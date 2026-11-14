// Two made-up tools for one agency: an email tool with three campaigns and a
// LinkedIn tool with one. Each has its own block list.
import type { MemoryData } from "outbound-sdk/memory";

const RAJ_PROFILE = "https://www.linkedin.com/in/raj-mehta-example";
const PAT_PROFILE = "https://www.linkedin.com/in/pat-quinn-example";

export const emailTool: MemoryData = {
  blocklist: [
    { id: "blk_leo", value: "leo@example.com" },
    { id: "blk_domain", value: "blocked.example" },
  ],
  campaigns: [
    { id: "em_founders", name: "Founders Q4" },
    { id: "em_agencies", name: "Agency owners" },
    { id: "em_summer", name: "Summer promo", status: "paused" },
  ],
  leads: [
    // Nina is in two active email campaigns.
    { campaignId: "em_founders", email: "nina@example.com", id: "f_nina" },
    { campaignId: "em_agencies", email: "nina@example.com", id: "a_nina" },
    // Raj is in two email campaigns. One record carries his profile, which
    // ties him to the LinkedIn tool.
    {
      campaignId: "em_founders",
      email: "raj@example.com",
      id: "f_raj",
      linkedinUrl: RAJ_PROFILE,
    },
    { campaignId: "em_agencies", email: "raj@example.com", id: "a_raj" },
    // Zoe is in one active campaign and one paused one.
    { campaignId: "em_founders", email: "zoe@example.com", id: "f_zoe" },
    { campaignId: "em_summer", email: "zoe@example.com", id: "s_zoe" },
    // Leo finished the sequence. His address is on the block list.
    {
      campaignId: "em_founders",
      email: "leo@example.com",
      id: "f_leo",
      status: "completed",
    },
    // Kim's domain is blocked.
    { campaignId: "em_agencies", email: "kim@blocked.example", id: "a_kim" },
    // Sue is blocked in the LinkedIn tool only.
    { campaignId: "em_agencies", email: "sue@example.com", id: "a_sue" },
  ],
};

export const linkedinTool: MemoryData = {
  blocklist: [
    { id: "blk_pat", kind: "linkedin", value: PAT_PROFILE },
    { id: "blk_sue", value: "sue@example.com" },
    // A company name cannot be matched to a lead.
    { id: "blk_company", kind: "company", value: "Initech Example" },
  ],
  campaigns: [
    { channel: "linkedin", id: "li_founders", name: "LinkedIn founders" },
  ],
  leads: [
    { campaignId: "li_founders", id: "p_raj", linkedinUrl: RAJ_PROFILE },
    { campaignId: "li_founders", id: "p_pat", linkedinUrl: PAT_PROFILE },
  ],
};
