// The Instantly email lane allows 20 requests a minute (OUT-114). A long read
// on it used to stop for a minute with nothing on stderr and no throttle time
// in the answer, so people and agents took it for a hang. These runs give
// the CLI and the MCP server a stand-in for Instantly that answers
// GET /emails with full pages, on a clock where waits take no real time.

import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { run, throttleMonitor } from "../../src/cli/index.ts";
import { instantly } from "../../src/instantly/index.ts";
import { createClock } from "../helpers/clock.ts";
import { fixture } from "../helpers/fixtures.ts";
import { createFetch, json } from "../helpers/http.ts";
import type { Reply } from "../helpers/http.ts";
import { KEY } from "./suite.ts";

const [template] = (
  fixture("instantly", "listReplies.json") as {
    items: Record<string, unknown>[];
  }
).items;

// One page of received emails as GET /emails sends it, 100 to a page.
const emailPage = (index: number, last: boolean): Response => {
  const items = Array.from({ length: 100 }, (_unused, offset) => {
    const { body_fallback_reason: _cut, ...email } = template ?? {};

    return {
      ...email,
      body: { text: "Thanks, send more." },
      id: `01a1d77f-0000-7000-8000-${String(index * 100 + offset).padStart(12, "0")}`,
    };
  });

  return json(
    last ? { items } : { items, next_starting_after: `page-${index + 1}` }
  );
};

const pageOf = (url: string): number => {
  const cursor = new URL(url).searchParams.get("starting_after");

  return cursor === null ? 0 : Number(cursor.replace("page-", ""));
};

// A workspace with `pages` pages of replies. `refuse` answers 429 to the
// request with that index, as Instantly does when another process on the
// same workspace has spent the lane.
const workspace = (pages: number, refuse?: number) =>
  createFetch((request, index): Reply => {
    if (index === refuse) {
      return json(
        {
          error: "Too Many Requests",
          message: "Rate limit exceeded",
          statusCode: 429,
        },
        429
      );
    }

    if (new URL(request.url).pathname === "/api/v2/emails") {
      const page = pageOf(request.url);

      return emailPage(page, page === pages - 1);
    }

    return json({ items: [] });
  });

interface Ran {
  readonly code: number;
  readonly out: string[];
  readonly err: string[];
  readonly elapsed: number;
  readonly requests: number;
}

// The rate budget is per credential and lives as long as the process, so
// each run gets its own key: one test's lane use never slows another.
let runs = 0;

const outbound = async (
  argv: string[],
  options: { pages?: number; refuse?: number; stdin?: string[] } = {}
): Promise<Ran> => {
  const clock = createClock();
  const http = workspace(options.pages ?? 30, options.refuse);
  const out: string[] = [];
  const err: string[] = [];
  runs += 1;

  const code = await clock.settle(
    run(argv, {
      adapter: instantly({ apiKey: `${KEY}-${runs}`, workspaceId: "client-a" }),
      fetch: http.fetch,
      runtime: clock.runtime,
      stderr: (text) => {
        err.push(text);
      },
      stdin:
        options.stdin === undefined ? undefined : () => options.stdin ?? [],
      stdout: (text) => {
        out.push(text);
      },
    })
  );

  return {
    code,
    elapsed: clock.elapsed(),
    err,
    out,
    requests: http.requests.length,
  };
};

interface Envelope {
  readonly ok: boolean;
  readonly data: { readonly items: unknown[] };
  readonly meta: { readonly requests: number; readonly throttledMs: number };
}

const WAITING =
  /^Waiting (?<seconds>\d+)s for Instantly's emails rate limit \(10 a minute\)…$/u;

