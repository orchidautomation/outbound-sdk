import { outbound } from "./outbound.ts";

const { data } = await outbound.insights.domainHealth({});

for (const domain of data.domains) {
  console.log(`${domain.domain}: ${domain.risk} risk`);

  for (const reason of domain.reasons) {
    console.log(`  - ${reason}`);
  }

  if (domain.notReported.length > 0) {
    console.log(`  not reported: ${domain.notReported.join(", ")}`);
  }
}

console.log(
  "LinkedIn seats:",
  data.linkedinSeats.map((seat) => `${seat.name}, connected ${seat.connected}`)
);

console.log("totals:", data.totals);
