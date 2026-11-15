// One agency's tool for the data-check tests. NOW is 2026-11-14T12:00:00Z.
// Every number a test expects is worked out here, beside the data.

import { createOutbound } from "../../src/index.ts";
import { insights } from "../../src/insights/index.ts";
import { memory } from "../../src/memory/index.ts";
import type { MemoryData, MemoryLead } from "../../src/memory/index.ts";

export const NOW = Date.parse("2026-11-14T12:00:00.000Z");

export const C1 = "memory:agency:c1";
export const C2 = "memory:agency:c2";
export const S2 = "memory:agency:s2";

const active = (id: string): MemoryLead => ({
  campaignId: "c1",
  email: `${id}@example.com`,
  firstName: "Ann",
  id,
  status: "active",
});

export const DATA: MemoryData = {
  blocklist: [{ id: "b1", kind: "email", value: "blocked@example.org" }],
  campaigns: [
    {
      id: "c1",
      name: "Founders Q4",
      steps: [{ variants: [{ body: "Hi {{firstName}}, about {{company}}." }] }],
    },
    { id: "c2", name: "Agencies Q4" },
  ],
  leads: [
    // 30 active leads in c1, none with a company: {{company}} breaks for all 30.
    ...Array.from({ length: 30 }, (_, index) => active(`a${index}`)),
    // One lead on the block list, still active in c2.
    {
      campaignId: "c2",
      email: "blocked@example.org",
      id: "x1",
      status: "active",
    },
    {
      campaignId: "c2",
      email: "reply@example.com",
      firstName: "Rae",
      id: "r1",
    },
  ],
  messages: [
    {
      campaignId: "c2",
      direction: "out",
      id: "m1",
      leadId: "r1",
      sentAt: "2026-11-09T08:00:00.000Z",
      threadId: "t1",
    },
    // A positive reply 76 hours before NOW, never answered.
    {
      campaignId: "c2",
      category: "positive",
      direction: "in",
      id: "m2",
      leadId: "r1",
      sentAt: "2026-11-11T08:00:00.000Z",
      threadId: "t1",
    },
  ],
  senders: [
    { address: "ok@example.com", id: "s1" },
    { address: "down@example.com", id: "s2", status: "disconnected" },
  ],
  stats: [
    // c1: 18 bounces in 200 sends on 11-12 (9%), and nothing sent on 11-13.
    {
      campaignId: "c1",
      counts: { bounced: 18, contacted: 200, replied: 4, sent: 200 },
      date: "2026-11-12",
    },
    {
      campaignId: "c1",
      counts: { bounced: 0, contacted: 0, replied: 0, sent: 0 },
      date: "2026-11-13",
    },
    // c1 contacted 10 new leads a day over 11-07..11-13 (70 in 7 days, with the rows above it is more).
    // c2: 1 bounce in 100 sends (1%), and 40 sends on a day too small for a rate.
    {
      campaignId: "c2",
      counts: { bounced: 1, contacted: 100, replied: 5, sent: 100 },
      date: "2026-11-12",
    },
    {
      campaignId: "c2",
      counts: { bounced: 10, contacted: 40, replied: 0, sent: 40 },
      date: "2026-11-01",
    },
  ],
};

export const instance = () =>
  createOutbound({
    adapter: memory({ data: DATA, workspaceId: "agency" }),
    plugins: [insights()],
  });
