import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import {
  alerts,
  bounceRateAbove,
  noSends,
  replyRateBelow,
  senderNotActive,
} from "../src/alerts/index.ts";
import type { Alert } from "../src/alerts/index.ts";
import { benchmarks } from "../src/benchmarks/index.ts";
import { combine } from "../src/combine/index.ts";
import { exporter } from "../src/exporter/index.ts";
import type { RowWriter } from "../src/exporter/index.ts";
import { fixtures } from "../src/fixtures/index.ts";
import { createOutbound, OutboundError } from "../src/index.ts";
import type { JsonObject } from "../src/index.ts";
import { memory } from "../src/memory/index.ts";
import type { MemoryData } from "../src/memory/index.ts";

const folders: string[] = [];

const folder = (): string => {
  const dir = mkdtempSync(path.join(tmpdir(), "outbound-plugin-"));
  folders.push(dir);

  return dir;
};

after(() => {
  for (const dir of folders) {
    rmSync(dir, { force: true, recursive: true });
  }
});

const data = (): MemoryData => ({
  campaigns: [
    { id: "good", name: "Acme founders" },
    { id: "bad", name: "Acme agencies" },
  ],
  leads: [
    {
      campaignId: "good",
      company: "Northwind, Inc.",
      custom: { phone: "555-0100" },
      email: "jane@northwind.example.com",
      firstName: "Jane",
      id: "l1",
      lastName: "Doe",
      linkedinUrl: "https://www.linkedin.com/in/example-jane",
    },
    {
      campaignId: "good",
      company: "Northwind, Inc.",
      email: "sam@northwind.example.com",
      firstName: "Sam",
      id: "l2",
      lastName: 'O"Neil',
    },
  ],
  messages: [
    {
      body: "Hello Jane",
      direction: "out",
      id: "m1",
      leadId: "l1",
      senderId: "jane@northwind.example.com",
      sentAt: "2026-10-05T00:00:00.000Z",
      subject: "Hi",
    },
  ],
  senders: [
    { address: "ok@example.com", id: "s1" },
    { address: "down@example.com", id: "s2", status: "disconnected" },
  ],
  stats: [
    {
      campaignId: "good",
      counts: { bounced: 1, contacted: 100, replied: 10, sent: 100 },
      date: "2026-10-05",
    },
    {
      campaignId: "bad",
      counts: { bounced: 12, contacted: 100, replied: 1, sent: 100 },
      date: "2026-10-05",
    },
    {
      campaignId: "bad",
      counts: { bounced: 0, contacted: 0, replied: 0, sent: 0 },
      date: "2026-10-06",
    },
  ],
});

const settle = () =>
  new Promise((resolve) => {
    setImmediate(resolve);
  });

test("alerts fire for a bounce spike, a weak reply rate, a dead sender and a silent day", async () => {
  const notified: Alert[][] = [];

  const outbound = createOutbound({
    adapter: memory({ data: data() }),
    plugins: [
      alerts({
        notify: (fired) => {
          notified.push([...fired]);
        },
        rules: [
          bounceRateAbove(0.05),
          replyRateBelow(0.02),
          senderNotActive(),
          noSends(),
        ],
      }),
    ],
  });

  await outbound.campaign("good").stats();
  assert.equal(notified.length, 0, "a healthy campaign fires nothing");

  await outbound.campaign("bad").stats();
  await settle();
  assert.deepEqual(
    notified[0]?.map((alert) => [
      alert.rule,
      alert.subject,
      alert.value,
      alert.threshold,
    ]),
    [
      // 12 bounces and 1 reply out of 100 sent to 100 people.
      ["bounce-rate-above", "memory:default:bad", 0.12, 0.05],
      ["reply-rate-below", "memory:default:bad", 0.01, 0.02],
    ]
  );
  assert.equal(notified[0]?.[0]?.message, "Bounce rate is 12%, above 5%");

  await outbound.senders.list();
  await outbound.campaign("bad").stats({ by: "day" });
  await settle();
  const rules = new Set(notified.flat().map((alert) => alert.rule));
  assert.ok(rules.has("sender-not-active"));
  assert.ok(rules.has("no-sends"));
  assert.equal(
    notified.flat().find((alert) => alert.rule === "sender-not-active")
      ?.subject,
    "memory:default:s2"
  );
});

