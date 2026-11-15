import type { Outbound } from "outbound-sdk";
import type { InsightsExtension } from "outbound-sdk/insights";

const number = (value: number | null): string =>
  value === null ? "not reported" : String(value);

/**
 * Whether the senders can carry one more campaign of `plannedDaily` sends a
 * day, as plain text. The three insights give the numbers; the subtraction
 * at the top is this function's own.
 */
export const capacityFor = async (
  outbound: Outbound & InsightsExtension,
  plannedDaily: number
): Promise<string> => {
  const capacity = await outbound.insights.senderCapacity({
    days: 7,
    split_uncounted: true,
  });

  const readiness = await outbound.insights.warmupReadiness({});
  const load = await outbound.insights.senderLoad({});

  const { daily } = capacity.data.capacity;
  const ask = capacity.data.ask?.daily ?? null;

  // A limit the vendor does not report is null, never 0. Without both
  // numbers there is no headroom to state.
  const headroom = daily === null || ask === null ? null : daily - ask;

  const lines = [capacity.data.finding];

  if (headroom === null) {
    lines.push(
      `Headroom cannot be stated: capacity is ${number(daily)} and the campaigns' ask is ${number(ask)}.`
    );
  } else {
    lines.push(
      `Headroom is ${headroom} a day. A campaign of ${plannedDaily} a day ${
        headroom >= plannedDaily
          ? "fits"
          : `does not fit: short by ${plannedDaily - headroom}`
      }.`
    );
  }

  lines.push("", "Before you count on that capacity:");

  for (const campaign of capacity.data.shortCampaigns ?? []) {
    lines.push(`  - ${campaign.finding}`);
  }

  // Capacity adds up every active sender, ready or not.
  for (const sender of readiness.data.notReady) {
    lines.push(
      `  - ${sender.address ?? sender.sender} is not ready: ${sender.findings.join("; ")}.`
    );
  }

  for (const sender of load.data.overused) {
    lines.push(`  - ${sender.finding}`);
  }

  for (const campaign of load.data.campaigns) {
    lines.push(`  - ${campaign.finding}`);
  }

  if (load.data.unused.length > 0) {
    lines.push(
      "",
      `Active senders attached to no campaign: ${load.data.unused
        .map((sender) => sender.address ?? sender.sender)
        .join(", ")}`
    );
  }

  const notes = [
    ...capacity.meta.notes,
    ...readiness.meta.notes,
    ...load.meta.notes,
  ];

  if (notes.length > 0) {
    lines.push(
      "",
      "Read this before relying on the numbers:",
      ...notes.map((note) => `  - ${note}`)
    );
  }

  return lines.join("\n");
};
