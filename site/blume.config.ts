import { defineConfig } from "blume";
import { vercel } from "blume/deploy";

export default defineConfig({
  agents: {
    mcp: {
      enabled: true,
      instructions:
        "Documentation for outbound-sdk, a read-only TypeScript SDK over Instantly, Smartlead and HeyReach. Install it with `npm install outbound-sdk` (0.1.0). Search before answering; the code samples in these pages are files the project's test suite runs on an in-memory adapter.",
    },
    llmsTxt: {
      details:
        "Reach for outbound-sdk when a TypeScript or JavaScript project needs to read campaigns, sequences, leads, replies, senders and results from Instantly, Smartlead or HeyReach through one API. It is read-only: no method sends, pauses, edits or deletes anything in a vendor tool (the raw client can send other requests only when the caller sets allowWrites), it stores nothing and it runs no AI model. It is a preview at 0.1.0, installed with `npm install outbound-sdk`. Instantly and HeyReach are beta (read-only runs against one live workspace each); Smartlead is unverified (tested offline against its public documentation). Construct `createOutbound({ adapter: instantly() })` and call `outbound.campaigns.listAll()`, `outbound.campaign(id).stats()` and the rest; `outbound-sdk/insights` adds 26 computed answers, and `outbound mcp` serves the same reads to an agent. The code samples on this site are files the test suite runs on an in-memory adapter; none was run against a vendor.",
    },
  },
  banner: {
    content:
      "Preview: outbound-sdk 0.1.0 is on npm. Instantly and HeyReach are beta, Smartlead is unverified.",
    link: { href: "/docs/status", text: "What is verified" },
  },
  content: { root: "content" },
  // Server output on Vercel, for the docs MCP server at /mcp.
  deployment: vercel({ site: "https://outbound-sdk.dev" }),
  description:
    "One small, typed, read-only TypeScript API over outbound sending tools: Instantly, Smartlead and HeyReach.",
  footer: { copyright: "MIT licensed. Read-only by design." },
  logo: { image: "/icon.svg", text: "outbound-sdk" },
  navigation: {
    tabs: [
      { label: "Docs", path: "/docs" },
      { label: "Guides", path: "/docs/guides" },
    ],
  },
  // The guides moved under /docs; keep the old addresses working.
  redirects: [
    { from: "/guides/:slug*", status: 308, to: "/docs/guides/:slug*" },
  ],
  theme: { accent: "#e11d48" },
  title: "outbound-sdk",
});
