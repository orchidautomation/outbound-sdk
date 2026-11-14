import { outbound } from "./outbound.ts";

const { data } = await outbound.insights.copyAudit({
  campaign: "memory:acme:founders",
});

for (const finding of data.findings) {
  console.log(
    `step ${finding.step} ${finding.severity} ${finding.check}: ${finding.finding}`
  );
}

console.log("by severity:", data.bySeverity);

console.log(
  `checked ${data.variantsChecked} variants in ${data.stepsChecked} steps, clean: ${data.clean}`
);
