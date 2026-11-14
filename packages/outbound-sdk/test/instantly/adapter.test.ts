import assert from "node:assert/strict";
import { test } from "node:test";

import { OutboundError } from "../../src/index.ts";
import { instantly } from "../../src/instantly/index.ts";
import { harness, runAdapterSuite } from "../helpers/adapter-suite.ts";
import { fixture } from "../helpers/fixtures.ts";
import { CAMPAIGN, KEY, LEAD, suite } from "./suite.ts";

runAdapterSuite(suite);

test("instantly: a campaign maps the documented fields", async () => {
  const { outbound, settle } = harness(suite);
  const campaign = await settle(outbound.campaigns.get(CAMPAIGN));
  assert.equal(campaign.sourceId, CAMPAIGN);
  assert.equal(campaign.name, "My First Campaign");
  assert.equal(campaign.status, "active", "status 1 is Active");
  assert.equal(campaign.channel, "email");
  assert.equal(campaign.createdAt, "2026-11-14T00:40:11.043Z");
});

test("instantly: every documented campaign status number maps to a status", async () => {
  const expected = [
    [0, "draft"],
    [1, "active"],
    [2, "paused"],
    [3, "completed"],
    [4, "active"],
    [-99, "paused"],
    [-1, "paused"],
    [-2, "paused"],
    [7, "unknown"],
  ] as const;

  for (const [code, status] of expected) {
    const { outbound, settle } = harness(suite, () =>
      Response.json({
        ...(fixture("instantly", "getCampaign.json") as object),
        status: code,
      })
    );

    const campaign = await settle(outbound.campaigns.get(CAMPAIGN));
    assert.equal(campaign.status, status, `status ${code}`);
    assert.equal(
      (campaign.raw as { status: number }).status,
      code,
      "the original is kept in raw"
    );
  }
});

test("instantly: draft and completed are filtered by Instantly's own status number", async () => {
  const { outbound, requests, settle } = harness(suite);
  await settle(outbound.campaigns.list({ limit: 25, status: "completed" }));
  const url = new URL(requests[0]?.url ?? "");
  assert.equal(url.searchParams.get("status"), "3");
  assert.equal(url.searchParams.get("limit"), "25");

  const before = requests.length;
  await settle(outbound.campaigns.list({ status: "draft" }));
  assert.equal(
    new URL(requests[before]?.url ?? "").searchParams.get("status"),
    "0"
  );
});

test("instantly: active and paused cover several Instantly statuses, so the adapter matches them", async () => {
  const { outbound, requests, settle } = harness(suite);

  const active = await settle(
    outbound.campaigns.listAll({ status: "active" }).toArray()
  );

  assert.deepEqual(
    active.map((campaign) => campaign.name),
    ["My First Campaign", "Second Campaign"],
    "status 1 and status 4 (running subsequences) are both active"
  );

  const listed = requests.filter(
    (request) => new URL(request.url).pathname === "/api/v2/campaigns"
  );

  for (const request of listed) {
    assert.equal(new URL(request.url).searchParams.get("status"), null);
  }

  const paused = await settle(
    outbound.campaigns.listAll({ status: "paused" }).toArray()
  );

  assert.deepEqual(
    paused.map((campaign) => campaign.name),
    ["Third Campaign"],
    "status -1 is Instantly pausing the campaign"
  );
});

test("instantly: a status Instantly does not have makes no request", async () => {
  const { outbound, requests, settle } = harness(suite);

  const archived = await settle(
    outbound.campaigns.list({ status: "archived" })
  );

  assert.deepEqual(archived.items, [], "Instantly has no archived campaigns");
  assert.equal(requests.length, 0);
});

test("instantly: the page size is clamped to the documented maximum of 100", async () => {
  const { outbound, requests, settle } = harness(suite);
  await settle(outbound.campaigns.list({ limit: 500 }));
  assert.equal(
    new URL(requests[0]?.url ?? "").searchParams.get("limit"),
    "100"
  );
});

