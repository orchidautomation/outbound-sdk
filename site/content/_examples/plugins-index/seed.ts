// Made-up data for one agency workspace, "agency", that runs campaigns for
// two clients. Every sample in the Plugins section reads this.
import type { MemoryData } from "outbound-sdk/memory";

export const seed: MemoryData = {
  campaigns: [
    { id: "cmp_founders", name: "Acme: SaaS founders", tags: ["acme"] },
    { id: "cmp_agencies", name: "Globex: agency owners", tags: ["globex"] },
    { id: "cmp_ecom", name: "Ecommerce ops" },
  ],
  leads: [
    {
      campaignId: "cmp_founders",
      company: "Northwind",
      createdAt: "2026-11-09T09:00:00.000Z",
      custom: { phone: "555-0100" },
      email: "jane.doe@example.com",
      firstName: "Jane",
      id: "lead_jane",
      lastName: "Doe",
      linkedinUrl: "https://www.linkedin.com/in/jane-doe-example",
    },
    {
      campaignId: "cmp_founders",
      company: "Contoso",
      createdAt: "2026-11-10T09:00:00.000Z",
      email: "sam.lee@example.com",
      firstName: "Sam",
      id: "lead_sam",
      lastName: "Lee",
    },
    {
      campaignId: "cmp_agencies",
      company: "Fabrikam",
      createdAt: "2026-11-12T09:00:00.000Z",
      email: "priya.patel@example.com",
      firstName: "Priya",
      id: "lead_priya",
      lastName: "Patel",
    },
    {
      campaignId: "cmp_ecom",
      company: "Tailspin",
      createdAt: "2026-11-13T09:00:00.000Z",
      email: "omar.haddad@example.com",
      firstName: "Omar",
      id: "lead_omar",
      lastName: "Haddad",
    },
  ],
  messages: [
    {
      body: "Hi Jane, are you still hiring SDRs?",
      campaignId: "cmp_founders",
      direction: "out",
      id: "msg_1",
      leadId: "lead_jane",
      senderId: "snd_ana",
      sentAt: "2026-11-10T10:00:00.000Z",
      subject: "Quick question",
    },
    {
      body: "Yes. Send me some times for next week.",
      campaignId: "cmp_founders",
      category: "positive",
      direction: "in",
      id: "msg_2",
      leadId: "lead_jane",
      sentAt: "2026-11-11T08:30:00.000Z",
      subject: "Re: Quick question",
    },
    {
      body: "Hi Priya, how do you report to clients today?",
      campaignId: "cmp_agencies",
      direction: "out",
      id: "msg_3",
      leadId: "lead_priya",
      senderId: "snd_ana",
      sentAt: "2026-11-12T10:00:00.000Z",
      subject: "Client reporting",
    },
  ],
  senders: [
    { address: "ana@agency.example.com", id: "snd_ana", name: "Ana Ruiz" },
    {
      address: "ben@agency.example.com",
      id: "snd_ben",
      name: "Ben Cole",
      status: "disconnected",
    },
  ],
  stats: [
    // Acme: 200 sent, 12 replies, 2 bounces over two days.
    {
      campaignId: "cmp_founders",
      counts: { bounced: 1, replied: 6, sent: 100 },
      date: "2026-11-12",
    },
    {
      campaignId: "cmp_founders",
      counts: { bounced: 1, replied: 6, sent: 100 },
      date: "2026-11-13",
    },
    // Globex: 400 sent, 8 replies, 4 bounces.
    {
      campaignId: "cmp_agencies",
      counts: { bounced: 2, replied: 4, sent: 200 },
      date: "2026-11-12",
    },
    {
      campaignId: "cmp_agencies",
      counts: { bounced: 2, replied: 4, sent: 200 },
      date: "2026-11-13",
    },
    // No client: nothing on the 11th, then 200 sent, 2 replies, 18 bounces.
    { campaignId: "cmp_ecom", counts: { sent: 0 }, date: "2026-11-11" },
    {
      campaignId: "cmp_ecom",
      counts: { bounced: 9, replied: 1, sent: 100 },
      date: "2026-11-12",
    },
    {
      campaignId: "cmp_ecom",
      counts: { bounced: 9, replied: 1, sent: 100 },
      date: "2026-11-13",
    },
  ],
};
