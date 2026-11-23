import assert from "node:assert/strict";
import { test } from "node:test";

import { run } from "../src/cli/index.ts";
import type { Adapter } from "../src/index.ts";
import { demoData, memory } from "../src/memory/index.ts";
import { createFetch, json, testAdapter } from "./helpers/http.ts";

const demo = () =>
  memory({
    data: demoData({ now: "2026-10-08T12:00:00.000Z" }),
    workspaceId: "acme",
  });

const cli = async (
  argv: string[],
  setup: { adapter?: Adapter; fetch?: typeof fetch } = {}
) => {
  const out: string[] = [];
  const err: string[] = [];

  const code = await run(argv, {
    adapter: setup.adapter ?? demo(),
    fetch: setup.fetch,
    stderr: (text) => {
      err.push(text);
    },
    stdout: (text) => {
      out.push(text);
    },
  });

  return {
    code,
    err: err.join("\n"),
    json: () => JSON.parse(out.join("\n")) as never,
    out: out.join("\n"),
  };
};

interface Envelope {
  ok: boolean;
  data: Record<string, unknown> | null;
  error?: { code: string; message: string };
  meta: {
    complete: boolean;
    notes: string[];
    provider: string | null;
    requests: number;
    [key: string]: unknown;
  };
  next?: string;
}

const COMMANDS: string[][] = [
  ["campaigns"],
  ["campaigns", "--limit", "1"],
  ["campaign", "cmp_founders"],
  ["campaign", "cmp_founders", "--stats", "--sequence"],
  ["stats"],
  ["senders"],
  ["leads"],
  ["lists"],
  ["tags"],
  ["replies", "--limit", "1"],
  ["replies", "--by", "person"],
  ["limits"],
  ["tools"],
  ["native"],
  ["tool", "campaigns", "--input", "{}"],
  ["insight"],
  ["insight", "step_funnel", "--input", '{"campaign":"cmp_founders"}'],
  ["person", "person1@example.com"],
  ["capabilities"],
  ["providers"],
];

test("every command prints ok, data and meta with complete, notes, provider and requests", async () => {
  for (const argv of COMMANDS) {
    // oxlint-disable-next-line no-await-in-loop -- each command reads its own fresh demo.
    const ran = await cli(argv);
    const answer = ran.json() as Envelope;
    const what = argv.join(" ");

    // A list --limit cut exits 3 and says where to resume.
    assert.equal(ran.code, "cursor" in answer.meta ? 3 : 0, what);
    assert.equal(answer.ok, true, what);
    assert.ok("data" in answer, what);
    assert.equal(typeof answer.meta.complete, "boolean", what);
    assert.ok(Array.isArray(answer.meta.notes), what);
    assert.equal(
      answer.meta.provider,
      argv[0] === "providers" ? null : "memory",
      what
    );
    assert.equal(answer.meta.requests, 0, `${what}: the demo sends no HTTP`);

    const keys = Object.keys(answer).filter((key) => key !== "next");
    assert.deepEqual(keys.toSorted(), ["data", "meta", "ok"], what);
  }

  // A list is never a bare array.
  const providers = (await cli(["providers"])).json() as Envelope;
  assert.ok(Array.isArray(providers.data?.items));
  assert.equal(providers.meta.complete, true);
});

test("a list goes in data.items, and stdout says when --limit cut it", async () => {
  const cut = await cli(["campaigns", "--limit", "1"]);
  const answer = cut.json() as Envelope;

  assert.equal(cut.code, 3, "a cut-off list is not a whole one");
  assert.equal((answer.data?.items as unknown[] | undefined)?.length, 1);
  assert.equal(answer.meta.complete, false);
  assert.equal(typeof answer.meta.cursor, "string");
  assert.equal(answer.meta.repeats, 0, "the page ended where --limit did");
  assert.deepEqual(answer.meta.notes, [
    "Stopped at 1 campaign; more exist. Pass --limit to read more.",
    `To resume, pass --cursor ${String(answer.meta.cursor)}.`,
  ]);
  // People still read the note on stderr.
  assert.match(cut.err, /Stopped at 1 campaign; more exist/u);

  const whole = (await cli(["campaigns"])).json() as Envelope;
  assert.equal((whole.data?.items as unknown[] | undefined)?.length, 2);
  assert.equal(whole.meta.complete, true);
  assert.deepEqual(whole.meta.notes, []);

  const replies = (await cli(["replies"])).json() as Envelope;

  // The demo has one reply, so nothing was cut; the note says who sent it.
  assert.equal(replies.meta.complete, true);
  assert.deepEqual(replies.meta.notes, [
    "1 message from 1 person in 1 thread.",
  ]);
});

