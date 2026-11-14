// One made-up email tool with eight leads. The clock in the samples is
// 2026-11-14 12:00 UTC, so "3.5 days ago" is 2026-11-11 00:00.
import type { MemoryData } from "outbound-sdk/memory";

export const CAMPAIGN = "memory:acme:cmp_founders";

export const seed: MemoryData = {
  campaigns: [{ id: "cmp_founders", name: "Founders Q4" }],
  leads: [
    // A positive label, two replies, the last 3.5 days ago, a click, six opens.
    {
      campaignId: "cmp_founders",
      company: "Northwind Example",
      email: "ava.chen@example.com",
      engagement: {
        clicks: 1,
        lastRepliedAt: "2026-11-11T00:00:00.000Z",
        opens: 6,
        replies: 2,
      },
      firstName: "Ava",
      id: "lead_ava",
      interest: "Interested",
      lastName: "Chen",
      status: "replied",
      title: "CEO",
    },
    // No label. One reply, 1.4 days ago.
    {
      campaignId: "cmp_founders",
      company: "Tailspin Example",
      email: "ben.ortiz@example.com",
      engagement: {
        clicks: 0,
        lastRepliedAt: "2026-11-13T02:24:00.000Z",
        opens: 3,
        replies: 1,
      },
      firstName: "Ben",
      id: "lead_ben",
      lastName: "Ortiz",
      status: "replied",
      title: "Head of Sales",
    },
    // Labelled not interested, but replied a week ago.
    {
      campaignId: "cmp_founders",
      email: "cara.lind@example.com",
      engagement: {
        clicks: 0,
        lastRepliedAt: "2026-11-07T12:00:00.000Z",
        opens: 2,
        replies: 1,
      },
      firstName: "Cara",
      id: "lead_cara",
      interest: "Not Interested",
      lastName: "Lind",
      status: "replied",
    },
    // Forty opens and nothing else. Opens stop counting at count_cap.
    {
      campaignId: "cmp_founders",
      email: "dev.rao@example.com",
      engagement: { clicks: 0, opens: 40, replies: 0 },
      firstName: "Dev",
      id: "lead_dev",
      lastName: "Rao",
    },
    // Nothing reported: no label and no counts.
    {
      campaignId: "cmp_founders",
      email: "eli.park@example.com",
      id: "lead_eli",
    },
    // Unsubscribed and bounced leads are never on the list.
    {
      campaignId: "cmp_founders",
      email: "fay.novak@example.com",
      engagement: { replies: 1 },
      id: "lead_fay",
      status: "unsubscribed",
    },
    {
      campaignId: "cmp_founders",
      email: "gus.hale@example.com",
      id: "lead_gus",
      status: "bounced",
    },
    // Three clicks and four opens, no reply.
    {
      campaignId: "cmp_founders",
      email: "hal.berg@example.com",
      engagement: { clicks: 3, opens: 4, replies: 0 },
      firstName: "Hal",
      id: "lead_hal",
      lastName: "Berg",
      title: "COO",
    },
  ],
};
