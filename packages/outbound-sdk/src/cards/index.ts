// outbound-sdk/cards: every tool and insight answer as a card. A card is a
// json-render spec for the chat catalog, built from the numbers the tool
// returned. No model writes it, so a number on a card is the number that was
// read, and a count the vendor does not report is a dash.
//
//   const result = await tool.call({});
//   const card = cardFor(tool.name, result);
//
//   await slack.chat.postMessage({ channel, ...toSlackMessage(card) });
//   await thread.post(toCard(card)); // Chat SDK, with @json-render/chat

export { CARD_NAMES, cardFor, digest } from "./render.ts";

export type {
  CardInput,
  DigestOptions,
  DigestSection,
  InsightResultLike,
} from "./render.ts";

export { alertCard, eventCard } from "./notify-cards.ts";

export type { EventCardOptions } from "./notify-cards.ts";

export { toSlackBlocks, toSlackMessage } from "./slack.ts";

export type { SlackMessage, SlackOptions } from "./slack.ts";

export { safe } from "./format.ts";

export type { CardOptions } from "./content.ts";

export type { CardComponent, CardElement, CardLink, CardSpec } from "./spec.ts";
