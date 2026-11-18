// Replies are messages, not people (OUT-88). One lead who writes twice in a
// thread is two replies and one person; the CLI and the reply_samples tool
// must both say so.

import assert from "node:assert/strict";
import { test } from "node:test";

import { run } from "../src/cli/index.ts";
import { createOutbound } from "../src/index.ts";
import { memory } from "../src/memory/index.ts";
import type { MemoryData } from "../src/memory/index.ts";
import { createTools } from "../src/tools/index.ts";

type Seed = NonNullable<MemoryData["messages"]>[number];

const reply = (
  id: string,
  leadId: string | undefined,
  threadId: string | undefined,
  sentAt: string,
  category: "positive" | "neutral" = "positive"
): Seed => {
  const seed: { -readonly [Key in keyof Seed]: Seed[Key] } = {
    campaignId: "cmp_1",
    category,
    direction: "in",
    id,
    isAuto: false,
    sentAt,
  };

  if (leadId !== undefined) {
    seed.leadId = leadId;
  }

  if (threadId !== undefined) {
    seed.threadId = threadId;
  }

  return seed;
};

// The Databricks case: one person, two messages, one thread ("send me a
// link", then "booked the 18th"), and someone else once.
const ONE_PERSON_TWICE = [
  reply("msg_1", "lead_1", "thr_1", "2026-11-10T09:00:00.000Z"),
  reply("msg_2", "lead_1", "thr_1", "2026-11-11T10:00:00.000Z"),
  reply("msg_3", "lead_2", "thr_2", "2026-11-12T11:00:00.000Z", "neutral"),
];

const adapter = (messages: readonly Seed[]) =>
  memory({ data: { messages }, workspaceId: "acme" });

const cli = async (
  messages: readonly Seed[],
  ...argv: string[]
): Promise<{ code: number; err: string[]; json: unknown; notes: unknown }> => {
  const out: string[] = [];
  const err: string[] = [];

  const code = await run(["replies", "--compact", ...argv], {
    adapter: adapter(messages),
    stderr: (text) => {
      err.push(text);
    },
    stdout: (text) => {
      out.push(text);
    },
  });

  const printed = JSON.parse(out.join("")) as {
    data: { items: unknown } | null;
    meta: { notes: unknown };
  };

  // The records, inside the envelope (`null` on failure), and the notes stdout carries.
  return {
    code,
    err,
    json: printed.data?.items ?? null,
    notes: printed.meta.notes,
  };
};

test("replies: stderr and stdout's meta say how many people and threads sent the messages; data is the records", async () => {
  const { code, err, json, notes } = await cli(ONE_PERSON_TWICE);

  assert.equal(code, 0);
  assert.deepEqual(err, ["3 messages from 2 people in 2 threads."]);
  assert.deepEqual(notes, err);
  assert.ok(Array.isArray(json));
  assert.deepEqual(
    (json as { ref: string }[]).map((record) => record.ref),
    ["memory:acme:msg_1", "memory:acme:msg_2", "memory:acme:msg_3"].toSorted()
  );
});

test("replies --by person: one row per person, with their message count", async () => {
  const { code, json } = await cli(
    ONE_PERSON_TWICE,
    "--category",
    "positive",
    "--by",
    "person"
  );

  assert.equal(code, 0);
  assert.deepEqual(json, [
    {
      automatic: 0,
      categories: ["positive"],
      firstAt: "2026-11-10T09:00:00.000Z",
      lastAt: "2026-11-11T10:00:00.000Z",
      leadEmail: null,
      leadRef: "memory:acme:lead_1",
      messages: 2,
      threadIds: ["thr_1"],
    },
  ]);
});

test("replies: people are not counted when a reply has no lead, and those replies group by thread", async () => {
  const messages = [
    ...ONE_PERSON_TWICE,
    reply("msg_4", undefined, "thr_3", "2026-11-13T09:00:00.000Z"),
    reply("msg_5", undefined, "thr_3", "2026-11-13T10:00:00.000Z"),
    reply("msg_6", undefined, undefined, "2026-11-14T10:00:00.000Z"),
  ];

  const summary = await cli(messages);

  // msg_6 has no thread either, so neither count is known.
  assert.deepEqual(summary.err, ["6 messages."]);

  const people = (await cli(messages, "--by", "person")).json as {
    leadRef: string | null;
    messages: number;
    threadIds: string[];
  }[];

  assert.deepEqual(
    people.map((row) => [row.leadRef, row.messages, row.threadIds]),
    [
      ["memory:acme:lead_1", 2, ["thr_1"]],
      ["memory:acme:lead_2", 1, ["thr_2"]],
      [null, 2, ["thr_3"]],
      [null, 1, []],
    ]
  );

  const threadsKnown = await cli(messages.slice(0, 5));
  assert.deepEqual(threadsKnown.err, ["5 messages in 3 threads."]);
});