test("instantly: a sequence comes from the campaign object, with positional variants", async () => {
  const { outbound, requests, settle } = harness(suite);
  const sequence = await settle(outbound.campaign(CAMPAIGN).sequence());
  assert.equal(
    new URL(requests[0]?.url ?? "").pathname,
    `/api/v2/campaigns/${CAMPAIGN}`
  );
  assert.equal(sequence.campaignRef, `instantly:client-a:${CAMPAIGN}`);
  assert.equal(sequence.kind, "main");
  assert.equal(sequence.name, null);
  assert.deepEqual(
    sequence.steps.map((each) => [
      each.index,
      each.parentIndex,
      each.delayDays,
      each.variants.length,
    ]),
    [
      // A campaign's first step goes out at once.
      [0, null, 0, 2],
      // `delay` is the wait before the NEXT email: step 0's 2 days.
      [1, 0, 2, 1],
      // Step 1's delay of 12 hours.
      [2, 1, 0.5, 1],
    ]
  );
  const [step, second] = sequence.steps;
  assert.equal(step?.action, "email");
  assert.equal(second?.variants[0]?.subject, "Following up, {{firstName}}");
  assert.equal(step?.variants[0]?.variantKey, "A");
  assert.equal(step?.variants[0]?.subject, "Hello {{firstName}}");
  assert.equal(
    step?.variants[0]?.body,
    "Hey {{firstName}},<br/><br/>I hope you are doing well."
  );
  assert.equal(step?.variants[0]?.contentHash.length, 32);
});

test("instantly: a mailbox is keyed by its address and carries warmup", async () => {
  const { outbound, requests, settle } = harness(suite);
  const sender = await settle(outbound.senders.get("person1@example.com"));
  assert.equal(
    new URL(requests[0]?.url ?? "").pathname,
    "/api/v2/accounts/person1%40example.com"
  );
  assert.equal(sender.sourceId, "person1@example.com");
  assert.equal(sender.address, "person1@example.com");
  assert.equal(sender.kind, "mailbox");
  assert.equal(sender.name, "Alex Example");
  assert.equal(sender.status, "active", "status 1 is Active");
  assert.equal(sender.dailyLimit, 100);
  assert.deepEqual(sender.warmup, { enabled: true, score: 85 });
});

test("instantly: leads are listed with POST, scoped by campaign in the body", async () => {
  const { outbound, requests, settle } = harness(suite);

  const page = await settle(
    outbound.campaign(CAMPAIGN).leads.list({ limit: 10 })
  );

  assert.equal(requests[0]?.method, "POST");
  assert.deepEqual(JSON.parse(requests[0]?.body ?? "{}"), {
    campaign: CAMPAIGN,
    limit: 10,
  });
  const [lead] = page.items;
  assert.equal(lead?.email, "person1@example.com");
  assert.equal(lead?.firstName, "Alex");
  assert.equal(lead?.lastName, "Example");
  assert.equal(lead?.company, "Example Co");
  assert.equal(lead?.title, "Head of Growth");
  assert.equal(lead?.status, "active", "status 1 is Active");
  assert.equal(lead?.custom.jobTitle, "Head of Growth");
  assert.equal(
    lead?.campaignRef,
    "instantly:client-a:01a1d77f-5158-772f-ad63-67da136d2f76"
  );
  assert.ok(page.cursor, "next_starting_after becomes the cursor");

  await settle(outbound.campaign(CAMPAIGN).leads.list({ cursor: page.cursor }));
  assert.equal(
    (JSON.parse(requests.at(-1)?.body ?? "{}") as { starting_after: string })
      .starting_after,
    "01a1d77f-97f1-710e-940f-6e091b8ab90b"
  );
});

test("instantly: leads have no date filter, so the wrapper filters and says so", async () => {
  const { outbound, settle } = harness(suite);
  const future = await settle(outbound.leads.list({ since: "2030-01-01" }));
  assert.deepEqual(future.items, []);
  assert.equal(future.meta.evidence, "derived");
});

test("instantly: emails use the 20-per-minute lane", async () => {
  const { outbound, settle } = harness(suite);
  await settle(outbound.messages.list());
  const [snapshot] = await outbound.limits();
  assert.deepEqual(
    snapshot?.windows.map((window) => [
      window.lane,
      window.requests,
      window.perMs,
      window.used,
    ]),
    [
      ["default", 100, 1000, 1],
      ["default", 6000, 60_000, 1],
      ["emails", 20, 60_000, 1],
    ]
  );
});

