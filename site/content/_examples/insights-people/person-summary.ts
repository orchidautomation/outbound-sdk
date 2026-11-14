import { outbound } from "./outbound.ts";

const { data } = await outbound.insights.personSummary({
  person: "ana@northwind.example.com",
});

console.log("identifiers:", data.identifiers.join(", "));

for (const entry of data.campaigns) {
  console.log(
    `${entry.campaignName} (${entry.channel}): sent ${entry.messagesSent}, replies ${entry.replies}, replied to steps [${entry.repliedSteps.join(", ")}], interest ${entry.interest}`
  );
}

console.log("by channel:", data.totals.byChannel);

console.log(
  `replied in ${data.totals.campaignsReplied} of ${data.totals.campaigns} campaigns (rate ${data.totals.campaignReplyRate})`
);
