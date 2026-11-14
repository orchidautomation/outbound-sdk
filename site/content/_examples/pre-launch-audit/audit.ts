import type { Outbound } from "outbound-sdk";
import type { InsightsExtension } from "outbound-sdk/insights";

/**
 * Everything the three audits find in one campaign, as plain text. It
 * reports. Nothing here stops the campaign from being launched.
 */
export const preLaunchAudit = async (
  outbound: Outbound & InsightsExtension,
  id: string
): Promise<string> => {
  const campaign = await outbound.campaigns.get(id);

  const copy = await outbound.insights.copyAudit({ campaign: campaign.ref });

  const gaps = await outbound.insights.personalizationGaps({
    campaign: campaign.ref,
  });

  // settingsAudit takes statuses, not one campaign. Ask for this campaign's
  // status and pick the campaign out of the answer.
  const settings = await outbound.insights.settingsAudit({
    statuses: [campaign.status],
  });

  const own = settings.data.campaigns.find(
    (audited) => audited.campaign === campaign.ref
  );

  const lines = [
    `Pre-launch audit of ${campaign.name} (${campaign.status})`,
    "",
    `Copy: ${copy.data.findings.length} findings in ${copy.data.variantsChecked} variants`,
    ...copy.data.findings.map(
      (finding) =>
        `  [${finding.severity}] step ${finding.step} ${finding.variantKey}: ${finding.finding}`
    ),
    "",
    `Merge variables: ${gaps.data.totals.leadsAffected} of ${gaps.data.totals.leadsRead} leads would get broken copy`,
    ...gaps.data.variables.map((variable) =>
      variable.leadsAffected === null
        ? `  ${variable.name}: no lead has it; check it by hand`
        : `  ${variable.name}: ${variable.leadsAffected} leads affected`
    ),
    ...gaps.data.leads.map(
      (lead) =>
        `  ${lead.email ?? lead.lead} is missing ${lead.missing.join(", ")}`
    ),
    "",
    `Settings: ${own?.findings.length ?? 0} findings`,
    ...(own?.findings ?? []).map(
      (finding) => `  [${finding.severity}] ${finding.finding}`
    ),
  ];

  // A cap that cut a read short, or a check that was skipped, is said here.
  const notes = [
    ...copy.meta.notes,
    ...gaps.meta.notes,
    ...settings.meta.notes,
  ];

  if (notes.length > 0) {
    lines.push(
      "",
      "Read this before relying on the audit:",
      ...notes.map((note) => `  - ${note}`)
    );
  }

  return lines.join("\n");
};
