import { outbound } from "./outbound.ts";

const { data } = await outbound.insights.accountSummary({
  domain: "northwind.example.com",
});

for (const person of data.people) {
  console.log(
    `${person.name} (${person.title}): ${person.campaigns.length} campaigns, replied ${person.replied}, interested ${person.interested}, opens ${person.opens}, replies ${person.replies}`
  );
}

console.log("totals:", data.totals);

console.log("last reply:", data.lastReply?.email, "at", data.lastReply?.at);
