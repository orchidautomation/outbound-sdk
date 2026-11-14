// Live, read-only checks against real credentials. They are NOT part of
// `npm test`: run them on purpose with
//
//   LIVE_TESTS=1 INSTANTLY_API_KEY=... npm run test:live
//
// Each provider's block runs only when its key is set. Every call is a read.
// Passing these is what moves an adapter from `unverified` to `stable`.

import assert from "node:assert/strict";
import { test } from "node:test";

import { heyreach } from "../../src/heyreach/index.ts";
import { createOutbound } from "../../src/index.ts";
import type { Adapter } from "../../src/index.ts";
import { instantly } from "../../src/instantly/index.ts";
import { smartlead } from "../../src/smartlead/index.ts";

const enabled = process.env.LIVE_TESTS === "1";

const providers: readonly { env: string; make: () => Adapter; name: string }[] =
  [
    { env: "INSTANTLY_API_KEY", make: () => instantly(), name: "instantly" },
    { env: "SMARTLEAD_API_KEY", make: () => smartlead(), name: "smartlead" },
    { env: "HEYREACH_API_KEY", make: () => heyreach(), name: "heyreach" },
  ];

for (const provider of providers) {
  const skip = !enabled || !process.env[provider.env];

  test(
    `${provider.name}: lists campaigns and reads one back`,
    { skip },
    async () => {
      const outbound = createOutbound({
        adapter: provider.make(),
        maxRequests: 10,
      });

      const page = await outbound.campaigns.list({ limit: 5 });
      assert.equal(page.meta.provider, provider.name);

      for (const campaign of page.items) {
        assert.equal(campaign.provider, provider.name);
        assert.notEqual(
          campaign.status,
          "unknown",
          `unmapped status on ${campaign.ref}`
        );
      }

      const [first] = page.items;

      if (first !== undefined) {
        const again = await outbound.campaigns.get(first.sourceId);
        assert.equal(again.ref, first.ref);
        assert.equal(again.name, first.name);
      }
    }
  );

  test(
    `${provider.name}: every declared capability answers`,
    { skip },
    async () => {
      const outbound = createOutbound({
        adapter: provider.make(),
        maxRequests: 30,
      });

      const { capabilities } = outbound;
      const [campaign] = (await outbound.campaigns.list({ limit: 1 })).items;

      if (capabilities["senders.list"]) {
        await outbound.senders.list({ limit: 5 });
      }

      if (capabilities["stats.workspace"]) {
        const stats = await outbound.stats();
        assert.ok(stats.rows.length > 0);
      }

      if (campaign !== undefined && capabilities["leads.byCampaign"]) {
        await outbound.campaign(campaign.sourceId).leads.list({ limit: 5 });
      }

      if (campaign !== undefined && capabilities.sequence) {
        await outbound.campaign(campaign.sourceId).sequence();
      }

      if (capabilities["replies.list"]) {
        await outbound.replies.list({ limit: 5 });
      }
    }
  );

  test(
    `${provider.name}: stays inside the published rate limit`,
    { skip },
    async () => {
      const outbound = createOutbound({
        adapter: provider.make(),
        maxRequests: 10,
      });

      await outbound.campaigns.list({ limit: 1 });
      const [snapshot] = await outbound.limits();
      assert.ok(snapshot);

      for (const window of snapshot.windows) {
        assert.ok(
          window.used <= window.requests,
          `${window.lane} is over budget`
        );
      }
    }
  );
}
