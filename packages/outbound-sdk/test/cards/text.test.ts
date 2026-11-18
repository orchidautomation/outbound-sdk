// toText: a card as text a person reads, or as Slack mrkdwn to paste.

import assert from "node:assert/strict";
import { test } from "node:test";

import { toText } from "../../src/cards/index.ts";
import type { CardSpec } from "../../src/cards/index.ts";

const spec: CardSpec = {
  elements: {
    actions: { children: ["link"], props: {}, type: "Actions" },
    chart: {
      children: [],
      props: {
        chart: {
          categories: ["Mon", "Tue"],
          series: [{ name: "Replies", values: [3, 5] }],
          type: "bar",
          xLabel: "Day",
        },
        title: "Replies by day",
      },
      type: "Chart",
    },
    divider: { children: [], props: {}, type: "Divider" },
    empty: {
      children: [],
      props: { headers: ["A"], rows: [] },
      type: "Table",
    },
    field: {
      children: [],
      props: { label: "Sent", value: "**120**" },
      type: "Field",
    },
    fields: { children: ["field"], props: {}, type: "Fields" },
    finding: {
      children: [],
      props: { content: "Reply rate **fell**", style: "bold" },
      type: "Text",
    },
    link: {
      children: [],
      props: { label: "Open", url: "https://example.com/c1" },
      type: "LinkButton",
    },
    nochart: { children: [], props: { title: "No data" }, type: "Chart" },
    root: {
      children: [
        "finding",
        "fields",
        "section",
        "divider",
        "chart",
        "nochart",
        "empty",
        "actions",
      ],
      props: { subtitle: "3 campaigns", title: "Report" },
      type: "Card",
    },
    section: {
      children: ["table"],
      props: { title: "Top" },
      type: "Card",
    },
    table: {
      children: [],
      props: { headers: ["Name", "Sent"], rows: [["Founders", "120"]] },
      type: "Table",
    },
  },
  root: "root",
};

test("plain text: title, finding, fields, a section's table, a chart, links", () => {
  assert.equal(
    toText(spec),
    [
      "Report\n3 campaigns",
      "Reply rate fell",
      "Sent: 120",
      "Top",
      "Name     | Sent\nFounders | 120",
      "---",
      "Replies by day\nDay | Replies\nMon | 3\nTue | 5",
      "Open: https://example.com/c1",
    ].join("\n\n")
  );
});

test("slack style: bold in mrkdwn, tables and charts fenced, links as Slack links", () => {
  const text = toText(spec, { style: "slack" });

  assert.match(
    text,
    /^\*Report\*\n3 campaigns\n\n\*Reply rate fell\*\n\n\*Sent\*: \*120\*/u
  );
  assert.match(
    text,
    /\n\n\*Top\*\n\n```\nName {5}\| Sent\nFounders \| 120\n```/u
  );
  assert.match(text, /<https:\/\/example\.com\/c1\|Open>$/u);
});

test("a spec with no root is empty text", () => {
  assert.equal(toText({ elements: {}, root: "missing" }), "");
});
