import assert from "node:assert/strict";
import { mock, test } from "node:test";

import { harness } from "../helpers/adapter-suite.ts";
import { API, CAMPAIGN, KEY, SENDER, suite, urlOf } from "./suite.ts";

const counts = (row: Record<string, unknown> | undefined) => ({
  bounced: row?.bounced,
  clicked: row?.clicked,
  contacted: row?.contacted,
  delivered: row?.delivered,
  opened: row?.opened,
  openedTotal: row?.openedTotal,
  positive: row?.positive,
  replied: row?.replied,
  repliedAuto: row?.repliedAuto,
  sent: row?.sent,
  unsubscribed: row?.unsubscribed,
});

const query = (url: URL) => Object.fromEntries(url.searchParams);

// "Today" for the tests that leave a date out.
const freeze = (now: string): void => {
  mock.timers.enable({ apis: ["Date"], now: new Date(now) });
};

test("smartlead: a campaign's lifetime totals are strings read as counts", async () => {
  const { outbound, requests, settle } = harness(suite);
  const stats = await settle(outbound.campaign(CAMPAIGN).stats());
  const url = urlOf(requests[0]);
  assert.equal(url.pathname, `${API}/campaigns/372/analytics`);
  assert.deepEqual(
    Object.keys(query(url)),
    ["api_key"],
    "no dates, no timezone"
  );
  const [row] = stats.rows;
  assert.equal(row?.scope, "campaign");
  assert.equal(row?.scopeRef, "smartlead:client-a:372");
  assert.equal(row?.sent, 14, '"14"');
  assert.equal(row?.contacted, 10, "unique_sent_count");
  assert.equal(row?.opened, 7, "unique_open_count");
  assert.equal(row?.openedTotal, 14, "open_count");
  assert.equal(row?.clicked, 8, "unique_click_count");
  assert.equal(row?.replied, 4);
  assert.equal(row?.bounced, 0, "a reported zero stays zero");
  assert.equal(row?.positive, null, "this example has no interested count");
  assert.equal(row?.delivered, null, "Smartlead reports no delivered count");
  assert.equal(row?.repliedAuto, null);
  assert.equal(row?.date, null);
  assert.equal(row?.timezone, null);
  assert.equal(row?.evidence, "exact");
});

test("smartlead: each lifetime count is read from its own field", async () => {
  const { outbound, settle } = harness(suite, () =>
    Response.json({
      block_count: "11",
      bounce_count: "12",
      campaign_lead_stats: { completed: 13, interested: 14, total: 15 },
      click_count: "16",
      drafted_count: "17",
      open_count: "18",
      reply_count: "19",
      sent_count: "20",
      sequence_count: "21",
      total_count: "22",
      unique_click_count: "23",
      unique_open_count: "24",
      unique_sent_count: "25",
      unsubscribed_count: "26",
    })
  );

  const [row] = (await settle(outbound.campaign(CAMPAIGN).stats())).rows;
  assert.deepEqual(counts(row), {
    bounced: 12,
    clicked: 23,
    contacted: 25,
    delivered: null,
    opened: 24,
    openedTotal: 18,
    positive: 14,
    replied: 19,
    repliedAuto: null,
    sent: 20,
    unsubscribed: 26,
  });
});

test("smartlead: a campaign's dated totals use time_zone and leave out-of-office replies out", async () => {
  const { outbound, requests, settle } = harness(suite);

  const stats = await settle(
    outbound.campaign(CAMPAIGN).stats({ from: "2025-01-01", to: "2025-01-31" })
  );

  const url = urlOf(requests[0]);
  assert.equal(url.pathname, `${API}/campaigns/372/analytics-by-date`);
  assert.equal(url.searchParams.get("start_date"), "2025-01-01");
  assert.equal(url.searchParams.get("end_date"), "2025-01-31");
  assert.equal(url.searchParams.get("time_zone"), "UTC");
  assert.equal(url.searchParams.get("timezone"), null);
  const [row] = stats.rows;
  assert.deepEqual(counts(row), {
    bounced: 1234,
    clicked: 489,
    contacted: 18_262,
    delivered: null,
    opened: 5133,
    openedTotal: 7420,
    positive: null,
    replied: 1502,
    repliedAuto: null,
    sent: 23_918,
    unsubscribed: 18,
  });
  assert.equal(row?.timezone, "UTC");
  assert.equal(row?.date, null, "a total for the window, not a day");

  const plain = harness(suite, () =>
    Response.json({ reply_count: "31", sent_count: "32" })
  );

  const [older] = (
    await plain.settle(
      plain.outbound
        .campaign(CAMPAIGN)
        .stats({ from: "2025-01-01", to: "2025-01-31" })
    )
  ).rows;

  assert.equal(
    older?.replied,
    31,
    "reply_count when non_ooo_reply_count is absent"
  );
  assert.equal(older?.bounced, null, "a count that is not reported is null");
});

