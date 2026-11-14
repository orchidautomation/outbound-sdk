import { outbound } from "./outbound.ts";

const { data } = await outbound.insights.suppressionCheck({});

for (const violation of data.violations) {
  console.log(
    `${violation.finding} (matched by ${violation.matchedBy}, same tool: ${violation.sameTool})`
  );
}

console.log("totals:", data.totals);
