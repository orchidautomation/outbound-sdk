import assert from "node:assert/strict";
import { test } from "node:test";

import { harness } from "../helpers/adapter-suite.ts";
import { fixture } from "../helpers/fixtures.ts";
import type { RecordedRequest } from "../helpers/http.ts";
import { CAMPAIGN, SENDER, suite } from "./suite.ts";

const pathOf = (request: RecordedRequest): string =>
  `${request.method} ${new URL(request.url).pathname}`;

// Answers one path with `body` and leaves the rest to the fixtures.
const answer =
  (path: string, body: unknown) =>
  (request: RecordedRequest): Response | undefined =>
    new URL(request.url).pathname === path ? Response.json(body) : undefined;

const account = (fields: Record<string, unknown>) => ({
  ...(fixture("instantly", "getAccount.json") as object),
  ...fields,
});

test("instantly: sender health joins the account, its DNS test and its warmup analytics", async () => {
  const { outbound, requests, settle } = harness(suite);
  const health = await settle(outbound.sender(SENDER).health());

  assert.deepEqual(requests.map(pathOf), [
    "GET /api/v2/accounts/person1%40example.com",
    "POST /api/v2/accounts/test/vitals",
    "POST /api/v2/accounts/warmup-analytics",
  ]);
  assert.deepEqual(JSON.parse(requests[1]?.body ?? "{}"), {
    accounts: [SENDER],
  });
  assert.deepEqual(JSON.parse(requests[2]?.body ?? "{}"), {
    emails: [SENDER],
  });
  assert.equal(health.sourceId, SENDER);
  assert.equal(health.senderRef, `instantly:client-a:${SENDER}`);
  assert.equal(health.domain, "example.com");
  assert.equal(health.connected, true, "status 1 is Active");
  assert.equal(health.blacklisted, null, "not reported per mailbox");
  assert.equal(health.checkedAt, null);
  assert.deepEqual(health.dns, {
    dkim: null,
    dmarc: false,
    mx: true,
    spf: true,
  });
  assert.deepEqual(health.warmup, {
    inbox: 13,
    received: 12,
    score: 87,
    sent: 15,
    spam: 2,
  });
  assert.deepEqual(health.issues, [
    "550-5.4.5 Daily user sending limit exceeded. For more information on Gmai",
    "error: data command failed: 550-5.4.5 daily user sending limit exceeded",
  ]);
  assert.deepEqual(Object.keys(health.raw as object), [
    "account",
    "vitals",
    "warmup",
  ]);
});

test("instantly: a failing account status and warmup status are named as issues", async () => {
  const cases = [
    [-1, false, "Connection Error"],
    [-2, null, "Soft Bounce Error"],
    [-3, null, "Sending Error"],
    [2, null, undefined],
  ] as const;

  for (const [status, connected, issue] of cases) {
    const { outbound, settle } = harness(
      suite,
      answer(
        "/api/v2/accounts/person1%40example.com",
        account({ status, status_message: null, warmup_status: -1 })
      )
    );

    const health = await settle(outbound.sender(SENDER).health());
    assert.equal(health.connected, connected, `status ${status}`);
    assert.deepEqual(
      health.issues,
      [issue, "Warmup: Banned"].filter((entry) => entry !== undefined)
    );
  }
});

test("instantly: health with no DNS answer and no warmup traffic reports nothing, not zeros", async () => {
  const { outbound, settle } = harness(suite, (request) => {
    const { pathname } = new URL(request.url);

    if (pathname === "/api/v2/accounts/test/vitals") {
      return Response.json({
        failure_list: [{ domain: "other.example.org", spf: false }],
        success_list: [{ domain: "another.example.org", spf: true }],
      });
    }

    return pathname === "/api/v2/accounts/warmup-analytics"
      ? Response.json({ aggregate_data: {} })
      : undefined;
  });

  const health = await settle(outbound.sender(SENDER).health());
  assert.deepEqual(health.dns, {
    dkim: null,
    dmarc: null,
    mx: null,
    spf: null,
  });
  assert.equal(health.warmup, null);
});

test("instantly: a DNS answer for the mailbox's own domain is found among several", async () => {
  const { outbound, settle } = harness(
    suite,
    answer("/api/v2/accounts/test/vitals", {
      failure_list: [],
      success_list: [
        { dkim: false, domain: "other.example.org" },
        { dkim: true, dmarc: true, domain: "Example.com", mx: true, spf: true },
      ],
    })
  );

  const health = await settle(outbound.sender(SENDER).health());
  assert.deepEqual(health.dns, {
    dkim: true,
    dmarc: true,
    mx: true,
    spf: true,
  });
});

test("instantly: an account payload without an address is still keyed by the id asked for", async () => {
  const { outbound, requests, settle } = harness(
    suite,
    answer("/api/v2/accounts/person1%40example.com", { status: 1 })
  );

  const health = await settle(outbound.sender(SENDER).health());
  assert.equal(health.sourceId, SENDER);
  assert.equal(health.domain, null);
  assert.equal(health.warmup, null);
  assert.deepEqual(JSON.parse(requests[1]?.body ?? "{}"), {
    accounts: [SENDER],
  });
});

