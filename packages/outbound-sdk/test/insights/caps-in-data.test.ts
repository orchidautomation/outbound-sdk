// A cap that leaves records unread is said in `data`, not only in
// `meta.notes`, so a renderer that shows only the data does not show a clean
// answer (OUT-45). Each case runs once at the cap and once with room.

import assert from "node:assert/strict";
import { test } from "node:test";

import { cardFor } from "../../src/cards/index.ts";
import { insightTools } from "../../src/insights/index.ts";
import type { MemoryData } from "../../src/memory/index.ts";
import { includes, read } from "../cards/helpers.ts";
import { NOW, single } from "./helpers.ts";

const BLOCKED: MemoryData = {
  blocklist: Array.from({ length: 2500 }, (_, index) => ({
    id: `b${index}`,
    kind: "email" as const,
    value: `dnc${index}@example.org`,
  })),
  campaigns: [{ id: "c1", name: "Q4", status: "active" }],
  // On the block list as entry 2,401, past the default cap of 2,000.
  leads: [{ campaignId: "c1", email: "dnc2400@example.org", id: "l1" }],
};

const card = async (data: MemoryData, name: string, input = {}) => {
  const [tool] = insightTools(single(data), { only: [name] });
  assert.ok(tool !== undefined, name);

  return read(cardFor(name, await tool.call(input)));
};

test("suppression_check says in data that block list entries were left unread", async () => {
  const capped = await single(BLOCKED).insights.suppressionCheck({});

  assert.equal(capped.data.totals.violations, 0);
  assert.equal(capped.data.totals.blockEntriesRead, 2000);
  assert.equal(capped.data.totals.moreBlockEntriesExist, true);
  // The unread entries were not checked, and their number is unknown: not 0.
  assert.equal(capped.data.totals.blockEntriesNotChecked, null);
  assert.equal(capped.meta.complete, false);

  const control = await single(BLOCKED).insights.suppressionCheck({
    max_block_entries: 3000,
  });

  assert.equal(control.data.totals.violations, 1);
  assert.equal(control.data.totals.moreBlockEntriesExist, false);
  assert.equal(control.data.totals.blockEntriesNotChecked, 0);
  assert.equal(control.meta.complete, true);
});

test("the suppression_check card does not call a capped check clean", async () => {
  const text = await card(BLOCKED, "suppression_check");

  includes(
    text,
    "No blocked lead found in the entries read, but more entries exist.",
    "Stopped at 2,000 block list entries; more exist and were not checked."
  );
  assert.ok(!text.includes("🟢"), text);
});

const COLD: MemoryData = {
  campaigns: [{ id: "c1" }],
  leads: [
    ...Array.from({ length: 1200 }, (_, index) => ({
      campaignId: "c1",
      email: `person${index}@cold${index}.example`,
      id: `l${index}`,
    })),
    // Past the default cap of 1,000 leads.
    {
      campaignId: "c1",
      email: "ceo@acme.example",
      firstName: "Ann",
      id: "t1",
      interest: "Interested",
      replied: true,
    },
  ],
};

test("account_summary says in data that leads were left unread", async () => {
  const capped = await single(COLD).insights.accountSummary({
    domain: "acme.example",
  });

  assert.deepEqual(capped.data.people, []);
  assert.equal(capped.data.totals.leadsRead, 1000);
  assert.equal(capped.data.totals.moreLeadsExist, true);
  assert.equal(capped.meta.complete, false);

  const control = await single(COLD).insights.accountSummary({
    domain: "acme.example",
    max_leads: 2000,
  });

  assert.equal(control.data.totals.people, 1);
  assert.equal(control.data.totals.moreLeadsExist, false);

  includes(
    await card(COLD, "account_summary", { domain: "acme.example" }),
    "Stopped at 1,000 leads read; more exist, so people at this company may be missing."
  );
});

test("account_summary says leads were left unread when it reads campaign by campaign", async () => {
  const data: MemoryData = {
    campaigns: [{ id: "c1" }, { id: "c2" }],
    leads: [
      { campaignId: "c1", email: "person1@acme.example", id: "l1" },
      { campaignId: "c2", email: "person2@acme.example", id: "l2" },
    ],
  };

  const perCampaign = { "leads.list": false };

  const capped = await single(data, perCampaign).insights.accountSummary({
    domain: "acme.example",
    max_campaigns: 1,
  });

  assert.equal(capped.data.totals.people, 1);
  assert.equal(capped.data.totals.moreLeadsExist, true);

  const control = await single(data, perCampaign).insights.accountSummary({
    domain: "acme.example",
  });

  assert.equal(control.data.totals.people, 2);
  assert.equal(control.data.totals.moreLeadsExist, false);
});

const hoursBefore = (now: number, hours: number): string =>
  new Date(now - hours * 3_600_000).toISOString();

const hoursAgo = (hours: number): string => hoursBefore(NOW, hours);

/** 60 positive replies nobody answered, the newest 30 hours before `now`. */
const waiting = (now: number): MemoryData => ({
  campaigns: [{ id: "c1", name: "Q4" }],
  leads: Array.from({ length: 60 }, (_, index) => ({
    campaignId: "c1",
    email: `person${index}@example.com`,
    id: `l${index}`,
  })),
  messages: Array.from({ length: 60 }, (_, index) => ({
    campaignId: "c1",
    category: "positive" as const,
    direction: "in" as const,
    id: `in${index}`,
    leadId: `l${index}`,
    sentAt: hoursBefore(now, 30 + index * 5),
  })),
});

const WAITING = waiting(NOW);

test("dropped_replies says in data that replies were left unread", async () => {
  const capped = await single(WAITING).insights.droppedReplies(
    {},
    { now: NOW }
  );

  assert.equal(capped.data.dropped.length, 50);
  assert.equal(capped.data.totals.moreRepliesExist, true);
  assert.equal(capped.meta.complete, false);

  const control = await single(WAITING).insights.droppedReplies(
    { max_replies: 100, since: "2026-01-01" },
    { now: NOW }
  );

  assert.equal(control.data.dropped.length, 60);
  assert.equal(control.data.totals.moreRepliesExist, false);
});

test("the dropped_replies card says when the cap was hit", async () => {
  // The tool runs on the real clock, so the replies are dated from it.
  const [tool] = insightTools(single(waiting(Date.now())), {
    only: ["dropped_replies"],
  });

  assert.ok(tool !== undefined);

  const text = read(cardFor("dropped_replies", await tool.call({})));

  includes(
    text,
    "Stopped at 50 replies read; more exist and were not checked."
  );
});

test("dropped_replies notes a reply that carries no lead ref, instead of silently leaving the name out", async () => {
  const result = await single({
    campaigns: [{ id: "c1", name: "Q4" }],
    messages: [
      {
        campaignId: "c1",
        category: "positive",
        direction: "in",
        id: "in1",
        sentAt: hoursAgo(48),
        threadId: "t1",
      },
    ],
  }).insights.droppedReplies({}, { now: NOW });

  const [reply] = result.data.dropped;

  assert.equal(reply?.lead, null);
  assert.equal(reply?.name, null);
  assert.equal(reply?.campaignName, "Q4");
  assert.deepEqual(result.meta.notes, [
    "1 dropped reply carries no lead ref, since the vendor does not tie a reply to its lead, so name, email and linkedinUrl are null there.",
  ]);
});
