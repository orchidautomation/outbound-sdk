// OUT-142: on an Instantly workspace shaped like the live one (303 mailboxes
// on 137 domains, 7 of them failing and listed past the first 200), the
// sender checks used to cover a subset: deliverability_check checked 10 in
// full and sender_health counted the first 100 to 200 senders, so it found
// none of the failing ones. Now every sender is checked, the coverage says
// so, and each failing mailbox carries the active campaigns it sends for,
// its recent sends and when it last sent. A value the vendor does not
// report is null with a reason, never 0.
//
// OUT-143: the recent sends of every failing mailbox come in one daily read,
// so impact is no longer cut off at 10 failing senders on Instantly.

import assert from "node:assert/strict";
import { test } from "node:test";

import type { Outbound } from "../src/index.ts";
import { createOutbound } from "../src/index.ts";
import { memory } from "../src/memory/index.ts";
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

type Mailbox = Record<string, unknown> & { readonly email: string };

const mailboxesWith = (failing: ReadonlyMap<number, number>): Mailbox[] =>
  Array.from({ length: MAILBOXES }, (_, index) => ({
    ...template,
    email: address(index),
    status: failing.get(index) ?? 1,
    status_message: null,
  }));

const mailboxes = mailboxesWith(FAILING);

const failingAddresses = new Set([...FAILING.keys()].map(address));

const page = (url: URL, boxes: readonly Mailbox[]) => {
  const limit = Number(url.searchParams.get("limit") ?? 100);
  const after = url.searchParams.get("starting_after");

  const start =
    after === null
      ? 0
      : boxes.findIndex((mailbox) => mailbox.email === after) + 1;

  const slice = boxes.slice(start, start + limit);

  return json({
    items: slice,
    next_starting_after:
      start + limit < boxes.length ? slice.at(-1)?.email : undefined,
  });
};

const bodyOf = (request: RecordedRequest) =>
  JSON.parse(String(request.body ?? "{}")) as {
    accounts?: string[];
    emails?: string[];
  };

const workspace =
  (
    dailyRows: (email: string) => Record<string, unknown>[],
    boxes: readonly Mailbox[] = mailboxes
  ) =>
  (request: RecordedRequest): Response | undefined => {
    const url = new URL(request.url);
    const path = decodeURIComponent(url.pathname);

    if (request.method === "GET" && path === "/api/v2/accounts") {
      return page(url, boxes);
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
      return json(url.searchParams.getAll("emails").flatMap(dailyRows));
    }

    return undefined;
  };

const sentEarlier = (email: string) => [
  { date: dayAgo(5), email_account: email, sent: 0 },
  { date: dayAgo(9), email_account: email, sent: 30 },
  { date: dayAgo(10), email_account: email, sent: 25 },
];