test("smartlead: a campaign's dated totals fill a missing bound and refuse more than 30 days", async () => {
  freeze("2025-03-10T15:00:00Z");

  try {
    const { outbound, requests, settle } = harness(suite);
    await settle(outbound.campaign(CAMPAIGN).stats({ from: "2025-03-01" }));
    await settle(outbound.campaign(CAMPAIGN).stats({ to: "2025-01-31" }));

    assert.deepEqual(
      requests.map((request) => [
        urlOf(request).searchParams.get("start_date"),
        urlOf(request).searchParams.get("end_date"),
      ]),
      [
        ["2025-03-01", "2025-03-10"],
        ["2025-01-01", "2025-01-31"],
      ],
      "a missing end is today, a missing start is 30 days before the end"
    );

    await assert.rejects(
      settle(
        outbound
          .campaign(CAMPAIGN)
          .stats({ from: "2025-01-01", to: "2025-02-01" })
      ),
      { code: "Invalid" }
    );
    await assert.rejects(
      settle(outbound.campaign(CAMPAIGN).stats({ from: "2025-01-01" })),
      { code: "Invalid" }
    );
    assert.equal(requests.length, 2, "refused before any request");
  } finally {
    mock.timers.reset();
  }
});

test("smartlead: workspace totals use timezone and read each field", async () => {
  const { outbound, requests, settle } = harness(suite);

  const stats = await settle(
    outbound.stats({ from: "2025-01-01", to: "2025-06-30" })
  );

  const url = urlOf(requests[0]);
  assert.equal(url.pathname, `${API}/analytics/overall-stats-v2`);
  assert.equal(url.searchParams.get("start_date"), "2025-01-01");
  assert.equal(url.searchParams.get("end_date"), "2025-06-30");
  assert.equal(url.searchParams.get("timezone"), "UTC");
  assert.equal(url.searchParams.get("time_zone"), null);
  const [row] = stats.rows;
  assert.equal(row?.scope, "workspace");
  assert.equal(row?.scopeRef, "smartlead:client-a:client-a");
  assert.equal(row?.sent, 345_805);
  assert.equal(row?.contacted, 299_503, "unique_lead_count");
  assert.equal(row?.replied, 1732);
  assert.equal(row?.bounced, 2015);
  assert.equal(row?.positive, 280);
  assert.equal(row?.timezone, "UTC");

  const distinct = harness(suite, () =>
    Response.json({
      data: {
        overall_stats: {
          bounce_rate: "41.00%",
          bounced: "42",
          open_rate: "43.00%",
          opened: "44",
          positive_replied: 45,
          positive_reply_rate: "46.00%",
          replied: "47",
          reply_rate: "48.00%",
          sent: "49",
          unique_lead_count: "50",
          unique_open_count: "51",
        },
      },
      success: true,
    })
  );

  const [each] = (await distinct.settle(distinct.outbound.stats())).rows;
  assert.deepEqual(counts(each), {
    bounced: 42,
    clicked: null,
    contacted: 50,
    delivered: null,
    opened: 51,
    openedTotal: 44,
    positive: 45,
    replied: 47,
    repliedAuto: null,
    sent: 49,
    unsubscribed: null,
  });
});

test("smartlead: workspace totals without dates ask for everything up to today", async () => {
  freeze("2025-03-10T15:00:00Z");

  try {
    const { outbound, requests, settle } = harness(suite);
    await settle(outbound.stats());
    assert.equal(
      urlOf(requests[0]).searchParams.get("start_date"),
      "2000-01-01"
    );
    assert.equal(urlOf(requests[0]).searchParams.get("end_date"), "2025-03-10");

    const empty = harness(suite, () => Response.json({ data: {}, ok: true }));
    const [row] = (await empty.settle(empty.outbound.stats())).rows;
    assert.equal(row?.sent, null, "nothing reported is null, not zero");

    const broken = harness(suite, () => Response.json([]));

    await assert.rejects(broken.settle(broken.outbound.stats({ retries: 0 })), {
      code: "Provider",
    });
  } finally {
    mock.timers.reset();
  }
});

