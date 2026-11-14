import type { Outbound } from "outbound-sdk";
import type { InsightsExtension } from "outbound-sdk/insights";

// A count the vendor does not report is null, never 0. Say so.
const count = (value: number | null): string =>
  value === null ? "not reported" : String(value);

// `interested` is null when the person carries no label at all.
const interest = (interested: boolean | null): string => {
  if (interested === null) {
    return "no label";
  }

  return interested ? "interested" : "labelled, not as interested";
};

/** Everyone the instance holds at one company domain, as text. */
export const accountBrief = async (
  outbound: Outbound & InsightsExtension,
  domain: string
): Promise<string> => {
  const { data, meta } = await outbound.insights.accountSummary({ domain });
  const { lastReply, totals } = data;

  const lines = [
    `${data.domain}: ${totals.people} people in ${totals.campaigns} campaigns, ` +
      `${totals.replied} replied, ${totals.interested} marked interested`,
    lastReply === null
      ? "No reply with a known time."
      : `Last reply: ${lastReply.name ?? lastReply.email} on ${lastReply.at.slice(0, 10)}`,
    "",
  ];

  // Most recent reply first. That order comes from the insight.
  for (const person of data.people) {
    lines.push(
      `  ${person.name ?? "No name"} <${person.email}>${
        person.title === null ? "" : `, ${person.title}`
      }`,
      `    ${person.replied ? "replied" : "no reply"}, ${interest(person.interested)}; ` +
        `replies ${count(person.replies)}, clicks ${count(person.clicks)}, opens ${count(person.opens)}`,
      ...person.records.map(
        (record) =>
          `    in ${record.campaign ?? "no campaign"}: ${record.status}${record.interest === null ? "" : `, ${record.interest}`}`
      )
    );
  }

  lines.push(
    "",
    `Read ${totals.leadsRead} leads. ${totals.leadsWithoutEmail} have no email address, so a domain cannot match them.`
  );

  if (!meta.complete || meta.notes.length > 0) {
    lines.push("", ...meta.notes.map((note) => `Note: ${note}`));
  }

  return lines.join("\n");
};
