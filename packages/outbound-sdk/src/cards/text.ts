// A card as text: what `outbound tool <name> --card` prints for a person to
// read, and, in the `slack` style, mrkdwn to paste into Slack's composer.
// Tables and charts are aligned text in both.

import { field, isJsonObject, list } from "../internal/json.ts";
import { bold, cells, prop } from "./slack-text.ts";
import { asciiTable, chartAscii } from "./slack.ts";
import type { CardElement, CardSpec } from "./spec.ts";

export interface TextOptions {
  /** `plain` (the default) for a terminal, `slack` for Slack's mrkdwn. */
  readonly style?: "plain" | "slack" | undefined;
}

type Lookup = (key: string) => CardElement | undefined;

interface Style {
  readonly strong: (value: string) => string;
  readonly inline: (value: string) => string;
  readonly block: (value: string) => string;
  readonly link: (label: string, url: string) => string;
}

const PLAIN: Style = {
  block: (value) => value,
  inline: (value) => value.replaceAll(/\*\*(?<inner>.+?)\*\*/gu, "$<inner>"),
  link: (label, url) => `${label}: ${url}`,
  strong: (value) => value.replaceAll(/\*\*(?<inner>.+?)\*\*/gu, "$<inner>"),
};

const SLACK: Style = {
  block: (value) => `\`\`\`\n${value}\n\`\`\``,
  inline: bold,
  link: (label, url) => `<${url}|${label}>`,
  strong: (value) => `*${bold(value).replaceAll("*", "")}*`,
};

const children = (element: CardElement, find: Lookup): CardElement[] =>
  element.children.flatMap((key) => find(key) ?? []);

const partsOf = (
  element: CardElement,
  find: Lookup,
  style: Style
): string[] => {
  switch (element.type) {
    case "Actions": {
      return [
        children(element, find)
          .map((item) => style.link(prop(item, "label"), prop(item, "url")))
          .join("\n"),
      ];
    }

    case "Card": {
      return [
        style.strong(prop(element, "title")),
        ...children(element, find).flatMap((child) =>
          partsOf(child, find, style)
        ),
      ];
    }

    case "Chart": {
      const chart = field(element.props, "chart");

      return isJsonObject(chart)
        ? [style.block(chartAscii(prop(element, "title"), chart))]
        : [];
    }

    case "Divider": {
      return ["---"];
    }

    case "Fields": {
      return [
        children(element, find)
          .map(
            (item) =>
              `${style.strong(prop(item, "label"))}: ${style.inline(prop(item, "value"))}`
          )
          .join("\n"),
      ];
    }

    case "Table": {
      const headers = cells(element.props.headers ?? []);
      const rows = list(element.props.rows).map((row) => cells(row));

      return rows.length === 0 ? [] : [style.block(asciiTable(headers, rows))];
    }

    case "Text": {
      const content = prop(element, "content");

      return [
        prop(element, "style") === "bold"
          ? style.strong(content)
          : style.inline(content),
      ];
    }

    default: {
      return [];
    }
  }
};

/** The card as text, one part per paragraph: title, finding, numbers, list, table, source. */
export const toText = (spec: CardSpec, options: TextOptions = {}): string => {
  const root = spec.elements[spec.root];

  if (root === undefined) {
    return "";
  }

  const style = options.style === "slack" ? SLACK : PLAIN;
  const find: Lookup = (key) => spec.elements[key];
  const subtitle = prop(root, "subtitle");

  return [
    [
      style.strong(prop(root, "title")),
      ...(subtitle === "" ? [] : [subtitle]),
    ].join("\n"),
    ...children(root, find).flatMap((element) => partsOf(element, find, style)),
  ]
    .filter((part) => part !== "")
    .join("\n\n");
};