const quiet = (email: string) => [
  { date: dayAgo(2), email_account: email, sent: 0 },
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
    readonly activeCampaignCount: number | null;
    readonly activeCampaigns: string[] | null;
    readonly lastAuthenticatedAt: string | null;
    readonly lastSentOn: string | null;
    readonly recentSends: { sent: number | null } | null;
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
    campaigns: Record<string, unknown>[];
    coverage: Record<string, unknown>;
    failing: number;
    senders: Row[];
  };

  assert.deepEqual(unrouted, []);
  // The 7 failing mailboxes share one campaign, so it is listed once.
  assert.deepEqual(data.campaigns, [
    {
      campaign: `instantly:client-a:${ACTIVE_CAMPAIGN}`,
      campaignName: "Active campaign",
      provider: "instantly",
      workspaceId: "client-a",
    },
  ]);
  assert.deepEqual(data.coverage, {
    checked: 303,
    notChecked: 0,
    notCheckedByReason: { cap: 0, error: 0, unsupported: 0 },
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
  // Impact: every failing mailbox's days in one read, and the workspace's
  // tracking once, where each mailbox used to read both for itself.
  assert.equal(count("/api/v2/accounts/analytics/daily"), 1);
  assert.equal(count("/api/v2/campaigns/analytics"), 1);
  assert.equal(
    paths.filter((path) =>
      path.startsWith("/api/v2/account-campaign-mappings/")
    ).length,
    7
  );
  // What is left per failing mailbox is its campaigns: the mapping and, on
  // this fixture, the two reads of their tags. It used to be six or more.
  assert.ok(result.meta.requests < 50, String(result.meta.requests));

  const failing = data.senders.filter(
    (row) => row.address !== null && failingAddresses.has(row.address)
  );

  assert.equal(failing.length, 7, "every failing mailbox is listed");

  for (const row of failing) {
    assert.equal(row.checked, true);
    assert.equal(row.impact?.activeCampaignCount, 1);
    assert.deepEqual(row.impact?.activeCampaigns, [
      `instantly:client-a:${ACTIVE_CAMPAIGN}`,
    ]);
    assert.equal(row.impact?.recentSends?.sent, 55);
    assert.equal(row.impact?.lastSentOn, dayAgo(9));
    assert.equal(row.impact?.lastAuthenticatedAt, null);
    assert.match(
      row.impact?.unknown.lastAuthenticatedAt ?? "",
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
    assert.equal(row.impact?.recentSends?.sent, null);
    assert.equal(row.impact?.lastSentOn, null);
    assert.match(
      row.impact?.unknown.recentSends ?? "",
      /^Unknown: the vendor returned no daily sends/u
    );
  }
});

test("sender_health ties all 20 failing mailboxes to their sends in one daily read, past the old cap of 10", async () => {
  const twenty = new Map(
    Array.from({ length: 20 }, (_, index) => [index * 15, -1] as const)
  );

  const { outbound, requests, settle } = harness(
    suite,
    workspace(sentEarlier, mailboxesWith(twenty))
  );

  const result = await settle(call(outbound, "sender_health"));
  const data = result.data as unknown as { failing: number; senders: Row[] };

  assert.equal(data.failing, 20);
  assert.ok(
    result.meta.notes.every((note) => !note.includes("more have none")),
    result.meta.notes.join(" ")
  );

  const tied = data.senders.filter((row) => row.impact);
  assert.equal(tied.length, 20);
  assert.ok(tied.every((row) => row.impact?.recentSends?.sent === 55));
  assert.ok(tied.every((row) => row.impact?.activeCampaignCount === 1));

  const daily = requests.filter(
    (request) =>
      new URL(request.url).pathname === "/api/v2/accounts/analytics/daily"
  );

  assert.equal(daily.length, 1);
  assert.equal(
    new URL(daily[0]?.url ?? "").searchParams.getAll("emails").length,
    20
  );
});

test("deliverability_check names the senders it did not check and why when a cap stops it", async () => {
  const { outbound, settle } = harness(suite, workspace(sentEarlier));

  const result = await settle(
    call(outbound, "deliverability_check", { max_checked: 150 })
  );

  const data = result.data as unknown as {
    coverage: {
      checked: number;
      notChecked: number;
      notCheckedByReason: Record<string, number>;
    };
    senders: (Row & { notChecked?: { reason: string } })[];
  };

  assert.equal(data.coverage.checked, 150);
  assert.equal(data.coverage.notChecked, 153);
  assert.equal(data.coverage.notCheckedByReason.cap, 153);
  assert.equal(result.meta.complete, false);

  const unchecked = data.senders.filter((row) => row.checked === false);
  assert.ok(unchecked.length > 0);
  assert.ok(unchecked.every((row) => row.notChecked?.reason === "cap"));
  // The failing mailboxes sit past the first 150, so they were not checked
  // in full, but the sender list's status still flags and ties them.
  assert.ok(
    data.senders
      .filter((row) => failingAddresses.has(row.address ?? ""))
      .every((row) => row.impact?.activeCampaignCount === 1)
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
    coverage: { checked: number; notChecked: number; screened: number };
    failing: number;
    senders: (Row & { sender: string })[];
  };

  assert.deepEqual(unrouted, []);
  assert.equal(data.coverage.checked, data.coverage.screened);
  assert.equal(data.coverage.notChecked, 0);
  assert.ok(data.failing >= 1);

  const seat = data.senders.find((row) => row.sender.endsWith(":1101"));
  assert.ok(seat?.impact, JSON.stringify(data.senders));
  assert.equal(seat.impact.lastAuthenticatedAt, null);
  assert.ok(seat.impact.unknown.lastAuthenticatedAt);
  assert.ok(Array.isArray(seat.impact.activeCampaigns));
});

test("impact says why it read nothing where the adapter cannot list a sender's campaigns or stats, and stops at 10 failing senders", async () => {
  const outbound = createOutbound({
    adapter: memory({
      capabilities: { "campaigns.bySender": false, "stats.bySender": false },
      data: {
        senders: Array.from({ length: 12 }, (_, index) => ({
          address: `seat${index + 1}@example.com`,
          id: `s${index + 1}`,
          status: "disconnected" as const,
        })),
      },
    }),
  });

  const result = await call(outbound, "sender_health");
  const data = result.data as unknown as { failing: number; senders: Row[] };

  assert.equal(data.failing, 12);
  assert.equal(data.senders.filter((row) => row.impact).length, 10);
  assert.equal(result.meta.complete, false);
  assert.ok(
    result.meta.notes.some((note) => note.includes("2 more have none")),
    result.meta.notes.join(" ")
  );

  const [first] = data.senders;
  assert.equal(first?.impact?.activeCampaigns, null);
  assert.equal(first?.impact?.activeCampaignCount, null);
  assert.equal(first?.impact?.recentSends, null);
  assert.match(
    first?.impact?.unknown.activeCampaigns ?? "",
    /cannot list a sender's campaigns/u
  );
  assert.match(
    first?.impact?.unknown.recentSends ?? "",
    /no daily stats for a sender/u
  );
});

test("impact keeps the call alive when a read fails or the request cap is reached, and says a quiet sender sent nothing in the window", async () => {
  const failingReads = (request: RecordedRequest) =>
    new URL(request.url).pathname.startsWith(
      "/api/v2/account-campaign-mappings/"
    )
      ? json({ message: "Server error" }, 500)
      : workspace(quiet)(request);

  const { outbound, settle } = harness(suite, failingReads);
  const result = await settle(call(outbound, "sender_health"));
  const [first] = (result.data as unknown as { senders: Row[] }).senders;

  assert.equal(first?.impact?.activeCampaigns, null);
  assert.match(
    first?.impact?.unknown.activeCampaigns ?? "",
    /^Not read: listing its campaigns failed/u
  );
  assert.equal(first?.impact?.recentSends?.sent, 0);
  assert.equal(first?.impact?.lastSentOn, null);
  assert.match(first?.impact?.unknown.lastSentOn ?? "", /^Nothing sent from/u);

  const capped = harness(suite, workspace(sentEarlier));

  const tool = createTools(capped.outbound, { maxRequestsPerToolCall: 6 }).find(
    (candidate) => candidate.name === "sender_health"
  );

  const stopped = await capped.settle(
    tool?.call({}) ?? Promise.reject(new Error("no tool"))
  );

  assert.ok(stopped.ok, JSON.stringify(stopped));

  const rows = (stopped.data as unknown as { senders: Row[] }).senders;
  assert.ok(
    rows.some((row) =>
      Object.values(row.impact?.unknown ?? {}).some((reason) =>
        reason.includes("request cap of this call was reached")
      )
    ),
    JSON.stringify(rows.slice(0, 2))
  );
});
