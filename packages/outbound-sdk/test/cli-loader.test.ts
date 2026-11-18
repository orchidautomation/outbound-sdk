// OUT-161: the CLI as a loader. `--jsonl` writes a record per line as pages
// arrive and ends on one `{ meta, ok }` line; `--cursor` resumes where
// `meta.cursor` says; `leads --since` filters by creation time; a list
// `--limit` cut off exits 3, so a script cannot take it for a whole load.
// OUT-163: `stats --scope sender` reads every sender in batches.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { run } from "../src/cli/index.ts";
import type { CliIo } from "../src/cli/index.ts";
import { instantly } from "../src/instantly/index.ts";
import { memory } from "../src/memory/index.ts";
import type { MemoryData } from "../src/memory/index.ts";
import { createClock } from "./helpers/clock.ts";
import { createFetch, json } from "./helpers/http.ts";
import type { RecordedRequest } from "./helpers/http.ts";

const DAY = 86_400_000;
const START = Date.parse("2026-11-01T00:00:00.000Z");

const leads = (count: number) =>
  Array.from({ length: count }, (_, index) => ({
    campaignId: "c1",
    createdAt: new Date(START + index * DAY).toISOString(),
    email: `person${index + 1}@example.com`,
    id: `l${index + 1}`,
  }));

const address = (index: number) => `person${index + 1}@d${index}.example.com`;

const DATA: MemoryData = { campaigns: [{ id: "c1" }], leads: leads(12) };

const cli = async (argv: string[], io: Partial<CliIo> = {}) => {
  const out: string[] = [];
  const err: string[] = [];

  const code = await run(argv, {
    adapter: memory({ data: DATA, workspaceId: "acme" }),
    stderr: (text) => {
      err.push(text);
    },
    stdout: (text) => {
      out.push(text);
    },
    ...io,
  });

  return { code, err, out };
};

interface Line {
  readonly ref?: string;
  readonly ok?: boolean;
  readonly error?: { readonly code: string };
  readonly meta?: {
    readonly complete: boolean;
    readonly cursor?: string | null;
    readonly records: number;
    readonly repeats?: number;
    readonly notes: string[];
  };
}

const lines = (out: readonly string[]): Line[] =>
  out.map((line) => {
    assert.doesNotMatch(line, /\n/u, "one JSON value per line");

    return JSON.parse(line) as Line;
  });

test("--jsonl writes a record per line, then one meta line that counts them", async () => {
  const { code, out } = await cli(["leads", "--jsonl", "--limit", "100"]);
  const parsed = lines(out);
  const last = parsed.at(-1);

  assert.equal(code, 0);
  assert.equal(parsed.length, 13);
  assert.deepEqual(
    parsed.slice(0, -1).map((line) => line.ref),
    leads(12).map((lead) => `memory:acme:${lead.id}`)
  );
  assert.equal(last?.ok, true);
  assert.equal(last?.meta?.complete, true);
  assert.equal(last?.meta?.records, 12);
  assert.equal(last?.meta?.cursor, undefined, "nothing left to resume");
});

test("--limit cut off exits 3 with a cursor, and --cursor reads the rest with no repeat", async () => {
  const first = await cli(["leads", "--jsonl", "--limit", "5"]);
  const head = lines(first.out);
  const meta = head.at(-1)?.meta;

  assert.equal(first.code, 3, "a cut-off load is not a whole one");
  assert.equal(meta?.complete, false);
  assert.equal(meta?.records, 5);
  assert.equal(meta?.repeats, 0);
  assert.equal(typeof meta?.cursor, "string");
  assert.match(first.err.join("\n"), /To resume, pass --cursor \S+\./u);

  const rest = await cli([
    "leads",
    "--jsonl",
    "--limit",
    "100",
    "--cursor",
    String(meta?.cursor),
  ]);

  const tail = lines(rest.out);

  assert.equal(rest.code, 0);
  assert.deepEqual(
    [...head.slice(0, -1), ...tail.slice(0, -1)].map((line) => line.ref),
    leads(12).map((lead) => `memory:acme:${lead.id}`),
    "every lead once, in order"
  );

  // The envelope says the same.
  const envelope = await cli(["leads", "--limit", "5"]);

  const parsed = JSON.parse(envelope.out.join("\n")) as Line & {
    data: { items: unknown[] };
  };

  assert.equal(envelope.code, 3);
  assert.equal(parsed.meta?.cursor, meta?.cursor);
});

test("a cut inside a page says how many records the cursor reads again", async () => {
  // --since keeps the vendor's page size where the SDK filters by date.
  const { code, err, out } = await cli(
    ["leads", "--jsonl", "--since", "2026-11-01", "--limit", "3"],
    {
      adapter: memory({
        capabilities: { "leads.since": "client" },
        data: DATA,
        workspaceId: "acme",
      }),
    }
  );

  const meta = lines(out).at(-1)?.meta;

  assert.equal(code, 3);
  assert.equal(meta?.repeats, 3);
  assert.equal(meta?.cursor, null, "the first page: resume from the start");
  assert.match(
    err.join("\n"),
    /run it again without --cursor; the first 3 records it reads were printed already, so dedupe on ref/u
  );
});