test("smartlead: daily rows come from the day-wise endpoint, without its bounces", async () => {
  const { outbound, requests, settle } = harness(suite);

  const stats = await settle(
    outbound.stats({ by: "day", from: "2024-01-15", to: "2024-01-16" })
  );

  const url = urlOf(requests[0]);
  assert.equal(url.pathname, `${API}/analytics/day-wise-overall-stats`);
  assert.equal(url.searchParams.get("start_date"), "2024-01-15");
  assert.equal(url.searchParams.get("end_date"), "2024-01-16");
  assert.equal(url.searchParams.get("timezone"), "UTC");
  assert.equal(url.searchParams.get("campaign_ids"), null);
  assert.deepEqual(
    stats.rows.map((row) => [
      row.date,
      row.sent,
      row.openedTotal,
      row.replied,
      row.bounced,
      row.opened,
      row.timezone,
    ]),
    [
      ["2024-01-15", 150, 52, 8, null, null, "UTC"],
      ["2024-01-16", 175, 61, 11, null, null, "UTC"],
    ],
    "the endpoint always reports 0 bounces, so bounced is null"
  );
  assert.equal(stats.meta.evidence, "exact");
});

test("smartlead: a campaign's daily rows filter the same endpoint, 30 days by default", async () => {
  freeze("2025-03-10T15:00:00Z");

  try {
    const { outbound, requests, settle } = harness(suite);

    const stats = await settle(
      outbound.campaign(CAMPAIGN).stats({ by: "day" })
    );

    const url = urlOf(requests[0]);
    assert.equal(url.pathname, `${API}/analytics/day-wise-overall-stats`);
    assert.equal(url.searchParams.get("campaign_ids"), "372");
    assert.equal(url.searchParams.get("start_date"), "2025-02-08");
    assert.equal(url.searchParams.get("end_date"), "2025-03-10");
    assert.equal(stats.rows[0]?.scope, "campaign");
    assert.equal(stats.rows[0]?.scopeRef, "smartlead:client-a:372");
  } finally {
    mock.timers.reset();
  }
});

test("smartlead: step totals take datetimes and return a row per variant", async () => {
  const { outbound, requests, settle } = harness(suite);

  const stats = await settle(
    outbound
      .campaign(CAMPAIGN)
      .stats({ from: "2026-09-01", scope: "step", to: "2026-09-30" })
  );

  const url = urlOf(requests[0]);
  assert.equal(url.pathname, `${API}/campaigns/372/sequence-analytics`);
  assert.equal(url.searchParams.get("start_date"), "2026-09-01T00:00:00.000Z");
  assert.equal(url.searchParams.get("end_date"), "2026-09-30T23:59:59.999Z");
  assert.equal(url.searchParams.get("time_zone"), "UTC");
  assert.equal(stats.rows.length, 1);
  const [row] = stats.rows;
  assert.equal(row?.scope, "step");
  assert.equal(row?.stepIndex, 0, "seq_number 1");
  assert.equal(row?.variantKey, "A");
  assert.deepEqual(counts(row), {
    bounced: 9,
    clicked: 50,
    contacted: null,
    delivered: null,
    opened: null,
    openedTotal: 200,
    positive: 6,
    replied: 14,
    repliedAuto: null,
    sent: 620,
    unsubscribed: 2,
  });
});

