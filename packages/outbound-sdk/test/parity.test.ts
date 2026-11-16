// Vendor UI parity: every case in fixtures/parity/<provider>/ replays a raw
// vendor response through the adapter and checks the SDK row against the
// numbers the vendor's dashboard showed (docs/vendor-parity.md). A fixture
// built from the docs cannot catch a field mapped to the wrong vendor field;
// a dashboard number can.

import assert from "node:assert/strict";
import { test } from "node:test";

import type { MetricRow, Outbound } from "../src/index.ts";
import { harness } from "./helpers/adapter-suite.ts";
import type { AdapterSuite } from "./helpers/adapter-suite.ts";
import {
  compareParity,
  parityCases,
  parityProviders,
  parseCase,
} from "./helpers/parity.ts";
import type { UiMapping } from "./helpers/parity.ts";
import { suite as instantlySuite } from "./instantly/suite.ts";

interface ProviderParity {
  readonly suite: AdapterSuite;
  /** Dashboard label -> the SDK field that must show the same number. */
  readonly mapping: UiMapping;
  /** The SDK read that requests each recorded endpoint. */
  readonly reads: Readonly<
    Record<
      string,
      (outbound: Outbound) => Promise<{ rows: readonly MetricRow[] }>
    >
  >;
}

const disabledWhenNull = (value: number | null) =>
  value === null ? "disabled" : value;

const NO_TOTAL_REPLIES =
  "The SDK counts people who replied (replied) and auto-replies (repliedAuto), not reply messages";

const INSTANTLY: ProviderParity = {
  mapping: {
    clickRate: (row) => disabledWhenNull(row.clicked),
    leadsTotal: { unmapped: "A stats row has no lead total" },
    openRate: (row) => disabledWhenNull(row.opened),
    opportunities: { unmapped: "The SDK has no opportunity count" },
    opportunityValue: { unmapped: "The SDK has no opportunity value" },
    replies: { unmapped: NO_TOTAL_REPLIES },
    sequenceStarted: (row) => row.contacted,
    totalSent: (row) => row.sent,
    uniqueReplies: (row) => row.replied,
  },
  reads: {
    "GET /api/v2/campaigns/analytics": (outbound) =>
      outbound.stats({ scope: "campaign" }),
  },
  suite: instantlySuite,
};

const PROVIDERS: Readonly<Record<string, ProviderParity>> = {
  instantly: INSTANTLY,
};

/** Replays a case's raw response and returns the one row it maps to. */
const replay = async (
  parity: ProviderParity,
  endpoint: string,
  raw: unknown
): Promise<MetricRow> => {
  const [method, pathname] = endpoint.split(" ");
  const read = parity.reads[endpoint];
  assert.ok(read, `no SDK read is declared for ${endpoint}`);

  const { outbound, settle } = harness(parity.suite, (request) =>
    request.method === method && new URL(request.url).pathname === pathname
      ? Response.json(raw)
      : undefined
  );

  const { rows } = await settle(read(outbound));
  assert.equal(rows.length, 1, "a parity case records one campaign");
  const [row] = rows;
  assert.ok(row);

  return row;
};

test("parity: every provider with cases declares how to read them", () => {
  assert.deepEqual(parityProviders(), Object.keys(PROVIDERS).toSorted());
});

for (const provider of parityProviders()) {
  for (const { file, parity } of parityCases(provider)) {
    test(`parity: ${provider} ${file} matches the dashboard`, async () => {
      const declared = PROVIDERS[provider];
      assert.ok(declared, `${provider} has no parity declaration`);

      const row = await replay(declared, parity.endpoint, parity.raw);

      assert.deepEqual(compareParity(parity.ui, row, declared.mapping), []);
    });
  }
}

// The checks above must be able to fail. These prove each way they do.

const [first] = parityCases("instantly");

test("parity: the old Instantly mapping (contacted_count) is rejected", async () => {
  assert.ok(first);
  const row = await replay(INSTANTLY, first.parity.endpoint, first.parity.raw);

  // What the adapter reported before OUT-86 read new_leads_contacted_count.
  const before = { ...row, contacted: 1404 };

  assert.deepEqual(compareParity(first.parity.ui, before, INSTANTLY.mapping), [
    '"sequenceStarted": the dashboard shows 430, the SDK gives 1404',
  ]);
});

test("parity: a dashboard label with no declared reading is rejected", async () => {
  assert.ok(first);
  const row = await replay(INSTANTLY, first.parity.endpoint, first.parity.raw);

  assert.deepEqual(
    compareParity(
      { ...first.parity.ui, bounceRate: 0 },
      row,
      INSTANTLY.mapping
    ),
    ['"bounceRate" has no declared SDK reading; map it or mark it unmapped']
  );
});

test("parity: a malformed case file is rejected", () => {
  const good = {
    capturedAt: "2026-11-15",
    endpoint: "GET /api/v2/campaigns/analytics",
    provider: "instantly",
    raw: [],
    source: "test",
    ui: { totalSent: 1 },
  };

  assert.equal(parseCase(good, "good.json").endpoint, good.endpoint);

  assert.throws(
    () => parseCase({ ...good, capturedAt: "15/11/2026" }, "bad.json"),
    /capturedAt/u
  );
  assert.throws(
    () => parseCase({ ...good, endpoint: "campaigns/analytics" }, "bad.json"),
    /endpoint/u
  );
  assert.throws(() => parseCase({ ...good, ui: {} }, "bad.json"), /ui/u);
  assert.throws(
    () => parseCase({ ...good, ui: { totalSent: null } }, "bad.json"),
    /totalSent/u
  );
  assert.throws(
    () => parseCase({ ...good, raw: undefined }, "bad.json"),
    /raw/u
  );
});
