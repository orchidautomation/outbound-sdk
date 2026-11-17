// OUT-142: on an Instantly workspace shaped like the live one (303 mailboxes
// on 137 domains, 7 of them failing and listed past the first 200), the
// sender checks used to cover a subset: deliverability_check checked 10 in
// full and sender_health counted the first 100 to 200 senders, so it found
// none of the failing ones. Now every sender is checked, the coverage says
// so, and each failing mailbox carries the active campaigns it sends for,
// its recent sends and when it last sent. A value the vendor does not
// report is null with a reason, never 0.

import assert from "node:assert/strict";
import { test } from "node:test";

import type { Outbound } from "../src/index.ts";
import { createTools } from "../src/tools/index.ts";
import { harness } from "./helpers/adapter-suite.ts";
import { fixture } from "./helpers/fixtures.ts";
import { json } from "./helpers/http.ts";
import type { RecordedRequest } from "./helpers/http.ts";
import { suite as heyreachSuite } from "./heyreach/suite.ts";
import { suite } from "./instantly/suite.ts";

const MAILBOXES = 303;
const DOMAINS = 137;

/** Six connection errors and one sending error, all past the first 200. */
const FAILING = new Map([
  [210, -1],
  [222, -1],
  [240, -1],
  [251, -1],
  [266, -1],
  [280, -1],
  [295, -3],
]);

const ACTIVE_CAMPAIGN = "01a1d77f-5e23-7a9a-9112-a6f7089f329f";
const DAY_MS = 86_400_000;

const dayAgo = (days: number) =>
  new Date(Date.now() - days * DAY_MS).toISOString().slice(0, 10);

const {
  items: [template],
} = fixture("instantly", "listAccounts.json") as {
  items: Record<string, unknown>[];
};

const address = (index: number) =>
  `person${index + 1}@d${index % DOMAINS}.example.com`;

const mailboxes = Array.from({ length: MAILBOXES }, (_, index) => ({
  ...template,
  email: address(index),
  status: FAILING.get(index) ?? 1,
  status_message: null,
}));

const failingAddresses = new Set([...FAILING.keys()].map(address));

const page = (url: URL) => {
  const limit = Number(url.searchParams.get("limit") ?? 100);
  const after = url.searchParams.get("starting_after");

  const start =
    after === null
      ? 0
      : mailboxes.findIndex((mailbox) => mailbox.email === after) + 1;

  const slice = mailboxes.slice(start, start + limit);

  return json({
    items: slice,
    next_starting_after:
      start + limit < mailboxes.length ? slice.at(-1)?.email : undefined,
  });
};

const bodyOf = (request: RecordedRequest) =>
  JSON.parse(String(request.body ?? "{}")) as {
    accounts?: string[];
    emails?: string[];
  };

const workspace =
  (dailyRows: (email: string) => Record<string, unknown>[]) =>
  (request: RecordedRequest): Response | undefined => {
    const url = new URL(request.url);
    const path = decodeURIComponent(url.pathname);

    if (request.method === "GET" && path === "/api/v2/accounts") {
      return page(url);
    }

    if (path === "/api/v2/accounts/test/vitals") {
      const domains = (bodyOf(request).accounts ?? []).map(
        (email) => email.split("@")[1] ?? ""
      );

      return json({
        failure_list: [],
        status: "success",
        success_list: domains.map((domain) => ({
          allPass: true,
          dkim: true,
          dmarc: true,
          domain,
          indeterminate: [],
          mx: true,
          spf: true,
        })),
      });
    }

    if (path === "/api/v2/accounts/warmup-analytics") {
      return json({
        aggregate_data: Object.fromEntries(
          (bodyOf(request).emails ?? []).map((email) => [
            email,
            { health_score: 90, landed_inbox: 19, landed_spam: 1, sent: 20 },
          ])
        ),
        email_date_data: {},
      });
    }

    if (path.startsWith("/api/v2/account-campaign-mappings/")) {
      return json({
        items: [
          {
            campaign_id: ACTIVE_CAMPAIGN,
            campaign_name: "Active campaign",
            status: 1,
            timestamp_created: "2026-11-01T00:00:00.000Z",
          },
          {
            campaign_id: "01a1d77f-5e23-7a9a-9112-a6f7089f3290",
            campaign_name: "Paused campaign",
            status: 2,
            timestamp_created: "2026-11-02T00:00:00.000Z",
          },
        ],
      });
    }

    if (path === "/api/v2/accounts/analytics/daily") {
      return json(dailyRows(url.searchParams.get("emails") ?? ""));
    }

    return undefined;
  };