test("the envelope lifts a record's meta and leaves the record in data", async () => {
  const record = (await cli(["campaign", "cmp_founders"])).json() as Envelope;

  assert.equal(record.data?.name, "Q4 SaaS founders");
  assert.ok(!("meta" in (record.data ?? {})), "meta is not repeated in data");
  assert.equal(record.meta.complete, true);
  assert.equal(record.meta.evidence, "exact");

  const both = (
    await cli(["campaign", "cmp_founders", "--stats", "--sequence"])
  ).json() as Envelope;

  assert.deepEqual(Object.keys(both.data ?? {}).toSorted(), [
    "sequence",
    "stats",
  ]);
  assert.equal(both.meta.complete, true);

  const insight = (
    await cli([
      "insight",
      "step_funnel",
      "--input",
      '{"campaign":"cmp_founders"}',
    ])
  ).json() as Envelope;

  assert.equal(insight.meta.insight, "step_funnel");
  assert.ok(!("insight" in (insight.data ?? {})), "data is the answer itself");
});

test("an unknown thread, campaign, sender, or leads scope fails with NotFound in the envelope", async () => {
  for (const argv of [
    ["thread", "nope"],
    ["campaign", "cmp_nope"],
    ["health", "nope"],
    ["leads", "--list", "nope"],
    ["leads", "--campaign", "cmp_nope"],
  ]) {
    // oxlint-disable-next-line no-await-in-loop -- each command reads its own fresh demo.
    const failed = await cli([...argv, "--compact"]);
    const answer = failed.json() as Envelope;

    assert.equal(failed.code, 1, argv.join(" "));
    assert.equal(answer.ok, false);
    assert.equal(answer.data, null);
    assert.equal(answer.error?.code, "NotFound", argv.join(" "));
    assert.equal(answer.meta.complete, false);
    assert.match(failed.err, /^NotFound: /u);
  }

  // A refused option, or an unknown command, fails in the envelope too.
  const refused = await cli(["campaigns", "--nope"]);
  assert.equal(refused.code, 1);
  assert.equal((refused.json() as Envelope).error?.code, "Invalid");
});

test("the envelope carries a tool's meta.complete and meta.notes, and its failure as ok: false", async () => {
  const cut = (
    await cli(["tool", "campaigns", "--input", '{"limit":1,"status":"active"}'])
  ).json() as Envelope;

  assert.equal(cut.ok, true);
  assert.ok(Array.isArray(cut.data?.campaigns));
  assert.equal(typeof cut.next, "string");
  assert.equal(cut.meta.complete, true, "one active campaign exists");

  const failed = await cli([
    "tool",
    "campaigns",
    "--input",
    '{"view":"trend","campaign":"cmp_nope"}',
  ]);

  const answer = failed.json() as Envelope;
  assert.equal(failed.code, 1);
  assert.equal(answer.ok, false);
  assert.equal(answer.data, null);
  assert.equal(typeof answer.error?.code, "string");
  assert.equal(answer.meta.complete, false);
});

test("meta.requests counts the vendor requests the command sent", async () => {
  const http = createFetch(() =>
    json({
      items: [
        { id: "c1", name: "One" },
        { id: "c2", name: "Two" },
      ],
    })
  );

  const answer = (
    await cli(["campaigns"], {
      adapter: testAdapter(),
      fetch: http.fetch,
    })
  ).json() as Envelope;

  assert.ok(http.requests.length > 0);
  assert.equal(answer.meta.requests, http.requests.length);
  assert.equal(answer.meta.provider, "testvendor");
});
