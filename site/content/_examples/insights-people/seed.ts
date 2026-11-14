// Made-up data for one client, "acme", on two tools: an email tool with three
// campaigns and a LinkedIn tool with one. Ana is in three of the four.
import type { MemoryData } from "outbound-sdk/memory";

const ANA_PROFILE = "https://www.linkedin.com/in/ana-ruiz-example";
const HAL_PROFILE = "https://www.linkedin.com/in/hal-voss-example";

export const MAIL: MemoryData = {
  blocklist: [
    { id: "block_gus", value: "gus@example.com" },
    { id: "block_domain", value: "blocked.example.com" },
    { id: "block_hal", kind: "linkedin", value: HAL_PROFILE },
    { id: "block_company", kind: "company", value: "Initech" },
  ],
  campaigns: [
    {
      id: "founders",
      name: "SaaS founders",
      steps: [
        {
          variants: [
            {
              body: "Hi {{firstName}}, I saw {{company}} is hiring. {{icebreaker}}\n\n{{senderSignature}}",
              subject: "Quick question, {{firstName}}",
            },
          ],
        },
        {
          delayDays: 3,
          variants: [
            { body: "Hi {{firstName|there}}, did my note reach you?" },
          ],
        },
      ],
    },
    { id: "agencies", name: "Agency owners" },
    { id: "summer", name: "Summer push", status: "completed" },
  ],
  leads: [
    {
      campaignId: "founders",
      company: "Northwind",
      custom: { icebreaker: "Congratulations on the funding round." },
      email: "ana@northwind.example.com",
      engagement: {
        clicks: 1,
        lastRepliedAt: "2026-11-12T12:00:00.000Z",
        opens: 6,
        replies: 2,
        stepIndex: 1,
      },
      firstName: "Ana",
      id: "ana_founders",
      interest: "Interested",
      lastName: "Ruiz",
      linkedinUrl: ANA_PROFILE,
      status: "replied",
      title: "CEO",
    },
    {
      campaignId: "founders",
      company: "Northwind",
      email: "ben@northwind.example.com",
      engagement: { clicks: 0, opens: 3, replies: 0 },
      firstName: "Ben",
      id: "ben_founders",
      lastName: "Okafor",
      title: "Head of Sales",
    },
    {
      campaignId: "founders",
      company: "Globex",
      custom: { icebreaker: "" },
      email: "cy@example.com",
      id: "cy_founders",
    },
    {
      campaignId: "founders",
      custom: { icebreaker: "Your talk last month was useful." },
      email: "dee@example.com",
      firstName: "Dee",
      id: "dee_founders",
      status: "unsubscribed",
    },
    {
      campaignId: "agencies",
      email: "ana@northwind.example.com",
      engagement: { opens: 2 },
      id: "ana_agencies",
    },
    { campaignId: "agencies", email: "cy@example.com", id: "cy_agencies" },
    {
      campaignId: "agencies",
      email: "eli@example.com",
      engagement: {
        clicks: 2,
        lastRepliedAt: "2026-11-07T12:00:00.000Z",
        opens: 4,
        replies: 1,
      },
      firstName: "Eli",
      id: "eli_agencies",
      interest: "Meeting Booked",
      lastName: "Stone",
      status: "replied",
    },
    {
      campaignId: "agencies",
      email: "fay@blocked.example.com",
      id: "fay_agencies",
    },
    { campaignId: "agencies", email: "gus@example.com", id: "gus_agencies" },
    {
      campaignId: "summer",
      email: "ben@northwind.example.com",
      id: "ben_summer",
      interest: "Not Interested",
      status: "completed",
    },
  ],
  messages: [
    // Ana, SaaS founders: two steps sent, then two replies nobody answered.
    {
      campaignId: "founders",
      direction: "out",
      id: "m1",
      leadId: "ana_founders",
      sentAt: "2026-11-03T09:00:00.000Z",
      stepIndex: 0,
      threadId: "thread_ana",
    },
    {
      campaignId: "founders",
      direction: "out",
      id: "m2",
      leadId: "ana_founders",
      sentAt: "2026-11-06T09:00:00.000Z",
      stepIndex: 1,
      threadId: "thread_ana",
    },
    {
      campaignId: "founders",
      category: "positive",
      direction: "in",
      id: "m3",
      leadId: "ana_founders",
      sentAt: "2026-11-07T10:00:00.000Z",
      subject: "Re: Quick question, Ana",
      threadId: "thread_ana",
    },
    {
      campaignId: "founders",
      category: "positive",
      direction: "in",
      id: "m4",
      leadId: "ana_founders",
      sentAt: "2026-11-12T12:00:00.000Z",
      subject: "Re: Quick question, Ana",
      threadId: "thread_ana",
    },
    // Ana, Agency owners: one step sent, no reply.
    {
      campaignId: "agencies",
      direction: "out",
      id: "m5",
      leadId: "ana_agencies",
      sentAt: "2026-11-10T09:00:00.000Z",
      stepIndex: 0,
    },
    // Eli: replied, and was answered two hours later.
    {
      campaignId: "agencies",
      direction: "out",
      id: "m6",
      leadId: "eli_agencies",
      sentAt: "2026-11-05T09:00:00.000Z",
      stepIndex: 0,
      threadId: "thread_eli",
    },
    {
      campaignId: "agencies",
      category: "positive",
      direction: "in",
      id: "m7",
      leadId: "eli_agencies",
      sentAt: "2026-11-07T12:00:00.000Z",
      threadId: "thread_eli",
    },
    {
      campaignId: "agencies",
      direction: "out",
      id: "m8",
      leadId: "eli_agencies",
      sentAt: "2026-11-07T14:00:00.000Z",
      threadId: "thread_eli",
    },
    // Gus: replied 16 hours ago. Unanswered, but not for a day yet.
    {
      campaignId: "agencies",
      direction: "out",
      id: "m9",
      leadId: "gus_agencies",
      sentAt: "2026-11-12T09:00:00.000Z",
      stepIndex: 0,
      threadId: "thread_gus",
    },
    {
      campaignId: "agencies",
      category: "neutral",
      direction: "in",
      id: "m10",
      leadId: "gus_agencies",
      sentAt: "2026-11-13T20:00:00.000Z",
      threadId: "thread_gus",
    },
    // Dee unsubscribed, and Cy's mailbox sent an automatic reply.
    {
      campaignId: "founders",
      category: "unsubscribe",
      direction: "in",
      id: "m11",
      leadId: "dee_founders",
      sentAt: "2026-11-08T09:00:00.000Z",
      threadId: "thread_dee",
    },
    {
      campaignId: "founders",
      category: "neutral",
      direction: "in",
      id: "m12",
      isAuto: true,
      leadId: "cy_founders",
      sentAt: "2026-11-09T09:00:00.000Z",
      threadId: "thread_cy",
    },
  ],
};

