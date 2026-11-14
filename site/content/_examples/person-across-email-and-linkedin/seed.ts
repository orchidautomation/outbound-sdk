// Two made-up tools for one agency. The email tool knows Dana and Omar by
// address only, as Instantly would. The LinkedIn tool knows Omar by profile
// only, and Dana by profile and by address, as a HeyReach lead can.
import type { MemoryData } from "outbound-sdk/memory";

export const DANA = "dana.whitfield@example.com";

export const DANA_PROFILE =
  "https://www.linkedin.com/in/dana-whitfield-example";

export const OMAR = "omar.haddad@example.com";
export const OMAR_PROFILE = "https://www.linkedin.com/in/omar-haddad-example";

export const emailTool: MemoryData = {
  campaigns: [
    { id: "em_q4", name: "Founders Q4" },
    { id: "em_webinar", name: "Webinar follow-up", status: "completed" },
  ],
  leads: [
    {
      campaignId: "em_q4",
      email: DANA,
      engagement: { replies: 1, stepIndex: 1 },
      firstName: "Dana",
      id: "lead_dana_q4",
      interest: "Interested",
      lastName: "Whitfield",
      status: "replied",
    },
    {
      campaignId: "em_webinar",
      email: DANA,
      id: "lead_dana_webinar",
      status: "completed",
    },
    // No profile on Omar's record, so nothing ties it to the LinkedIn tool.
    { campaignId: "em_q4", email: OMAR, id: "lead_omar_q4" },
  ],
  messages: [
    {
      campaignId: "em_q4",
      direction: "out",
      id: "msg_1",
      leadId: "lead_dana_q4",
      sentAt: "2026-11-03T09:00:00.000Z",
      stepIndex: 0,
    },
    {
      campaignId: "em_q4",
      direction: "out",
      id: "msg_2",
      leadId: "lead_dana_q4",
      sentAt: "2026-11-06T09:00:00.000Z",
      stepIndex: 1,
    },
    {
      campaignId: "em_q4",
      category: "positive",
      direction: "in",
      id: "msg_3",
      leadId: "lead_dana_q4",
      sentAt: "2026-11-07T14:30:00.000Z",
    },
    {
      campaignId: "em_webinar",
      direction: "out",
      id: "msg_4",
      leadId: "lead_dana_webinar",
      sentAt: "2026-10-12T09:00:00.000Z",
      stepIndex: 0,
    },
    {
      campaignId: "em_q4",
      direction: "out",
      id: "msg_5",
      leadId: "lead_omar_q4",
      sentAt: "2026-11-03T09:05:00.000Z",
      stepIndex: 0,
    },
  ],
};

export const linkedinTool: MemoryData = {
  campaigns: [
    { channel: "linkedin", id: "li_founders", name: "LinkedIn founders" },
  ],
  leads: [
    // The one record that carries both identifiers for Dana.
    {
      campaignId: "li_founders",
      email: DANA,
      id: "prof_dana",
      linkedinUrl: DANA_PROFILE,
    },
    {
      campaignId: "li_founders",
      id: "prof_omar",
      linkedinUrl: OMAR_PROFILE,
    },
  ],
  messages: [
    {
      campaignId: "li_founders",
      direction: "out",
      id: "dm_1",
      leadId: "prof_dana",
      sentAt: "2026-11-04T10:00:00.000Z",
    },
    {
      campaignId: "li_founders",
      direction: "in",
      id: "dm_2",
      leadId: "prof_dana",
      sentAt: "2026-11-08T08:15:00.000Z",
    },
    {
      campaignId: "li_founders",
      direction: "out",
      id: "dm_3",
      leadId: "prof_dana",
      sentAt: "2026-11-10T10:00:00.000Z",
    },
    {
      campaignId: "li_founders",
      direction: "out",
      id: "dm_4",
      leadId: "prof_omar",
      sentAt: "2026-11-04T10:05:00.000Z",
    },
    {
      campaignId: "li_founders",
      direction: "in",
      id: "dm_5",
      leadId: "prof_omar",
      sentAt: "2026-11-09T16:00:00.000Z",
    },
  ],
};
