// Reply messages beside the people who replied, on Instantly's stats
// (OUT-88). The counts are the ones seen live on a four-step campaign on
// 2026-11-15: the dashboard showed "Replies 13" and "Unique replies 1".

import assert from "node:assert/strict";
import { test } from "node:test";

import { harness } from "../helpers/adapter-suite.ts";
import { CAMPAIGN, suite } from "./suite.ts";

const LIVE = {
  campaign_id: CAMPAIGN,
  emails_sent_count: 1501,
  reply_count: 2,
  reply_count_automatic: 11,
  reply_count_automatic_unique: 11,
  reply_count_unique: 1,
};

const repliesOf = (row: Record<string, unknown> | undefined) => ({
  replied: row?.replied,
  repliedAuto: row?.repliedAuto,
  repliedAutoTotal: row?.repliedAutoTotal,
  repliedTotal: row?.repliedTotal,
});

test("instantly: every campaign's row counts reply messages beside the people who replied", async () => {
  const { outbound, settle } = harness(suite, () => Response.json([LIVE]));

  const [row] = (await settle(outbound.stats({ scope: "campaign" }))).rows;

  assert.deepEqual(repliesOf(row), {
    replied: 1,
    repliedAuto: 11,
    repliedAutoTotal: 11,
    repliedTotal: 2,
  });
});

test("instantly: one campaign's total reads reply messages from the overview", async () => {
  const { outbound, settle } = harness(suite, () =>
    Response.json({ ...LIVE, reply_count: 5 })
  );

  const [row] = (await settle(outbound.campaign(CAMPAIGN).stats())).rows;

  assert.equal(row?.repliedTotal, 5);
  assert.equal(row?.repliedAutoTotal, 11);
  assert.equal(row?.replied, 1);
});

test("instantly: daily and step rows read replies and replies_automatic", async () => {
  const report = {
    date: "2026-10-05",
    replies: 4,
    replies_automatic: 3,
    sent: 9,
    step: "0",
    unique_replies: 2,
    unique_replies_automatic: 1,
    variant: "0",
  };

  const { outbound, settle } = harness(suite, () => Response.json([report]));

  const [day] = (await settle(outbound.campaign(CAMPAIGN).stats({ by: "day" })))
    .rows;

  const [step] = (
    await settle(outbound.campaign(CAMPAIGN).stats({ scope: "step" }))
  ).rows;

  for (const row of [day, step]) {
    assert.deepEqual(repliesOf(row), {
      replied: 2,
      repliedAuto: 1,
      repliedAutoTotal: 3,
      repliedTotal: 4,
    });
  }
});

test("instantly: a row without reply message counts reports them as null, never 0", async () => {
  const { outbound, settle } = harness(suite, () =>
    Response.json([{ campaign_id: CAMPAIGN, emails_sent_count: 10 }])
  );

  const [row] = (await settle(outbound.stats({ scope: "campaign" }))).rows;

  assert.deepEqual(repliesOf(row), {
    replied: null,
    repliedAuto: null,
    repliedAutoTotal: null,
    repliedTotal: null,
  });
});
