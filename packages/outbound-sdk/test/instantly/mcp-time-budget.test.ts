// A long MCP tool call on Instantly's email lane (20 requests a minute) used
// to run for five minutes in silence while agent hosts gave up at one to
// five minutes and kept nothing (OUT-154). These runs give the MCP server a
// stand-in for Instantly that answers GET /emails with full pages, on a
// clock where waits take no real time, and check that the server reports
// progress, answers ping and cancellation during the call, and stops at its
// time budget with what it read.

import assert from "node:assert/strict";
import { test } from "node:test";

import { run } from "../../src/cli/index.ts";
import { instantly } from "../../src/instantly/index.ts";
import { createClock } from "../helpers/clock.ts";
import { fixture } from "../helpers/fixtures.ts";
import { createFetch, json } from "../helpers/http.ts";
import { KEY } from "./suite.ts";

const [template] = (
  fixture("instantly", "listReplies.json") as {
    items: Record<string, unknown>[];
  }
).items;

// 30 pages of 100 received emails, as GET /emails sends them.
const PAGES = 30;

const emailPage = (index: number): Response => {
  const items = Array.from({ length: 100 }, (_unused, offset) => {
    const { body_fallback_reason: _cut, ...email } = template ?? {};

    return {
      ...email,
      body: { text: "Thanks, send more." },
      id: `01a1d77f-0000-7000-8000-${String(index * 100 + offset).padStart(12, "0")}`,
    };
  });

  return json(
    index === PAGES - 1
      ? { items }
      : { items, next_starting_after: `page-${index + 1}` }
  );
};

const pageOf = (url: string): number => {
  const cursor = new URL(url).searchParams.get("starting_after");

  return cursor === null ? 0 : Number(cursor.replace("page-", ""));
};

interface Line {
  /** Virtual milliseconds since the run started, when the line was written. */
  readonly at: number;
  readonly message: {
    readonly id?: number;
    readonly method?: string;
    readonly params?: {
      readonly progress: number;
      readonly progressToken: string;
      readonly total?: number;
      readonly message: string;
    };
    readonly result?: {
      readonly structuredContent?: {
        readonly ok: boolean;
        readonly error?: { readonly message: string };
        readonly meta: {
          readonly complete: boolean;
          readonly notes: readonly string[];
        };
      };
    };
  };
}

// Each run gets its own key: the rate budget is per credential and lives as
// long as the process, so one test's lane use never slows another.
let runs = 0;

const mcp = async (
  argv: readonly string[],
  messages: (
    written: readonly Line[],
    sent: () => number
  ) => AsyncIterable<string>
) => {
  const clock = createClock();
  const lines: Line[] = [];
  const err: string[] = [];
  runs += 1;

  const http = createFetch((request) =>
    new URL(request.url).pathname === "/api/v2/emails"
      ? emailPage(pageOf(request.url))
      : json({ items: [] })
  );

  const code = await clock.settle(
    run(["mcp", ...argv], {
      adapter: instantly({
        apiKey: `${KEY}-budget-${runs}`,
        workspaceId: "client-a",
      }),
      fetch: http.fetch,
      runtime: clock.runtime,
      stderr: (text) => {
        err.push(text);
      },
      stdin: () => messages(lines, () => http.requests.length),
      stdout: (text) => {
        lines.push({ at: clock.elapsed(), message: JSON.parse(text) });
      },
    })
  );

  return { code, err: err.join("\n"), lines, requests: http.requests.length };
};

const droppedReplies = (id: number, progressToken?: number | string) =>
  JSON.stringify({
    id,
    jsonrpc: "2.0",
    method: "tools/call",
    params: {
      _meta: { progressToken },
      arguments: { since: "2025-12-01" },
      name: "dropped_replies",
    },
  });

const ping = (id: number) =>
  JSON.stringify({ id, jsonrpc: "2.0", method: "ping" });

const answerTo = (lines: readonly Line[], id: number) =>
  lines.find((line) => line.message.id === id);

// Lines given as they are, once the server is reading.
const given = (...messages: string[]) =>
  async function* send() {
    for (const message of messages) {
      yield message;
    }
  };

