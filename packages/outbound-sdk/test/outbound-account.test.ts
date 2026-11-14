import assert from "node:assert/strict";
import { test } from "node:test";

import { combine } from "../src/combine/index.ts";
import { createOutbound, OutboundError } from "../src/index.ts";
import { memory } from "../src/memory/index.ts";
import type { MemoryData } from "../src/memory/index.ts";

const DATA: MemoryData = {
  blocklist: [
    { id: "blk_1", value: " Blocked@Example.com " },
    { id: "blk_2", value: "example.org" },
    { id: "blk_3", kind: "linkedin", value: "https://www.linkedin.com/in/x" },
  ],
  campaigns: [
    {
      id: "cmp_1",
      settings: {
        dailyLimit: 40,
        dailyNewLeads: 15,
        endDate: "2026-12-31",
        gapMinutes: 9,
        plainText: true,
        schedule: [
          {
            days: [1, 2, 3, 4, 5],
            from: "09:00",
            name: "Weekdays",
            timezone: "America/New_York",
            to: "17:30",
          },
        ],
        startDate: "2026-11-01",
        stopOnAutoReply: false,
        stopOnReply: true,
        trackClicks: false,
        trackOpens: true,
      },
      steps: [
        { variants: [{ body: "Hi" }] },
        { branch: "accepted", parentIndex: 0, variants: [{ body: "Thanks" }] },
        { branch: "ignored", parentIndex: 0, variants: [{ body: "Nudge" }] },
      ],
      subsequences: [
        { id: "sub_1", name: "Interested", steps: [{ variants: [{}] }] },
      ],
    },
    { id: "cmp_2" },
  ],
  leads: [
    {
      engagement: { clicks: 1, opens: 3, replies: 2, stepIndex: 1 },
      id: "lead_1",
      interest: "Meeting Booked",
      listIds: ["list_1"],
      tags: ["vip"],
    },
    { id: "lead_2", listIds: ["list_1", "list_2"] },
    { campaignId: "cmp_1", id: "lead_3" },
  ],
  lists: [{ id: "list_1", name: "Founders" }, { id: "list_2" }],
  messages: [
    {
      direction: "out",
      id: "m2",
      sentAt: "2026-11-02T10:00:00Z",
      threadId: "t1",
    },
    {
      direction: "in",
      id: "m1",
      sentAt: "2026-11-01T10:00:00Z",
      threadId: "t1",
    },
    {
      direction: "out",
      id: "m3",
      sentAt: "2026-11-03T10:00:00Z",
      threadId: "t2",
    },
  ],
  senders: [
    {
      address: "Rep@Mail.Example.com",
      health: {
        blacklisted: false,
        checkedAt: "2026-11-10T00:00:00Z",
        connected: true,
        dkim: false,
        dmarc: true,
        issues: ["DKIM record missing"],
        mx: true,
        spf: true,
        warmup: { inbox: 90, received: 80, score: 97, sent: 100, spam: 10 },
      },
      id: "snd_1",
    },
    { id: "snd_2", linkedinUrl: "https://www.linkedin.com/in/seat" },
  ],
  tags: [{ description: "High value", id: "tag_1", name: "vip" }],
  webhooks: [
    {
      events: ["reply_received"],
      id: "wh_1",
      url: "https://hooks.example.com/a",
    },
    {
      active: false,
      campaignId: "cmp_1",
      id: "wh_2",
      name: "Campaign hook",
      url: "https://hooks.example.com/b",
    },
  ],
};

const client = (capabilities = {}) =>
  createOutbound({
    adapter: memory({ capabilities, data: DATA, workspaceId: "client-a" }),
  });

const unsupported = (error: unknown): boolean =>
  OutboundError.is(error) && error.code === "Unsupported";

test("a campaign's settings carry its schedule, caps, tracking and stop rules", async () => {
  const settings = await client().campaign("cmp_1").settings();
  assert.equal(settings.campaignRef, "memory:client-a:cmp_1");
  assert.equal(settings.sourceId, "cmp_1");
  assert.deepEqual(settings.schedule, [
    {
      days: [1, 2, 3, 4, 5],
      from: "09:00",
      name: "Weekdays",
      timezone: "America/New_York",
      to: "17:30",
    },
  ]);
  assert.equal(settings.dailyLimit, 40);
  assert.equal(settings.dailyNewLeads, 15);
  assert.equal(settings.gapMinutes, 9);
  assert.equal(settings.startDate, "2026-11-01");
  assert.equal(settings.endDate, "2026-12-31");
  assert.deepEqual(settings.tracking, { clicks: false, opens: true });
  assert.equal(settings.stopOnReply, true);
  assert.equal(settings.stopOnAutoReply, false);
  assert.equal(settings.plainText, true);
  assert.equal(settings.meta.complete, true);
});

