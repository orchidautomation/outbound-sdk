// One made-up tool with an email campaign and a LinkedIn campaign. The clock
// in the samples is 2026-11-14 12:00 UTC.
import type { MemoryData } from "outbound-sdk/memory";

export const seed: MemoryData = {
  campaigns: [
    { id: "cmp_email", name: "Founders Q4" },
    { channel: "linkedin", id: "cmp_linkedin", name: "LinkedIn founders" },
  ],
  leads: [
    { campaignId: "cmp_email", email: "priya@example.com", id: "lead_priya" },
    { campaignId: "cmp_email", email: "luis@example.com", id: "lead_luis" },
    { campaignId: "cmp_email", email: "mei@example.com", id: "lead_mei" },
    { campaignId: "cmp_email", email: "sam@example.com", id: "lead_sam" },
    {
      campaignId: "cmp_linkedin",
      id: "lead_tom",
      linkedinUrl: "https://www.linkedin.com/in/tom-okafor-example",
    },
  ],
  messages: [
    // Priya replied on Tuesday and again on Thursday. Nothing went back.
    {
      campaignId: "cmp_email",
      direction: "out",
      id: "msg_01",
      leadId: "lead_priya",
      sentAt: "2026-11-09T08:00:00.000Z",
      threadId: "thread_priya",
    },
    {
      campaignId: "cmp_email",
      category: "positive",
      direction: "in",
      id: "msg_02",
      leadId: "lead_priya",
      sentAt: "2026-11-10T09:00:00.000Z",
      subject: "Re: pricing for 10 seats",
      threadId: "thread_priya",
    },
    {
      campaignId: "cmp_email",
      category: "neutral",
      direction: "in",
      id: "msg_03",
      leadId: "lead_priya",
      sentAt: "2026-11-12T10:00:00.000Z",
      subject: "Re: pricing for 10 seats",
      threadId: "thread_priya",
    },
    // Luis was answered ninety minutes after he replied.
    {
      campaignId: "cmp_email",
      category: "neutral",
      direction: "in",
      id: "msg_04",
      leadId: "lead_luis",
      sentAt: "2026-11-11T08:00:00.000Z",
      subject: "Re: quick question",
      threadId: "thread_luis",
    },
    {
      campaignId: "cmp_email",
      direction: "out",
      id: "msg_05",
      leadId: "lead_luis",
      sentAt: "2026-11-11T09:30:00.000Z",
      threadId: "thread_luis",
    },
    // Mei replied five hours ago: unanswered, but not yet a day old.
    {
      campaignId: "cmp_email",
      category: "positive",
      direction: "in",
      id: "msg_06",
      leadId: "lead_mei",
      sentAt: "2026-11-14T07:00:00.000Z",
      subject: "Re: intro",
      threadId: "thread_mei",
    },
    // Sam is out of office, twice: once filed as such, once filed as neutral
    // but marked automatic. Neither needs an answer.
    {
      campaignId: "cmp_email",
      category: "ooo",
      direction: "in",
      id: "msg_07",
      leadId: "lead_sam",
      sentAt: "2026-11-10T06:00:00.000Z",
      subject: "Out of office",
      threadId: "thread_sam_1",
    },
    {
      campaignId: "cmp_email",
      category: "neutral",
      direction: "in",
      id: "msg_08",
      isAuto: true,
      leadId: "lead_sam",
      sentAt: "2026-11-11T06:00:00.000Z",
      subject: "Automatic reply",
      threadId: "thread_sam_2",
    },
    // Tom replied on LinkedIn. The message has no thread id, so the
    // conversation is read from his timeline.
    {
      campaignId: "cmp_linkedin",
      direction: "out",
      id: "msg_09",
      leadId: "lead_tom",
      sentAt: "2026-11-12T09:00:00.000Z",
    },
    {
      campaignId: "cmp_linkedin",
      category: "positive",
      direction: "in",
      id: "msg_10",
      leadId: "lead_tom",
      sentAt: "2026-11-13T05:00:00.000Z",
    },
  ],
};
