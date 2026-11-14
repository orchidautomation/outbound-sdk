import type { Outbound } from "outbound-sdk";
import type { HotLeadParts, InsightsExtension } from "outbound-sdk/insights";

// A part is null when the vendor reports nothing for that signal. That is
// "unknown", not zero points.
const part = (name: string, points: number | null): string =>
  `${name} ${points === null ? "unknown" : points}`;

const breakdown = (parts: HotLeadParts): string =>
  [
    part("label", parts.interest),
    part("replies", parts.replies),
    part("recency", parts.recency),
    part("clicks", parts.clicks),
    part("opens", parts.opens),
  ].join(", ");

/**
 * Who to call first, as text. Give a campaign ref to rank one campaign;
 * without one, every lead the tool lists is ranked.
 */
export const callList = async (
  outbound: Outbound & InsightsExtension,
  campaign: string | null = null
): Promise<string> => {
  const { data, meta } = await outbound.insights.hotLeads({
    campaign,
    limit: 10,
  });

  const lines = data.leads.flatMap((lead, index) => [
    `${index + 1}. ${lead.name ?? "No name"} <${lead.email ?? lead.linkedinUrl ?? lead.lead}>${
      lead.title === null ? "" : `, ${lead.title}`
    }${lead.company === null ? "" : `, ${lead.company}`}`,
    `   score ${lead.score}: ${breakdown(lead.parts)}`,
    `   ${lead.reason}`,
  ]);

  const { totals } = data;

  lines.push(
    "",
    `Read ${totals.leadsRead} leads: ${totals.hot} scored above 0, ` +
      `${totals.withoutData} had nothing to score, ${totals.excluded} unsubscribed or bounced.`
  );

  // A read stopped by max_leads ranks part of the leads. A vendor with no
  // per-lead counts ranks on less. Both are said in the notes.
  if (!meta.complete || meta.notes.length > 0) {
    lines.push("", ...meta.notes.map((note) => `Note: ${note}`));
  }

  return lines.join("\n");
};
