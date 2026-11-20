// Every record a built-in tool or a CLI listing returns says which tool and
// workspace it came from (OUT-166): provider, workspaceId and a ref
// qualified by both, so nobody has to parse a ref to split rows by tool.

import assert from "node:assert/strict";
import { test } from "node:test";

import { run } from "../src/cli/index.ts";
import { clients } from "../src/clients/index.ts";
import { identity } from "../src/identity/index.ts";
import { createOutbound } from "../src/index.ts";
import { demoData, memory } from "../src/memory/index.ts";
import { createTools, TOOL_NAMES } from "../src/tools/index.ts";

const NOW = "2026-10-08T12:00:00.000Z";
const CAMPAIGN = "memory:acme:cmp_founders";

const demo = () =>
  memory({ data: demoData({ now: NOW }), workspaceId: "acme" });

type Row = Record<string, unknown>;

const rowsAt = (value: unknown, key: string): Row[] => {
  const rows = key === "." ? [value] : (value as Row)[key];
  assert.ok(Array.isArray(rows), `${key} is a list`);

  return rows as Row[];
};

/** The record names its tool and workspace, and its ref is qualified by both. */
const assertProvenance = (row: Row, refKey: string, what: string): void => {
  assert.equal(typeof row.provider, "string", `${what}: provider`);
  assert.equal(typeof row.workspaceId, "string", `${what}: workspaceId`);

  const ref = row[refKey];

  // A reply with no lead groups by thread, and names no lead.
  if (ref === null) {
    return;
  }

  assert.equal(typeof ref, "string", `${what}: ${refKey}`);
  assert.ok(
    String(ref).startsWith(
      `${String(row.provider)}:${String(row.workspaceId)}:`
    ),
    `${what}: ${String(ref)} is qualified by its provider and workspace`
  );
};

interface Check {
  readonly input: Row;
  /** Each list of records in data with the field holding a record's ref; "." is data itself. */
  readonly records: readonly (readonly [string, string])[];
  /**
   * Lists the demo leaves empty: no demo sender is failing, so no campaign
   * is listed; tools-sender-impact.test.ts checks those rows on Instantly.
   */
  readonly empty?: readonly string[];
}

const TOOL_RECORDS: Readonly<Record<string, Check>> = {
  audience_lists: { input: {}, records: [["lists", "list"]] },
  campaign_overview: { input: {}, records: [["campaigns", "campaign"]] },
  campaign_setup: {
    input: { campaign: CAMPAIGN },
    records: [[".", "campaign"]],
  },
  cross_channel_lead: {
    input: { email: "person1@example.com" },
    records: [
      ["records", "lead"],
      ["timeline", "message"],
    ],
  },
  deliverability_check: {
    input: {},
    records: [
      ["senders", "sender"],
      ["campaigns", "campaign"],
    ],
    empty: ["campaigns"],
  },
  lead_runway: { input: { campaign: CAMPAIGN }, records: [[".", "campaign"]] },
  reply_samples: { input: {}, records: [["replies", "reply"]] },
  sender_health: {
    input: {},
    records: [
      ["senders", "sender"],
      ["campaigns", "campaign"],
    ],
    empty: ["campaigns"],
  },
};

/** Tools whose answer holds no vendor record, and why. */
const NO_RECORDS: Readonly<Record<string, string>> = {
  campaign_trend: "one point per day of one campaign",
  compare_clients: "each row adds up a client's campaigns across tools",
  vendor_read: "the vendor's own response, not normalized",
  winning_steps: "one row per step of one campaign",
};

test("every built-in tool is checked for provenance or says why it returns no record", () => {
  assert.deepEqual(
    [...Object.keys(TOOL_RECORDS), ...Object.keys(NO_RECORDS)].toSorted(),
    [...TOOL_NAMES].toSorted()
  );
});

test("every record a built-in tool returns carries provider, workspaceId and a qualified ref", async () => {
  const outbound = createOutbound({
    adapter: demo(),
    plugins: [clients(), identity()],
  });

  const tools = createTools(outbound);

  const cases: [string, Check][] = [
    ...Object.entries(TOOL_RECORDS),
    [
      "reply_samples",
      { input: { by: "person" }, records: [["people", "lead"]] },
    ],
  ];

  for (const [name, check] of cases) {
    const tool = tools.find((candidate) => candidate.name === name);
    assert.ok(tool, `${name} is offered`);

    // oxlint-disable-next-line no-await-in-loop -- each tool reads the same demo in turn.
    const result = await tool.call(check.input as never);
    assert.ok(result.ok, JSON.stringify(result));

    for (const [key, refKey] of check.records) {
      const rows = rowsAt(result.data, key);
      assert.ok(
        rows.length > 0 || check.empty?.includes(key) === true,
        `${name} ${key}: the demo returns records`
      );

      for (const row of rows) {
        assertProvenance(row, refKey, `${name} ${key}`);
      }
    }
  }
});

const cli = async (argv: string[]): Promise<Row> => {
  const out: string[] = [];

  await run([...argv, "--compact"], {
    adapter: demo(),
    stderr: () => {},
    stdout: (text) => {
      out.push(text);
    },
  });

  return JSON.parse(out.join("")) as Row;
};

const LISTINGS: readonly (readonly [string[], string, string])[] = [
  [["campaigns"], "items", "ref"],
  [["senders"], "items", "ref"],
  [["leads"], "items", "ref"],
  [["lists"], "items", "ref"],
  [["replies"], "items", "ref"],
  [["replies", "--by", "person"], "items", "leadRef"],
  [["stats"], "rows", "scopeRef"],
];

test("every record a CLI listing prints carries provider, workspaceId and a qualified ref", async () => {
  for (const [argv, key, refKey] of LISTINGS) {
    // oxlint-disable-next-line no-await-in-loop -- each listing reads its own fresh demo.
    const printed = await cli(argv);
    const rows = rowsAt(printed.data, key);
    const what = argv.join(" ");

    assert.ok(rows.length > 0, `${what}: the demo returns records`);

    for (const row of rows) {
      assertProvenance(row, refKey, what);
    }
  }
});
