// Holds docs/metric-glossary.md to the code: every adapter's table lists
// every MetricRow count once, with a unit, and names only vendor fields the
// adapter's source actually reads.

import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { emptyCounts } from "../src/index.ts";
import { checkGlossary } from "./helpers/glossary.ts";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const FILE = path.join(ROOT, "docs/metric-glossary.md");

const sourceOf = (folder: string): string => {
  const dir = path.join(ROOT, "packages/outbound-sdk/src", folder);

  return readdirSync(dir)
    .filter((file) => file.endsWith(".ts"))
    .map((file) => readFileSync(path.join(dir, file), "utf-8"))
    .join("\n");
};

const ADAPTERS = [
  { heading: "Instantly", source: sourceOf("instantly") },
  { heading: "Smartlead", source: sourceOf("smartlead") },
  { heading: "HeyReach", source: sourceOf("heyreach") },
  { heading: "EmailBison", source: sourceOf("emailbison") },
];

const COUNTS = Object.keys(emptyCounts());

test("metric glossary: every adapter lists every count, with a unit and real fields", () => {
  assert.deepEqual(
    checkGlossary(readFileSync(FILE, "utf-8"), COUNTS, ADAPTERS),
    []
  );
});

// The check must be able to fail: each kind of drift it catches.

const TABLE = (rows: string): string =>
  [
    "## Acme",
    "",
    "| SDK field | Vendor API field | Vendor UI label | Unit |",
    "| --- | --- | --- | --- |",
    rows,
    "",
  ].join("\n");

const ACME = [{ heading: "Acme", source: "count(raw.sent_count)" }];

test("metric glossary: a complete, truthful table is accepted", () => {
  assert.deepEqual(
    checkGlossary(
      TABLE(
        "| `sent` | `sent_count` | Sent | messages |\n| `bounced` | not reported | not captured | — |\n| `opportunityValue` | `deal_value` | Value | money |"
      ),
      ["bounced", "opportunityValue", "sent"],
      [
        {
          heading: "Acme",
          source: "count(raw.sent_count) count(raw.deal_value)",
        },
      ]
    ),
    []
  );
});

test("metric glossary: drift is rejected", () => {
  assert.deepEqual(checkGlossary("# nothing", ["sent"], ACME), [
    "Acme: no section",
  ]);

  assert.deepEqual(
    checkGlossary(
      TABLE(
        "| `sent` | `emails_sent` | Sent | emails |\n| `sent` | not reported | not captured | people |\n| `sends` | not reported | not captured | — |"
      ),
      ["bounced", "sent"],
      ACME
    ),
    [
      "Acme: `bounced` is listed 0 times",
      "Acme: `sent` is listed 2 times",
      "Acme: `sends` is not a MetricRow count",
      'Acme: `sent` has unit "emails"',
      "Acme: `sent` names `emails_sent`, which the adapter never reads",
      'Acme: `sent` has unit "people"',
    ]
  );
});
