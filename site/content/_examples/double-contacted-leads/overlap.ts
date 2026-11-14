import type { Outbound } from "outbound-sdk";
import type { InsightsExtension } from "outbound-sdk/insights";

/** People in two or more campaigns at once, as text. */
export const collisionReport = async (
  outbound: Outbound & InsightsExtension
): Promise<string> => {
  const { data, meta } = await outbound.insights.leadCollisions({});
  const { totals } = data;

  const lines = [
    `${totals.collisions} people are in two or more active campaigns ` +
      `(${totals.acrossTools} across tools, ${totals.withinTool} inside one tool)`,
    "",
  ];

  // Most campaigns first. That order comes from the insight.
  for (const person of data.collisions) {
    lines.push(
      `  ${person.finding}`,
      ...person.campaigns.map(
        (each) =>
          `    ${each.campaignName} (${each.provider}, ${each.channel}), lead is ${each.leadStatus}`
      )
    );
  }

  lines.push(
    "",
    `Read ${totals.leadsRead} leads in ${totals.campaignsRead} campaigns. ` +
      `${totals.leadsWithoutIdentifier} had no address and no profile to match on.`
  );

  if (!meta.complete || meta.notes.length > 0) {
    lines.push("", ...meta.notes.map((note) => `Note: ${note}`));
  }

  return lines.join("\n");
};

/** Leads in campaigns although the block list holds them, as text. */
export const blockListReport = async (
  outbound: Outbound & InsightsExtension
): Promise<string> => {
  const { data, meta } = await outbound.insights.suppressionCheck({});
  const { totals } = data;

  const lines = [
    `${totals.violations} leads are in active campaigns although they are on a block list ` +
      `(${totals.byMatch.email} by address, ${totals.byMatch.domain} by domain, ${totals.byMatch.linkedin} by profile)`,
    "",
  ];

  // Leads the tool still counts as active come first.
  for (const violation of data.violations) {
    lines.push(
      `  ${violation.finding}`,
      `    lead is ${violation.leadStatus}; ${
        violation.sameTool
          ? "the entry is on this tool's own list"
          : "the entry is on another tool's list"
      }`
    );
  }

  lines.push(
    "",
    `Read ${totals.blockEntriesRead} block list entries and ${totals.leadsRead} leads. ` +
      `${totals.blockEntriesNotChecked} entries are of a kind that cannot be matched to a lead, such as a company name.`
  );

  if (!meta.complete || meta.notes.length > 0) {
    lines.push("", ...meta.notes.map((note) => `Note: ${note}`));
  }

  return lines.join("\n");
};
