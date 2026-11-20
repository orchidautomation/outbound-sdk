// A request budget the caller set stops an insight part way (OUT-156): the
// answer keeps what it read, with complete: false and a note saying the cap
// is the caller's own, never a vendor 429. Failed reads count toward
// meta.requests (OUT-151). copy_audit does not call itself incomplete for a
// lead cap that did not change its answer (OUT-148).

import assert from "node:assert/strict";
import { test } from "node:test";

import { z } from "zod";

import { budget } from "../../src/budget/index.ts";
import { run } from "../../src/cli/index.ts";
import { createOutbound, OutboundError } from "../../src/index.ts";
import {
  defineInsight,
  insights,
  runInsight,
} from "../../src/insights/index.ts";
import { memory } from "../../src/memory/index.ts";
import type { MemoryData } from "../../src/memory/index.ts";
import { createFetch, json } from "../helpers/http.ts";
import { metered, NOW, over, world } from "./metered.ts";

const OWN_CAP = "That budget is a cap you set, not the vendor's rate limit.";

for (const name of ["suppressionCheck", "leadCollisions"] as const) {
  test(`${name} keeps what it read when the run's budget runs out`, async () => {
    const { http, outbound } = over(world(12, 30), {
      plugins: [
        budget({ maxRequests: 8, per: "run", setting: "--max-requests" }),
      ],
    });

    const result = await outbound.insights[name]({}, { now: NOW });

    assert.equal(http.requests.length, 8, "not one request past the budget");
    assert.equal(result.meta.requests, 8);
    assert.equal(result.meta.complete, false);
    assert.ok(
      result.meta.notes.some(
        (note) =>
          note.startsWith("A request cap stopped the run:") &&
          note.includes(OWN_CAP) &&
          note.includes("Raise --max-requests.")
      ),
      result.meta.notes.join("\n")
    );
  });
}

test("suppression_check stopped by the run's budget gives no total", async () => {
  const { outbound } = over(world(12, 30), {
    plugins: [budget({ maxRequests: 8, per: "run" })],
  });

  const { data } = await outbound.insights.suppressionCheck({}, { now: NOW });

  assert.equal(data.totals.violations, null);
  assert.match(data.finding, /^Not a clean result\. /u);
  // The budget stopped the reads, so the budget is what to raise, not an input.
  assert.match(data.finding, /\(a request cap\)/u);
  assert.match(data.finding, /raise the request cap the notes name\.$/u);
});

test("a budget that stops the reads naming dropped replies keeps the replies and says so", async () => {
  const whole = over(world(2, 4));

  const unbudgeted = await whole.outbound.insights.droppedReplies(
    {},
    { now: NOW }
  );

  const total = whole.http.requests.length;

  assert.ok(unbudgeted.data.dropped.length > 0);

  // The naming reads come last, so one request short stops one of them.
  const { outbound } = over(world(2, 4), {
    plugins: [budget({ maxRequests: total - 1, per: "run" })],
  });

  const result = await outbound.insights.droppedReplies({}, { now: NOW });

  assert.equal(result.data.dropped.length, unbudgeted.data.dropped.length);
  assert.equal(result.meta.complete, false);
  assert.ok(
    result.meta.notes.some(
      (note) =>
        note.startsWith("A request cap stopped the reads of") &&
        note.includes(OWN_CAP)
    ),
    result.meta.notes.join("\n")
  );
});

test("a budget that stops dropped_replies' conversation reads keeps what it read and counts the rest unchecked", async () => {
  const { http, outbound } = over(world(2, 4), {
    plugins: [
      budget({ maxRequests: 2, per: "run", setting: "--max-requests" }),
    ],
  });

  const result = await outbound.insights.droppedReplies({}, { now: NOW });
  const { totals } = result.data;

  assert.equal(http.requests.length, 2, "not one request past the budget");
  assert.equal(result.meta.requests, 2);
  assert.equal(result.meta.complete, false);
  assert.ok(totals.unchecked > 0);
  // A stopped read is never passed off as answered or dropped.
  assert.equal(
    totals.answered + totals.droppedFound + totals.tooRecent + totals.unchecked,
    totals.conversations
  );
  assert.ok(
    result.meta.notes.some(
      (note) =>
        note.startsWith("A request cap stopped the run:") &&
        note.includes(OWN_CAP) &&
        note.includes("Raise --max-requests.") &&
        note.endsWith(" conversations; the answer covers those.")
    ),
    result.meta.notes.join("\n")
  );
});

