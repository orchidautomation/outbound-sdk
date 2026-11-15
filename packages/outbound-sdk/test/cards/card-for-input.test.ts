// cardFor takes what a caller has in hand: a tool's result, or an insight
// method's result straight from `outbound.insights`. Given anything else it
// still returns a card, because it never throws.

import assert from "node:assert/strict";
import { test } from "node:test";

import { cardFor } from "../../src/cards/index.ts";
import type { CardSpec } from "../../src/cards/index.ts";
import { createOutbound } from "../../src/index.ts";
import { insights, insightTools } from "../../src/insights/index.ts";
import { demoData, memory } from "../../src/memory/index.ts";
import { includes, read } from "./helpers.ts";

const NOW = "2026-11-14T12:00:00.000Z";

const instance = () =>
  createOutbound({
    adapter: memory({ data: demoData({ now: NOW }) }),
    plugins: [insights()],
  });

test("cardFor draws an insight method's result the same as its tool's result", async () => {
  const outbound = instance();
  const direct = await outbound.insights.hotLeads({});

  // The direct form type-checks: an insight result is accepted as it is.
  const card: CardSpec = cardFor("hot_leads", direct);

  const tool = insightTools(outbound).find(
    (candidate) => candidate.name === "hot_leads"
  );

  assert.ok(tool);

  const viaTool = cardFor("hot_leads", await tool.call({}));
  const text = read(card);

  includes(text, "Hot leads");
  assert.equal(text, read(viaTool));
});

test("cardFor draws an insight result's notes and an incomplete read", async () => {
  const result = await instance().insights.campaignRanking({
    max_campaigns: 1,
  });

  assert.equal(result.meta.complete, false);

  const text = read(cardFor("campaign_ranking", result));

  includes(text, "Campaign ranking", "Stopped at 1 campaign");
});

test("cardFor returns a card for anything it cannot draw, and never throws", () => {
  const odd: unknown[] = [
    undefined,
    null,
    42,
    "text",
    [],
    {},
    { ok: true },
    { ok: false },
    { data: 1 },
    { data: {}, meta: null },
    { data: { campaigns: "not a list" }, meta: { evidence: 3 }, ok: true },
  ];

  for (const value of odd) {
    // SAFETY: the point is to hand cardFor what its types forbid, as plain JavaScript can.
    const card = cardFor("campaign_overview", value as never);

    assert.ok(card.root in card.elements, JSON.stringify(value));
    read(card);
  }

  includes(
    read(cardFor("hot_leads", {} as never)),
    "Nothing to show: this is not a tool or insight result."
  );
});
