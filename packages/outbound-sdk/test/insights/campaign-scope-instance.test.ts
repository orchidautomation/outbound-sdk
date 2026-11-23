// The instance an insight runs on under a campaign scope (OUT-200), read
// directly through a test insight: each collection answers for the scope's
// campaigns only, a read of another campaign is refused, and a read that
// would span the workspace either turns into per-campaign reads or is
// refused as Unsupported.

import assert from "node:assert/strict";
import { test } from "node:test";

import { z } from "zod";

import { OutboundError } from "../../src/index.ts";
import type { OutboundApi } from "../../src/index.ts";
import { defineInsight, runInsight } from "../../src/insights/index.ts";
import { NOW, over, world } from "./metered.ts";

type Read = (
  outbound: OutboundApi
) => Promise<
  readonly { readonly campaignRef?: string | null; readonly ref?: string }[]
>;

/** What each read answered: the campaigns its records belong to, or the error code. */
const probe = defineInsight({
  description: "Reads what the test asks for, under the scope.",
  inputSchema: z.object({}),
  key: "scopeProbe",
  name: "scope_probe",
  needs: [],
  next: "",
  run: async (context) => {
    const answers: Record<string, string> = {};

    for (const [label, read] of Object.entries(READS)) {
      try {
        // oxlint-disable-next-line no-await-in-loop -- one read at a time, so the answers keep their order
        const items = await read(context.outbound);

        answers[label] = [
          ...new Set(
            items.map((item) =>
              (item.campaignRef ?? item.ref ?? "").replace("memory:agency:", "")
            )
          ),
        ]
          .toSorted()
          .join(",");
      } catch (error) {
        answers[label] = OutboundError.is(error) ? error.code : "other";
      }
    }

    return answers;
  },
});

const all = <Item>(walk: { readonly toArray: () => Promise<Item[]> }) =>
  walk.toArray();

// c1, c3 and c5 are tagged even. Sender s1 sends for every campaign. The
// memory tool reports no stats per sender, so that read is Unsupported.
const READS: Readonly<Record<string, Read>> = {
  "campaign c2, outside": async (outbound) => [
    await outbound.campaign("c2").get(),
  ],
  "campaign c3 leads": (outbound) =>
    all(outbound.campaign("c3").leads.listAll()),
  "campaigns of sender s1": (outbound) =>
    all(outbound.campaigns.listAll({ senderId: "s1" })),
  "campaigns page": async (outbound) => (await outbound.campaigns.list()).items,
  "leads page of c1": async (outbound) =>
    (await outbound.leads.list({ campaignId: "c1" })).items,
  messages: (outbound) => all(outbound.messages.listAll()),
  "replies of c4, outside": (outbound) =>
    all(outbound.replies.listAll({ campaignId: "c4" })),
  "replies page": async (outbound) => (await outbound.replies.list()).items,
  "sender health": async (outbound) =>
    (await outbound.senderHealth.list()).items,
  "sender health walk": (outbound) => all(outbound.senderHealth.listAll()),
  "sender s1 campaigns page": async (outbound) =>
    (await outbound.sender("s1").campaigns.list()).items,
  "sender s1 campaigns walk": (outbound) =>
    all(outbound.sender("s1").campaigns.listAll()),
  "senders, at most 2": (outbound) => all(outbound.senders.listAll({ max: 2 })),
  "stats of c2, outside": async (outbound) =>
    (await outbound.stats({ scope: "campaign", scopeId: "c2" })).rows.map(
      () => ({ ref: "c2" })
    ),
  "stats of the scope's senders": async (outbound) =>
    (await outbound.stats({ scope: "sender" })).rows.length > 0
      ? [{ ref: "rows" }]
      : [],
};

test("under a campaign scope each read answers for the scope's campaigns, or is refused", async () => {
  const { outbound } = over(world(6, 5));

  const answer = await runInsight(outbound, probe, { tag: "even" } as never, {
    now: NOW,
  });

  assert.deepEqual(answer.data, {
    "campaign c2, outside": "Invalid",
    "campaign c3 leads": "c3",
    "campaigns of sender s1": "c1,c3,c5",
    "campaigns page": "c1,c3,c5",
    "leads page of c1": "c1",
    messages: "c1,c3,c5",
    "replies of c4, outside": "Invalid",
    "replies page": "Unsupported",
    "sender health": "Unsupported",
    "sender health walk": "Unsupported",
    "sender s1 campaigns page": "c1,c3,c5",
    "sender s1 campaigns walk": "c1,c3,c5",
    "senders, at most 2": "s1,s2",
    "stats of c2, outside": "Invalid",
    "stats of the scope's senders": "Unsupported",
  });
});