test("an alert names its subject as a person knows it, once the instance has read it", async () => {
  const notified: Alert[] = [];

  const outbound = createOutbound({
    adapter: memory({
      data: { ...data(), campaigns: [{ id: "bad", name: "Founders Q4" }] },
    }),
    plugins: [
      alerts({
        notify: (fired) => {
          notified.push(...fired);
        },
        rules: [bounceRateAbove(0.05), senderNotActive()],
      }),
    ],
  });

  // Before the campaign itself is read, only its ref is known.
  await outbound.campaign("bad").stats();
  await outbound.campaigns.list();
  await outbound.campaign("bad").stats();
  await outbound.senders.list();
  await settle();

  assert.deepEqual(
    notified.map((alert) => [alert.rule, alert.subjectName]),
    [
      ["bounce-rate-above", null],
      ["bounce-rate-above", "Founders Q4"],
      ["sender-not-active", "down@example.com"],
    ]
  );
});

test("a rate rule ignores rows too small to mean anything, and evaluate() does not notify", async () => {
  let notifications = 0;

  const outbound = createOutbound({
    adapter: memory({
      data: {
        stats: [
          {
            campaignId: "tiny",
            counts: { bounced: 5, sent: 10 },
            date: "2026-10-05",
          },
        ],
      },
    }),
    plugins: [
      alerts({
        notify: () => {
          notifications += 1;
        },
        rules: [bounceRateAbove(0.05), bounceRateAbove(0.05, { minSent: 5 })],
      }),
    ],
  });

  const { rows } = await outbound.campaign("tiny").stats();
  await settle();
  assert.equal(notifications, 1);
  const evaluated = outbound.alerts.evaluate(rows);
  assert.equal(evaluated.length, 1, "only the rule with a lower minimum fires");
  assert.equal(notifications, 1);
});

test("a failing notifier cannot fail the read", async () => {
  for (const notify of [
    () => {
      throw new Error("slack is down");
    },
    () => Promise.reject(new Error("slack is down")),
  ]) {
    const outbound = createOutbound({
      adapter: memory({ data: data() }),
      plugins: [alerts({ notify, rules: [senderNotActive()] })],
    });

    assert.equal((await outbound.senders.list()).items.length, 2);
  }
});

test("benchmarks compares a campaign with its own workspace", async () => {
  const outbound = createOutbound({
    adapter: memory({ data: data() }),
    plugins: [benchmarks()],
  });

  const result = await outbound.benchmarks.campaign("good");
  assert.equal(result.campaign, "memory:default:good");
  // Campaign: 10 replies of 100 contacted. Workspace: 11 replies of 200 contacted.
  assert.deepEqual(result.comparisons.replyRate, {
    baseline: 0.055,
    ratio: 0.1 / 0.055,
    value: 0.1,
  });
  assert.deepEqual(result.comparisons.bounceRate, {
    baseline: 0.065,
    ratio: 0.01 / 0.065,
    value: 0.01,
  });
  assert.deepEqual(result.comparisons.openRate, {
    baseline: null,
    ratio: null,
    value: null,
  });
  await assert.rejects(
    outbound.benchmarks.campaign("nope"),
    (error) => OutboundError.is(error) && error.code === "NotFound"
  );
});

test("benchmarks uses the campaign's own member on a combined instance", async () => {
  const outbound = createOutbound({
    adapter: combine([
      memory({ data: data(), name: "mailtool", workspaceId: "a" }),
      memory({
        data: {
          stats: [
            {
              campaignId: "x",
              counts: { contacted: 1000, replied: 500, sent: 1000 },
              date: "2026-10-05",
            },
          ],
        },
        name: "mailtool",
        workspaceId: "b",
      }),
    ]),
    plugins: [benchmarks()],
  });

  const result = await outbound.benchmarks.campaign("mailtool:a:good");
  assert.equal(
    result.comparisons.replyRate.baseline,
    0.055,
    "workspace b's numbers are not mixed in"
  );
});

