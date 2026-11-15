// The default Slack style. Its shapes were accepted by Slack itself: every
// card here was sent to Slack's `blocks.validate` and nine were posted to a
// sandbox workspace. These tests hold the code to the rules Slack enforced.

import assert from "node:assert/strict";
import { test } from "node:test";

import { cardFor, digest, toSlackBlocks } from "../../src/cards/index.ts";
import { clients } from "../../src/clients/index.ts";
import { identity } from "../../src/identity/index.ts";
import { createOutbound } from "../../src/index.ts";
import { insights, insightTools } from "../../src/insights/index.ts";
import { demoData, memory } from "../../src/memory/index.ts";
import { createTools } from "../../src/tools/index.ts";
import { insight, tool } from "./helpers.ts";

interface Block {
  type: string;
  [key: string]: unknown;
}

interface Layout extends Block {
  rows: { items: { block: Block }[] }[];
  fallback: Block[];
}

const blocks = (...args: Parameters<typeof toSlackBlocks>): Block[] =>
  toSlackBlocks(...args) as Block[];

const one = <Found extends Block>(all: Block[], type: string): Found => {
  const found = all.find((block) => block.type === type);
  assert.ok(found, `a ${type} block in ${all.map((block) => block.type)}`);

  return found as Found;
};

const hot = (leads: number) =>
  insight({
    leads: Array.from({ length: leads }, (_, index) => ({
      company: "Example Co",
      name: index === 0 ? "<!channel> *Maya*" : `Lead ${index + 1}`,
      reason: "replied twice",
      score: 90 - index,
    })),
    totals: { hot: leads, leadsRead: 1400, scored: 212 },
  });

test("numbers are drawn as a bordered grid of tiles, three to a row", () => {
  const layout = one<Layout>(blocks(cardFor("hot_leads", hot(1))), "layout");

  assert.equal(layout.grid_lines, "outer");
  assert.deepEqual(
    layout.rows.map((row) => row.items.map((item) => item.block.text)),
    [
      [
        { text: "Hot\n*1*", type: "mrkdwn" },
        { text: "Scored\n*212*", type: "mrkdwn" },
        { text: "Leads read\n*1,400*", type: "mrkdwn" },
      ],
    ]
  );
  // A client that cannot draw a layout shows the two-column list.
  assert.equal(layout.fallback[0]?.type, "section");
  assert.equal(((layout.fallback[0]?.fields ?? []) as unknown[]).length, 3);
});

test("more numbers than one layout holds go into a second one", () => {
  const all = blocks(
    cardFor(
      "warmup_readiness",
      insight({
        byReason: Object.fromEntries(
          Array.from({ length: 17 }, (_, index) => [
            `reason_${index}`,
            index + 1,
          ])
        ),
        notReady: [],
        ready: 3,
        total: 3,
      })
    )
  ).filter((block) => block.type === "layout") as Layout[];

  assert.deepEqual(
    all.map((layout) => layout.rows.map((row) => row.items.length)),
    [
      [3, 3, 3, 3, 3],
      [3, 1],
    ]
  );
});

test("a table cell that is a number is sent as one, so Slack sorts it", () => {
  const table = one<Block & { rows: Block[][]; page_size: number }>(
    blocks(
      cardFor(
        "campaign_overview",
        tool({
          campaigns: [
            {
              metrics: { bounce_rate: 0.011, reply_rate: 0.077, sent: 1200 },
              name: "Founders [Q4]",
            },
            { metrics: null, name: "Never sent" },
          ],
        })
      )
    ),
    "data_table"
  );

  const [header, first, second] = table.rows;

  assert.equal(table.page_size, 2);
  assert.deepEqual(header?.[0], { text: "Campaign", type: "raw_text" });
  assert.deepEqual(first?.[0], {
    elements: [
      {
        elements: [
          { style: { bold: true }, text: "Founders [Q4]", type: "text" },
        ],
        type: "rich_text_section",
      },
    ],
    type: "rich_text",
  });
  assert.deepEqual(first?.[1], {
    text: "1,200",
    type: "raw_number",
    value: 1200,
  });
  assert.deepEqual(first?.[3], {
    text: "7.7%",
    type: "raw_number",
    value: 7.7,
  });
  // A count the vendor does not report stays a dash, and is not a number.
  assert.deepEqual(second?.[1], { text: "—", type: "raw_text" });
});