const sentEarlier = (email: string) => [
  { date: dayAgo(5), email_account: email, sent: 0 },
  { date: dayAgo(9), email_account: email, sent: 30 },
  { date: dayAgo(10), email_account: email, sent: 25 },
];

const call = async (
  outbound: Outbound,
  name: string,
  input: Record<string, unknown> = {}
) => {
  const tool = createTools(outbound).find(
    (candidate) => candidate.name === name
  );

  assert.ok(tool, `${name} is offered`);
  const result = await tool.call(input);
  assert.ok(result.ok, JSON.stringify(result));

  return result;
};

interface Row {
  readonly address: string | null;
  readonly checked?: boolean;
  readonly impact?: {
    readonly active_campaign_count: number | null;
    readonly active_campaigns: { campaign: string; name: string }[] | null;
    readonly last_authenticated_at: string | null;
    readonly last_sent_on: string | null;
    readonly recent_sends: { sent: number | null } | null;
    readonly unknown: Record<string, string>;
  };
}

test("deliverability_check checks every Instantly mailbox by default and ties each failing one to its active campaigns", async () => {
  const { outbound, requests, settle, unrouted } = harness(
    suite,
    workspace(sentEarlier)
  );

  const result = await settle(call(outbound, "deliverability_check"));

  const data = result.data as unknown as {
    coverage: Record<string, unknown>;
    failing: number;
    senders: Row[];
  };

  assert.deepEqual(unrouted, []);
  assert.deepEqual(data.coverage, {
    checked: 303,
    not_checked: 0,
    not_checked_by_reason: { cap: 0, error: 0, unsupported: 0 },
    screened: 303,
    senders: 303,
  });
  assert.equal(result.meta.complete, true, result.meta.notes.join(" "));
  assert.equal(data.failing, 7);

  const paths = requests.map((request) => new URL(request.url).pathname);
  const count = (path: string) => paths.filter((each) => each === path).length;

  // Health a page at a time: no account read per mailbox, one DNS test and
  // one warmup report per page of 100, where it used to be 3 per mailbox.
  assert.equal(
    paths.filter((path) => /^\/api\/v2\/accounts\/[^/]+@/u.test(path)).length,
    0
  );
  assert.equal(count("/api/v2/accounts/test/vitals"), 4);
  assert.equal(count("/api/v2/accounts/warmup-analytics"), 4);
  assert.ok(result.meta.requests < 100, String(result.meta.requests));

  const failing = data.senders.filter(
    (row) => row.address !== null && failingAddresses.has(row.address)
  );

  assert.equal(failing.length, 7, "every failing mailbox is listed");

  for (const row of failing) {
    assert.equal(row.checked, true);
    assert.equal(row.impact?.active_campaign_count, 1);
    assert.deepEqual(row.impact?.active_campaigns, [
      {
        campaign: `instantly:client-a:${ACTIVE_CAMPAIGN}`,
        name: "Active campaign",
      },
    ]);
    assert.equal(row.impact?.recent_sends?.sent, 55);
    assert.equal(row.impact?.last_sent_on, dayAgo(9));
    assert.equal(row.impact?.last_authenticated_at, null);
    assert.match(
      row.impact?.unknown.last_authenticated_at ?? "",
      /no time of the last successful sign-in/u
    );
  }
});