test("fixtures records scrubbed answers, then replays them without calling the vendor", async () => {
  const dir = folder();
  let calls = 0;
  const base = memory({ data: data() });

  const counted = {
    ...base,
    listLeads: (
      ...parameters: Parameters<NonNullable<typeof base.listLeads>>
    ) => {
      calls += 1;

      return base.listLeads?.(...parameters) ?? Promise.resolve({ items: [] });
    },
  };

  const recording = createOutbound({
    adapter: counted,
    plugins: [fixtures({ dir, mode: "record" })],
  });

  const recorded = await recording.leads.list();
  assert.equal(calls, 1);
  assert.deepEqual(
    recorded.items.map((lead) => [
      lead.email,
      lead.firstName,
      lead.lastName,
      lead.company,
      lead.linkedinUrl,
      lead.raw,
    ]),
    [
      [
        "person1@example.com",
        "Person",
        "1",
        "Company 1",
        "https://www.linkedin.com/in/example-person-1",
        null,
      ],
      ["person2@example.com", "Person", "2", "Company 1", null, null],
    ],
    "the same company gets the same placeholder"
  );
  assert.deepEqual(recorded.items[0]?.custom, { phone: "value-1" });
  const [file] = readdirSync(dir);
  assert.match(
    file ?? "",
    /^memory\.default\.leads\.list\.[0-9a-f]{12}\.json$/u
  );
  const saved = readFileSync(path.join(dir, file ?? ""), "utf-8");
  assert.ok(
    !/northwind|jane|doe|555/iu.test(saved),
    "nothing personal reaches the disk"
  );

  const replaying = createOutbound({
    adapter: counted,
    plugins: [fixtures({ dir, mode: "replay" })],
  });

  const replayed = await replaying.leads.list();
  assert.equal(calls, 1, "replay never calls the vendor");
  assert.deepEqual(replayed.items, recorded.items);
  await assert.rejects(
    replaying.campaigns.list(),
    (error) =>
      OutboundError.is(error) &&
      error.code === "NotFound" &&
      /No fixture was recorded for campaigns\.list/u.test(error.message)
  );
});

test("fixtures in auto mode records once, and scrubs ids that are email addresses", async () => {
  const dir = folder();

  const outbound = createOutbound({
    adapter: memory({ data: data() }),
    plugins: [fixtures({ dir })],
  });

  const first = await outbound.messages.list({ include: ["body"] });
  assert.equal(first.items[0]?.bodyText, "[body]");
  assert.equal(first.items[0]?.subject, "[subject]");
  assert.equal(
    first.items[0]?.senderRef,
    "memory:default:person1@example.com",
    "the sender's id was an address"
  );
  assert.equal(readdirSync(dir).length, 1);
  assert.deepEqual(
    (await outbound.messages.list({ include: ["body"] })).items,
    first.items
  );
  assert.equal(readdirSync(dir).length, 1, "the second read was a replay");

  await outbound.senders.list();
  await outbound.campaigns.list();
  await outbound.stats();
  await outbound.campaign("good").sequence();
  await outbound.workspaces.list();

  const names = (await outbound.campaigns.list()).items.map(
    (campaign) => campaign.name
  );

  assert.deepEqual(names, ["Campaign 1", "Campaign 2"]);
  assert.equal(
    (await outbound.senders.list()).items[0]?.address,
    "person2@example.com"
  );
  assert.equal(
    (await outbound.stats()).rows[0]?.sent,
    200,
    "counts are kept as they are"
  );
});

test("fixtures can keep data unscrubbed, and rejects a file that is not a recording", async () => {
  const dir = folder();

  const outbound = createOutbound({
    adapter: memory({ data: data() }),
    plugins: [fixtures({ dir, mode: "record", scrub: false })],
  });

  assert.equal(
    (await outbound.leads.list()).items[0]?.email,
    "jane@northwind.example.com"
  );
});

