// The richer Slack drawing of a card. Slack's layout block puts numbers in a
// grid of tiles and people on cards side by side, and its data table takes
// typed cells, so a number sorts as a number. Chat SDK's card elements have
// no word for these yet, so this is what `toSlackBlocks` writes by default,
// and `style: "plain"` writes what Chat SDK's Slack adapter would.

import {
  compactObject,
  count,
  field,
  isJsonObject,
  list,
} from "../internal/json.ts";
import type { JsonObject } from "../internal/json.ts";
import { bold, cut, filled, mrkdwn, plainText, prop } from "./slack-text.ts";
import type { CardElement } from "./spec.ts";

// Slack's limits for the blocks used here.
const ITEMS_PER_ROW = 3;
const ROWS_PER_LAYOUT = 5;
const MAX_TILE_TEXT = 3000;
const MAX_CARD_TITLE = 150;
const MAX_CARD_BODY = 200;
const MAX_LABEL = 150;
const MAX_BUTTONS = 25;
const MAX_BUTTON_TEXT = 75;
const MAX_ACTION_ID = 255;
const MAX_URL = 3000;
const MAX_PAGE_SIZE = 100;

type Lookup = (key: string) => CardElement | undefined;

const chunks = <Item>(items: readonly Item[], size: number): Item[][] => {
  const groups: Item[][] = [];

  for (let start = 0; start < items.length; start += size) {
    groups.push(items.slice(start, start + size));
  }

  return groups;
};

/** One or more layout blocks holding `items`, three to a row. */
const layouts = (
  label: string,
  items: readonly JsonObject[],
  extra: JsonObject
): JsonObject[] =>
  chunks(chunks(items, ITEMS_PER_ROW), ROWS_PER_LAYOUT).map((rows) => ({
    ...extra,
    label: cut(filled(label), MAX_LABEL),
    rows: rows.map((row) => ({ items: row.map((block) => ({ block })) })),
    type: "layout",
  }));

/**
 * A card's numbers as a bordered grid of tiles. A client that cannot draw a
 * layout shows `plain`, the two-column list.
 */
export const richFields = (
  element: CardElement,
  find: Lookup,
  plain: JsonObject
): JsonObject[] => {
  const tiles = element.children.flatMap((key) => {
    const item = find(key);

    return item === undefined
      ? []
      : [
          {
            text: mrkdwn(
              `${bold(prop(item, "label"))}\n*${filled(bold(prop(item, "value")))}*`,
              MAX_TILE_TEXT
            ),
            type: "section",
          },
        ];
  });

  return layouts("Numbers", tiles, {
    fallback: [plain],
    grid_lines: "outer",
  });
};

const NUMBER = /^-?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?%?$/u;

/** A table cell: a number Slack can sort when the text is one, otherwise text. */
const cell = (value: string, first: boolean): JsonObject => {
  if (NUMBER.test(value)) {
    return {
      text: value,
      type: "raw_number",
      value: Number(value.replaceAll(/[,%]/gu, "")),
    };
  }

  // Rich text is literal: nothing in it is read as a mention or a link.
  return first && value !== ""
    ? {
        elements: [
          {
            elements: [{ style: { bold: true }, text: value, type: "text" }],
            type: "rich_text_section",
          },
        ],
        type: "rich_text",
      }
    : { text: filled(value), type: "raw_text" };
};

/** A data table with typed cells, every row on one page. */
export const richTable = (
  caption: string,
  headers: readonly string[],
  rows: readonly (readonly string[])[]
): JsonObject => ({
  caption,
  page_size: Math.min(Math.max(rows.length, 1), MAX_PAGE_SIZE),
  rows: [
    headers.map((header) => ({ text: filled(header), type: "raw_text" })),
    ...rows.map((row) => row.map((value, index) => cell(value, index === 0))),
  ],
  type: "data_table",
});

const MAX_PEOPLE = ITEMS_PER_ROW * 3;

const labelled =
  (headers: readonly string[], row: readonly string[]) =>
  (index: number, position: number): string => {
    const value = row[index] ?? "";

    // The first part stands alone; a later one says what it is.
    return position === 0
      ? value
      : `${(headers[index] ?? "").toLowerCase()} *${value}*`;
  };

/**
 * A short table as cards side by side, when the table says which columns are
 * a card's title, subtitle and body. `null` when it does not, or has too
 * many rows to read as cards.
 */
export const richPeople = (
  element: CardElement,
  headers: readonly string[],
  rows: readonly (readonly string[])[],
  plain: JsonObject
): JsonObject[] | null => {
  const hint = field(element.props, "cards");

  if (!isJsonObject(hint) || rows.length === 0 || rows.length > MAX_PEOPLE) {
    return null;
  }

  const title = count(hint.title) ?? 0;
  const body = count(hint.body);
  const subtitle = list(hint.subtitle).flatMap((index) => count(index) ?? []);

  const cards = rows.map((row) =>
    compactObject({
      body:
        body === null || (row[body] ?? "") === ""
          ? undefined
          : mrkdwn(row[body] ?? "", MAX_CARD_BODY),
      subtitle: mrkdwn(
        subtitle.map(labelled(headers, row)).join(" · "),
        MAX_CARD_TITLE
      ),
      title: mrkdwn(`*${filled(row[title] ?? "")}*`, MAX_CARD_TITLE),
      type: "card",
    })
  );

  return layouts(prop(element, "caption") || "Cards", cards, {
    fallback: [plain],
  });
};

/** Link buttons, the first one in Slack's primary colour. */
export const richActions = (
  element: CardElement,
  find: Lookup
): JsonObject => ({
  elements: element.children.slice(0, MAX_BUTTONS).flatMap((key, index) => {
    const item = find(key);

    return item === undefined
      ? []
      : [
          compactObject({
            action_id: cut(`link-${prop(item, "url")}`, MAX_ACTION_ID),
            style: index === 0 ? "primary" : undefined,
            text: plainText(prop(item, "label"), MAX_BUTTON_TEXT),
            type: "button",
            url: cut(prop(item, "url"), MAX_URL),
          }),
        ];
  }),
  type: "actions",
});