test("instantly: a message maps direction, sender, lead and thread", async () => {
  const { outbound, requests, settle } = harness(suite);

  const page = await settle(
    outbound.messages.list({
      campaignId: CAMPAIGN,
      include: ["body"],
      since: "2026-01-01",
      until: "2026-12-31",
    })
  );

  const url = new URL(requests[0]?.url ?? "");
  assert.equal(url.searchParams.get("campaign_id"), CAMPAIGN);
  assert.equal(
    url.searchParams.get("min_timestamp_created"),
    "2026-01-01T00:00:00.000Z"
  );
  assert.equal(
    url.searchParams.get("max_timestamp_created"),
    "2026-12-31T00:00:00.000Z"
  );
  const [message] = page.items;
  assert.equal(message?.direction, "out", "ue_type 3 is Sent");
  assert.equal(message?.subject, "Re: Your inquiry");
  assert.equal(message?.sentAt, "2026-11-14T00:40:11.109Z");
  assert.equal(
    message?.leadRef,
    "instantly:client-a:01a1d77f-5e65-78a7-8eb0-0216d691e16c"
  );
  assert.equal(message?.threadId, "01a1d77f-5e65-78a7-8eb0-021717740220");
  const [, second] = page.items;
  assert.equal(second?.bodyHtml, "This is a test email.<br/><br/>Second line.");
  assert.equal(second?.bodyText, "This is a test email.\n\nSecond line.");
  assert.equal(
    message?.stepIndex,
    null,
    "a step that is not a whole number is not guessed"
  );
});

test("instantly: a lead's timeline looks up the lead's address once and carries it in the cursor", async () => {
  const { outbound, requests, settle } = harness(suite);
  const timeline = await settle(outbound.lead(LEAD).timeline());
  assert.equal(timeline.items.length, 3);

  const paths = requests.map(
    (request) => `${request.method} ${new URL(request.url).pathname}`
  );

  assert.deepEqual(paths, [
    `GET /api/v2/leads/${LEAD}`,
    "GET /api/v2/emails",
    "GET /api/v2/emails",
  ]);
  assert.equal(
    new URL(requests[1]?.url ?? "").searchParams.get("lead"),
    "person1@example.com"
  );
  assert.equal(
    new URL(requests[2]?.url ?? "").searchParams.get("lead"),
    "person1@example.com"
  );
});

test("instantly: replies are received emails, categorised from the interest status", async () => {
  const cases = [
    [1, "positive", "vendor"],
    [2, "positive", "vendor"],
    [0, "ooo", "vendor"],
    [-1, "negative", "vendor"],
    [-2, "negative", "vendor"],
    [42, "unknown", null],
    [null, "unknown", null],
  ] as const;

  for (const [interest, category, source] of cases) {
    const base = fixture("instantly", "listReplies.page2.json") as {
      items: object[];
    };

    const { outbound, requests, settle } = harness(suite, () =>
      Response.json({
        items: base.items.map((item) => ({ ...item, i_status: interest })),
      })
    );

    const page = await settle(outbound.replies.list());
    assert.equal(
      new URL(requests[0]?.url ?? "").searchParams.get("email_type"),
      "received"
    );
    assert.equal(
      page.items[0]?.category,
      category,
      `i_status ${String(interest)}`
    );
    assert.equal(page.items[0]?.categorySource, source);
    assert.equal(page.items[0]?.direction, "in");
    assert.equal(page.items[0]?.isAuto, false, "is_auto_reply 0");
  }
});

test("instantly: scheduled emails are not messages", async () => {
  const base = fixture("instantly", "listEmails.page2.json") as {
    items: object[];
  };

  const { outbound, settle } = harness(suite, () =>
    Response.json({
      items: base.items.map((item) => ({ ...item, ue_type: 4 })),
    })
  );

  assert.deepEqual((await settle(outbound.messages.list())).items, []);
});

test("instantly: the workspace comes from the key's own workspace", async () => {
  const { outbound, settle } = harness(suite);
  const { items } = await settle(outbound.workspaces.list());
  assert.equal(items[0]?.name, "My Workspace");
  assert.equal(items[0]?.sourceId, "01a1d77f-5e6e-71ef-a479-ca3a5e94107f");
});

test("instantly: an admin key can act as a sub workspace", async () => {
  const sub = {
    ...suite,
    make: () =>
      instantly({
        apiKey: KEY,
        asWorkspace: "ws_sub_1",
        workspaceId: "client-a",
      }),
  };

  const { outbound, requests, settle } = harness(sub);
  await settle(outbound.campaigns.list());
  assert.equal(requests[0]?.headers["x-as-workspace"], "ws_sub_1");
});

test("instantly: a 402 says the plan does not include the endpoint", async () => {
  const { outbound, settle } = harness(suite, () =>
    Response.json(
      {
        error: "Payment Required",
        message: "No active paid plan",
        statusCode: 402,
      },
      { status: 402 }
    )
  );

  await assert.rejects(
    async () => await settle(outbound.campaigns.list()),
    (error) =>
      OutboundError.is(error) &&
      error.code === "Unsupported" &&
      error.status === 402
  );
});

