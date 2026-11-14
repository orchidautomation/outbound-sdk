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
import { createOutbound, OutboundError } from "../../src/index.ts";
import type { Adapter, NativeCatalog } from "../../src/index.ts";
import { instantly } from "../../src/instantly/index.ts";
import { smartlead } from "../../src/smartlead/index.ts";

const enabled = process.env.LIVE_TESTS === "1";

const TOLERATED = new Set(["Invalid", "Unauthorized"]);

const providers: readonly {
  env: string;
  make: () => Adapter<NativeCatalog>;
  name: string;
}[] = [
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
    `${provider.name}: every declared account-level read answers`,
    { skip },
    async () => {
      const outbound = createOutbound({
        adapter: provider.make(),
        maxRequests: 60,
      });

      const { capabilities } = outbound;
      const [campaign] = (await outbound.campaigns.list({ limit: 1 })).items;

      const [sender] = capabilities["senders.list"]
        ? (await outbound.senders.list({ limit: 1 })).items
        : [];

      if (campaign !== undefined && capabilities["campaigns.settings"]) {
        const settings = await outbound.campaign(campaign.ref).settings();
        assert.equal(settings.campaignRef, campaign.ref);
      }

      if (campaign !== undefined && capabilities["sequence.subsequences"]) {
        await outbound.campaign(campaign.ref).subsequences.list({ limit: 5 });
      }

      if (campaign !== undefined && capabilities["senders.byCampaign"]) {
        await outbound.campaign(campaign.ref).senders.list({ limit: 5 });
      }

      if (sender !== undefined && capabilities["senders.health"]) {
        const health = await outbound.sender(sender.ref).health();
        assert.equal(health.senderRef, sender.ref);
      }
    }
  );

  test(
    `${provider.name}: lists, the block list, tags, webhooks and a thread answer`,
    { skip },
    async () => {
      const outbound = createOutbound({
        adapter: provider.make(),
        maxRequests: 60,
      });

      const { capabilities } = outbound;

      if (capabilities["lists.list"]) {
        const [list] = (await outbound.lists.list({ limit: 1 })).items;

        if (list !== undefined && capabilities["lists.leads"]) {
          await outbound.list(list.ref).leads.list({ limit: 5 });
        }
      }

      if (capabilities.blocklist) {
        await outbound.blocklist.list({ limit: 5 });
      }

      if (capabilities.tags) {
        await outbound.tags.list({ limit: 5 });
      }

      if (capabilities["webhooks.list"]) {
        await outbound.webhooks.list({ limit: 5 });
      }

      if (capabilities["messages.list"] && capabilities["messages.byThread"]) {
        const messages = (await outbound.messages.list({ limit: 5 })).items;

        const threadId = messages.find(
          (message) => message.threadId !== null
        )?.threadId;

        if (threadId !== null && threadId !== undefined) {
          const thread = await outbound.thread(threadId).messages();
          assert.ok(thread.items.length > 0, "a thread holds its own message");
        }
      }
    }
  );

  test(
    `${provider.name}: every native read without required parameters answers`,
    { skip },
    async () => {
      const outbound = createOutbound({
        adapter: provider.make(),
        maxRequests: 200,
        retries: 1,
      });

      const failures: string[] = [];

      for (const [name, read] of Object.entries(outbound.native.catalog)) {
        const needsInput = Object.values(read.params ?? {}).some(
          (param) => param.required === true || param.in === "path"
        );

        if (needsInput || read.baseUrl !== undefined) {
          continue;
        }

        try {
          // oxlint-disable-next-line no-await-in-loop -- one read at a time stays inside the rate limit.
          await outbound.native.read(name);
        } catch (error) {
          // A plan that lacks a feature answers Unauthorized, and a read that
          // needs one of several inputs answers Invalid. Neither is a wrong path.
          if (!OutboundError.is(error) || !TOLERATED.has(error.code)) {
            failures.push(`${name}: ${String(error)}`);
          }
        }
      }

      assert.deepEqual(failures, []);
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
