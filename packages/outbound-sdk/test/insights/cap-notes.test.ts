// Every cap an insight reads up to names the input that raises it in its
// note, so a reader knows what to change (OUT-46). Each insight runs with
// each of its caps set to 1 on data that holds more than one of everything.

import assert from "node:assert/strict";
import { test } from "node:test";

import type { ZodObject } from "zod";

import { INSIGHTS } from "../../src/insights/index.ts";
import type { MemoryData } from "../../src/memory/index.ts";
import { NOW, single } from "./helpers.ts";

const DAY_MS = 86_400_000;

const daysAgo = (days: number): string =>
  new Date(NOW - days * DAY_MS).toISOString();

const CAMPAIGNS = ["c1", "c2", "c3"];
const SENDERS = ["s1", "s2", "s3"];

const STEPS = [
  { variants: [{ body: "Hi {{firstName}}, a short note.", subject: "Hello" }] },
];

// Three campaigns, each with three leads, two sends and a reply each, and
// three senders on every campaign. The same people are in every campaign.
const DATA: MemoryData = {
  blocklist: [
    { id: "b1", kind: "email", value: "blocked1@example.org" },
    { id: "b2", kind: "email", value: "blocked2@example.org" },
  ],
  campaigns: CAMPAIGNS.map((id) => ({
    id,
    name: `Campaign ${id}`,
    status: "active" as const,
    steps: STEPS,
    tags: ["client-a"],
  })),
  leads: CAMPAIGNS.flatMap((campaignId) =>
    [1, 2, 3].map((person) => ({
      campaignId,
      email: `person${person}@acme.example`,
      id: `${campaignId}-l${person}`,
      interest: "Interested",
      replied: true,
      status: "active" as const,
    }))
  ),
  messages: CAMPAIGNS.flatMap((campaignId) =>
    [1, 2, 3].flatMap((person) => [
      {
        campaignId,
        direction: "out" as const,
        id: `${campaignId}-o${person}`,
        leadId: `${campaignId}-l${person}`,
        sentAt: daysAgo(3),
      },
      {
        campaignId,
        category: "positive" as const,
        direction: "in" as const,
        id: `${campaignId}-i${person}`,
        leadId: `${campaignId}-l${person}`,
        sentAt: daysAgo(2),
      },
    ])
  ),
  senders: SENDERS.map((id) => ({
    address: `${id}@sender.example`,
    campaignIds: CAMPAIGNS,
    dailyLimit: 30,
    id,
  })),
  stats: CAMPAIGNS.flatMap((campaignId) =>
    [1, 2, 3, 4, 5, 6, 8, 9, 10].map((day) => ({
      campaignId,
      counts: { bounced: 20, contacted: 100, replied: 5, sent: 100 },
      date: daysAgo(day).slice(0, 10),
    }))
  ),
};

const REQUIRED: Readonly<Record<string, Record<string, string>>> = {
  account_summary: { domain: "acme.example" },
  campaign_diagnosis: { campaign: "memory:agency:c1" },
  copy_audit: { campaign: "memory:agency:c1" },
  copy_preview: { campaign: "memory:agency:c1" },
  person_summary: { person: "person1@acme.example" },
  personalization_gaps: { campaign: "memory:agency:c1" },
  pipeline_forecast: { campaign: "memory:agency:c1" },
  step_funnel: { campaign: "memory:agency:c1" },
  variant_test: { campaign: "memory:agency:c1" },
};

// A cap that applies only where the tool lacks a read: account_summary reads
// campaign by campaign only when it cannot list every lead.
const CAPABILITIES: Readonly<Record<string, Record<string, boolean>>> = {
  "account_summary max_campaigns": { "leads.list": false },
};

// A cap is an input that bounds how much is read, not a limit the answer
// judges against such as max_links.
const CAP = /^The most .+ to (?:read|check|report on|count|audit)\b/u;

const capsOf = (schema: ZodObject): string[] =>
  Object.entries(schema.shape).flatMap(([key, field]) =>
    key.startsWith("max_") && CAP.test(field.description ?? "") ? [key] : []
  );

/** The input a note names in brackets, `a fixed cap` for one no input sets, or `null`. */
const namedIn = (note: string): string | null =>
  /\((?<input>max_[a-z_]+|a fixed cap)\)/u.exec(note)?.groups?.input ?? null;

test("every cap note names the input that raises it", async () => {
  let checked = 0;

  for (const definition of Object.values(INSIGHTS)) {
    const caps = capsOf(definition.inputSchema);

    for (const cap of caps) {
      const run = `${definition.name} ${cap}`;
      const outbound = single(DATA, CAPABILITIES[run] ?? {});

      // oxlint-disable-next-line no-await-in-loop -- one run at a time keeps a failure's message about one insight.
      const result = await definition.execute(
        outbound,
        { ...REQUIRED[definition.name], [cap]: 1 },
        { now: NOW }
      );

      // The data holds more than one of everything, so the cap must stop a read.
      assert.equal(result.meta.complete, false, run);

      const stops = result.meta.notes.filter((note) =>
        /\bstopped at\b|\bcap\b/iu.test(note)
      );

      const named = stops.map(namedIn);

      // The cap set to 1 is the one a note names.
      assert.ok(named.includes(cap), `${run}: ${stops.join(" | ")}`);

      for (const [index, input] of named.entries()) {
        assert.ok(
          input === "a fixed cap" || (input !== null && caps.includes(input)),
          `${run}: "${stops[index]}" names no input of ${definition.name}`
        );
      }

      checked += 1;
    }
  }

  // Every insight that reads up to a cap was run.
  assert.ok(checked >= 25, String(checked));
});
