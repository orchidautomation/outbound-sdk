// Checks docs/insights.md against the registry: every insight is listed,
// with the capabilities it needs, and nothing else is.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { CAPABILITY_KEYS } from "../src/index.ts";
import { listInsights } from "../src/insights/index.ts";

const TEXT = readFileSync(
  path.resolve(import.meta.dirname, "../../../docs/insights.md"),
  "utf-8"
);

const ROWS = new Map(
  TEXT.split("\n").flatMap((line) => {
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());

    const key = /^`(?<key>[a-z][A-Za-z]+)`$/u.exec(cells[0] ?? "")?.groups?.key;

    return key === undefined || cells.length !== 3
      ? []
      : [[key, cells[2] ?? ""] as const];
  })
);

test("docs/insights.md lists every insight and no other", () => {
  assert.deepEqual(
    [...ROWS.keys()].toSorted(),
    listInsights()
      .map((insight) => insight.key)
      .toSorted()
  );
});

test("docs/insights.md names every capability an insight needs", () => {
  const known = new Set<string>(CAPABILITY_KEYS);

  for (const insight of listInsights()) {
    const cell = ROWS.get(insight.key) ?? "";

    const named = [...cell.matchAll(/`(?<name>[^`]+)`/gu)].flatMap(
      (match) => match.groups?.name ?? []
    );

    for (const name of named) {
      assert.ok(known.has(name), `${insight.key}: ${name} is a capability`);
    }

    for (const need of insight.needs) {
      assert.ok(
        named.includes(need),
        `${insight.key} is documented to need ${need}`
      );
    }
  }
});