test("leads --since keeps the leads created since then, and says when the SDK filtered", async () => {
  const server = await cli(["leads", "--since", "2026-11-10"]);

  const answer = JSON.parse(server.out.join("\n")) as {
    data: { items: { ref: string }[] };
    meta: { complete: boolean; notes: string[] };
  };

  assert.equal(server.code, 0);
  assert.deepEqual(
    answer.data.items.map((lead) => lead.ref),
    ["memory:acme:l10", "memory:acme:l11", "memory:acme:l12"]
  );
  assert.deepEqual(answer.meta.notes, []);

  const client = await cli(["leads", "--since", "2026-11-10", "--compact"], {
    adapter: memory({
      capabilities: { "leads.since": "client" },
      data: DATA,
      workspaceId: "acme",
    }),
  });

  const note =
    "memory cannot filter leads by date, so --since reads every one and keeps those since 2026-11-10: it costs as many requests as reading them all.";

  assert.equal(client.code, 0);
  assert.ok(client.err.includes(note));
  assert.ok(
    (JSON.parse(client.out.join("\n")) as typeof answer).meta.notes.includes(
      note
    )
  );
  assert.equal(
    (JSON.parse(client.out.join("\n")) as typeof answer).data.items.length,
    3
  );
});

test("a failure part way gives the cursor to resume from, on one line under --jsonl", async () => {
  const [account] = (
    JSON.parse(
      readFileSync(
        new URL(
          "../../../fixtures/instantly/listAccounts.json",
          import.meta.url
        ),
        "utf-8"
      )
    ) as { items: Record<string, unknown>[] }
  ).items;

  const http = createFetch((request: RecordedRequest) => {
    const url = new URL(request.url);

    return url.searchParams.has("starting_after")
      ? json({ message: "Unauthorized" }, 401)
      : json({
          items: [account, { ...account, email: "person2@example.com" }],
          next_starting_after: "person2@example.com",
        });
  });

  const clock = createClock();

  const { code, out } = await clock.settle(
    cli(["senders", "--jsonl", "--limit", "10"], {
      adapter: instantly({ apiKey: "inst_key_for_client_a_0001" }),
      fetch: http.fetch,
      runtime: clock.runtime,
    })
  );

  const parsed = lines(out);
  const last = parsed.at(-1);

  assert.equal(code, 1);
  assert.equal(parsed.length, 3, "the two senders read, then the failure");
  assert.equal(last?.ok, false);
  assert.equal(last?.error?.code, "Unauthorized");
  assert.equal(typeof last?.meta?.cursor, "string", "where page 2 starts");
});

test("stats --scope sender reads every sender in batches, a row per line with --jsonl", async () => {
  const [account] = (
    JSON.parse(
      readFileSync(
        new URL(
          "../../../fixtures/instantly/listAccounts.json",
          import.meta.url
        ),
        "utf-8"
      )
    ) as { items: Record<string, unknown>[] }
  ).items;

  const http = createFetch((request: RecordedRequest) => {
    const url = new URL(request.url);

    if (url.pathname === "/api/v2/accounts") {
      return json({
        items: Array.from({ length: 3 }, (_, index) => ({
          ...account,
          email: address(index),
        })),
      });
    }

    if (url.pathname === "/api/v2/accounts/analytics/daily") {
      return json(
        url.searchParams.getAll("emails").map((email) => ({
          date: "2026-11-02",
          email_account: email,
          sent: 4,
        }))
      );
    }

    return json(url.pathname === "/api/v2/campaigns" ? { items: [] } : []);
  });

  const clock = createClock();

  const { code, out } = await clock.settle(
    cli(
      [
        "stats",
        "--scope",
        "sender",
        "--by",
        "day",
        "--from",
        "2026-11-01",
        "--to",
        "2026-11-07",
        "--jsonl",
      ],
      {
        adapter: instantly({ apiKey: "inst_key_for_client_a_0001" }),
        fetch: http.fetch,
        runtime: clock.runtime,
      }
    )
  );

  const parsed = lines(out);

  assert.equal(code, 0);
  assert.equal(parsed.length, 4, "three sender rows, then the meta line");
  assert.equal(
    http.requests.filter(
      (request) =>
        new URL(request.url).pathname === "/api/v2/accounts/analytics/daily"
    ).length,
    1,
    "the three senders in one daily read"
  );
  assert.equal(parsed.at(-1)?.meta?.records, 3);

  const refused = await cli(["stats", "--scope", "campaign", "--sender", "x"]);
  assert.equal(refused.code, 1);
});
