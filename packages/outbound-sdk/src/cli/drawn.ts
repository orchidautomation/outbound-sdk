// How a tool's answer is printed with --card, --slack-text or --slack.

import { OutboundError } from "../internal/errors.ts";
import { toJson } from "../internal/json.ts";
import type { ToolResult } from "../tools/index.ts";
import { Answer, coverageOf } from "./envelope.ts";
import type { Printed } from "./envelope.ts";
import type { CommandInput } from "./inputs.ts";

const asJson = toJson;

const CARD_FLAGS = ["card", "slack", "slack-text"] as const;

export const wantsCard = (input: CommandInput): boolean =>
  CARD_FLAGS.some((flag) => input.flags[flag] === true);

/**
 * A tool result as it should be printed: itself, or with `--card` its card
 * as text, with `--slack-text` that text in Slack's mrkdwn, ready to paste
 * into the composer, or with `--slack` the card as a Slack message's JSON,
 * ready to post with `chat.postMessage`. The last three print no envelope.
 */
export const drawn = async (
  name: string,
  result: ToolResult,
  input: CommandInput
): Promise<Printed> => {
  if (!wantsCard(input)) {
    return asJson(result);
  }

  const given = CARD_FLAGS.filter((flag) => input.flags[flag] === true);

  if (given.length > 1) {
    throw new OutboundError(
      "Invalid",
      `Pass one of --${CARD_FLAGS.join(", --")}, not ${given.map((flag) => `--${flag}`).join(" and ")}`
    );
  }

  // Loaded on demand, so the other commands do not pay for the cards.
  const { cardFor, toSlackMessage, toText } = await import("../cards/index.ts");

  const card = cardFor(name, result);
  // The card covers what the result covered.
  const coverage = coverageOf(asJson(result));

  // The message alone, not in the envelope, so it pipes straight to
  // chat.postMessage or an incoming webhook.
  if (input.flags.slack === true) {
    const message = asJson(toSlackMessage(card));

    return new Answer(
      message,
      coverage,
      false,
      {},
      input.flags.compact === true
        ? JSON.stringify(message)
        : JSON.stringify(message, null, 2)
    );
  }

  return new Answer(
    null,
    coverage,
    false,
    {},
    toText(card, { style: input.flags.card === true ? "plain" : "slack" })
  );
};
