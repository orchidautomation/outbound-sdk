import { outbound } from "./outbound.ts";

// Ana's conversation in the founders campaign, and a lead that does not exist.
const { data } = await outbound.insights.threadContext({
  leads: ["mailtool:acme:ana_founders", "mailtool:acme:nobody"],
  max_messages: 2,
});

for (const thread of data.threads) {
  const { latest } = thread.activity;

  console.log(
    `${thread.email ?? thread.target.id}: latest ${latest?.direction ?? "none"} at ${latest?.sentAt ?? "-"}, meeting ${thread.meeting ?? "none recorded"}`
  );
  console.log("vendorSentiment:", thread.vendorSentiment);
  console.log("followUp:", thread.followUp);

  for (const message of thread.messages) {
    console.log(
      `  ${message.direction} ${message.sentAt}: ${message.snippet?.untrustedContent ?? ""}`
    );
  }
}

console.log("coverage:", data.coverage);
