// OUT-122: on HeyReach a lead's id is its LinkedIn profile URL, and on
// Instantly a reply names its lead by address, so redact masks the person
// inside the ref. When every masked ref was one `[redacted]`, everyone merged
// into one: live, `leads` gave 1 of 306, `replies --by person` 1 of 115 and
// `hot_leads` none. Masked, the people counts must be the counts unmasked.

import assert from "node:assert/strict";
import { test } from "node:test";

import { run } from "../src/cli/index.ts";
import { fixtureHandler } from "./helpers/adapter-suite.ts";
import type { AdapterSuite } from "./helpers/adapter-suite.ts";
import { createFetch } from "./helpers/http.ts";
import { suite as heyreach } from "./heyreach/suite.ts";
import { suite as instantly } from "./instantly/suite.ts";

interface Answer {
  readonly data: {
    readonly items?: readonly Readonly<Record<string, unknown>>[];
    readonly leads?: readonly Readonly<Record<string, unknown>>[];
    readonly totals?: Readonly<Record<string, unknown>>;
  };
  readonly meta: { readonly notes: readonly string[] };
}

const cli = async (
  suite: AdapterSuite,
  argv: readonly string[]
): Promise<{ readonly answer: Answer; readonly out: string }> => {
  const out: string[] = [];
  const err: string[] = [];

  const code = await run(argv, {
    adapter: suite.make(),
    fetch: createFetch(fixtureHandler([suite])).fetch,
    stderr: (text) => {
      err.push(text);
    },
    stdout: (text) => {
      out.push(text);
    },
  });

  assert.equal(code, 0, err.join("\n"));

  return { answer: JSON.parse(out.join("\n")) as Answer, out: out.join("\n") };
};

/** What a people read counts: rows, distinct people, and its totals and notes. */
const people = ({ data, meta }: Answer): unknown => {
  const rows = data.items ?? data.leads ?? [];

  return {
    distinct: new Set(rows.map((row) => row.ref ?? row.leadRef ?? row.lead))
      .size,
    notes: meta.notes,
    rows: rows.length,
    totals: data.totals ?? null,
  };
};

const READS = [
  ["leads"],
  ["replies", "--by", "person"],
  ["insight", "hot_leads"],
] as const;

for (const [suite, expected, personal] of [
  [heyreach, [3, 2, 1], /linkedin\.com|example-person/iu],
  [instantly, [3, 3, 3], /@example\.com/iu],
] as const) {
  test(`${suite.provider}: redact gives the same people counts as no redact`, async () => {
    const runs = await Promise.all(
      READS.map(async (argv) => [
        await cli(suite, argv),
        await cli(suite, [...argv, "--redact"]),
      ])
    );

    for (const [index, [plain, masked]] of runs.entries()) {
      assert.ok(plain && masked);
      const label = READS[index]?.join(" ") ?? "";
      assert.deepEqual(people(masked.answer), people(plain.answer), label);
      assert.equal(
        (people(masked.answer) as { distinct: number }).distinct,
        expected[index],
        `${label}: one row per person in the fixtures`
      );
      assert.doesNotMatch(masked.out, personal, `${label}: nothing personal`);
      assert.doesNotMatch(
        masked.out,
        /:\[redacted\]/u,
        `${label}: no shared ref`
      );
    }
  });
}