test("settings a vendor does not report are null, never a guess", async () => {
  const settings = await client().campaign("cmp_2").settings();
  assert.deepEqual(settings.schedule, []);
  assert.equal(settings.dailyLimit, null);
  assert.deepEqual(settings.tracking, { clicks: null, opens: null });
  assert.equal(settings.stopOnReply, null);
});

test("a sender's health reports DNS, connection, block list and warmup traffic", async () => {
  const health = await client().sender("snd_1").health();
  assert.equal(health.senderRef, "memory:client-a:snd_1");
  assert.equal(health.domain, "mail.example.com");
  assert.deepEqual(health.dns, {
    dkim: false,
    dmarc: true,
    mx: true,
    spf: true,
  });
  assert.equal(health.connected, true);
  assert.equal(health.blacklisted, false);
  assert.deepEqual(health.issues, ["DKIM record missing"]);
  assert.deepEqual(health.warmup, {
    inbox: 90,
    received: 80,
    score: 97,
    sent: 100,
    spam: 10,
  });
  assert.equal(health.checkedAt, "2026-11-10T00:00:00Z");
  const seat = await client().sender("snd_2").health();
  assert.equal(seat.domain, null);
  assert.equal(seat.warmup, null);
});

test("a branching sequence keeps each step's parent and the outcome that leads to it", async () => {
  const sequence = await client().campaign("cmp_1").sequence();
  assert.equal(sequence.kind, "main");
  assert.equal(sequence.name, null);
  assert.deepEqual(
    sequence.steps.map((step) => [step.index, step.parentIndex, step.branch]),
    [
      [0, null, null],
      [1, 0, "accepted"],
      [2, 0, "ignored"],
    ]
  );
});

test("subsequences are listed under their campaign", async () => {
  const page = await client().campaign("cmp_1").subsequences.list();
  assert.deepEqual(
    page.items.map((item) => [
      item.ref,
      item.kind,
      item.name,
      item.campaignRef,
    ]),
    [
      [
        "memory:client-a:sub_1",
        "subsequence",
        "Interested",
        "memory:client-a:cmp_1",
      ],
    ]
  );
  assert.deepEqual(
    (await client().campaign("cmp_2").subsequences.list()).items,
    []
  );
});

test("lead lists report their size and list their own leads", async () => {
  const outbound = client();
  assert.deepEqual(
    (await outbound.lists.list()).items.map((list) => [
      list.sourceId,
      list.name,
      list.kind,
      list.size,
    ]),
    [
      ["list_1", "Founders", "leads", 2],
      ["list_2", "list_2", "leads", 1],
    ]
  );
  assert.deepEqual(
    (await outbound.list("list_2").leads.listAll().toArray()).map(
      (lead) => lead.sourceId
    ),
    ["lead_2"]
  );
  assert.deepEqual(
    (await outbound.leads.list({ listId: "memory:client-a:list_1" })).items.map(
      (lead) => lead.sourceId
    ),
    ["lead_1", "lead_2"]
  );
});

test("leads cannot be listed by campaign and by list at once", async () => {
  await assert.rejects(
    async () =>
      await client().leads.list({ campaignId: "cmp_1", listId: "list_1" }),
    (error) => OutboundError.is(error) && error.code === "Invalid"
  );
});

test("a lead carries its engagement counts, interest and tags", async () => {
  const lead = await client().leads.get("lead_1");
  assert.deepEqual(lead.engagement, {
    clicks: 1,
    lastContactedAt: null,
    lastOpenedAt: null,
    lastRepliedAt: null,
    opens: 3,
    replies: 2,
    stepIndex: 1,
  });
  assert.equal(lead.interest, "Meeting Booked");
  assert.deepEqual(lead.tags, ["vip"]);
  const plain = await client().leads.get("lead_2");
  assert.equal(plain.engagement, null);
  assert.equal(plain.interest, null);
  assert.deepEqual(plain.tags, []);
});

