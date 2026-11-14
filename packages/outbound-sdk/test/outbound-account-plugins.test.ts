import assert from "node:assert/strict";
import { test } from "node:test";

import { combine } from "../src/combine/index.ts";
import { createScrubber } from "../src/fixtures/index.ts";
import { createOutbound, OutboundError } from "../src/index.ts";
import type { Adapter } from "../src/index.ts";
import { memory } from "../src/memory/index.ts";
import type { MemoryData } from "../src/memory/index.ts";
import { MASK, redact } from "../src/redact/index.ts";

const DATA: MemoryData = {
  blocklist: [
    { id: "blk_1", value: "blocked@example.com" },
    { id: "blk_2", value: "example.org" },
    { id: "blk_3", kind: "linkedin", value: "https://www.linkedin.com/in/x" },
  ],
  campaigns: [
    {
      id: "cmp_1",
      settings: { dailyLimit: 40 },
      subsequences: [{ id: "sub_1", steps: [{ variants: [{}] }] }],
    },
  ],
  lists: [{ id: "list_1", name: "Founders" }],
  senders: [
    { address: "rep@mail.example.com", health: { spf: true }, id: "snd_1" },
  ],
  tags: [{ id: "tag_1", name: "vip" }],
  webhooks: [
    {
      campaignId: "cmp_1",
      id: "wh_1",
      name: "Acme hook",
      url: "https://hooks.acme.test/in?token=abc",
    },
  ],
};

const unsupported = (error: unknown): boolean =>
  OutboundError.is(error) && error.code === "Unsupported";

const READS = [
  [
    "getCampaignSettings",
    (o: ReturnType<typeof createOutbound>, p: string) =>
      o.campaign(`${p}cmp_1`).settings(),
  ],
  [
    "getSenderHealth",
    (o: ReturnType<typeof createOutbound>, p: string) =>
      o.sender(`${p}snd_1`).health(),
  ],
  [
    "listBlocklist",
    (o: ReturnType<typeof createOutbound>) => o.blocklist.list(),
  ],
  ["listLists", (o: ReturnType<typeof createOutbound>) => o.lists.list()],
  [
    "listSubsequences",
    (o: ReturnType<typeof createOutbound>, p: string) =>
      o.campaign(`${p}cmp_1`).subsequences.list(),
  ],
  ["listTags", (o: ReturnType<typeof createOutbound>) => o.tags.list()],
  ["listWebhooks", (o: ReturnType<typeof createOutbound>) => o.webhooks.list()],
] as const;

const without = (adapter: Adapter, method: string): Adapter =>
  // SAFETY: an entry list of an Adapter with one optional method removed is still an Adapter.
  Object.fromEntries(
    Object.entries(adapter).filter(([key]) => key !== method)
  ) as unknown as Adapter;

for (const [method, read] of READS) {
  test(`${method}: an adapter that declares it but lacks it fails as Unsupported, alone and combined`, async () => {
    const broken = without(
      memory({ data: DATA, workspaceId: "client-a" }),
      method
    );

    await assert.rejects(
      async () => await read(createOutbound({ adapter: broken }), ""),
      unsupported
    );
    await assert.rejects(
      async () =>
        await read(
          createOutbound({ adapter: combine([broken]) }),
          "memory:client-a:"
        ),
      unsupported
    );
  });
}

test("a combined instance refuses a list's leads from a member that cannot list leads", async () => {
  const broken = without(
    memory({ data: DATA, workspaceId: "client-a" }),
    "listLeads"
  );

  await assert.rejects(
    async () =>
      await createOutbound({ adapter: combine([broken]) })
        .list("memory:client-a:list_1")
        .leads.list(),
    unsupported
  );
});

test("redact masks a blocked address or profile and leaves domains and account records readable", async () => {
  const outbound = createOutbound({
    adapter: memory({ data: DATA, workspaceId: "client-a" }),
    plugins: [redact()],
  });

  assert.deepEqual(
    (await outbound.blocklist.list()).items.map((entry) => entry.value),
    [MASK, "example.org", MASK]
  );
  assert.equal((await outbound.campaign("cmp_1").settings()).dailyLimit, 40);
  assert.equal((await outbound.sender("snd_1").health()).dns.spf, true);
  assert.equal((await outbound.lists.list()).items[0]?.name, "Founders");
  assert.equal((await outbound.tags.list()).items[0]?.name, "vip");
  assert.equal((await outbound.webhooks.list()).items[0]?.raw, null);
  assert.equal(
    (await outbound.campaign("cmp_1").subsequences.list()).items[0]?.kind,
    "subsequence"
  );
});

test("the scrubber replaces what could identify a customer in account records", async () => {
  const outbound = createOutbound({
    adapter: memory({ data: DATA, workspaceId: "client-a" }),
  });

  const scrubber = createScrubber();
  const [entry] = (await outbound.blocklist.list()).items;
  const [list] = (await outbound.lists.list()).items;
  const [hook] = (await outbound.webhooks.list()).items;
  const [tag] = (await outbound.tags.list()).items;

  const [subsequence] = (await outbound.campaign("cmp_1").subsequences.list())
    .items;

  const settings = await outbound.campaign("cmp_1").settings();
  const health = await outbound.sender("snd_1").health();
  assert.ok(entry && list && hook && tag && subsequence);
  assert.deepEqual(
    [scrubber.record(entry), scrubber.record(list)].map((record) =>
      "value" in record ? record.value : "name" in record && record.name
    ),
    ["value-1", "value-2"]
  );
  const scrubbedHook = scrubber.record(hook);
  assert.ok("url" in scrubbedHook);
  assert.equal(scrubbedHook.url, "https://example.com/webhook");
  assert.equal(scrubbedHook.name, "value-3");
  assert.equal(scrubbedHook.campaignRef, "memory:client-a:cmp_1");
  const scrubbedHealth = scrubber.record(health);
  assert.ok("dns" in scrubbedHealth);
  assert.equal(scrubbedHealth.domain, "example.com");
  assert.equal(scrubbedHealth.senderRef, "memory:client-a:snd_1");
  const scrubbedSettings = scrubber.record(settings);
  assert.ok("schedule" in scrubbedSettings);
  assert.equal(scrubbedSettings.campaignRef, "memory:client-a:cmp_1");
  const scrubbedTag = scrubber.record(tag);
  assert.ok("description" in scrubbedTag);
  assert.equal(scrubbedTag.ref, "memory:client-a:tag_1");
  const scrubbedSteps = scrubber.record(subsequence);
  assert.ok("steps" in scrubbedSteps);
  assert.equal(scrubbedSteps.raw, null);
});
