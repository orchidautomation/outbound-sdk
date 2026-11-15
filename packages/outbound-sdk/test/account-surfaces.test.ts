import assert from "node:assert/strict";
import { test } from "node:test";

import { run } from "../src/cli/index.ts";
import { createOutbound } from "../src/index.ts";
import { demoData, memory } from "../src/memory/index.ts";
import { createTools } from "../src/tools/index.ts";

const adapter = (capabilities = {}) =>
  memory({
    capabilities,
    data: demoData({ now: "2026-10-08T12:00:00.000Z" }),
    workspaceId: "acme",
  });

const cli = async (...argv: string[]) => {
  const out: string[] = [];

  const code = await run(argv, {
    adapter: adapter(),
    stderr: () => {
      // Errors are asserted through the exit code.
    },
    stdout: (text) => {
      out.push(text);
    },
  });

  return { code, json: () => JSON.parse(out.join("\n")) as never };
};

const call = async (
  name: string,
  input: Record<string, string | number> = {},
  capabilities = {}
) => {
  const tool = createTools(
    createOutbound({ adapter: adapter(capabilities) })
  ).find((candidate) => candidate.name === name);

  assert.ok(tool, `${name} is offered`);

  return await tool.call(input);
};

test("the CLI reads settings, subsequences, health, lists, tags, the block list, webhooks and a thread", async () => {
  const settings = (
    await cli("campaign", "cmp_founders", "--settings")
  ).json() as { dailyLimit: number; schedule: { from: string }[] };

  assert.equal(settings.dailyLimit, 80);
  assert.equal(settings.schedule[0]?.from, "09:00");
  assert.deepEqual(
    (await cli("campaign", "cmp_founders", "--subsequences")).json(),
    []
  );

  const health = (await cli("health", "mbx_2")).json() as {
    dns: { dkim: boolean };
    issues: string[];
  };

  assert.equal(health.dns.dkim, false);
  assert.deepEqual(health.issues, ["DKIM selector not found"]);

  const lists = (await cli("lists")).json() as { name: string; size: number }[];
  assert.deepEqual(
    lists.map((list) => [list.name, list.size]),
    [["SaaS founders", 2]]
  );

  const listLeads = (
    await cli("leads", "--list", "lst_founders", "--limit", "1")
  ).json() as { sourceId: string }[];

  assert.deepEqual(
    listLeads.map((lead) => lead.sourceId),
    ["lead_1"]
  );

  const tags = (await cli("tags")).json() as { name: string }[];
  assert.deepEqual(
    tags.map((tag) => tag.name),
    ["client-a"]
  );

  const blocked = (await cli("blocklist")).json() as { value: string }[];
  assert.deepEqual(
    blocked.map((entry) => entry.value),
    ["competitor.example"]
  );

  const hooks = (await cli("webhooks")).json() as { url: string }[];
  assert.deepEqual(
    hooks.map((hook) => hook.url),
    ["https://hooks.example.com/replies"]
  );
  assert.deepEqual(
    (await cli("webhooks", "--campaign", "cmp_founders")).json(),
    []
  );

  const thread = (await cli("thread", "thr_1", "--bodies")).json() as {
    items: { sourceId: string; bodyText: string | null }[];
  };

  assert.deepEqual(
    thread.items.map((message) => message.sourceId),
    ["msg_1", "msg_2"]
  );
  assert.equal(thread.items[0]?.bodyText, "Hi Alex, saw your launch.");

  const bare = (await cli("thread", "thr_1")).json() as {
    items: { bodyText: string | null }[];
  };

  assert.equal(bare.items[0]?.bodyText, null);
  assert.notEqual((await cli("health")).code, 0, "a sender id is required");
});