test("sender_health counts failing mailboxes past the first 200 and leaves unreported sends null, not 0", async () => {
  const { outbound, settle } = harness(
    suite,
    workspace(() => [])
  );

  const result = await settle(call(outbound, "sender_health"));

  const data = result.data as unknown as {
    checked: number;
    failing: number;
    senders: Row[];
    total: number;
    unhealthy: number;
  };

  assert.equal(data.checked, 303);
  assert.equal(data.total, 303);
  assert.equal(data.failing, 7);
  assert.equal(data.unhealthy, 7);

  const first = data.senders.slice(0, 7);
  assert.ok(first.every((row) => failingAddresses.has(row.address ?? "")));

  for (const row of first) {
    assert.equal(row.impact?.recent_sends?.sent, null);
    assert.equal(row.impact?.last_sent_on, null);
    assert.match(
      row.impact?.unknown.recent_sends ?? "",
      /^Unknown: the vendor returned no daily sends/u
    );
  }
});

test("deliverability_check names the senders it did not check and why when a cap stops it", async () => {
  const { outbound, settle } = harness(suite, workspace(sentEarlier));

  const result = await settle(
    call(outbound, "deliverability_check", { max_checked: 150 })
  );

  const data = result.data as unknown as {
    coverage: {
      checked: number;
      not_checked: number;
      not_checked_by_reason: Record<string, number>;
    };
    senders: (Row & { not_checked?: { reason: string } })[];
  };

  assert.equal(data.coverage.checked, 150);
  assert.equal(data.coverage.not_checked, 153);
  assert.equal(data.coverage.not_checked_by_reason.cap, 153);
  assert.equal(result.meta.complete, false);

  const unchecked = data.senders.filter((row) => row.checked === false);
  assert.ok(unchecked.length > 0);
  assert.ok(unchecked.every((row) => row.not_checked?.reason === "cap"));
  // The failing mailboxes sit past the first 150, so they were not checked
  // in full, but the sender list's status still flags and ties them.
  assert.ok(
    data.senders
      .filter((row) => failingAddresses.has(row.address ?? ""))
      .every((row) => row.impact?.active_campaign_count === 1)
  );
});

test("on HeyReach a disconnected LinkedIn seat is checked one at a time and its impact says what HeyReach does not report", async () => {
  const accounts = fixture("heyreach", "listLinkedInAccounts.json") as {
    items: Record<string, unknown>[];
    totalCount: number;
  };

  const status = fixture("heyreach", "getAccountStatus.json") as Record<
    string,
    unknown
  >;

  const { outbound, settle, unrouted } = harness(heyreachSuite, (request) => {
    const { pathname } = new URL(request.url);

    if (pathname === "/api/public/li_account/GetAll") {
      return json({
        ...accounts,
        items: accounts.items.map((item, index) =>
          index === 0 ? { ...item, authIsValid: false } : item
        ),
      });
    }

    // The recorded status is the disconnected seat's; the others are signed in.
    const other = /\/GetAccountStatus\/(?<id>\d+)$/u.exec(pathname)?.groups?.id;

    return other === undefined || other === "1101"
      ? undefined
      : json({
          ...status,
          accountId: Number(other),
          failureReason: null,
          status: "Connected",
        });
  });

  const result = await settle(call(outbound, "deliverability_check"));

  const data = result.data as unknown as {
    coverage: { checked: number; not_checked: number; screened: number };
    failing: number;
    senders: (Row & { sender: string })[];
  };

  assert.deepEqual(unrouted, []);
  assert.equal(data.coverage.checked, data.coverage.screened);
  assert.equal(data.coverage.not_checked, 0);
  assert.ok(data.failing >= 1);

  const seat = data.senders.find((row) => row.sender.endsWith(":1101"));
  assert.ok(seat?.impact, JSON.stringify(data.senders));
  assert.equal(seat.impact.last_authenticated_at, null);
  assert.ok(seat.impact.unknown.last_authenticated_at);
  assert.ok(Array.isArray(seat.impact.active_campaigns));
});