test("replies past the lane's minute says on stderr what it waits for, and meta.throttledMs says how long", async () => {
  const ran = await outbound(["replies", "--limit", "2000", "--compact"]);

  assert.equal(ran.code, 0, ran.err.join("\n"));
  assert.equal(ran.out.length, 1);
  const answer = JSON.parse(ran.out[0] ?? "") as Envelope;
  assert.equal(answer.data.items.length, 2000);
  // 20 pages on the emails lane, and each page's lookup of its leads' ids on
  // the default lane (OUT-149).
  assert.equal(answer.meta.requests, 40);

  // Half of Instantly's 20 a minute is 10: ten pages go at once, the eleventh
  // waits for the minute to pass. The live run took 62.6 s for 20 requests.
  const waits = ran.err.filter((line) => WAITING.test(line));
  assert.equal(waits.length, 1, ran.err.join("\n"));
  assert.equal(WAITING.exec(waits[0] ?? "")?.groups?.seconds, "60");
  assert.ok(ran.elapsed >= 60_000, String(ran.elapsed));
  assert.equal(answer.meta.throttledMs, ran.elapsed);
});

test("a read that never waits has throttledMs 0 in meta and prints nothing on stderr", async () => {
  const ran = await outbound(["replies", "--limit", "200", "--compact"]);
  const answer = JSON.parse(ran.out[0] ?? "") as Envelope;

  // Two pages and their two lookups of the leads' ids (OUT-149).
  assert.equal(answer.meta.requests, 4);
  assert.equal(answer.meta.throttledMs, 0);
  assert.deepEqual(
    ran.err.filter((line) => /rate limit/u.test(line)),
    []
  );
});

test("a failed command still carries throttledMs in its meta", async () => {
  const ran = await outbound(["replies", "--limit", "abc", "--compact"]);
  const answer = JSON.parse(ran.out[0] ?? "") as Envelope;

  assert.equal(answer.ok, false);
  assert.equal(answer.meta.throttledMs, 0);
});

test("a 429 from another process on the workspace is reported as throttled by Instantly, then the read finishes", async () => {
  // Request 2 is the second page of emails; request 1 is the first page's
  // lookup of its leads' ids on the default lane (OUT-149).
  const ran = await outbound(["replies", "--limit", "300", "--compact"], {
    refuse: 2,
  });

  assert.equal(ran.code, 0, ran.err.join("\n"));
  const answer = JSON.parse(ran.out[0] ?? "") as Envelope;
  assert.equal(answer.data.items.length, 300);

  const throttled = ran.err.filter((line) => /rate limit/u.test(line));
  const [line] = throttled;
  assert.equal(throttled.length, 1, ran.err.join("\n"));
  assert.match(
    line ?? "",
    /^Throttled by Instantly: it answered 429 on Instantly's emails rate limit/u
  );
  assert.match(line ?? "", /another process or tool on the same workspace/u);
  assert.match(line ?? "", /rateLimitStore in a --config file/u);

  // Instantly sends no Retry-After, so the lane waits for one more request
  // to fit its 20 a minute: 3 s.
  assert.ok(answer.meta.throttledMs >= 3000, String(answer.meta.throttledMs));
});

interface ToolCall {
  readonly result: {
    readonly structuredContent: {
      readonly ok: boolean;
      readonly meta: {
        readonly notes: string[];
        readonly throttledMs?: number;
      };
    };
  };
}

const call = (id: number): string =>
  JSON.stringify({
    id,
    jsonrpc: "2.0",
    method: "tools/call",
    params: { arguments: { limit: 50 }, name: "reply_samples" },
  });

