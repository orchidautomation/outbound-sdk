import assert from "node:assert/strict";
import { test } from "node:test";

import type { MemoryData } from "../../src/memory/index.ts";
import { NOW, single } from "./helpers.ts";
import { pair, ref, refused } from "./senders-helpers.ts";

const WEEKDAYS = [1, 2, 3, 4, 5];

// NOW is 2026-11-14.
const DATA: MemoryData = {
  campaigns: [
    {
      id: "c1",
      name: "Clean",
      settings: {
        dailyLimit: 80,
        endDate: "2026-12-31",
        gapMinutes: 10,
        schedule: [
          {
            days: WEEKDAYS,
            from: "09:00",
            timezone: "America/New_York",
            to: "17:00",
          },
        ],
        stopOnReply: true,
        trackClicks: false,
        trackOpens: false,
      },
    },
    // A window of 90 minutes, and no sender to compare its limit with.
    {
      id: "c4",
      name: "Short",
      settings: {
        dailyLimit: 20,
        schedule: [
          { days: [1, 2, 3], from: "22:00", timezone: "UTC", to: "23:30" },
        ],
      },
    },
    { id: "c3", name: "Bare" },
    {
      id: "c2",
      name: "Risky",
      settings: {
        dailyLimit: 150,
        endDate: "2026-11-01",
        gapMinutes: 2,
        schedule: [{ days: [0, 1, 2, 3, 4, 5, 6], from: "06:00", to: "20:30" }],
        stopOnReply: false,
        trackClicks: true,
        trackOpens: true,
      },
    },
    // 22:00 to 06:00 runs past midnight: 8 hours. The second window has no hours.
    {
      id: "c5",
      name: "Night",
      settings: {
        dailyLimit: 10,
        schedule: [
          { days: [2], from: "22:00", timezone: "UTC", to: "06:00" },
          { days: [3], timezone: "UTC" },
        ],
      },
    },
    {
      id: "c6",
      name: "On hold",
      settings: {
        dailyLimit: 12,
        endDate: "2026-01-01",
        schedule: [{ days: [1], from: "09:00", timezone: "UTC", to: "12:00" }],
        stopOnReply: false,
      },
      status: "paused",
    },
  ],
  senders: [
    { address: "a@example.com", campaignIds: ["c1", "c2"], id: "a" },
    { address: "b@example.com", campaignIds: ["c1", "c2"], id: "b" },
  ],
};

const checks = (data: {
  campaigns: readonly {
    name: string;
    findings: readonly { check: string }[];
  }[];
}) =>
  Object.fromEntries(
    data.campaigns.map((campaign) => [
      campaign.name,
      campaign.findings.map((finding) => finding.check),
    ])
  );

/** The checks flagged per campaign name, under the given thresholds. */
const audit = async (input: Record<string, number>) =>
  checks((await single(DATA).insights.settingsAudit(input, { now: NOW })).data);

