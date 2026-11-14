import { outbound } from "./outbound.ts";

const { data } = await outbound.insights.warmupReadiness({
  check_health: true,
});

for (const sender of data.notReady) {
  console.log(`${sender.address}:`);

  for (const finding of sender.findings) {
    console.log(`  - ${finding}`);
  }
}

console.log(`ready: ${data.ready} of ${data.total}`);

console.log("by reason:", data.byReason);
