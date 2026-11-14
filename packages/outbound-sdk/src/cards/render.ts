// From a tool result to a card. `cardFor` picks the card by the tool's name;
// a failed result, and a tool with no card of its own, still get one, so a
// caller can post whatever came back.

import { field, isJsonArray, isJsonObject, text } from "../internal/json.ts";
import type { Json } from "../internal/json.ts";
import type { ToolResult, ToolSuccess } from "../tools/index.ts";
import { compact, layout } from "./content.ts";
import type { CardContent, CardMeta, CardOptions, Stat } from "./content.ts";
import { COPY_CARDS } from "./copy-cards.ts";
import { bool, int, plural, safe, strings, words } from "./format.ts";
import { OPS_CARDS } from "./ops-cards.ts";
import { PEOPLE_CARDS } from "./people-cards.ts";
import { SENDER_CARDS } from "./sender-cards.ts";
import { buildSpec } from "./spec.ts";
import type { CardNode, CardSpec } from "./spec.ts";
import { TOOL_CARDS } from "./tool-cards.ts";

const INSIGHT_CARDS = new Map([
  ...PEOPLE_CARDS,
  ...COPY_CARDS,
  ...SENDER_CARDS,
  ...OPS_CARDS,
]);

/** Every tool and insight that has a card of its own. */
export const CARD_NAMES: readonly string[] = [
  ...TOOL_CARDS.keys(),
  ...INSIGHT_CARDS.keys(),
].toSorted();

const MAX_GENERIC_STATS = 10;

/** For a tool with no card of its own: its plain values and list sizes. */
const generic = (name: string, data: Json): CardContent => {
  const stats: Stat[] = [];

  for (const [key, value] of Object.entries(isJsonObject(data) ? data : {})) {
    const plain = isJsonObject(value) ? null : text(value);

    if (isJsonArray(value)) {
      stats.push([words(key), plural(value.length, "item")]);
    } else if (plain !== null) {
      stats.push([words(key), safe(plain)]);
    }
  }

  return { stats: stats.slice(0, MAX_GENERIC_STATS), title: words(name) };
};

interface Drawn {
  readonly content: CardContent;
  readonly meta: CardMeta;
}

const draw = (name: string, result: ToolSuccess): Drawn => {
  const insight = INSIGHT_CARDS.get(name);

  // An insight's tool result wraps its answer with the read's notes.
  const data =
    insight === undefined ? result.data : field(result.data, "result");

  const builder = insight ?? TOOL_CARDS.get(name);

  return {
    content:
      builder === undefined
        ? generic(name, result.data)
        : builder(data ?? null),
    meta: {
      complete:
        insight === undefined || bool(result.data, "complete") !== false,
      evidence: result.meta.evidence,
      notes: insight === undefined ? [] : strings(result.data, "notes"),
      provider: result.meta.provider,
      requests: result.meta.requests,
    },
  };
};

const failureText = (name: string, result: ToolResult): string | null =>
  result.ok
    ? null
    : `${result.error.code === "Unsupported" ? "⚪ Not available" : "🔴 Failed"}: ${safe(
        result.error.message
      )}`;

/**
 * The card for one tool or insight result. `name` is the tool's name, such as
 * `campaign_overview` or `hot_leads`. Never throws: a failed result becomes a
 * card that says what failed.
 */
export const cardFor = (
  name: string,
  result: ToolResult,
  options: CardOptions = {}
): CardSpec => {
  if (!result.ok) {
    return buildSpec({
      children: [
        {
          content: failureText(name, result) ?? "",
          style: "bold",
          type: "Text",
        },
      ],
      title: words(name),
    });
  }

  const { content, meta } = draw(name, result);

  return buildSpec({
    children: layout(content, meta, options),
    subtitle: content.subtitle,
    title: content.title,
  });
};

export interface DigestSection {
  /** The tool's name, such as `bounce_watch`. */
  readonly name: string;
  readonly result: ToolResult;
}

export interface DigestOptions {
  readonly title: string;
  readonly subtitle?: string | undefined;
  /** At most nine are shown, so the message stays inside a chat platform's limits. */
  readonly sections: readonly DigestSection[];
  readonly links?: CardOptions["links"];
}

const MAX_SECTIONS = 9;

const section = ({ name, result }: DigestSection): CardNode => {
  if (!result.ok) {
    return {
      children: [
        {
          content: failureText(name, result) ?? "",
          style: "plain",
          type: "Text",
        },
      ],
      title: words(name),
      type: "Section",
    };
  }

  const { content } = draw(name, result);

  return {
    children: compact(content),
    title: content.subtitle
      ? `${content.title} · ${content.subtitle}`
      : content.title,
    type: "Section",
  };
};

/**
 * One message made of several results, each cut down to its finding, its
 * first numbers and its first lines. For a morning summary in a channel.
 */
export const digest = (options: DigestOptions): CardSpec => {
  const shown = options.sections.slice(0, MAX_SECTIONS);

  const requests = shown.reduce(
    (sum, { result }) => sum + (result.ok ? result.meta.requests : 0),
    0
  );

  const providers = new Set(
    shown.flatMap(({ result }) => (result.ok ? [result.meta.provider] : []))
  );

  const links = options.links ?? [];

  return buildSpec({
    children: [
      ...shown.flatMap((entry, index): CardNode[] =>
        index === 0 ? [section(entry)] : [{ type: "Divider" }, section(entry)]
      ),
      {
        content: `${[...providers].join(", ") || "no source"} · ${int(requests)} ${
          requests === 1 ? "request" : "requests"
        }`,
        style: "muted",
        type: "Text",
      },
      ...(links.length > 0 ? [{ links, type: "Links" } as const] : []),
    ],
    subtitle: options.subtitle,
    title: options.title,
  });
};