export const LINKEDIN: MemoryData = {
  campaigns: [
    { channel: "linkedin", id: "li_founders", name: "LinkedIn founders" },
  ],
  leads: [
    { campaignId: "li_founders", id: "ana_linkedin", linkedinUrl: ANA_PROFILE },
    { campaignId: "li_founders", id: "hal_linkedin", linkedinUrl: HAL_PROFILE },
  ],
  messages: [
    // Ana: replied on LinkedIn and was answered the same day.
    {
      campaignId: "li_founders",
      direction: "out",
      id: "d1",
      leadId: "ana_linkedin",
      sentAt: "2026-11-04T09:00:00.000Z",
    },
    {
      campaignId: "li_founders",
      direction: "in",
      id: "d2",
      leadId: "ana_linkedin",
      sentAt: "2026-11-05T09:00:00.000Z",
    },
    {
      campaignId: "li_founders",
      direction: "out",
      id: "d3",
      leadId: "ana_linkedin",
      sentAt: "2026-11-05T15:00:00.000Z",
    },
    // Hal: replied three days ago, and nothing was sent after.
    {
      campaignId: "li_founders",
      direction: "out",
      id: "d4",
      leadId: "hal_linkedin",
      sentAt: "2026-11-10T12:00:00.000Z",
    },
    {
      campaignId: "li_founders",
      direction: "in",
      id: "d5",
      leadId: "hal_linkedin",
      sentAt: "2026-11-11T12:00:00.000Z",
    },
  ],
};
