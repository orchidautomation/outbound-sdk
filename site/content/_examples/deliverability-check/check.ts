import type { Outbound } from "outbound-sdk";
import type { InsightsExtension } from "outbound-sdk/insights";

const percent = (rate: number | null): string =>
  rate === null ? "not reported" : `${(rate * 100).toFixed(1)}%`;

/**
 * One pass over domain health and bounces, as plain text. Run it from your
 * scheduler: nothing is read between runs.
 */
export const deliverabilityCheck = async (
  outbound: Outbound & InsightsExtension
): Promise<string> => {
  const domains = await outbound.insights.domainHealth({});
  const bounces = await outbound.insights.bounceWatch({ threshold: 0.03 });

  const lines = ["Domains:"];

  for (const domain of domains.data.domains) {
    lines.push(
      `  ${domain.domain}: ${domain.risk} risk, ${domain.mailboxes.length} mailboxes`,
      ...domain.reasons.map((reason) => `    - ${reason}`)
    );

    // A check the vendor reports for no mailbox was not passed. Say so.
    if (domain.notReported.length > 0) {
      lines.push(`    not reported: ${domain.notReported.join(", ")}`);
    }
  }

  lines.push(
    "",
    `Campaigns over a ${percent(bounces.data.threshold)} bounce rate:`
  );

  for (const campaign of bounces.data.over) {
    lines.push(`  ${campaign.name}: ${campaign.finding}`);

    for (const sender of campaign.senders ?? []) {
      lines.push(
        `    ${sender.address ?? sender.sender}: ${percent(sender.rate)} (${sender.bounced} of ${sender.sent})`
      );
    }
  }

  // Too few sends to judge, or no bounce count at all, is not "clean".
  lines.push(
    "",
    `Clean: ${bounces.data.totals.clean}. Too few sends to judge: ${bounces.data.totals.tooFewSends}. No bounce count: ${bounces.data.totals.unknown}.`
  );

  const notes = [...domains.meta.notes, ...bounces.meta.notes];

  if (notes.length > 0) {
    lines.push(
      "",
      "Read this before relying on the check:",
      ...notes.map((note) => `  - ${note}`)
    );
  }

  return lines.join("\n");
};