test("instantly: raw reads the vendor API, including its documented POST reads", async () => {
  const { outbound, requests, settle } = harness(suite);
  await settle(outbound.raw.get("/workspaces/current"));
  await settle(
    outbound.raw.request("POST", "/leads/list", { body: { limit: 1 } })
  );
  assert.equal(requests.length, 2);
  await assert.rejects(
    async () => await outbound.raw.request("POST", "/campaigns"),
    (error) => OutboundError.is(error) && error.code === "Unsupported"
  );
});

test("instantly: the key comes from the option or the environment, and is required", () => {
  const previous = process.env.INSTANTLY_API_KEY;
  delete process.env.INSTANTLY_API_KEY;

  try {
    assert.throws(
      () => instantly(),
      (error) =>
        OutboundError.is(error) &&
        error.code === "Unauthorized" &&
        /pass apiKey or set INSTANTLY_API_KEY/u.test(error.message)
    );
    process.env.INSTANTLY_API_KEY = "inst_env_key_0123456789";
    process.env.INSTANTLY_WORKSPACE_ID = "from-env";
    const adapter = instantly();
    assert.deepEqual(adapter.secrets, ["inst_env_key_0123456789"]);
    assert.equal(adapter.workspaceId, "from-env");
  } finally {
    delete process.env.INSTANTLY_WORKSPACE_ID;

    if (previous === undefined) {
      delete process.env.INSTANTLY_API_KEY;
    } else {
      process.env.INSTANTLY_API_KEY = previous;
    }
  }
});

// The documented examples repeat the same number across fields, so these use

// a distinct value per field to pin each mapping to exactly one source field.

test("instantly: a count the response leaves out stays null", async () => {
  const { outbound, settle } = harness(suite, () =>
    Response.json({ emails_sent_count: 5 })
  );

  const [row] = (await settle(outbound.stats())).rows;
  assert.equal(row?.sent, 5);
  assert.equal(row?.replied, null);
  assert.equal(row?.opened, null);
  assert.equal(row?.bounced, null);
});

test("instantly: an HTML body keeps its HTML and gains plain text without the quoted thread", async () => {
  const html =
    "<div>Sounds good &amp; thanks &#8212; let&#x27;s talk.</div><p>Tue works&nbsp;for me.</p>" +
    "<script>track()</script><br/>On Mon, Oct 5, 2026 at 9:00 AM Alex Example wrote:<br/>&gt; Hi there";

  const base = fixture("instantly", "listReplies.page2.json") as {
    items: Record<string, unknown>[];
  };

  const { outbound, settle } = harness(suite, () =>
    Response.json({
      items: base.items.map((item) => ({ ...item, body: { html } })),
    })
  );

  const [reply] = (await settle(outbound.replies.list({ include: ["body"] })))
    .items;

  assert.equal(reply?.bodyHtml, html);
  assert.equal(
    reply?.bodyText,
    "Sounds good & thanks — let's talk.\nTue works for me."
  );
});

test("instantly: a plain-text body loses its quoted lines and its signature marker", async () => {
  const cases = [
    ["Yes please.\n\n> earlier message\n> more of it", "Yes please."],
    ["Call me.\n\n-----Original Message-----\nFrom: someone", "Call me."],
    ["Not now.\nSent from my iPhone", "Not now."],
    ["> only a quote", null],
    ["   ", null],
  ] as const;

  const base = fixture("instantly", "listReplies.page2.json") as {
    items: Record<string, unknown>[];
  };

  for (const [text, expected] of cases) {
    const { outbound, settle } = harness(suite, () =>
      Response.json({
        items: base.items.map((item) => ({ ...item, body: { text } })),
      })
    );

    const [reply] = (await settle(outbound.replies.list({ include: ["body"] })))
      .items;

    assert.equal(reply?.bodyText, expected, JSON.stringify(text));
    assert.equal(reply?.bodyHtml, null);
  }
});

test("instantly: a response that is not an object is a Provider error, not a crash", async () => {
  const { outbound, settle } = harness(suite, () =>
    Response.json(["unexpected"])
  );

  await assert.rejects(
    async () => await settle(outbound.campaigns.get(CAMPAIGN, { retries: 0 })),
    (error) =>
      OutboundError.is(error) &&
      error.code === "Provider" &&
      /returned no object/u.test(error.message)
  );
});

test("instantly: an adapter lists what it has not confirmed against the live API", () => {
  const { outbound } = harness(suite);
  assert.equal(outbound.maturity, "unverified");
  assert.ok(outbound.caveats.length > 0);
  assert.match(outbound.caveats[0] ?? "", /live Instantly workspace/u);
});
