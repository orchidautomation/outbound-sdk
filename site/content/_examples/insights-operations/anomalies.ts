import { outbound } from "./outbound.ts";

const { data } = await outbound.insights.anomalies({});

console.log(`checked ${data.period.from} to ${data.period.to}`);

for (const anomaly of data.anomalies) {
  console.log(`${anomaly.direction}: ${anomaly.finding}`);
}

for (const metric of data.metrics) {
  console.log(
    `${metric.metric}: ${metric.daysTested} of ${metric.daysWithData} days tested`
  );

  if (metric.reason !== null) {
    console.log(`  ${metric.reason}`);
  }
}