test("a rate with its interval, and a number in the first column, keep their text", () => {
  const table = one<Block & { rows: Block[][] }>(
    blocks(
      cardFor(
        "campaign_ranking",
        insight({
          gap: {},
          metric: "reply_rate",
          ranked: [
            {
              high: 0.08,
              low: 0.04,
              name: "Founders",
              rank: 1,
              rate: 0.06,
              sent: 500,
            },
          ],
          tooFewSends: [],
        })
      )
    ),
    "data_table"
  );

  assert.deepEqual(table.rows[1]?.[0], {
    text: "1",
    type: "raw_number",
    value: 1,
  });
  assert.deepEqual(table.rows[1]?.[3], {
    text: "6% (4–8%)",
    type: "raw_text",
  });
});

test("a few leads are drawn as cards side by side, and prospect text stays inert", () => {
  const layout = one<Layout>(
    blocks(cardFor("hot_leads", hot(4))).filter(
      (block) => block.grid_lines === undefined
    ),
    "layout"
  );

  assert.deepEqual(
    layout.rows.map((row) => row.items.length),
    [3, 1]
  );
  assert.deepEqual(layout.rows[0]?.items[0]?.block, {
    body: { text: "replied twice", type: "mrkdwn" },
    subtitle: { text: "Example Co · score *90*", type: "mrkdwn" },
    title: { text: "*‹!channel› *Maya**", type: "mrkdwn" },
    type: "card",
  });
  assert.match(
    ((layout.fallback[0]?.text ?? {}) as { text: string }).text,
    /^```\nLead/u
  );
});

test("more leads than read well as cards stay a table", () => {
  const all = blocks(cardFor("hot_leads", hot(12), { maxRows: 12 }));

  assert.equal(all.filter((block) => block.type === "data_table").length, 1);
  assert.equal(
    all.some((block) => block.type === "layout" && !block.grid_lines),
    false
  );
});

test("the first link button is the primary one", () => {
  const actions = one<Block & { elements: Block[] }>(
    blocks(
      cardFor("hot_leads", hot(1), {
        links: [
          { label: "Open in Instantly", url: "https://app.example.com/1" },
          { label: "Docs", url: "https://app.example.com/2" },
        ],
      })
    ),
    "actions"
  );

  assert.deepEqual(
    actions.elements.map((button) => button.style),
    ["primary", undefined]
  );
});

const WIDE = new Set(["data_table", "data_visualization", "carousel"]);

/** The rules Slack's API gave when it refused a block. */
const assertSlackAccepts = (all: Block[], name: string): void => {
  assert.ok(all.length <= 50, `${name}: 50 blocks at most`);
  assert.ok(
    all.filter((block) => block.type === "data_visualization").length <= 2,
    `${name}: two charts at most`
  );

  for (const block of all) {
    if (block.type === "data_table") {
      assert.ok(
        (block.rows as unknown[]).length >= 2,
        `${name}: a table has a row`
      );
      assert.ok(block.caption, `${name}: a table has a caption`);
    }

    if (block.type === "layout") {
      const { rows } = block as Layout;

      assert.ok(rows.length >= 1 && rows.length <= 5, `${name}: 1 to 5 rows`);

      for (const row of rows) {
        assert.ok(
          row.items.length >= 1 && row.items.length <= 3,
          `${name}: 1 to 3 items in a row`
        );
        assert.ok(
          row.items.filter((item) => WIDE.has(item.block.type)).length <= 1,
          `${name}: one wide block in a row`
        );
        // The alert block is refused in a message.
        assert.ok(
          row.items.every((item) => item.block.type !== "alert"),
          `${name}: no alert block`
        );
      }
    }
  }
};

test("every card a real instance produces keeps to what Slack accepts", async () => {
  const outbound = createOutbound({
    adapter: memory({
      data: demoData({ now: "2026-10-08T12:00:00.000Z" }),
      workspaceId: "acme",
    }),
    plugins: [clients(), identity(), insights()],
  });

  const [campaign] = await outbound.campaigns.listAll().toArray();

  const values = new Map([
    ["domain", "example.com"],
    ["from", "2026-11-01"],
    ["person", "person1@example.com"],
    ["to", "2026-11-14"],
  ]);

  const sections = [];

  for (const offered of createTools(outbound, {
    extra: insightTools(outbound),
  })) {
    const { required } = offered.parameters as { required?: string[] };

    const result = await offered.call(
      Object.fromEntries(
        (required ?? []).map((key) => [
          key,
          values.get(key) ?? campaign?.ref ?? "",
        ])
      )
    );

    sections.push({ name: offered.name, result });
    assertSlackAccepts(blocks(cardFor(offered.name, result)), offered.name);
  }

  assert.ok(sections.length >= 35);
  assertSlackAccepts(blocks(digest({ sections, title: "Digest" })), "digest");
});
