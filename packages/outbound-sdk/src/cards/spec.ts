// The card format. A card is a json-render spec for the chat catalog
// (`@json-render/chat`): a flat map of elements under a root `Card`. It is
// plain JSON, so it can be posted with Chat SDK, drawn by any json-render
// renderer, or turned into Slack blocks by `toSlackBlocks` with no package.

import { compactObject } from "../internal/json.ts";
import type { JsonObject } from "../internal/json.ts";

export type CardComponent =
  | "Actions"
  | "Card"
  | "Chart"
  | "Divider"
  | "Field"
  | "Fields"
  | "LinkButton"
  | "Table"
  | "Text";

export interface CardElement {
  readonly type: CardComponent;
  readonly props: JsonObject;
  readonly children: readonly string[];
}

/** A json-render spec whose root is a `Card` from the chat catalog. */
export interface CardSpec {
  readonly root: string;
  readonly elements: Readonly<Record<string, CardElement>>;
}

export type TextStyle = "bold" | "muted" | "plain";

export type Align = "center" | "left" | "right";

export interface TableData {
  readonly headers: readonly string[];
  readonly rows: readonly (readonly string[])[];
  readonly align?: readonly Align[] | undefined;
  /** What the table is, for a screen reader and for Slack's table title. */
  readonly caption?: string | undefined;
  /**
   * Which columns make a card when each row is a person or a thing: Slack
   * then draws a short table as cards side by side.
   */
  readonly cards?: TableCards | undefined;
}

export interface TableCards {
  readonly title: number;
  readonly subtitle: readonly number[];
  readonly body?: number | undefined;
}

export interface PieChart {
  readonly type: "pie";
  readonly segments: readonly {
    readonly label: string;
    readonly value: number;
  }[];
}

export interface SeriesChart {
  readonly type: "area" | "bar" | "line";
  readonly categories: readonly string[];
  readonly series: readonly {
    readonly name: string;
    readonly values: readonly number[];
  }[];
  readonly yLabel?: string | undefined;
}

export interface ChartData {
  readonly title: string;
  readonly chart: PieChart | SeriesChart;
}

export interface CardLink {
  readonly label: string;
  readonly url: string;
}

/** One piece of a card, before it is flattened into a spec. */
export type CardNode =
  | { readonly type: "Chart"; readonly chart: ChartData }
  | { readonly type: "Divider" }
  | {
      readonly type: "Fields";
      readonly fields: readonly (readonly [label: string, value: string])[];
    }
  | { readonly type: "Links"; readonly links: readonly CardLink[] }
  | {
      readonly type: "Section";
      readonly title: string;
      readonly children: readonly CardNode[];
    }
  | { readonly type: "Table"; readonly table: TableData }
  | {
      readonly type: "Text";
      readonly content: string;
      readonly style: TextStyle;
    };

export interface CardFrame {
  readonly title: string;
  readonly subtitle?: string | null | undefined;
  readonly children: readonly CardNode[];
}

type Elements = Record<string, CardElement>;

const leaf = (type: CardComponent, props: JsonObject): CardElement => ({
  children: [],
  props,
  type,
});

const chartProps = ({ chart, title }: ChartData): JsonObject =>
  chart.type === "pie"
    ? {
        chart: {
          segments: chart.segments.map((segment) => ({ ...segment })),
          type: "pie",
        },
        title,
      }
    : {
        chart: compactObject({
          categories: [...chart.categories],
          series: chart.series.map((series) => ({
            name: series.name,
            values: [...series.values],
          })),
          type: chart.type,
          yLabel: chart.yLabel,
        }),
        title,
      };

const tableProps = (table: TableData): JsonObject =>
  compactObject({
    align: table.align === undefined ? undefined : [...table.align],
    caption: table.caption,
    cards:
      table.cards === undefined
        ? undefined
        : compactObject({
            body: table.cards.body,
            subtitle: [...table.cards.subtitle],
            title: table.cards.title,
          }),
    headers: [...table.headers],
    rows: table.rows.map((row) => [...row]),
  });

/** Adds a group element whose children are leaves of one kind. */
const group = (
  elements: Elements,
  key: string,
  type: CardComponent,
  childType: CardComponent,
  items: readonly JsonObject[]
): void => {
  const children = items.map((props, index) => {
    const childKey = `${key}-${index + 1}`;
    elements[childKey] = leaf(childType, props);

    return childKey;
  });

  elements[key] = { children, props: {}, type };
};

const addNode = (elements: Elements, key: string, node: CardNode): void => {
  switch (node.type) {
    case "Chart": {
      elements[key] = leaf("Chart", chartProps(node.chart));
      break;
    }

    case "Divider": {
      elements[key] = leaf("Divider", {});
      break;
    }

    case "Fields": {
      group(
        elements,
        key,
        "Fields",
        "Field",
        node.fields.map(([label, value]) => ({ label, value }))
      );
      break;
    }

    case "Links": {
      group(
        elements,
        key,
        "Actions",
        "LinkButton",
        node.links.map((link) => ({ label: link.label, url: link.url }))
      );
      break;
    }

    case "Section": {
      elements[key] = {
        children: addNodes(elements, key, node.children),
        props: { title: node.title },
        type: "Card",
      };
      break;
    }

    case "Table": {
      elements[key] = leaf("Table", tableProps(node.table));
      break;
    }

    default: {
      elements[key] = leaf("Text", {
        content: node.content,
        style: node.style,
      });
    }
  }
};

const addNodes = (
  elements: Elements,
  prefix: string,
  nodes: readonly CardNode[]
): string[] =>
  nodes.map((node, index) => {
    const key = `${prefix}-${index + 1}`;
    addNode(elements, key, node);

    return key;
  });

/** Flattens a card into a json-render spec. Element keys are stable. */
export const buildSpec = (frame: CardFrame): CardSpec => {
  const elements: Elements = {};
  const children = addNodes(elements, "card", frame.children);

  elements.card = {
    children,
    props: compactObject({
      subtitle: frame.subtitle || undefined,
      title: frame.title,
    }),
    type: "Card",
  };

  return { elements, root: "card" };
};
