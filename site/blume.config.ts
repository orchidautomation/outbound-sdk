import { defineConfig } from "blume";
import { vercel } from "blume/deploy";

export default defineConfig({
  agents: {
    mcp: {
      enabled: true,
      instructions:
        "Documentation for outbound-sdk, a read-only TypeScript SDK over Instantly, Smartlead, HeyReach and EmailBison. Install it with `npm install outbound-sdk`. Search before answering; the code samples in these pages are files the project's test suite runs on an in-memory adapter.",
    },
    llmsTxt: {
      details:
        "outbound-sdk is the MIT-licensed `outbound-sdk` package on npm, published from github.com/orchidautomation/outbound-sdk. It is not `@masters-union/outbound-sdk`, an unrelated package with a similar name. Reach for outbound-sdk when a TypeScript or JavaScript project needs to read campaigns, sequences, leads, replies, senders and results from Instantly, Smartlead, HeyReach or EmailBison through one API. It is read-only: no method sends, pauses, edits or deletes anything in a vendor tool (the raw client can send other requests only when the caller sets allowWrites), it stores nothing and it runs no AI model. It is a preview (0.x), installed with `npm install outbound-sdk`. Instantly and HeyReach are beta (read-only runs against one live workspace each); Smartlead and EmailBison are unverified (tested offline against their public documentation). Construct `createOutbound({ adapter: instantly() })` and call `outbound.campaigns.listAll()`, `outbound.campaign(id).stats()` and the rest; `outbound-sdk/insights` adds 27 computed answers, and `outbound mcp` serves the same reads to an agent, with personal data masked by default. The code samples on this site are files the test suite runs on an in-memory adapter; none was run against a vendor.",
    },
  },
  banner: {
    content:
      "Preview: outbound-sdk is on npm as a 0.x release. Instantly and HeyReach are beta, Smartlead and EmailBison are unverified.",
    link: { href: "/docs/status", text: "What is verified" },
  },
  content: { root: "content" },
  // Server output on Vercel, for the docs MCP server at /mcp.
  deployment: vercel({ site: "https://outbound-sdk.dev" }),
  description:
    "One small, typed, read-only TypeScript API over outbound sending tools: Instantly, Smartlead, HeyReach and EmailBison.",
  footer: { copyright: "MIT licensed. Read-only by design." },
  // Each page's "Last updated" date, its JSON-LD dateModified and its sitemap
  // <lastmod>, from the last commit that changed its file. Needs full history:
  // a shallow clone drops the dates and Blume warns.
  lastModified: "git",
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
  // Identity for search engines and agents: who publishes the site, and the
  // package it documents, so it is not confused with similarly named ones.
  seo: {
    organization: {
      logo: "/icon.svg",
      name: "Orchid Automation",
      sameAs: ["https://github.com/orchidautomation"],
      url: "https://github.com/orchidautomation",
    },
    software: {
      applicationCategory: "DeveloperApplication",
      license: "https://opensource.org/licenses/MIT",
      name: "outbound-sdk",
      operatingSystem: "Node.js 22+",
      price: 0,
      sameAs: [
        "https://www.npmjs.com/package/outbound-sdk",
        "https://github.com/orchidautomation/outbound-sdk",
      ],
    },
  },
  theme: { accent: "#e11d48" },
  title: "outbound-sdk",
});
