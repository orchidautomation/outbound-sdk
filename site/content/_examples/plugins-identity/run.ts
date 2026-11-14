import { createOutbound } from "outbound-sdk";
import { combine } from "outbound-sdk/combine";
import { identity } from "outbound-sdk/identity";
import { memory } from "outbound-sdk/memory";

import { seed } from "../plugins-index/seed.ts";

// A second tool that knows Jane only by her LinkedIn profile.
const linkedinTool = memory({
  data: {
    campaigns: [{ channel: "linkedin", id: "li_founders", name: "Founders" }],
    leads: [
      {
        campaignId: "li_founders",
        firstName: "Jane",
        id: "li_jane",
        linkedinUrl: "https://linkedin.com/in/Jane-Doe-Example/?utm_source=x",
      },
    ],
    messages: [
      {
        body: "Thanks for connecting, Jane.",
        campaignId: "li_founders",
        direction: "out",
        id: "li_msg_1",
        leadId: "li_jane",
        sentAt: "2026-11-10T15:00:00.000Z",
      },
    ],
  },
  name: "linkedintool",
  workspaceId: "agency",
});

const outbound = createOutbound({
  adapter: combine([
    memory({ data: seed, workspaceId: "agency" }),
    linkedinTool,
  ]),
  plugins: [identity()],
});

// Every lead is tagged as it is read.
for await (const lead of outbound.leads.listAll()) {
  console.log(
    lead.ref,
    "personKey" in lead ? lead.personKey : "?",
    "personKeys" in lead ? lead.personKeys : "?"
  );
}

// Asked by email, found in both tools through the profile the email record carries.
const person = await outbound.person("Jane.Doe@example.com");

console.log("\nfound:", person.found);

console.log("keys:", person.keys);

console.log(
  "records:",
  person.records.map((record) => record.ref)
);

for (const message of person.timeline) {
  console.log(message.sentAt, message.provider, message.direction);
}

// No record carries this address. The link is unknown, not an error.
const nobody = await outbound.person("nobody@example.com");

console.log("\nnobody:", nobody.found, nobody.records.length);
