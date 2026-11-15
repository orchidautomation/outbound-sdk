// The numbers behind a reply, as Slack cards. outbound-sdk draws a card for
// each tool and insight (`outbound-sdk/cards`): a finding, a grid of number
// tiles, a table, a chart where there is a series, and the source. This picks
// the ones a turn called and turns them into Block Kit messages.

import type { CallObservation } from "eve/events";
import type { ToolResult } from "outbound-sdk/tools";

export interface SlackCardMessage {
  readonly blocks: unknown[];
  readonly text: string;
}

// Slack draws one table per message, so each card gets its own message. Past
// this many, the rest share one digest instead of flooding the thread.
const MAX_CARDS = 3;

const isSuccess = (output: unknown): output is ToolResult & { ok: true } =>
  typeof output === "object" &&
  output !== null &&
  "ok" in output &&
  output.ok === true &&
  "meta" in output;

/**
 * The messages for the outbound calls a turn completed, in the order the
 * tools were first called. The latest call of each tool wins, and failed
 * calls are left out: the reply already says what went wrong.
 */
export const cardMessages = async (
  observed: readonly CallObservation[]
): Promise<SlackCardMessage[]> => {
  const { CARD_NAMES, cardFor, digest, toSlackMessage } =
    await import("outbound-sdk/cards");

  const latest = new Map<string, ToolResult>();

  for (const call of observed) {
    if (
      call.state === "completed" &&
      CARD_NAMES.includes(call.name) &&
      isSuccess(call.output)
    ) {
      latest.set(call.name, call.output);
    }
  }

  const sections = [...latest].map(([name, result]) => ({ name, result }));
  const cards = sections.slice(0, MAX_CARDS);
  const rest = sections.slice(MAX_CARDS);

  return [
    ...cards.map(({ name, result }) => toSlackMessage(cardFor(name, result))),
    ...(rest.length === 0
      ? []
      : [toSlackMessage(digest({ sections: rest, title: "More numbers" }))]),
  ];
};