test("settings_audit lists each campaign's risky settings, the most serious first", async () => {
  const result = await single(DATA).insights.settingsAudit({}, { now: NOW });
  const { data } = result;

  assert.equal(result.insight, "settings_audit");
  assert.deepEqual(
    data.campaigns.map((campaign) => [campaign.campaign, campaign.status]),
    [
      [ref("c2"), "active"],
      [ref("c3"), "active"],
      [ref("c4"), "active"],
    ]
  );
  assert.deepEqual(data.campaigns[0]?.findings, [
    {
      check: "limit_over_senders",
      // 2 senders at 50 a day each.
      finding:
        "The daily limit of 150 is over 50 a day for each of its 2 senders (100).",
      severity: "high",
      value: 150,
    },
    {
      check: "end_date_passed",
      finding: "The campaign is active but its end date 2026-11-01 has passed.",
      severity: "high",
      value: "2026-11-01",
    },
    {
      check: "reply_does_not_stop",
      finding: "A lead who replies keeps getting the next steps.",
      severity: "high",
      value: null,
    },
    {
      check: "window_long",
      // 06:00 to 20:30.
      finding: "A sending window is 14.5 hours long, over 12.",
      severity: "medium",
      value: 14.5,
    },
    {
      check: "gap_short",
      finding: "Sends are 2 minutes apart, under 5.",
      severity: "medium",
      value: 2,
    },
    {
      check: "open_tracking",
      finding: "Open tracking is on, a deliverability risk.",
      severity: "medium",
      value: null,
    },
    {
      check: "click_tracking",
      finding:
        "Click tracking is on; it rewrites links, a deliverability risk.",
      severity: "medium",
      value: null,
    },
    {
      check: "weekend",
      finding: "A sending window includes Saturday or Sunday.",
      severity: "low",
      value: "0,1,2,3,4,5,6",
    },
    {
      check: "no_timezone",
      finding: "A sending window has no timezone.",
      severity: "low",
      value: null,
    },
  ]);
  assert.deepEqual(data.campaigns[1]?.findings, [
    {
      check: "no_window",
      finding:
        "No sending window is set or reported, so it can send at any hour.",
      severity: "medium",
      value: null,
    },
    {
      check: "no_daily_limit",
      finding: "No daily limit is set or reported.",
      severity: "medium",
      value: null,
    },
  ]);
  assert.deepEqual(data.campaigns[2]?.findings, [
    {
      check: "window_short",
      finding: "A sending window is 1.5 hours long, under 2.",
      severity: "low",
      value: 1.5,
    },
  ]);
  assert.deepEqual(data.byCheck, {
    click_tracking: 1,
    end_date_passed: 1,
    gap_short: 1,
    limit_over_senders: 1,
    no_daily_limit: 1,
    no_timezone: 1,
    no_window: 1,
    open_tracking: 1,
    reply_does_not_stop: 1,
    weekend: 1,
    window_long: 1,
    window_short: 1,
  });
  assert.deepEqual(data.totals, {
    campaigns: 5,
    // Clean and Night.
    clean: 2,
    high: 3,
    low: 3,
    medium: 6,
    withFindings: 3,
  });
  assert.equal(result.meta.complete, true);
  assert.deepEqual(result.meta.notes, []);
});

test("settings_audit skips a setting the vendor does not report", async () => {
  const { data } = await single(DATA).insights.settingsAudit({}, { now: NOW });

  // Bare reports no tracking, stop rule, gap or end date: none of them is flagged.
  assert.deepEqual(checks(data).Bare, ["no_window", "no_daily_limit"]);
  // Night's second window has no hours, so it has no length to judge.
  assert.equal(checks(data).Night, undefined);
});

test("settings_audit flags a passed end date only on an active campaign", async () => {
  const { data } = await single(DATA).insights.settingsAudit(
    { statuses: ["paused"] },
    { now: NOW }
  );

  assert.deepEqual(checks(data), { "On hold": ["reply_does_not_stop"] });
  assert.equal(data.totals.campaigns, 1);

  // The day before the end date, Risky is still inside its dates.
  const before = await single(DATA).insights.settingsAudit(
    {},
    { now: Date.parse("2026-10-31T12:00:00.000Z") }
  );

  assert.equal(before.data.byCheck.end_date_passed, 0);

  const onTheDay = await single(DATA).insights.settingsAudit(
    {},
    { now: Date.parse("2026-11-01T23:00:00.000Z") }
  );

  assert.equal(onTheDay.data.byCheck.end_date_passed, 0);
});

test("settings_audit moves findings with each threshold", async () => {
  // 150 for 2 senders is exactly 75 each; 80 for 2 senders is over 30 each.
  assert.ok(
    !(await audit({ max_daily_limit_per_sender: 75 })).Risky?.includes(
      "limit_over_senders"
    )
  );
  assert.deepEqual((await audit({ max_daily_limit_per_sender: 30 })).Clean, [
    "limit_over_senders",
  ]);

  assert.ok(
    !(await audit({ min_gap_minutes: 1 })).Risky?.includes("gap_short")
  );
  assert.deepEqual((await audit({ min_gap_minutes: 15 })).Clean, ["gap_short"]);

  assert.ok(
    !(await audit({ max_window_hours: 15 })).Risky?.includes("window_long")
  );

  // Clean and Night both have 8-hour windows.
  const narrow = await audit({ max_window_hours: 7 });
  assert.deepEqual(narrow.Clean, ["window_long"]);
  assert.deepEqual(narrow.Night, ["window_long"]);

  assert.equal((await audit({ min_window_hours: 1 })).Short, undefined);
  assert.deepEqual((await audit({ min_window_hours: 9 })).Clean, [
    "window_short",
  ]);
});

