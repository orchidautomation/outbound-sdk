// Every insight under a campaign scope (OUT-200): it answers, and no read
// it sends names a campaign outside the scope. The adapter records the
// campaign every read is made for, so a workspace-wide read turned into
// per-campaign reads shows here as reads of the scope's campaigns only.

import assert from "node:assert/strict";
import { test } from "node:test";

import { combine } from "../../src/combine/index.ts";
import { createOutbound, MemoryRateLimitStore } from "../../src/index.ts";
import type { Adapter } from "../../src/index.ts";
import {
  insights,
  listInsights,
  runInsightByName,
} from "../../src/insights/index.ts";
import { memory } from "../../src/memory/index.ts";
import { createFetch, json } from "../helpers/http.ts";
import { metered, NOW, world } from "./metered.ts";

// Six campaigns, c1 to c6: c1, c3 and c5 are tagged even, the rest odd.
const OUTSIDE = /\bc[246]\b/u;

/** The adapter, with every campaign id a read is given recorded. */
const recording = (inner: Adapter, seen: string[]): Adapter =>
  Object.fromEntries(
    Object.entries(inner).map(([name, value]) => [
      name,
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- picking the adapter's read functions out of its fields
      typeof value === "function" && /^(?:list|get|stats)/u.test(name)
        ? (...args: unknown[]) => {
            seen.push(`${name} ${JSON.stringify(args.slice(0, -1))}`);

            // SAFETY: the same read, called with the arguments it was given.
            return (value as (...all: unknown[]) => unknown)(...args);
          }
        : value,
    ])
  ) as unknown as Adapter;

const instance = (adapter: Adapter) =>
  createOutbound({
    adapter,
    fetch: createFetch(() => json({})).fetch,
    plugins: [insights()],
    rateLimitStore: new MemoryRateLimitStore(),
    retries: 0,
  });

const INPUTS: Readonly<Record<string, string>> = {
  campaign: "memory:agency:c1",
  domain: "acme.example",
  person: "person1@acme.example",
  thread: "memory:agency:c1-t0",
};

// Inputs an insight needs one of, which its schema cannot mark required.
const ONE_OF: Readonly<Record<string, Record<string, string>>> = {
  person_summary: { email: "person1@acme.example" },
};

const inputFor = (
  name: string,
  parameters: unknown,
  scope: Readonly<Record<string, unknown>>
): Record<string, unknown> => {
  // SAFETY: an insight's parameters are a JSON Schema object.
  const required = ((parameters as { required?: string[] }).required ??
    []) as readonly string[];

  return Object.fromEntries([
    ...Object.entries(scope),
    ...required.map((key) => [key, INPUTS[key] ?? "x"]),
    ...Object.entries(ONE_OF[name] ?? {}),
  ]);
};

// The same six campaigns alone, or beside a tool whose campaigns carry no tags.
const TOOLS = {
  alone: (seen: string[]) => recording(metered(world(6, 5)), seen),
  combined: (seen: string[]) =>
    combine([
      recording(metered(world(6, 5)), seen),
      memory({
        capabilities: { "campaigns.byTag": false },
        data: world(2, 1),
        workspaceId: "plain",
      }),
    ]),
};

for (const [setup, scope] of [
  ["alone", { tag: "even" }],
  ["alone", { campaign_ids: ["c1", "memory:agency:c3", "c5"] }],
  ["alone", { campaign_name: "/campaign c[135]/i" }],
  ["combined", { tag: "even" }],
  ["combined", { campaign_ids: ["memory:agency:c1", "c3", "c5", "c9"] }],
  ["combined", { campaign_name: "Campaign C1" }],
] as const) {
  test(`every insight answers under ${JSON.stringify(scope)} on a tool ${setup}, and reads no campaign outside it`, async () => {
    for (const { name, parameters } of listInsights()) {
      const seen: string[] = [];
      const outbound = instance(TOOLS[setup](seen));

      // oxlint-disable-next-line no-await-in-loop -- one insight at a time, each on its own record of reads
      const answer = await runInsightByName(
        outbound,
        name,
        inputFor(name, parameters, scope) as never,
        { now: NOW }
      );

      assert.equal(answer.insight, name);

      const outside = seen.filter(
        (read) => !read.startsWith("listCampaigns") && OUTSIDE.test(read)
      );

      assert.deepEqual(outside, [], name);
    }
  });
}

test("a combined instance reads the scope on each tool, and skips a tool that carries no tags", async () => {
  const seen: string[] = [];

  const outbound = instance(
    combine([
      recording(metered(world(4, 3)), seen),
      memory({
        capabilities: { "campaigns.byTag": false },
        data: world(2, 1),
        workspaceId: "plain",
      }),
    ])
  );

  const answer = await runInsightByName(
    outbound,
    "campaign_ranking",
    { statuses: ["active", "paused", "completed"], tag: "even" } as never,
    { now: NOW }
  );

  const notes = answer.meta.notes.join(" ");

  assert.match(
    notes,
    /Campaign scope \(tag even\): 2 campaigns of memory:agency match/u
  );
  assert.match(notes, /memory:plain/u);
  assert.deepEqual(
    seen.filter(
      (read) => !read.startsWith("listCampaigns") && OUTSIDE.test(read)
    ),
    []
  );
});

test("the record catches a read of another campaign: with no scope, campaign_ranking reads them all", async () => {
  const seen: string[] = [];
  const outbound = instance(recording(metered(world(6, 5)), seen));

  await runInsightByName(
    outbound,
    "campaign_ranking",
    { statuses: ["active", "paused", "completed"] } as never,
    { now: NOW }
  );

  assert.ok(
    seen.some((read) => !read.startsWith("listCampaigns") && OUTSIDE.test(read))
  );
});