test("an MCP tool call that waits more than 5 s on the lane says so in meta.notes", async () => {
  const ran = await outbound(["mcp"], {
    stdin: Array.from({ length: 11 }, (_unused, index) => call(index + 1)),
  });

  assert.equal(ran.code, 0, ran.err.join("\n"));
  const results = ran.out.map((line) => JSON.parse(line) as ToolCall);
  assert.equal(results.length, 11);

  const quick = results[0]?.result.structuredContent;
  const slow = results[10]?.result.structuredContent;
  assert.equal(quick?.ok, true);
  assert.equal(quick?.meta.throttledMs, undefined);
  assert.ok(!quick?.meta.notes.some((note) => /rate limits/u.test(note)));

  assert.equal(slow?.ok, true);
  assert.ok((slow?.meta.throttledMs ?? 0) > 5000, JSON.stringify(slow?.meta));
  assert.ok(
    slow?.meta.notes.some((note) =>
      /^This call waited \d+s on rate limits, so it was slow, not stuck\. Last wait: Waiting \d+s for Instantly's emails rate limit/u.test(
        note
      )
    ),
    JSON.stringify(slow?.meta.notes)
  );
  // The server's stdout is the protocol; the wait goes to stderr.
  assert.ok(
    ran.err.some((line) => WAITING.test(line)),
    ran.err.join("\n")
  );
});

test("a --config file's rateLimitStore holds the budget, so processes that share it share the lane", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "outbound-store-"));
  const file = path.join(directory, "outbound.config.mjs");
  const sdk = new URL("../../src/index.ts", import.meta.url).href;

  // A store that counts into a MemoryRateLimitStore and records each key it
  // was asked about, standing in for redisRateLimitStore().
  await writeFile(
    file,
    [
      `import { MemoryRateLimitStore } from ${JSON.stringify(sdk)};`,
      "const memory = new MemoryRateLimitStore();",
      "export const keys = [];",
      "export default {",
      "  rateLimitStore: {",
      "    pause: (key, until) => memory.pause(key, until),",
      "    reserve: (key, windows, now) => { keys.push(key); return memory.reserve(key, windows, now); },",
      "    usage: (key, windows, now) => memory.usage(key, windows, now),",
      "  },",
      "};",
      "",
    ].join("\n")
  );

  const ran = await outbound([
    "replies",
    "--limit",
    "300",
    "--compact",
    "--config",
    file,
  ]);

  assert.equal(ran.code, 0, ran.err.join("\n"));

  const { keys } = (await import(file)) as { keys: string[] };
  assert.equal(keys.filter((key) => key.endsWith("#emails")).length, 3);
});

test("a --config file whose rateLimitStore is not a store is refused", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "outbound-store-"));
  const file = path.join(directory, "outbound.config.mjs");
  await writeFile(file, 'export default { rateLimitStore: "redis" };\n');

  const ran = await outbound(["replies", "--config", file, "--compact"]);
  assert.equal(ran.code, 1);
  assert.match(
    ran.err.join("\n"),
    /must export rateLimitStore as a rate limit store/u
  );
});

test("a wait counts as it elapses, so the tool call that sits through it is the one charged", () => {
  let now = 0;
  const said: string[] = [];

  const monitor = throttleMonitor(
    () => now,
    (text) => {
      said.push(text);
    }
  );

  const wait = (waitMs: number) => {
    monitor.hooks.onThrottle?.({
      cause: "budget",
      lane: "emails",
      provider: "instantly",
      waitMs,
      windows: [{ perMs: 60_000, requests: 10 }],
    });
  };

  // A tool call books a minute's wait and fails a second later, as
  // person_summary does when its campaign lookup fails beside a timeline read.
  wait(60_000);
  assert.equal(monitor.total().ms, 0, "nothing has elapsed yet");
  now = 1000;
  const first = monitor.total().ms;
  assert.equal(first, 1000);

  // The next call waits out the rest of that minute itself.
  wait(59_000);
  now = 60_000;
  assert.equal(monitor.total().ms - first, 59_000);

  // A later, separate wait adds its own time once it has passed.
  now = 70_000;
  wait(5000);
  now = 72_000;
  assert.equal(monitor.total().ms, 62_000);
  now = 80_000;
  assert.equal(monitor.total().ms, 65_000);
  assert.equal(
    said.length,
    2,
    "the second wait fell inside the first one's line"
  );
});