test("instantly: lead lists map name and creation time, and have no size", async () => {
  const { outbound, requests, settle } = harness(suite);
  const page = await settle(outbound.lists.list({ limit: 2 }));
  const url = new URL(requests[0]?.url ?? "");
  assert.equal(url.pathname, "/api/v2/lead-lists");
  assert.equal(url.searchParams.get("limit"), "2");
  const [list] = page.items;
  assert.equal(list?.sourceId, "01a1d77f-5e53-7eb1-ad45-7031e944ef51");
  assert.equal(list?.name, "My Lead List");
  assert.equal(list?.createdAt, "2026-10-01T15:00:00.000Z");
  assert.equal(list?.kind, "leads");
  assert.equal(list?.size, null, "the list object has no count");

  await settle(outbound.lists.list({ cursor: page.cursor }));
  assert.equal(
    new URL(requests[1]?.url ?? "").searchParams.get("starting_after"),
    "2026-10-02T15:00:00.000Z"
  );
});

test("instantly: block list entries are a domain or an address, lowercased", async () => {
  const { outbound, requests, settle } = harness(suite);
  const entries = await settle(outbound.blocklist.listAll().toArray());
  assert.equal(
    new URL(requests[0]?.url ?? "").pathname,
    "/api/v2/block-lists-entries"
  );
  assert.deepEqual(
    entries.map((entry) => [entry.kind, entry.value, entry.createdAt]),
    [
      ["domain", "blocked.example.com", "2026-09-01T10:00:00.000Z"],
      ["email", "person9@example.org", "2026-09-02T10:00:00.000Z"],
      ["other", "example.net", "2026-09-03T10:00:00.000Z"],
    ],
    "an entry that does not say is_domain is not guessed"
  );
  assert.equal(entries[0]?.sourceId, "01a1d77f-5e51-7a11-9c3e-5f2b6a000001");
  assert.equal(
    new URL(requests[1]?.url ?? "").searchParams.get("starting_after"),
    "01a1d77f-5e51-7a11-9c3e-5f2b6a000002"
  );
});

test("instantly: tags map label and description", async () => {
  const { outbound, requests, settle } = harness(suite);
  const tags = await settle(outbound.tags.listAll().toArray());
  assert.equal(new URL(requests[0]?.url ?? "").pathname, "/api/v2/custom-tags");
  assert.deepEqual(
    tags.map((tag) => [tag.sourceId, tag.name, tag.description]),
    [
      [
        "01a1d77f-5e57-7861-bab6-41dac7e7804a",
        "Important",
        "Used for marking important items",
      ],
      ["01a1d77f-5e57-7861-bab6-41dac7e7804b", "Warm pool", null],
      [
        "01a1d77f-5e57-7861-bab6-41dac7e7804c",
        "Agency",
        "Campaigns run for agency clients",
      ],
    ]
  );
});

test("instantly: a tag or list without a name falls back to its id", async () => {
  const { outbound, settle } = harness(suite, () =>
    Response.json({ items: [{ id: "nameless" }] })
  );

  assert.equal((await settle(outbound.tags.list())).items[0]?.name, "nameless");
  assert.equal(
    (await settle(outbound.lists.list())).items[0]?.name,
    "nameless"
  );
});

test("instantly: webhooks map url, event, campaign and whether they are active", async () => {
  const { outbound, settle } = harness(suite);
  const hooks = await settle(outbound.webhooks.listAll().toArray());
  const [first, second, third] = hooks;
  assert.equal(first?.sourceId, "01a1d77f-5ea4-7b53-a085-00338a94f591");
  assert.equal(first?.name, "Positive replies");
  assert.equal(first?.url, "https://hooks.example.com/instantly/replies");
  assert.deepEqual(first?.events, ["lead_interested"]);
  assert.equal(first?.campaignRef, `instantly:client-a:${CAMPAIGN}`);
  assert.equal(first?.active, true, "status 1");
  assert.equal(first?.createdAt, "2026-08-01T06:00:00.000Z");

  assert.equal(second?.name, null);
  assert.deepEqual(second?.events, ["all_events"]);
  assert.equal(second?.campaignRef, null, "null means every campaign");
  assert.equal(second?.active, false, "status -1 is disabled after failures");

  assert.deepEqual(
    third?.events,
    [],
    "a custom label webhook has no event type"
  );
  assert.equal(third?.active, null, "no status, no answer");
});

test("instantly: webhooks can be listed for one campaign", async () => {
  const { outbound, requests, settle } = harness(suite);
  await settle(outbound.webhooks.list({ campaignId: CAMPAIGN }));
  const url = new URL(requests[0]?.url ?? "");
  assert.equal(url.pathname, "/api/v2/webhooks");
  assert.equal(url.searchParams.get("campaign"), CAMPAIGN);
});
