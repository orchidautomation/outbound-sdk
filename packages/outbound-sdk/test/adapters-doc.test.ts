// Checks the capability table in site/content/docs/adapters/index.mdx against
// what each adapter declares, so the table cannot drift from the code.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { heyreach } from "../src/heyreach/index.ts";
import { CAPABILITY_KEYS, resolveCapabilities } from "../src/index.ts";
import { instantly } from "../src/instantly/index.ts";
import { smartlead } from "../src/smartlead/index.ts";

const FILE = path.resolve(
  import.meta.dirname,
  "../../../site/content/docs/adapters/index.mdx"
);

const NAME = "site/content/docs/adapters/index.mdx";

const COLUMNS = [
  resolveCapabilities(instantly({ apiKey: "test-key" }).capabilities),
  resolveCapabilities(smartlead({ apiKey: "test-key" }).capabilities),
  resolveCapabilities(heyreach({ apiKey: "test-key" }).capabilities),
];

const word = (value: boolean | string): string => {
  if (value === true) {
    return "yes";
  }

  return value === false ? "no" : value;
};

/** The table the document must hold, one row per capability. */
const expected = (): string[] =>
  CAPABILITY_KEYS.toSorted().map((key) =>
    [`\`${key}\``, ...COLUMNS.map((column) => word(column[key]))].join(" | ")
  );

const documented = (): string[] => {
  const lines = readFileSync(FILE, "utf-8").split("\n");
  const header = lines.findIndex((line) => /^\|\s*Capability\s*\|/u.test(line));
  assert.notEqual(header, -1, `${NAME} has a Capability table`);
  const rows: string[] = [];

  for (const line of lines.slice(header + 2)) {
    if (!line.startsWith("|")) {
      break;
    }

    rows.push(
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim())
        .join(" | ")
    );
  }

  return rows;
};

test(`the capability table in ${NAME} matches what each adapter declares`, () => {
  assert.deepEqual(
    documented(),
    expected(),
    "regenerate the table: one row per capability key, sorted, columns Instantly, Smartlead, HeyReach"
  );
});