test("replies: --by takes only person", async () => {
  const { code, err } = await cli(ONE_PERSON_TWICE, "--by", "day");

  assert.equal(code, 1);
  assert.match(err.join("\n"), /--by must be one of: person/u);
});

test("replies: no replies is 0 messages from 0 people", async () => {
  const { err, json } = await cli([]);

  assert.deepEqual(json, []);
  assert.deepEqual(err, ["0 messages from 0 people in 0 threads."]);
});

const replySamples = (messages: readonly Seed[]) => {
  const tool = createTools(createOutbound({ adapter: adapter(messages) })).find(
    (candidate) => candidate.name === "reply_samples"
  );

  assert.ok(tool);

  return tool;
};

test("reply_samples: says each record is a message and counts unique people and threads", async () => {
  const tool = replySamples(ONE_PERSON_TWICE);

  assert.match(tool.description, /one message, not one person/u);

  const result = await tool.call({});
  assert.ok(result.ok);

  const data = result.data as {
    replies: unknown[];
    unique_people: number | null;
    unique_threads: number | null;
  };

  assert.equal(data.replies.length, 3);
  assert.equal(data.unique_people, 2);
  assert.equal(data.unique_threads, 2);
});

test("reply_samples by person: one row per person", async () => {
  const result = await replySamples(ONE_PERSON_TWICE).call({
    by: "person",
    category: "positive",
  });

  assert.ok(result.ok);

  assert.deepEqual(result.data, {
    automatic: 0,
    people: [
      {
        automatic: 0,
        categories: ["positive"],
        first_at: "2026-11-10T09:00:00.000Z",
        last_at: "2026-11-11T10:00:00.000Z",
        lead: "memory:acme:lead_1",
        lead_email: null,
        messages: 2,
        thread_ids: ["thr_1"],
      },
    ],
    unique_people: 1,
    unique_threads: 1,
  });
});

test("reply_samples: unique_people is null, not a guess, when a reply has no lead", async () => {
  const result = await replySamples([
    ...ONE_PERSON_TWICE,
    reply("msg_4", undefined, "thr_3", "2026-11-13T09:00:00.000Z"),
  ]).call({});

  assert.ok(result.ok);

  const data = result.data as {
    unique_people: unknown;
    unique_threads: unknown;
  };

  assert.equal(data.unique_people, null);
  assert.equal(data.unique_threads, 3);
});

// OUT-146: Instantly labelled four automatic replies positive. A positive
// count must be able to leave them out, so both surfaces count them apart.
const POSITIVE_AND_AUTOMATIC = [
  ...ONE_PERSON_TWICE.slice(0, 2),
  {
    ...reply("msg_4", "lead_3", "thr_3", "2026-11-12T11:00:00.000Z"),
    isAuto: true,
  },
];

test("replies: a positive count says how many of its replies are automatic", async () => {
  const messages = await cli(POSITIVE_AND_AUTOMATIC, "--category", "positive");

  assert.deepEqual(messages.err, [
    "3 messages from 2 people in 2 threads, 1 of them automatic.",
  ]);

  const people = await cli(
    POSITIVE_AND_AUTOMATIC,
    "--category",
    "positive",
    "--by",
    "person"
  );

  assert.deepEqual(
    (people.json as { automatic: number; leadRef: string }[]).map(
      ({ automatic, leadRef }) => ({ automatic, leadRef })
    ),
    [
      { automatic: 0, leadRef: "memory:acme:lead_1" },
      { automatic: 1, leadRef: "memory:acme:lead_3" },
    ]
  );
});

test("reply_samples: automatic counts the automatic replies a category holds, and is null when unknown", async () => {
  const known = await replySamples(POSITIVE_AND_AUTOMATIC).call({
    category: "positive",
  });

  assert.ok(known.ok);
  assert.equal((known.data as { automatic: unknown }).automatic, 1);

  const { isAuto: _flagged, ...unflagged } = reply(
    "msg_5",
    "lead_4",
    "thr_4",
    "2026-11-13T09:00:00.000Z"
  );

  const unknown = await replySamples([...ONE_PERSON_TWICE, unflagged]).call({});

  assert.ok(unknown.ok);
  assert.equal((unknown.data as { automatic: unknown }).automatic, null);
});

test("reply_samples: an unknown by is refused", async () => {
  const result = await replySamples(ONE_PERSON_TWICE).call({ by: "thread" });

  assert.equal(result.ok, false);
});