test("a long tool call with a progressToken hears progress well before its answer, naming the rate limit", async () => {
  const ran = await mcp(["--time-budget", "600"], () =>
    given(droppedReplies(1, "dropped"))()
  );

  assert.equal(ran.code, 0, ran.err);
  const answer = answerTo(ran.lines, 1);
  assert.ok(answer !== undefined, JSON.stringify(ran.lines.at(-1)));

  const progress = ran.lines.filter(
    (line) => line.message.method === "notifications/progress"
  );

  assert.ok(progress.length >= 3, String(progress.length));
  const [first] = progress;
  assert.ok((first?.at ?? Infinity) <= 30_000, String(first?.at));
  assert.ok((first?.at ?? Infinity) < answer.at);
  assert.equal(first?.message.params?.progressToken, "dropped");
  assert.equal(first?.message.params?.total, 600);

  const values = progress.map((line) => line.message.params?.progress ?? 0);
  assert.deepEqual(
    values,
    values.toSorted((left, right) => left - right)
  );
  assert.equal(new Set(values).size, values.length, "each progress is higher");

  assert.ok(
    progress.some((line) =>
      /waiting on rate limits\. Last wait: Waiting \d+s for Instantly's emails rate limit \(20 a minute; this process reads up to \d+ a minute\)/u.test(
        line.message.params?.message ?? ""
      )
    ),
    JSON.stringify(progress.map((line) => line.message.params?.message))
  );
});

test("a tool call without a progressToken gets no progress notifications", async () => {
  const ran = await mcp(["--time-budget", "120"], () =>
    given(droppedReplies(1))()
  );

  assert.equal(ran.code, 0, ran.err);
  assert.deepEqual(
    ran.lines.map((line) => line.message.id),
    [1]
  );
});

test("ping is answered at once while a long tool call is still running", async () => {
  const ran = await mcp(["--time-budget", "600"], () =>
    given(droppedReplies(1), ping(2))()
  );

  assert.equal(ran.code, 0, ran.err);
  const call = answerTo(ran.lines, 1);
  const pong = answerTo(ran.lines, 2);
  assert.ok(call !== undefined && pong !== undefined);
  assert.ok(pong.at < 1000, String(pong.at));
  assert.ok(call.at >= 60_000, String(call.at));
  assert.ok(ran.lines.indexOf(pong) < ran.lines.indexOf(call));
});

const TIME_NOTE =
  /dropped_replies stopped at its time budget of 60s: what it had not read would not have been read in time, so the answer leaves it out\. Call it again with less to read, such as fewer campaigns or a shorter range, or raise --time-budget on outbound mcp/u;

test("a call that runs out its time budget returns by then with what it read, marked incomplete", async () => {
  const ran = await mcp(["--time-budget", "60"], () =>
    given(droppedReplies(1))()
  );

  assert.equal(ran.code, 0, ran.err);
  const answer = answerTo(ran.lines, 1);
  const content = answer?.message.result?.structuredContent;
  assert.ok(answer !== undefined && content !== undefined);
  assert.ok(answer.at <= 65_000, String(answer.at));
  assert.equal(content.ok, true, JSON.stringify(content));
  assert.equal(content.meta.complete, false);
  assert.ok(
    content.meta.notes.some((note) => TIME_NOTE.test(note)),
    JSON.stringify(content.meta.notes)
  );
  // It read part of the replies, not all 30 pages and not none.
  assert.ok(ran.requests > 1 && ran.requests < PAGES, String(ran.requests));
});

test("by default a tool call answers inside the minute an agent host waits", async () => {
  const ran = await mcp([], () => given(droppedReplies(1))());

  assert.equal(ran.code, 0, ran.err);
  const answer = answerTo(ran.lines, 1);
  assert.ok(answer !== undefined);
  assert.ok(answer.at < 60_000, String(answer.at));
  assert.equal(answer.message.result?.structuredContent?.meta.complete, false);
});

test("a cancelled tool call stops reading and is not answered", async () => {
  let atCancel = 0;

  const ran = await mcp(["--time-budget", "600"], (written, sent) =>
    (async function* send() {
      yield droppedReplies(1, 1);

      // Cancelled once the call is under way, after its first progress.
      while (
        !written.some(
          (line) => line.message.method === "notifications/progress"
        )
      ) {
        // oxlint-disable-next-line no-await-in-loop -- waits for the server to write.
        await new Promise((resolve) => {
          setImmediate(resolve);
        });
      }

      atCancel = sent();

      yield JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/cancelled",
        params: { reason: "The user stopped it", requestId: 1 },
      });
      yield ping(2);
    })()
  );

  assert.equal(ran.code, 0, ran.err);
  assert.equal(answerTo(ran.lines, 1), undefined);
  assert.ok(answerTo(ran.lines, 2) !== undefined);
  const last = ran.lines.at(-1);
  assert.ok((last?.at ?? Infinity) < 30_000, String(last?.at));
  assert.ok(atCancel > 0);
  assert.equal(ran.requests, atCancel, "nothing is read after the cancel");
});

test("--time-budget takes a positive whole number of seconds", async () => {
  const ran = await mcp(["--time-budget", "0"], () => given()());

  assert.notEqual(ran.code, 0);
  assert.match(
    ran.err,
    /--time-budget takes a positive whole number of seconds, not "0"/u
  );
});