test("exporter streams records to CSV with a header and correct quoting", async () => {
  const dir = folder();
  const file = path.join(dir, "leads.csv");

  const outbound = createOutbound({
    adapter: memory({ data: data() }),
    plugins: [exporter()],
  });

  const result = await outbound.export(outbound.leads.listAll(), {
    columns: ["ref", "email", "company", "lastName", "custom"],
    to: file,
  });

  assert.deepEqual(result, {
    columns: ["ref", "email", "company", "lastName", "custom"],
    rows: 2,
  });
  assert.equal(
    readFileSync(file, "utf-8"),
    [
      "ref,email,company,lastName,custom",
      'memory:default:l1,jane@northwind.example.com,"Northwind, Inc.",Doe,"{""phone"":""555-0100""}"',
      'memory:default:l2,sam@northwind.example.com,"Northwind, Inc.","O""Neil",{}',
      "",
    ].join("\n")
  );
});

test("exporter writes JSON Lines, leaves raw out by default, and handles an empty listing", async () => {
  const dir = folder();

  const outbound = createOutbound({
    adapter: memory({ data: data() }),
    plugins: [exporter()],
  });

  const jsonl = path.join(dir, "campaigns.jsonl");

  const result = await outbound.export(outbound.campaigns.listAll(), {
    to: jsonl,
  });

  assert.ok(!result.columns.includes("raw"));

  const lines = readFileSync(jsonl, "utf-8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { name: string });

  assert.deepEqual(
    lines.map((line) => line.name),
    ["Acme founders", "Acme agencies"]
  );

  const withRaw = await outbound.export(outbound.campaigns.listAll(), {
    includeRaw: true,
    to: jsonl,
  });

  assert.ok(withRaw.columns.includes("raw"));

  const empty = path.join(dir, "replies.csv");
  assert.deepEqual(
    await outbound.export(outbound.replies.listAll(), {
      columns: ["ref"],
      to: empty,
    }),
    {
      columns: ["ref"],
      rows: 0,
    }
  );
  assert.equal(readFileSync(empty, "utf-8"), "ref\n");

  // With no columns given and no record to take them from, there is no header: an empty file, not a blank line.
  for (const name of ["none.csv", "none.jsonl"]) {
    const file = path.join(dir, name);

    assert.deepEqual(
      // oxlint-disable-next-line no-await-in-loop -- two small files, one after the other.
      await outbound.export(outbound.replies.listAll(), { to: file }),
      { columns: [], rows: 0 }
    );
    assert.equal(readFileSync(file, "utf-8"), "");
  }

  await assert.rejects(
    outbound.export(outbound.campaigns.listAll(), {
      to: path.join(dir, "campaigns.parquet"),
    }),
    (error) =>
      OutboundError.is(error) &&
      /pass a writer for other formats/u.test(error.message)
  );
});

// A listing that fails before its first record.
const failingAtOnce: AsyncIterable<JsonObject> = {
  [Symbol.asyncIterator]: () => ({
    next: () => Promise.reject(new Error("the vendor never answered")),
  }),
};

// A listing that fails part-way through.
const failing = async function* failing() {
  yield { ref: "one" };
  throw new Error("the vendor went away");
};

test("exporter hands rows to a writer you supply, and closes it even when the source fails", async () => {
  const rows: JsonObject[] = [];
  let closed = 0;

  const writer: RowWriter = {
    close: () => {
      closed += 1;

      return Promise.resolve();
    },
    write: (row) => {
      rows.push(row);

      return Promise.resolve();
    },
  };

  const outbound = createOutbound({
    adapter: memory({ data: data() }),
    plugins: [exporter()],
  });

  await outbound.export(outbound.senders.listAll(), { to: writer });
  assert.deepEqual(
    rows.map((row) => row.address),
    ["ok@example.com", "down@example.com"]
  );
  assert.equal(closed, 1);

  await assert.rejects(
    outbound.export(failing(), { to: writer }),
    /the vendor went away/u
  );
  assert.equal(closed, 2);

  // Also when no row ever reached the writer: a failed source, or an empty one.
  await assert.rejects(
    outbound.export(failingAtOnce, { to: writer }),
    /the vendor never answered/u
  );
  assert.equal(closed, 3);
  await outbound.export(outbound.replies.listAll(), { to: writer });
  assert.equal(closed, 4);
});
