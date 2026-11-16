import { outbound } from "./outbound.ts";

const { data } = await outbound.insights.copyReuse({});

for (const copy of data.reused) {
  console.log(`"${copy.bodyPreview?.slice(0, 40)}..."`);
  console.log(`  ${copy.finding}`);
  console.log(
    `  spread ${copy.spread}, p-value ${copy.spreadPValue}, real: ${copy.spreadIsReal}`
  );
}

console.log(
  `best copy: "${data.bestCopy?.subject}" at ${data.bestCopy?.rates.replyRate.rate} over ${data.bestCopy?.rates.replyRate.of} sends`
);

console.log(
  `${data.piecesOfCopy} pieces of copy in ${data.campaignsRead} campaigns`
);