test("smartlead: a step without variants returns its total, and steps have no daily rows", async () => {
  freeze("2025-03-10T15:00:00Z");

  try {
    const { outbound, requests, settle } = harness(suite, () =>
      Response.json({
        data: {
          sequences: [
            {
              seq_number: 2,
              total_stats: {
                bounce_count: 61,
                click_count: 62,
                open_count: 63,
                positive_reply_count: 64,
                reply_count: 65,
                sender_bounce_count: 66,
                sent_count: 67,
                skipped_count: 68,
                unsubscribed_count: 69,
              },
              variants: [],
            },
            { total_stats: {}, variants: [] },
          ],
        },
        ok: true,
      })
    );

    const stats = await settle(
      outbound.campaign(CAMPAIGN).stats({ scope: "step" })
    );

    assert.equal(
      urlOf(requests[0]).searchParams.get("start_date"),
      "2000-01-01T00:00:00.000Z"
    );
    assert.equal(
      urlOf(requests[0]).searchParams.get("end_date"),
      "2025-03-10T23:59:59.999Z"
    );
    assert.deepEqual(
      stats.rows.map((row) => [row.stepIndex, row.variantKey]),
      [
        [1, null],
        [null, null],
      ]
    );
    assert.deepEqual(counts(stats.rows[0]), {
      bounced: 61,
      clicked: 62,
      contacted: null,
      delivered: null,
      opened: null,
      openedTotal: 63,
      positive: 64,
      replied: 65,
      repliedAuto: null,
      sent: 67,
      unsubscribed: 69,
    });

    await assert.rejects(
      settle(outbound.campaign(CAMPAIGN).stats({ by: "day", scope: "step" })),
      { code: "Unsupported" }
    );
    assert.equal(requests.length, 1);
  } finally {
    mock.timers.reset();
  }
});

test("smartlead: a mailbox's totals are its row of the per-mailbox list, found by address", async () => {
  freeze("2026-03-10T12:00:00Z");

  try {
    const { outbound, requests, settle } = harness(suite);
    const stats = await settle(outbound.sender(SENDER).stats());

    assert.deepEqual(
      requests.map((request) => urlOf(request).pathname),
      [
        `${API}/email-accounts/123/`,
        `${API}/analytics/mailbox/name-wise-health-metrics`,
      ],
      "the mailbox is read for its address, then the list"
    );
    assert.deepEqual(query(urlOf(requests[1])), {
      api_key: KEY,
      end_date: "2026-03-10",
      start_date: "2000-01-01",
      timezone: "UTC",
    });
    assert.equal(stats.rows.length, 1);
    const [row] = stats.rows;
    assert.equal(row?.scope, "sender");
    assert.equal(row?.scopeRef, "smartlead:client-a:123");
    assert.equal(row?.evidence, "exact");
    assert.equal(row?.date, null);
    assert.deepEqual(counts(row), {
      bounced: 5,
      clicked: null,
      contacted: null,
      delivered: null,
      opened: null,
      openedTotal: 250,
      positive: null,
      replied: 30,
      repliedAuto: null,
      sent: 500,
      unsubscribed: null,
    });

    const dated = harness(suite);
    await dated.settle(
      dated.outbound
        .sender(SENDER)
        .stats({ from: "2026-02-01", to: "2026-02-28" })
    );
    assert.equal(
      urlOf(dated.requests[1]).searchParams.get("start_date"),
      "2026-02-01"
    );
    assert.equal(
      urlOf(dated.requests[1]).searchParams.get("end_date"),
      "2026-02-28"
    );
  } finally {
    mock.timers.reset();
  }
});

test("smartlead: a mailbox the list leaves out has unknown counts, never zeros", async () => {
  const absent = harness(suite, (request) =>
    urlOf(request).pathname.endsWith("/name-wise-health-metrics")
      ? Response.json({ data: { email_health_metrics: [] }, ok: true })
      : undefined
  );

  const stats = await absent.settle(absent.outbound.sender(SENDER).stats());
  assert.equal(stats.rows.length, 1);
  assert.deepEqual(
    Object.values(counts(stats.rows[0])),
    Object.values(counts(stats.rows[0])).map(() => null)
  );

  // A mailbox without an address matches no row either.
  const nameless = harness(suite, (request) =>
    urlOf(request).pathname.endsWith("/email-accounts/123/")
      ? Response.json({ id: 123 })
      : undefined
  );

  const unknown = await nameless.settle(
    nameless.outbound.sender(SENDER).stats()
  );

  assert.equal(unknown.rows[0]?.sent, null);
});

test("smartlead: a mailbox's stats are totals only", async () => {
  const { outbound, requests, settle } = harness(suite);

  await assert.rejects(
    settle(outbound.sender(SENDER).stats({ by: "day", retries: 0 })),
    { code: "Unsupported" }
  );
  assert.equal(requests.length, 0);
});