test("settings_audit leaves the sender comparison out when a campaign's senders cannot be listed", async () => {
  const result = await single(DATA, {
    "senders.byCampaign": false,
  }).insights.settingsAudit({}, { now: NOW });

  assert.equal(result.data.byCheck.limit_over_senders, 0);
  assert.equal(result.data.totals.high, 2);
  assert.deepEqual(result.meta.notes, [
    "The daily limit was not compared with the sender count: the adapter cannot list a campaign's senders.",
  ]);
});

test("settings_audit has nothing to report with no campaigns, and says so when a cap cuts a read", async () => {
  const empty = await single({}).insights.settingsAudit({});

  assert.deepEqual(empty.data.campaigns, []);
  assert.deepEqual(empty.data.totals, {
    campaigns: 0,
    clean: 0,
    high: 0,
    low: 0,
    medium: 0,
    withFindings: 0,
  });
  assert.equal(empty.data.byCheck.no_window, 0);
  assert.equal(empty.meta.complete, true);

  const fewCampaigns = await single(DATA).insights.settingsAudit(
    { max_campaigns: 2 },
    { now: NOW }
  );

  assert.equal(fewCampaigns.data.totals.campaigns, 2);
  assert.deepEqual(checks(fewCampaigns.data), { Short: ["window_short"] });
  assert.equal(fewCampaigns.meta.complete, false);

  // With one sender counted, Clean's 80 is over 50 and the answer is partial.
  const fewSenders = await single(DATA).insights.settingsAudit(
    { max_senders_per_campaign: 1 },
    { now: NOW }
  );

  assert.deepEqual(checks(fewSenders.data).Clean, ["limit_over_senders"]);
  assert.equal(fewSenders.meta.complete, false);
});

test("settings_audit is refused when the adapter cannot read campaign settings", async () => {
  await refused(
    () =>
      single(DATA, { "campaigns.settings": false }).insights.settingsAudit({}),
    "campaigns.settings"
  );
});

test("settings_audit ranks campaigns of two tools together", async () => {
  const outbound = pair(
    {
      campaigns: [
        {
          id: "c1",
          name: "Mail",
          settings: {
            dailyLimit: 30,
            schedule: [
              { days: WEEKDAYS, from: "09:00", timezone: "UTC", to: "17:00" },
            ],
            trackOpens: true,
          },
        },
      ],
    },
    {
      campaigns: [
        {
          channel: "linkedin",
          id: "c1",
          name: "Seats",
          settings: {
            dailyLimit: 40,
            schedule: [
              { days: WEEKDAYS, from: "09:00", timezone: "UTC", to: "17:00" },
            ],
            stopOnReply: false,
          },
        },
      ],
      senders: [
        {
          campaignIds: ["c1"],
          id: "seat",
          linkedinUrl: "https://www.linkedin.com/in/seat-1",
        },
      ],
    }
  );

  const { data } = await outbound.insights.settingsAudit(
    { max_daily_limit_per_sender: 25 },
    { now: NOW }
  );

  assert.deepEqual(
    data.campaigns.map((campaign) => [
      campaign.campaign,
      campaign.findings.map((finding) => finding.check),
    ]),
    [
      // 40 a day on 1 seat is over 25. The mail campaign has no sender to compare.
      ["lntool:agency:c1", ["limit_over_senders", "reply_does_not_stop"]],
      ["mailtool:agency:c1", ["open_tracking"]],
    ]
  );
  assert.equal(data.totals.high, 2);
  assert.equal(data.totals.medium, 1);
});
