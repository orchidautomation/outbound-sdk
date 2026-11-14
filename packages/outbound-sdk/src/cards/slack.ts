// A card as Slack Block Kit, with no package. It writes the same blocks Chat
// SDK's Slack adapter writes for the same card, so a card looks the same
// whether it is posted through Chat SDK or straight to `chat.postMessage` or
// an incoming webhook. The test suite holds the two to each other.

import {
  compactObject,
  field,
  isJsonObject,
  list,
  objects,
  text,
} from "../internal/json.ts";
import type { Json, JsonObject } from "../internal/json.ts";
import type { CardElement, CardSpec } from "./spec.ts";

// Slack's own limits.
const MAX_BLOCKS = 50;
const MAX_HEADER = 150;
const MAX_TEXT = 3000;
const MAX_FIELD_TEXT = 2000;
const MAX_FIELDS = 10;
const MAX_BUTTONS = 25;
const MAX_BUTTON_TEXT = 75;
const MAX_ACTION_ID = 255;
const MAX_CHARTS = 2;

interface State {
  usedTable: boolean;
  charts: number;
}

const cut = (value: string, max: number): string =>
  value.length > max ? value.slice(0, max) : value;

const filled = (value: string): string => (value.length > 0 ? value : " ");

/** The card format's `**bold**` is `*bold*` in Slack. */
const bold = (value: string): string =>
  value.replaceAll(/\*\*(?<inner>.+?)\*\*/gu, "*$<inner>*");

const mrkdwn = (value: string, max: number): JsonObject => ({
  text: filled(cut(value, max)),
  type: "mrkdwn",
});

const plainText = (value: string, max: number): JsonObject => ({
  emoji: true,
  text: filled(cut(value, max)),
  type: "plain_text",
});

const prop = (element: CardElement, key: string): string =>
  text(element.props[key]) ?? "";

const cells = (row: Json): string[] =>
  list(row).map((cell) => text(cell) ?? "");

/** A table as aligned text, for a second table or a chart Slack will not draw. */
const asciiTable = (headers: string[], rows: string[][]): string => {
  const all = [headers, ...rows];

  const widths = headers.map((_, column) =>
    Math.max(...all.map((row) => row[column]?.length ?? 0))
  );

  return all
    .map((row) =>
      row
        .map((cell, column) => cell.padEnd(widths[column] ?? 0))
        .join(" | ")
        .trimEnd()
    )
    .join("\n");
};

const fenced = (content: string): JsonObject => {
  const budget = MAX_TEXT - "```\n\n```".length;

  const body =
    content.length > budget ? `${content.slice(0, budget - 1)}…` : content;

  return {
    text: { text: `\`\`\`\n${body}\n\`\`\``, type: "mrkdwn" },
    type: "section",
  };
};

const textBlock = (element: CardElement): JsonObject => {
  const content = bold(prop(element, "content"));
  const style = prop(element, "style");

  return style === "muted"
    ? { elements: [mrkdwn(content, MAX_TEXT)], type: "context" }
    : {
        text: mrkdwn(style === "bold" ? `*${content}*` : content, MAX_TEXT),
        type: "section",
      };
};

const raw = (cell: string): JsonObject => ({
  text: filled(cell),
  type: "raw_text",
});

const MAX_TABLE_ROWS = 100;
const MAX_TABLE_COLUMNS = 20;
const MAX_TABLE_CHARS = 10_000;

const tableBlock = (element: CardElement, state: State): JsonObject => {
  const headers = cells(element.props.headers ?? []);
  const rows = list(element.props.rows).map((row) => cells(row));
  const all = [headers, ...rows];
  const chars = all.flat().reduce((total, cell) => total + cell.length, 0);

  if (
    state.usedTable ||
    all.length > MAX_TABLE_ROWS ||
    headers.length > MAX_TABLE_COLUMNS ||
    chars > MAX_TABLE_CHARS
  ) {
    return fenced(asciiTable(headers, rows));
  }

  state.usedTable = true;

  return {
    caption: prop(element, "caption") || "Table",
    rows: all.map((row) => row.map((cell) => raw(cell))),
    type: "data_table",
  };
};

const seriesRows = (chart: JsonObject, categories: string[]): string[][] =>
  categories.map((category, index) => [
    category,
    ...objects(chart.series).map((series) =>
      String(list(series.values)[index] ?? "")
    ),
  ]);

const chartAscii = (title: string, chart: JsonObject): string =>
  chart.type === "pie"
    ? `${title}\n${asciiTable(
        ["Label", "Value"],
        objects(chart.segments).map((segment) => [
          text(segment.label) ?? "",
          String(segment.value),
        ])
      )}`
    : `${title}\n${asciiTable(
        [
          text(chart.xLabel) ?? "",
          ...objects(chart.series).map((series) => text(series.name) ?? ""),
        ],
        seriesRows(chart, cells(chart.categories ?? []))
      )}`;

