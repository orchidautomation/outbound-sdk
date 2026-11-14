import assert from "node:assert/strict";
import { test } from "node:test";

import { outOfScope } from "./check-drift-scope.mjs";

test("accepts a vendor's mapping, capabilities, webhooks, fixtures, tests and research note", () => {
  assert.deepEqual(
    outOfScope("instantly", [
      "packages/outbound-sdk/src/instantly/map.ts",
      "packages/outbound-sdk/src/instantly/map-stats.ts",
      "packages/outbound-sdk/src/instantly/capabilities.ts",
      "packages/outbound-sdk/src/instantly/webhooks.ts",
      "packages/outbound-sdk/test/instantly/stats.test.ts",
      "fixtures/instantly/listCampaigns.json",
      "docs/research/instantly.md",
      ".changeset/quiet-moons-wave.md",
    ]),
    []
  );
});

test("rejects the core, another vendor, the client and anything else", () => {
  const rejected = [
    "packages/outbound-sdk/src/internal/engine/request.ts",
    "packages/outbound-sdk/src/smartlead/map.ts",
    "packages/outbound-sdk/src/instantly/client.ts",
    "packages/outbound-sdk/src/instantly/adapter.ts",
    "fixtures/smartlead/getCampaign.json",
    "docs/research/smartlead.md",
    "package.json",
    ".github/workflows/ci.yml",
    "scripts/check-drift-scope.mjs",
    "AGENTS.md",
  ];

  assert.deepEqual(outOfScope("instantly", rejected), rejected);
});

test("rejects a vendor name that could escape its folder", () => {
  assert.deepEqual(outOfScope("../internal", ["x"]), [
    '"../internal" is not a vendor name',
  ]);
  assert.deepEqual(outOfScope("", []), ['"" is not a vendor name']);
});
