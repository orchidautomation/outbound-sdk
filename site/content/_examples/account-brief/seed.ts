// Two made-up tools for one agency, with four people at one company. The
// company's domain is northwind.example: `.example` is reserved, so it is
// nobody's real domain.
import type { MemoryData } from "outbound-sdk/memory";

export const DOMAIN = "northwind.example";

export const emailTool: MemoryData = {
  campaigns: [
    { id: "em_founders", name: "Founders Q4" },
    { id: "em_ops", name: "Ops leaders" },
  ],
  leads: [
    // Ava is in both email campaigns. She replied twice in the first.
    {
      campaignId: "em_founders",
      company: "Northwind",
      email: "ava.chen@northwind.example",
      engagement: {
        clicks: 1,
        lastContactedAt: "2026-11-10T09:00:00.000Z",
        lastRepliedAt: "2026-11-12T15:00:00.000Z",
        opens: 5,
        replies: 2,
      },
      firstName: "Ava",
      id: "f_ava",
      interest: "Interested",
      lastName: "Chen",
      status: "replied",
      title: "CEO",
    },
    {
      campaignId: "em_ops",
      email: "ava.chen@northwind.example",
      engagement: { clicks: 0, opens: 2, replies: 0 },
      id: "o_ava",
    },
    // Ben replied once and was labelled not interested.
    {
      campaignId: "em_ops",
      company: "Northwind",
      email: "ben.ortiz@northwind.example",
      engagement: {
        clicks: 0,
        lastRepliedAt: "2026-11-05T09:00:00.000Z",
        opens: 3,
        replies: 1,
      },
      firstName: "Ben",
      id: "o_ben",
      interest: "Not Interested",
      lastName: "Ortiz",
      status: "replied",
      title: "Head of Operations",
    },
    // Cy opened one email. No label.
    {
      campaignId: "em_founders",
      email: "cy.dunn@northwind.example",
      engagement: { clicks: 0, opens: 1, replies: 0 },
      firstName: "Cy",
      id: "f_cy",
      lastName: "Dunn",
    },
    // Someone at another company.
    { campaignId: "em_founders", email: "dee@tailspin.example", id: "f_dee" },
  ],
};

export const linkedinTool: MemoryData = {
  campaigns: [
    { channel: "linkedin", id: "li_execs", name: "LinkedIn executives" },
  ],
  leads: [
    // The LinkedIn tool holds Ava's address, so her record here joins the rest.
    {
      campaignId: "li_execs",
      email: "ava.chen@northwind.example",
      id: "p_ava",
      linkedinUrl: "https://www.linkedin.com/in/ava-chen-example",
    },
    // Eve works at Northwind, but the tool has her profile only. A domain
    // cannot find her.
    {
      campaignId: "li_execs",
      company: "Northwind",
      firstName: "Eve",
      id: "p_eve",
      linkedinUrl: "https://www.linkedin.com/in/eve-marsh-example",
    },
  ],
};