test("the block list, tags and webhooks are listed and normalized", async () => {
  const outbound = client();
  assert.deepEqual(
    (await outbound.blocklist.list()).items.map((entry) => [
      entry.kind,
      entry.value,
    ]),
    [
      ["email", "blocked@example.com"],
      ["domain", "example.org"],
      ["linkedin", "https://www.linkedin.com/in/x"],
    ]
  );
  assert.deepEqual(
    (await outbound.tags.list()).items.map((tag) => [
      tag.name,
      tag.description,
    ]),
    [["vip", "High value"]]
  );
  assert.deepEqual(
    (await outbound.webhooks.list()).items.map((hook) => [
      hook.sourceId,
      hook.url,
      hook.active,
      hook.campaignRefs,
      hook.events,
      hook.name,
    ]),
    [
      [
        "wh_1",
        "https://hooks.example.com/a",
        true,
        [],
        ["reply_received"],
        null,
      ],
      [
        "wh_2",
        "https://hooks.example.com/b",
        false,
        ["memory:client-a:cmp_1"],
        [],
        "Campaign hook",
      ],
    ]
  );
  assert.deepEqual(
    (await outbound.campaign("cmp_1").webhooks.list()).items.map(
      (hook) => hook.sourceId
    ),
    ["wh_2"]
  );
});

test("a thread returns its own messages, oldest first", async () => {
  const thread = await client().thread("t1").messages();
  assert.deepEqual(
    thread.items.map((message) => message.sourceId),
    ["m1", "m2"]
  );
  assert.equal(thread.complete, true);
});

test("each new read is refused as Unsupported before the adapter is asked", async () => {
  const off = client({
    blocklist: false,
    "campaigns.settings": false,
    "lists.leads": false,
    "lists.list": false,
    "messages.byThread": false,
    "senders.health": false,
    "sequence.subsequences": false,
    tags: false,
    "webhooks.list": false,
  });

  const reads = [
    () => off.blocklist.list(),
    () => off.campaign("cmp_1").settings(),
    () => off.list("list_1").leads.list(),
    () => off.lists.list(),
    () => off.thread("t1").messages(),
    () => off.sender("snd_1").health(),
    () => off.campaign("cmp_1").subsequences.list(),
    () => off.tags.list(),
    () => off.webhooks.list(),
    () => off.campaign("cmp_1").webhooks.list(),
  ];

  for (const read of reads) {
    // oxlint-disable-next-line no-await-in-loop -- one assertion at a time keeps the failure readable.
    await assert.rejects(async () => await read(), unsupported);
  }
});

test("an adapter that declares a read but does not implement it fails as Unsupported", async () => {
  const {
    getCampaignSettings: _settings,
    listTags: _tags,
    ...rest
  } = memory({
    data: DATA,
  });

  const outbound = createOutbound({ adapter: rest });
  await assert.rejects(
    async () => await outbound.campaign("cmp_1").settings(),
    unsupported
  );
  await assert.rejects(async () => await outbound.tags.list(), unsupported);
});

test("a combined instance routes lookups by ref and walks listings across members", async () => {
  const outbound = createOutbound({
    adapter: combine([
      memory({ data: DATA, workspaceId: "client-a" }),
      memory({
        data: {
          campaigns: [{ id: "cmp_9", settings: { dailyLimit: 7 } }],
          leads: [{ id: "lead_9", listIds: ["list_9"] }],
          lists: [{ id: "list_9" }],
          senders: [{ address: "b@example.net", id: "snd_9" }],
          tags: [{ id: "tag_9" }],
          webhooks: [{ id: "wh_9", url: "https://hooks.example.com/z" }],
        },
        workspaceId: "client-b",
      }),
    ]),
  });

  assert.equal(
    (await outbound.campaign("memory:client-b:cmp_9").settings()).dailyLimit,
    7
  );
  assert.equal(
    (await outbound.sender("memory:client-b:snd_9").health()).domain,
    "example.net"
  );
  assert.deepEqual(
    (await outbound.lists.listAll().toArray()).map((list) => list.ref),
    [
      "memory:client-a:list_1",
      "memory:client-a:list_2",
      "memory:client-b:list_9",
    ]
  );
  assert.deepEqual(
    (await outbound.tags.listAll().toArray()).map((tag) => tag.ref),
    ["memory:client-a:tag_1", "memory:client-b:tag_9"]
  );
  assert.equal((await outbound.blocklist.listAll().toArray()).length, 3);
  assert.deepEqual(
    (await outbound.webhooks.listAll().toArray()).map((hook) => hook.sourceId),
    ["wh_1", "wh_2", "wh_9"]
  );
  assert.deepEqual(
    (
      await outbound.campaign("memory:client-a:cmp_1").webhooks.list()
    ).items.map((hook) => hook.sourceId),
    ["wh_2"]
  );
  assert.deepEqual(
    (
      await outbound.campaign("memory:client-a:cmp_1").subsequences.list()
    ).items.map((item) => item.sourceId),
    ["sub_1"]
  );
  assert.deepEqual(
    (
      await outbound.list("memory:client-b:list_9").leads.listAll().toArray()
    ).map((lead) => lead.ref),
    ["memory:client-b:lead_9"]
  );
  await assert.rejects(
    async () => await outbound.thread("t1").messages(),
    unsupported
  );
});
