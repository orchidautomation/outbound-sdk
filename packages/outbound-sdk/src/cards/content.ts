// What every card is made of. A card builder fills in a `CardContent`: a
// finding, a few numbers, a list, a table and a chart. This file lays that out
// the same way for every card, in full or as a short section of a digest, and
// keeps each piece inside what a chat message can hold.

import { clip, int } from "./format.ts";
import type {
  CardLink,
  CardNode,
  ChartData,
  SeriesChart,
  TableData,
} from "./spec.ts";

export type Stat = readonly [label: string, value: string];

/** A table, and how many rows it stands for when the data holds fewer. */
export interface ContentTable extends TableData {
  /** Every row the answer counted, shown or not, for "… and 62 more". Defaults to `rows.length`. */
  readonly total?: number | undefined;
}

export interface CardContent {
  readonly title: string;
  readonly subtitle?: string | null | undefined;
  /** The one sentence to read if nothing else is read. */
  readonly finding?: string | null | undefined;
  readonly stats?: readonly Stat[] | undefined;
  /**
   * What to do, in the order the answer ranked it. Shown before the list and
   * cut only past MAX_ACTIONS, so a long list never hides one.
   */
  readonly actions?: readonly string[] | undefined;
  readonly bullets?: readonly string[] | undefined;
  readonly table?: ContentTable | undefined;
  readonly chart?: ChartData | null | undefined;
  /** What to know before trusting the numbers. */
  readonly notes?: readonly string[] | undefined;
}

/** Where the numbers came from, shown under every card. */
export interface CardMeta {
  readonly evidence: string;
  readonly provider: string;
  readonly requests: number;
  /** `false` when a cap stopped a read early. */
  readonly complete: boolean;
  readonly notes: readonly string[];
}

export interface CardOptions {
  /** The most table rows or list items a card shows. Defaults to 8. */
  readonly maxRows?: number | undefined;
  /** Link buttons under the card, for example to the campaign in the vendor's app. */
  readonly links?: readonly CardLink[] | undefined;
}

export const DEFAULT_MAX_ROWS = 8;

/** The most actions a card shows, whatever `maxRows` says. */
export const MAX_ACTIONS = 20;

// Slack's limits, which are the tightest of the chat platforms.
const MAX_FIELDS = 10;
const MAX_STATS = 20;
const MAX_TEXT = 2900;
const MAX_BULLET = 300;
const MAX_CELL = 80;
const MAX_CHART_TITLE = 50;
const MAX_CHART_LABEL = 20;
const MAX_CHART_POINTS = 20;
const MAX_PIE_SEGMENTS = 12;
const MAX_LINKS = 5;
const COMPACT_STATS = 2;
const COMPACT_ROWS = 3;

const textNode = (
  content: string,
  style: "bold" | "muted" | "plain"
): CardNode => ({ content: clip(content, MAX_TEXT), style, type: "Text" });

const more = (shown: number, total: number): string[] =>
  total > shown ? [`… and ${int(total - shown)} more`] : [];

const bulletText = (
  bullets: readonly string[],
  max: number,
  total = bullets.length
): string =>
  [
    ...bullets.slice(0, max).map((line) => `• ${clip(line, MAX_BULLET)}`),
    ...more(Math.min(max, bullets.length), Math.max(total, bullets.length)),
  ].join("\n");

const statNodes = (stats: readonly Stat[], max: number): CardNode[] => {
  const kept = stats.slice(0, max);
  const nodes: CardNode[] = [];

  for (let start = 0; start < kept.length; start += MAX_FIELDS) {
    nodes.push({
      fields: kept.slice(start, start + MAX_FIELDS),
      type: "Fields",
    });
  }

  return nodes;
};

const tableNodes = (
  table: ContentTable,
  caption: string,
  max: number
): CardNode[] => {
  if (table.rows.length === 0) {
    return [];
  }

  const shown: TableData = {
    align: table.align,
    caption,
    cards: table.cards,
    headers: table.headers,
    rows: table.rows
      .slice(0, max)
      .map((row) => row.map((cell) => clip(cell, MAX_CELL))),
  };

  return [
    { table: shown, type: "Table" },
    ...more(
      Math.min(max, table.rows.length),
      Math.max(table.total ?? 0, table.rows.length)
    ).map((line) => textNode(line, "muted")),
  ];
};

