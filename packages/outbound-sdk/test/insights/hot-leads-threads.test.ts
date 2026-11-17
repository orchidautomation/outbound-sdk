import assert from "node:assert/strict";
import { test } from "node:test";

import type { MemoryData } from "../../src/memory/index.ts";
import { NOW, single } from "./helpers.ts";

// NOW is 2026-11-14T12:00:00Z. One lead labelled interested whose reply was
// answered, one whose reply nobody answered.
const DATA: MemoryData = {
  campaigns: [{ id: "c1", name: "Agency owners" }],
  leads: [
    {
      campaignId: "c1",
      email: "person1@example.com",
      id: "a1",
      interest: "Interested",
      interestCategory: "positive",
    },
    {
      campaignId: "c1",
      email: "person2@example.com",
      id: "a2",
      interest: "Interested",
      interestCategory: "positive",
      meeting: "booked",
    },
  ],
  messages: [
    {
      campaignId: "c1",
      category: "positive",
      direction: "in",
      id: "m1",
      leadId: "a1",
      sentAt: "2026-11-12T08:00:00.000Z",
    },
    {
      campaignId: "c1",
      direction: "out",
      id: "m2",
      leadId: "a1",
      sentAt: "2026-11-12T09:00:00.000Z",
    },
    {
      campaignId: "c1",
      category: "positive",
      direction: "in",
      id: "m3",
      leadId: "a2",
      sentAt: "2026-11-13T08:00:00.000Z",
    },
  ],
};

const byLead = (
  leads: readonly {
    lead: string;
    followUp?: { basis: string; needed: boolean | null } | undefined;
  }[]
) =>
  Object.fromEntries(
    leads.map((each) => [
      each.lead,
      [each.followUp?.basis, each.followUp?.needed],
    ])
  );

test("hot_leads leaves follow-up unknown by default: a label is not a verdict", async () => {
  const { data } = await single(DATA).insights.hotLeads({}, { now: NOW });

  assert.deepEqual(byLead(data.leads), {
    "memory:agency:a1": ["not_read", null],
    // A recorded meeting settles it even unread.
    "memory:agency:a2": ["meeting", false],
  });
});

test("hot_leads with read_threads reads each returned lead's conversation", async () => {
  const { data } = await single(DATA).insights.hotLeads(
    { read_threads: true },
    { now: NOW }
  );

  assert.deepEqual(byLead(data.leads), {
    "memory:agency:a1": ["answered", false],
    "memory:agency:a2": ["meeting", false],
  });
  assert.equal(
    data.leads.find((each) => each.lead === "memory:agency:a1")?.activity
      ?.latest?.direction,
    "out"
  );
});

test("hot_leads with read_threads says why a conversation was not read where no timeline can be", async () => {
  const { data } = await single(DATA, {
    "leads.timeline": false,
  }).insights.hotLeads({ read_threads: true }, { now: NOW });

  const first = data.leads.find((each) => each.lead === "memory:agency:a1");

  assert.equal(first?.followUp?.needed, null);
  assert.match(
    first?.followUp?.unchecked[0] ?? "",
    /not read \(this tool cannot read a lead's timeline \(leads\.timeline\)\)/u
  );
});