test("the CLI returns the partial answer at --max-requests, exit 0, not a RateLimited failure", async () => {
  const out: string[] = [];
  const err: string[] = [];

  const code = await run(
    ["insight", "suppression_check", "--max-requests", "8"],
    {
      adapter: metered(world(12, 30)),
      fetch: createFetch(() => json({})).fetch,
      stderr: (text) => {
        err.push(text);
      },
      stdout: (text) => {
        out.push(text);
      },
    }
  );

  assert.equal(code, 0, err.join("\n"));

  const printed = JSON.parse(out.join("\n")) as {
    data: { totals: { violations: number | null } } | null;
    meta: { complete: boolean; notes: string[]; requests: number };
    ok: boolean;
  };

  assert.equal(printed.ok, true);
  assert.equal(printed.data?.totals.violations, null);
  assert.equal(printed.meta.complete, false);
  assert.equal(printed.meta.requests, 8);
  // The flag the user set is named, and nothing reads like a vendor 429.
  assert.match(printed.meta.notes.join(" "), /Raise --max-requests\./u);
  assert.doesNotMatch(out.join("\n"), /RateLimited/u);
});

test("an insight that opts out with partialOnCap: false still fails at the budget", async () => {
  const strict = defineInsight({
    description: "Every campaign's leads, or nothing.",
    inputSchema: z.object({}),
    key: "strictLeads",
    name: "strict_leads",
    needs: [],
    next: "",
    partialOnCap: false,
    run: async (context) => {
      const campaigns = await context.all(context.outbound.campaigns.listAll());

      return context.each(
        campaigns,
        async (campaign) =>
          (
            await context.all(
              context.outbound.campaign(campaign.ref).leads.listAll()
            )
          ).length,
        "campaigns"
      );
    },
  });

  const { outbound } = over(world(12, 30), {
    plugins: [budget({ maxRequests: 5, per: "run" })],
  });

  await assert.rejects(
    runInsight(outbound, strict, {}, { now: NOW }),
    (error) => {
      assert.ok(OutboundError.is(error));
      assert.equal(error.code, "RateLimited");
      assert.equal(error.limit, "run");
      assert.match(error.message, new RegExp(OWN_CAP, "u"));

      return true;
    }
  );
});

test("a read that failed still counts toward meta.requests (OUT-151)", async () => {
  const tolerant = defineInsight({
    description: "Reads a campaign that is not there, and carries on.",
    inputSchema: z.object({}),
    key: "missingCampaign",
    name: "missing_campaign",
    needs: [],
    next: "",
    run: async (context) => {
      try {
        context.one(
          await context.outbound.campaign("memory:agency:gone").get()
        );

        return { found: true };
      } catch {
        return { found: false };
      }
    },
  });

  const { http, outbound } = over(world(1, 1));
  const result = await runInsight(outbound, tolerant, {}, { now: NOW });

  assert.equal(result.data.found, false);
  assert.ok(http.requests.length > 0);
  assert.equal(result.meta.requests, http.requests.length);
});

const perLead = (index: number, filled: boolean) => ({
  campaignId: "c1",
  custom: filled
    ? { body_1: `Lead ${index}, a short note.`, subject_1: "A question" }
    : {},
  email: `person${index}@example.com`,
  id: `l${index}`,
});

const copyCampaign = (leads: NonNullable<MemoryData["leads"]>): MemoryData => ({
  campaigns: [
    {
      id: "c1",
      name: "Per-lead copy",
      steps: [
        {
          variants: [
            { body: "<div>{{body_1}}</div>", subject: "{{subject_1}}" },
          ],
        },
      ],
    },
  ],
  leads,
});

const audit = (data: MemoryData) =>
  createOutbound({
    adapter: memory({ data, name: "instantly", workspaceId: "agency" }),
    plugins: [insights()],
  }).insights.copyAudit({ campaign: "instantly:agency:c1" }, { now: NOW });

test("copy_audit with its samples is complete although max_leads left leads unread (OUT-148)", async () => {
  const leads = Array.from({ length: 150 }, (_, index) =>
    perLead(index + 1, true)
  );

  const result = await audit(copyCampaign(leads));

  assert.equal(result.data.leadsAudited?.length, 3);
  assert.equal(result.data.variantsNotAudited, 0);
  assert.equal(result.meta.complete, true, result.meta.notes.join("\n"));
});

test("copy_audit is incomplete when max_leads stopped it before it found its samples", async () => {
  // Only leads past the first 100 fill the variables.
  const leads = Array.from({ length: 150 }, (_, index) =>
    perLead(index + 1, index >= 100)
  );

  const result = await audit(copyCampaign(leads));

  assert.equal(result.meta.complete, false);
  assert.ok(
    result.meta.notes.includes("Stopped at 100 leads (max_leads); more exist."),
    result.meta.notes.join("\n")
  );
});
