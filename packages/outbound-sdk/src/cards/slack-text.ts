// The small pieces both Slack renderers share: how text is cut, filled and
// wrapped in Slack's text objects.

import { list, text } from "../internal/json.ts";
import type { Json, JsonObject } from "../internal/json.ts";
import type { CardElement } from "./spec.ts";

export const cut = (value: string, max: number): string =>
  value.length > max ? value.slice(0, max) : value;

export const filled = (value: string): string =>
  value.length > 0 ? value : " ";

/** The card format's `**bold**` is `*bold*` in Slack. */
export const bold = (value: string): string =>
  value.replaceAll(/\*\*(?<inner>.+?)\*\*/gu, "*$<inner>*");

export const mrkdwn = (value: string, max: number): JsonObject => ({
  text: filled(cut(value, max)),
  type: "mrkdwn",
});

export const plainText = (value: string, max: number): JsonObject => ({
  emoji: true,
  text: filled(cut(value, max)),
  type: "plain_text",
});

export const prop = (element: CardElement, key: string): string =>
  text(element.props[key]) ?? "";

export const cells = (row: Json): string[] =>
  list(row).map((cell) => text(cell) ?? "");
