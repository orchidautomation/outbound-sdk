import type { Outbound } from "outbound-sdk";
import type { InsightsExtension } from "outbound-sdk/insights";

/** Replies waiting longer than `hours` with nothing sent after them, as text. */
export const unansweredReplies = async (
  outbound: Outbound & InsightsExtension,
  hours = 24
): Promise<string> => {
  const { data, meta } = await outbound.insights.droppedReplies({
    older_than_hours: hours,
  });

  const lines = [
    `${data.totals.dropped} unanswered for more than ${data.olderThanHours} hours, since ${data.since.slice(0, 10)}`,
    "",
  ];

  // Longest waiting first. That order comes from the insight.
  for (const reply of data.dropped) {
    // The insight names each person and campaign; any it could not read are null.
    const who =
      reply.name ?? reply.email ?? reply.linkedinUrl ?? "unknown lead";

    lines.push(
      `  ${Math.floor(reply.hoursWaiting)}h  ${who}${reply.campaignName === null ? "" : ` (${reply.campaignName})`}`,
      `       ${reply.channel}, ${reply.category}, ${reply.unansweredReplies} unanswered${
        reply.subject === null ? "" : `, "${reply.subject}"`
      }`
    );
  }

  const { totals } = data;

  lines.push(
    "",
    `Read ${totals.repliesRead} replies in ${totals.conversations} conversations to check: ` +
      `${totals.answered} answered, ${totals.tooRecent} too recent, ${totals.unchecked} could not be checked.`,
    `Left out: ${totals.skippedByCategory} by category, ${totals.skippedAuto} automatic.`
  );

  // A list cut short by max_replies is not the whole list. Say so.
  if (!meta.complete || meta.notes.length > 0) {
    lines.push("", ...meta.notes.map((note) => `Note: ${note}`));
  }

  return lines.join("\n");
};