const footer = (meta: CardMeta, notes: readonly string[]): CardNode => {
  const source = `${meta.evidence} · ${meta.provider} · ${int(meta.requests)} ${
    meta.requests === 1 ? "request" : "requests"
  }`;

  const lines = [
    ...(meta.complete
      ? []
      : ["Incomplete: a cap stopped a read early, so totals are a floor."]),
    ...notes,
    ...meta.notes,
  ].map((note) => `Note: ${clip(note, MAX_BULLET)}`);

  return textNode([source, ...lines].join("\n"), "muted");
};

/** The whole card: finding, numbers, list, table, chart, then its source. */
export const layout = (
  content: CardContent,
  meta: CardMeta,
  options: CardOptions = {}
): CardNode[] => {
  const max = options.maxRows ?? DEFAULT_MAX_ROWS;
  const links = options.links?.slice(0, MAX_LINKS) ?? [];

  return [
    ...(content.finding ? [textNode(content.finding, "bold")] : []),
    ...statNodes(content.stats ?? [], MAX_STATS),
    ...(content.actions?.length
      ? [
          textNode(
            bulletText(content.actions, Math.max(max, MAX_ACTIONS)),
            "plain"
          ),
        ]
      : []),
    ...(content.bullets?.length
      ? [textNode(bulletText(content.bullets, max), "plain")]
      : []),
    ...tableNodes(
      content.table ?? { headers: [], rows: [] },
      content.title,
      max
    ),
    ...(content.chart
      ? [{ chart: content.chart, type: "Chart" } as const]
      : []),
    footer(meta, content.notes ?? []),
    ...(links.length > 0 ? [{ links, type: "Links" } as const] : []),
  ];
};

const rowLines = (table: TableData | undefined): string[] =>
  (table?.rows ?? []).map((row) => row.join(" · "));

/** A short form for one section of a digest: no table and no chart. */
export const compact = (content: CardContent): CardNode[] => {
  const listed = [...(content.actions ?? []), ...(content.bullets ?? [])];
  const fromTable = listed.length === 0;
  const lines = fromTable ? rowLines(content.table) : listed;
  const total = fromTable ? content.table?.total : undefined;

  return [
    ...(content.finding ? [textNode(content.finding, "plain")] : []),
    ...statNodes(content.stats ?? [], COMPACT_STATS),
    ...(lines.length > 0
      ? [textNode(bulletText(lines, COMPACT_ROWS, total), "plain")]
      : []),
  ];
};

/** Chart labels must be short and must not repeat. */
const labels = (raw: readonly string[]): string[] => {
  const seen = new Map<string, number>();

  return raw.map((label) => {
    const short = clip(label === "" ? "?" : label, MAX_CHART_LABEL);
    const times = (seen.get(short) ?? 0) + 1;
    seen.set(short, times);

    return times === 1 ? short : `${clip(short, MAX_CHART_LABEL - 3)} ${times}`;
  });
};

type Point = readonly [label: string, value: number | null];

const known = (points: readonly Point[]): [string, number][] => {
  const kept: [string, number][] = [];

  for (const [label, value] of points) {
    if (value !== null) {
      kept.push([label, value]);
    }
  }

  return kept;
};

/**
 * A one-series chart of the points that have a value. `null` with fewer than
 * two: one bar says nothing a number does not.
 */
export const seriesChart = (
  type: SeriesChart["type"],
  title: string,
  name: string,
  points: readonly Point[]
): ChartData | null => {
  const kept = known(points).slice(-MAX_CHART_POINTS);

  if (kept.length < 2) {
    return null;
  }

  return {
    chart: {
      categories: labels(kept.map(([label]) => label)),
      series: [
        {
          name: clip(name, MAX_CHART_LABEL),
          values: kept.map(([, value]) => value),
        },
      ],
      type,
    },
    title: clip(title, MAX_CHART_TITLE),
  };
};

/** A pie of the shares above zero, or `null` with fewer than two. */
export const pieChart = (
  title: string,
  points: readonly Point[]
): ChartData | null => {
  const kept = known(points)
    .filter(([, value]) => value > 0)
    .slice(0, MAX_PIE_SEGMENTS);

  if (kept.length < 2) {
    return null;
  }

  const names = labels(kept.map(([label]) => label));

  return {
    chart: {
      segments: kept.map(([, value], index) => ({
        label: names[index] ?? "?",
        value,
      })),
      type: "pie",
    },
    title: clip(title, MAX_CHART_TITLE),
  };
};
