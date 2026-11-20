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
      provider: "memory",
      threadIds: ["thr_1"],
      workspaceId: "acme",
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
    uniquePeople: number | null;
    uniqueThreads: number | null;
  };

  assert.equal(data.replies.length, 3);
  assert.equal(data.uniquePeople, 2);
  assert.equal(data.uniqueThreads, 2);
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
        firstAt: "2026-11-10T09:00:00.000Z",
        lastAt: "2026-11-11T10:00:00.000Z",
        lead: "memory:acme:lead_1",
        leadEmail: null,
        messages: 2,
        provider: "memory",
        threadIds: ["thr_1"],
        workspaceId: "acme",
      },
    ],
    uniquePeople: 1,
    uniqueThreads: 1,
  });
});

test("reply_samples: uniquePeople is null, not a guess, when a reply has no lead", async () => {
  const result = await replySamples([
    ...ONE_PERSON_TWICE,
    reply("msg_4", undefined, "thr_3", "2026-11-13T09:00:00.000Z"),
  ]).call({});

  assert.ok(result.ok);

  const data = result.data as {
    uniquePeople: unknown;
    uniqueThreads: unknown;
  };

  assert.equal(data.uniquePeople, null);
  assert.equal(data.uniqueThreads, 3);
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

// OUTB-24: by person, limit 20 gave 12 people, since limit counted messages.
const THREE_PEOPLE_TWICE = ["lead_1", "lead_2", "lead_3"].flatMap(
  (lead, index) => [
    reply(
      `msg_${index}a`,
      lead,
      `thr_${index}`,
      `2026-11-1${index}T09:00:00.000Z`
    ),
    reply(
      `msg_${index}b`,
      lead,
      `thr_${index}`,
      `2026-11-1${index}T10:00:00.000Z`
    ),
  ]
);

test("reply_samples by person: limit counts people, not messages", async () => {
  const tool = replySamples(THREE_PEOPLE_TWICE);
  const all = await tool.call({ by: "person", limit: 3 });

  assert.ok(all.ok);

  const { people } = all.data as { people: { messages: number }[] };
  assert.deepEqual(
    people.map((person) => person.messages),
    [2, 2, 2],
    "three people, each with both messages, from a limit of 3"
  );
  assert.equal(all.meta.complete, true);
  assert.deepEqual(all.meta.notes, []);

  const two = await tool.call({ by: "person", limit: 2 });

  assert.ok(two.ok);
  assert.equal((two.data as { people: unknown[] }).people.length, 2);
  assert.equal(two.meta.complete, false);
  assert.match(
    String(two.meta.notes),
    /Stopped at 2 people \(limit\); more people replied/u
  );

  const messages = await tool.call({ limit: 3 });

  assert.ok(messages.ok);
  assert.equal(
    (messages.data as { replies: unknown[] }).replies.length,
    3,
    "by message, limit still counts messages"
  );
  assert.match(String(messages.meta.notes), /Stopped at 3 replies \(limit\)/u);
});
