// A two-tool agency setup the insight tests share: one email tool with two
// campaigns and one LinkedIn tool, holding the same person under an email
// address and a profile.

import { combine } from "../../src/combine/index.ts";
import { createOutbound } from "../../src/index.ts";
import { insights } from "../../src/insights/index.ts";
import { memory } from "../../src/memory/index.ts";
import type { MemoryData } from "../../src/memory/index.ts";

export const NOW = Date.parse("2026-11-14T12:00:00.000Z");

export const PROFILE = "https://www.linkedin.com/in/example-person-1";

export const EMAIL_TOOL: MemoryData = {
  campaigns: [
    { id: "c1", name: "Founders Q4", status: "active" },
    { id: "c2", name: "Agencies Q3", status: "completed" },
    { id: "c3", name: "Never sent", status: "draft" },
  ],
  leads: [
    {
      campaignId: "c1",
      email: "person1@example.com",
      engagement: { replies: 1, stepIndex: 2 },
      id: "l1",
      interest: "Interested",
      linkedinUrl: `${PROFILE}/`,
      status: "replied",
    },
    {
      campaignId: "c2",
      email: "person1@example.com",
      engagement: { repliedStepIndex: 3 },
      id: "l2",
    },
    { campaignId: "c3", email: "person1@example.com", id: "l3" },
    { campaignId: "c1", email: "person2@example.com", id: "l4" },
  ],
  messages: [
    {
      campaignId: "c1",
      direction: "out",
      id: "m1",
      leadId: "l1",
      sentAt: "2026-11-01T09:00:00.000Z",
      stepIndex: 0,
    },
    {
      campaignId: "c1",
      direction: "out",
      id: "m2",
      leadId: "l1",
      sentAt: "2026-11-04T09:00:00.000Z",
      stepIndex: 1,
    },
    {
      campaignId: "c1",
      direction: "in",
      id: "m3",
      leadId: "l1",
      sentAt: "2026-11-05T10:00:00.000Z",
    },
    {
      campaignId: "c1",
      direction: "out",
      id: "m4",
      leadId: "l1",
      sentAt: "2026-11-06T09:00:00.000Z",
      stepIndex: 2,
    },
    {
      campaignId: "c2",
      direction: "out",
      id: "m5",
      leadId: "l2",
      sentAt: "2026-08-01T09:00:00.000Z",
      stepIndex: 0,
    },
  ],
};

export const LINKEDIN_TOOL: MemoryData = {
  campaigns: [{ channel: "linkedin", id: "k1", name: "LinkedIn founders" }],
  leads: [{ campaignId: "k1", id: "p1", linkedinUrl: PROFILE }],
  messages: [
    {
      campaignId: "k1",
      direction: "out",
      id: "d1",
      leadId: "p1",
      sentAt: "2026-11-02T09:00:00.000Z",
    },
    {
      campaignId: "k1",
      direction: "in",
      id: "d2",
      leadId: "p1",
      sentAt: "2026-11-03T09:00:00.000Z",
    },
    {
      campaignId: "k1",
      direction: "in",
      id: "d3",
      leadId: "p1",
      sentAt: "2026-11-03T09:05:00.000Z",
    },
  ],
};

/** An instance over one in-memory tool, with the insights plugin. */
export const single = (data: MemoryData, capabilities = {}) =>
  createOutbound({
    adapter: memory({ capabilities, data, workspaceId: "agency" }),
    plugins: [insights()],
  });

/** An instance over the email tool and the LinkedIn tool together. */
export const agency = () =>
  createOutbound({
    adapter: combine([
      memory({ data: EMAIL_TOOL, name: "mailtool", workspaceId: "agency" }),
      memory({ data: LINKEDIN_TOOL, name: "lntool", workspaceId: "agency" }),
    ]),
    plugins: [insights()],
  });

/** A rate's 95% interval as `{ high, low }`, or `null` when it has none. */
export const bounds = (
  rate:
    | { readonly high: number | null; readonly low: number | null }
    | undefined
) =>
  rate === undefined || rate.low === null || rate.high === null
    ? null
    : { high: rate.high, low: rate.low };
