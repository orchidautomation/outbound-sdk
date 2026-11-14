import { createOutbound } from "outbound-sdk";
import type { FilterGrade } from "outbound-sdk";
import { demoData, memory } from "outbound-sdk/memory";

// The same read on three adapters that differ in one grade.
const read = async (grade: FilterGrade): Promise<void> => {
  const outbound = createOutbound({
    adapter: memory({
      capabilities: { "campaigns.status": grade },
      data: demoData(),
    }),
  });

  try {
    const page = await outbound.campaigns.list({ status: "paused" });

    console.log(
      `${grade}:`,
      page.items.map((campaign) => campaign.name),
      page.meta.evidence
    );
  } catch (error) {
    console.log(`${grade}:`, error instanceof Error ? error.message : error);
  }
};

await read("server");

await read("client");

await read(false);
