// Every card a test builds goes through `read`, which holds it to two outside
// referees before returning its text: the json-render chat catalog must accept
// the spec inside Slack's limits, and Chat SDK's Slack adapter must write the
// same blocks for it that `toSlackBlocks` does.

import assert from "node:assert/strict";

import {
  cardToSlackBlocks,
  cardToSlackFallbackText,
} from "@chat-adapter/slack/blocks";
import { toCard } from "@json-render/chat";

import { toSlackBlocks } from "../../src/cards/index.ts";
import type { CardSpec } from "../../src/cards/index.ts";
import type { ToolResult } from "../../src/tools/index.ts";

/** What one Slack message can hold, as Chat SDK's Slack adapter enforces it. */
export const SLACK_LIMITS = {
  chartLabel: 20,
  chartPoints: 20,
  chartSeries: 12,
  chartTitle: 50,
  charts: 2,
  fields: 10,
  tableColumns: 20,
  tableRows: 100,
  tables: 1,
};

/** The card as text, after both referees have accepted it. */
export const read = (
  spec: CardSpec,
  limits: Partial<typeof SLACK_LIMITS> = SLACK_LIMITS
): string => {
  // Chat SDK's own types differ only under exactOptionalPropertyTypes.
  const card = toCard(spec as never, { limits }) as never;
  const blocks = toSlackBlocks(spec, { style: "plain" });

  assert.deepEqual(blocks, cardToSlackBlocks(card));
  assert.ok(blocks.length <= 50, "a Slack message holds 50 blocks");

  return cardToSlackFallbackText(card);
};

export const META = {
  complete: true,
  evidence: "exact",
  notes: [] as string[],
  provider: "instantly",
  requests: 3,
};

/** A tool's successful result. */
export const tool = (
  data: unknown,
  meta: Partial<typeof META> = {}
): ToolResult => ({
  // Fixtures are plain JSON already; the tool result type only needs telling.
  data: data as never,
  meta: { ...META, ...meta } as never,
  next: "",
  ok: true,
});

/** An insight's successful result, as `insightTools` returns it. */
export const insight = (
  result: unknown,
  coverage: { complete?: boolean; notes?: string[] } = {}
): ToolResult => tool(result, coverage);

export const includes = (text: string, ...parts: string[]): void => {
  for (const part of parts) {
    assert.ok(text.includes(part), `expected "${part}" in:\n${text}`);
  }
};

export const excludes = (text: string, ...parts: string[]): void => {
  for (const part of parts) {
    assert.ok(!text.includes(part), `did not expect "${part}" in:\n${text}`);
  }
};
