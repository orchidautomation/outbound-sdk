// From a tool result to a card. `cardFor` picks the card by the tool's name;
// a failed result, and a tool with no card of its own, still get one, so a
// caller can post whatever came back.

import type { Evidence } from "../internal/entities.ts";
import {
  count,
  field,
  flag,
  isJsonArray,
  isJsonObject,
  list,
  text,
  toJson,
} from "../internal/json.ts";
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

/** An insight method's result, as `outbound.insights.hotLeads()` returns it. */
export interface InsightResultLike {
  readonly insight?: string | undefined;
  readonly data: unknown;
  readonly meta: {
    readonly evidence: string;
    readonly requests: number;
    readonly provider: string;
    readonly complete?: boolean | undefined;
    readonly notes?: readonly string[] | undefined;
  };
}

/** What `cardFor` draws: a tool's result, or an insight method's result. */
export type CardInput = InsightResultLike | ToolResult;

const EVIDENCE: ReadonlySet<string> = new Set(["derived", "exact", "sampled"]);

const isEvidence = (value: string | null): value is Evidence =>
  EVIDENCE.has(value ?? "");

const NOT_A_RESULT = "⚪ Nothing to show: this is not a tool or insight result.";

/**
 * What came in, as a tool result: an insight's answer is wrapped the way
 * `insightTools` wraps it. `null` when it is neither.
 */
const asToolResult = (input: CardInput): ToolResult | null => {
  const value = toJson(input);
  const ok = flag(field(value, "ok"));

  if (ok === false) {
    const error = field(value, "error");

    return {
      error: {
        code: text(field(error, "code")) ?? "Unknown",
        message: text(field(error, "message")) ?? "No message was given.",
      },
      next: "",
      ok: false,
    };
  }

  const meta = field(value, "meta");
  const data = field(value, "data");

  if (!isJsonObject(meta) || data === undefined) {
    return null;
  }

  const evidence = text(field(meta, "evidence"));

  return {
    data:
      ok === true
        ? data
        : {
            complete: flag(field(meta, "complete")) ?? true,
            notes: list(field(meta, "notes")),
            result: data,
          },
    meta: {
      evidence: isEvidence(evidence) ? evidence : "derived",
      provider: text(field(meta, "provider")) ?? "unknown",
      requests: count(field(meta, "requests")) ?? 0,
    },
    next: "",
    ok: true,
  };
};

const note = (name: string, content: string): CardSpec =>
  buildSpec({
    children: [{ content, style: "bold", type: "Text" }],
    title: words(name),
  });

/**
 * The card for one tool or insight result. `name` is the tool's name, such as
 * `campaign_overview` or `hot_leads`. `result` is what the tool's `call`
 * returned, or what the insight method returned, such as
 * `await outbound.insights.hotLeads({})`. Never throws: a failed result
 * becomes a card that says what failed, and anything else a card that says
 * there is nothing to show.
 */
export const cardFor = (
  name: string,
  result: CardInput,
  options: CardOptions = {}
): CardSpec => {
  try {
    const given = asToolResult(result);

    if (given === null) {
      return note(name, NOT_A_RESULT);
    }

    if (!given.ok) {
      return note(name, failureText(name, given) ?? "");
    }

    const { content, meta } = draw(name, given);

    return buildSpec({
      children: layout(content, meta, options),
      subtitle: content.subtitle,
      title: content.title,
    });
  } catch {
    return note(name, NOT_A_RESULT);
  }
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
