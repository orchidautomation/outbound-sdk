// A card as Slack Block Kit, with no package. In the `plain` style it writes
// the same blocks Chat SDK's Slack adapter writes for the same card, and the
// test suite holds the two to each other. The default `rich` style swaps in
// the blocks from slack-rich.ts.

import {
  compactObject,
  field,
  isJsonObject,
  list,
  objects,
  text,
} from "../internal/json.ts";
import type { JsonObject } from "../internal/json.ts";
import {
  richActions,
  richFields,
  richPeople,
  richTable,
} from "./slack-rich.ts";
import {
  bold,
  cells,
  cut,
  filled,
  mrkdwn,
  plainText,
  prop,
} from "./slack-text.ts";
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
  /** Draw with Slack's layout, card and typed table cells. */
  readonly rich: boolean;
}

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

const plainTable = (element: CardElement, all: string[][]): JsonObject => ({
  caption: prop(element, "caption") || "Table",
  rows: all.map((row) => row.map((cell) => raw(cell))),
  type: "data_table",
});

const tableBlocks = (element: CardElement, state: State): JsonObject[] => {
  const headers = cells(element.props.headers ?? []);
  const rows = list(element.props.rows).map((row) => cells(row));
  const all = [headers, ...rows];
  const chars = all.flat().reduce((total, cell) => total + cell.length, 0);

  const people = state.rich
    ? richPeople(element, headers, rows, fenced(asciiTable(headers, rows)))
    : null;

  if (people !== null) {
    return people;
  }

  if (
    state.usedTable ||
    all.length > MAX_TABLE_ROWS ||
    headers.length > MAX_TABLE_COLUMNS ||
    chars > MAX_TABLE_CHARS
  ) {
    return [fenced(asciiTable(headers, rows))];
  }

  state.usedTable = true;

  return [
    state.rich && rows.length > 0
      ? richTable(prop(element, "caption") || "Table", headers, rows)
      : plainTable(element, all),
  ];
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

/**
 * The elements under a card. A card with more than ten numbers holds them in
 * several `Fields`; the rich style draws those as one grid.
 */
const elementsOf = (
  keys: readonly string[],
  find: Lookup,
  rich: boolean
): CardElement[] => {
  const found: CardElement[] = [];

  for (const key of keys) {
    const element = find(key);
    const last = found.at(-1);

    if (rich && element?.type === "Fields" && last?.type === "Fields") {
      found[found.length - 1] = {
        ...last,
        children: [...last.children, ...element.children],
      };
    } else if (element !== undefined) {
      found.push(element);
    }
  }

  return found;
};

const blocksFor = (
  element: CardElement,
  find: Lookup,
  state: State
): JsonObject[] => {
  const inner = (): JsonObject[] =>
    elementsOf(element.children, find, state.rich).flatMap((child) =>
      blocksFor(child, find, state)
    );

  switch (element.type) {
    case "Actions": {
      return [
        state.rich ? richActions(element, find) : actionsBlock(element, find),
      ];
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
      return state.rich
        ? richFields(element, find, fieldsBlock(element, find))
        : [fieldsBlock(element, find)];
    }

    case "Table": {
      return tableBlocks(element, state);
    }

    case "Text": {
      return [textBlock(element)];
    }

    default: {
      return [];
    }
  }
};

export interface SlackOptions {
  /**
   * `rich` (the default) uses Slack's layout, card and typed table cells.
   * `plain` writes exactly what Chat SDK's Slack adapter writes for the card.
   */
  readonly style?: "plain" | "rich" | undefined;
}

/**
 * The card as Slack blocks, for `chat.postMessage({ blocks })` or an incoming
 * webhook. Slack draws one table and two charts per message; a card with more
 * shows the rest as aligned text.
 */
export const toSlackBlocks = (
  spec: CardSpec,
  options: SlackOptions = {}
): JsonObject[] => {
  const root = spec.elements[spec.root];

  if (root === undefined) {
    return [];
  }

  const find: Lookup = (key) => spec.elements[key];

  const state: State = {
    charts: 0,
    rich: options.style !== "plain",
    usedTable: false,
  };

  const subtitle = prop(root, "subtitle");

  return [
    { text: plainText(prop(root, "title"), MAX_HEADER), type: "header" },
    ...(subtitle === ""
      ? []
      : [{ elements: [mrkdwn(subtitle, MAX_TEXT)], type: "context" }]),
    ...elementsOf(root.children, find, state.rich).flatMap((element) =>
      blocksFor(element, find, state)
    ),
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
export const toSlackMessage = (
  spec: CardSpec,
  options: SlackOptions = {}
): SlackMessage => ({
  blocks: toSlackBlocks(spec, options),
  text: cut(fallback(spec), MAX_TEXT),
});