const chartBlock = (element: CardElement, state: State): JsonObject => {
  const title = prop(element, "title");
  const chart = field(element.props, "chart");

  if (!isJsonObject(chart)) {
    return fenced(title);
  }

  if (state.charts >= MAX_CHARTS) {
    return fenced(chartAscii(title, chart));
  }

  state.charts += 1;

  if (chart.type === "pie") {
    return {
      chart: { segments: chart.segments ?? [], type: "pie" },
      title,
      type: "data_visualization",
    };
  }

  const categories = cells(chart.categories ?? []);

  return {
    chart: {
      axis_config: compactObject({
        categories,
        x_label: chart.xLabel,
        y_label: chart.yLabel,
      }),
      series: objects(chart.series).map((series) => ({
        data: categories.map((label, index) => ({
          label,
          value: list(series.values)[index] ?? 0,
        })),
        name: series.name ?? "",
      })),
      type: chart.type ?? "bar",
    },
    title,
    type: "data_visualization",
  };
};

type Lookup = (key: string) => CardElement | undefined;

const fieldsBlock = (element: CardElement, find: Lookup): JsonObject => ({
  fields: element.children.slice(0, MAX_FIELDS).flatMap((key) => {
    const item = find(key);

    return item === undefined
      ? []
      : [
          mrkdwn(
            `*${bold(prop(item, "label"))}*\n${bold(prop(item, "value"))}`,
            MAX_FIELD_TEXT
          ),
        ];
  }),
  type: "section",
});

const actionsBlock = (element: CardElement, find: Lookup): JsonObject => ({
  elements: element.children.slice(0, MAX_BUTTONS).flatMap((key) => {
    const item = find(key);

    return item === undefined
      ? []
      : [
          {
            action_id: cut(`link-${prop(item, "url")}`, MAX_ACTION_ID),
            text: plainText(prop(item, "label"), MAX_BUTTON_TEXT),
            type: "button",
            url: cut(prop(item, "url"), MAX_TEXT),
          },
        ];
  }),
  type: "actions",
});

const blocksFor = (key: string, find: Lookup, state: State): JsonObject[] => {
  const element = find(key);

  if (element === undefined) {
    return [];
  }

  const inner = (): JsonObject[] =>
    element.children.flatMap((childKey) => blocksFor(childKey, find, state));

  switch (element.type) {
    case "Actions": {
      return [actionsBlock(element, find)];
    }

    case "Card": {
      // A card inside a card is a titled section.
      return [
        {
          text: mrkdwn(`*${bold(prop(element, "title"))}*`, MAX_TEXT),
          type: "section",
        },
        ...inner(),
      ];
    }

    case "Chart": {
      return [chartBlock(element, state)];
    }

    case "Divider": {
      return [{ type: "divider" }];
    }

    case "Fields": {
      return [fieldsBlock(element, find)];
    }

    case "Table": {
      return [tableBlock(element, state)];
    }

    case "Text": {
      return [textBlock(element)];
    }

    default: {
      return [];
    }
  }
};

/**
 * The card as Slack blocks, for `chat.postMessage({ blocks })` or an incoming
 * webhook. Slack draws one table and two charts per message; a card with more
 * shows the rest as aligned text.
 */
export const toSlackBlocks = (spec: CardSpec): JsonObject[] => {
  const root = spec.elements[spec.root];

  if (root === undefined) {
    return [];
  }

  const find: Lookup = (key) => spec.elements[key];
  const state: State = { charts: 0, usedTable: false };
  const subtitle = prop(root, "subtitle");

  return [
    { text: plainText(prop(root, "title"), MAX_HEADER), type: "header" },
    ...(subtitle === ""
      ? []
      : [{ elements: [mrkdwn(subtitle, MAX_TEXT)], type: "context" }]),
    ...root.children.flatMap((key) => blocksFor(key, find, state)),
  ].slice(0, MAX_BLOCKS);
};

/**
 * The card's title and its finding, shown in a notification and to a screen
 * reader. A card with no finding gives its subtitle.
 */
const fallback = (spec: CardSpec): string => {
  const root = spec.elements[spec.root];

  if (root === undefined) {
    return "";
  }

  const finding = root.children
    .map((key) => spec.elements[key])
    .find(
      (element) =>
        element?.type === "Text" && prop(element, "style") !== "muted"
    );

  return [
    prop(root, "title"),
    finding === undefined
      ? prop(root, "subtitle")
      : bold(prop(finding, "content")),
  ]
    .filter((part) => part !== "")
    .join(": ");
};

export interface SlackMessage {
  readonly text: string;
  readonly blocks: JsonObject[];
}

/** A whole Slack message: spread it into `chat.postMessage` or post it to a webhook. */
export const toSlackMessage = (spec: CardSpec): SlackMessage => ({
  blocks: toSlackBlocks(spec),
  text: cut(fallback(spec), MAX_TEXT),
});