test("campaign_setup reports how a campaign is set up to send", async () => {
  const result = await call("campaign_setup", { campaign: "cmp_founders" });
  assert.ok(result.ok, JSON.stringify(result));
  assert.deepEqual(result.data, {
    campaign: "memory:acme:cmp_founders",
    daily_limit: 80,
    daily_new_leads: 30,
    end_date: null,
    gap_minutes: 12,
    plain_text: null,
    schedule: [
      {
        days: [1, 2, 3, 4, 5],
        from: "09:00",
        name: "Weekdays",
        timezone: "America/New_York",
        to: "17:00",
      },
    ],
    start_date: "2026-09-26",
    stop_on_auto_reply: false,
    stop_on_reply: true,
    track_clicks: false,
    track_opens: true,
  });
  assert.equal(result.meta.provider, "memory");
});

test("deliverability_check lists senders with a problem first and computes the warmup spam rate", async () => {
  const result = await call("deliverability_check");
  assert.ok(result.ok, JSON.stringify(result));

  const { senders, with_problems: withProblems } = result.data as {
    senders: {
      address: string;
      problems: string[];
      warmup_spam_rate: number;
      warmup_score: number;
      domain: string;
    }[];
    with_problems: number;
  };

  assert.equal(withProblems, 1);
  assert.deepEqual(
    senders.map((sender) => [
      sender.address,
      sender.problems,
      sender.warmup_spam_rate,
      sender.warmup_score,
    ]),
    [
      [
        "outreach2@example.com",
        ["DKIM record fails", "DKIM selector not found"],
        0.25,
        88,
      ],
      ["outreach1@example.com", [], 0.04, 96],
    ]
  );
  assert.equal(senders[0]?.domain, "example.com");
  assert.equal(result.meta.requests, 1);

  const scoped = await call("deliverability_check", {
    campaign: "cmp_agencies",
  });

  assert.ok(scoped.ok);
  assert.equal((scoped.data as { senders: unknown[] }).senders.length, 1);
});

test("deliverability_check names a lost sign-in and a block listing, and leaves the spam rate null without warmup data", async () => {
  const outbound = createOutbound({
    adapter: memory({
      data: {
        senders: [
          {
            address: "a@example.com",
            health: { blacklisted: true, connected: false },
            id: "s1",
          },
          {
            address: "b@example.com",
            health: { warmup: { inbox: 0, spam: 0 } },
            id: "s2",
          },
        ],
      },
    }),
  });

  const tool = createTools(outbound).find(
    (candidate) => candidate.name === "deliverability_check"
  );

  const result = await tool?.call({});
  assert.ok(result?.ok, JSON.stringify(result));

  const { senders } = result.data as {
    senders: { problems: string[]; warmup_spam_rate: number | null }[];
  };

  assert.deepEqual(senders[0]?.problems, [
    "the vendor cannot sign in to this sender",
    "on a block list",
  ]);
  assert.deepEqual(
    senders.map((sender) => sender.warmup_spam_rate),
    [null, null]
  );
});

test("audience_lists reports each saved list and its size", async () => {
  const result = await call("audience_lists");
  assert.ok(result.ok, JSON.stringify(result));
  assert.deepEqual(result.data, {
    lists: [
      {
        created_at: "2026-09-21T09:00:00.000Z",
        kind: "leads",
        list: "memory:acme:lst_founders",
        name: "SaaS founders",
        size: 2,
      },
    ],
  });
});

test("an account tool is not offered when the adapter cannot answer, and fails as Unsupported for a read only its input asks for", async () => {
  const off = {
    "campaigns.settings": false,
    "lists.list": false,
    "senders.health": false,
  };

  const offered = new Set(
    createTools(createOutbound({ adapter: adapter(off) })).map(
      (tool) => tool.name
    )
  );

  for (const name of [
    "campaign_setup",
    "deliverability_check",
    "audience_lists",
  ]) {
    assert.ok(!offered.has(name), `${name} is left out`);
  }

  // The tool's own reads are available; the one the input adds is not.
  const result = await call(
    "deliverability_check",
    { campaign: "cmp_founders" },
    { "senders.byCampaign": false }
  );

  assert.ok(!result.ok);
  assert.equal(result.error.code, "Unsupported");
});
