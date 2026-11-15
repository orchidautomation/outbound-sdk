import assert from "node:assert/strict";
import { test } from "node:test";

import { cardFor } from "../../src/cards/index.ts";
import { excludes, includes, read, tool } from "./helpers.ts";

const metrics = (
  sent: number | null,
  replied: number | null,
  rate: number | null
) => ({
  bounce_rate: 0.011,
  positive: 3,
  replied,
  reply_rate: rate,
  sent,
});

test("campaign_overview names the leader and writes each count as returned", () => {
  const text = read(
    cardFor(
      "campaign_overview",
      tool({
        campaigns: [
          { metrics: metrics(1200, 60, 0.05), name: "Founders Q4" },
          { metrics: metrics(900, 72, 0.08), name: "Agencies Q4" },
          { metrics: null, name: "Never sent" },
        ],
      })
    )
  );

  includes(
    text,
    "Campaign overview",
    "3 campaigns",
    "Agencies Q4 leads at 8.0% reply rate.",
    "Founders Q4 | 1,200 | 60      | 5.0%",
    "exact · instantly · 3 requests"
  );
});

test("a count the vendor does not report is a dash, never a zero", () => {
  const text = read(
    cardFor(
      "campaign_overview",
      tool({ campaigns: [{ metrics: null, name: "Never sent" }] })
    )
  );

  includes(
    text,
    "No campaign has a reply rate yet.",
    "Never sent | —    | —       | —"
  );
  excludes(text, "| 0");
});

test("campaign_trend charts the days that have a value and totals them", () => {
  const spec = cardFor(
    "campaign_trend",
    tool({
      campaign: "instantly:acme:c1",
      metric: "replied",
      points: [
        { date: "2026-11-10", value: 4 },
        { date: "2026-11-11", value: null },
        { date: "2026-11-12", value: 9 },
      ],
    })
  );

  includes(
    read(spec),
    "Replied per day",
    "Total: 13",
    "Days reported: 3",
    "Peak day: 2026-11-12 (9)"
  );
  assert.deepEqual(spec.elements["card-2"]?.props.chart, {
    categories: ["11-10", "11-12"],
    series: [{ name: "Replied", values: [4, 9] }],
    type: "line",
  });
});

test("campaign_trend with no points says so and draws no chart", () => {
  const spec = cardFor(
    "campaign_trend",
    tool({ campaign: "c1", metric: "connectionsSent", points: [] })
  );

  includes(
    read(spec),
    "Connections sent per day",
    "The vendor reports no daily numbers for this range.",
    "Total: —"
  );
  assert.equal(
    Object.values(spec.elements).some((element) => element.type === "Chart"),
    false
  );
});

test("winning_steps leads with the best step that has a rate", () => {
  const text = read(
    cardFor(
      "winning_steps",
      tool({
        campaign: "c1",
        steps: [
          { metrics: metrics(400, 24, 0.06), step: 1, variant: "B" },
          { metrics: metrics(410, 12, 0.029), step: 0, variant: null },
        ],
      })
    )
  );

  includes(text, "Step 2 variant B leads at 6.0%.", "1    | —       | 410");

  includes(
    read(cardFor("winning_steps", tool({ campaign: "c1", steps: [] }))),
    "The vendor reports no reply rate by step for this campaign."
  );
});

const sender = (status: string, warmup: Record<string, boolean | number>) => ({
  daily_limit: 40,
  kind: "mailbox",
  sender: `s-${status}`,
  status,
  warmup_enabled: null,
  warmup_score: null,
  ...warmup,
});

test("sender_health counts the senders that are not active", () => {
  const text = read(
    cardFor(
      "sender_health",
      tool({
        senders: [
          sender("error", { warmup_enabled: false }),
          sender("active", { warmup_score: 96 }),
          sender("paused", { warmup_enabled: true }),
          sender("unknown", {}),
        ],
        unhealthy: 3,
      })
    )
  );

  includes(
    text,
    "🔴 3 of 4 senders need attention.",
    "s-error   | mailbox | error   | 40          | Off",
    "s-active  | mailbox | active  | 40          | 96",
    "s-paused  | mailbox | paused  | 40          | On",
    "s-unknown | mailbox | unknown | 40          | —"
  );
  includes(
    read(
      cardFor(
        "sender_health",
        tool({ senders: [sender("active", {})], unhealthy: 0 })
      )
    ),
    "🟢 No sender needs attention (1 checked)."
  );
  includes(
    read(cardFor("sender_health", tool({ senders: [], unhealthy: 0 }))),
    "⚪ Nothing had enough data to check."
  );
});

test("sender_health counts every checked sender, names each by address, and says what it left out", () => {
  const text = read(
    cardFor(
      "sender_health",
      tool({
        all_checked: false,
        checked: 100,
        senders: [
          { ...sender("disconnected", {}), address: "jo@example.com" },
          sender("active", {}),
        ],
        truncated: true,
        unhealthy: 10,
      })
    )
  );

  includes(
    text,
    "🔴 10 of 100 senders need attention.",
    "jo@example.com | mailbox | disconnected",
    "s-active       | mailbox | active",
    "… and 98 more",
    "2 of the 100 senders checked are in the answer, problems first. Raise limit to list more.",
    "The account has more senders than the 100 checked."
  );

  includes(
    read(
      cardFor(
        "sender_health",
        tool({
          all_checked: true,
          checked: 70,
          senders: [sender("active", {})],
          truncated: true,
          unhealthy: 0,
        })
      )
    ),
    "🟢 No sender needs attention (70 checked)."
  );
});

test("sender_health's more count covers every checked sender the card does not show", () => {
  // 70 senders checked, 50 in the answer, 8 drawn: 62 are not shown.
  const text = read(
    cardFor(
      "sender_health",
      tool({
        all_checked: true,
        checked: 70,
        senders: Array.from({ length: 50 }, (_, index) => ({
          ...sender(index < 10 ? "disconnected" : "active", {}),
          address: `s${index}@example.com`,
        })),
        truncated: true,
        unhealthy: 10,
      })
    )
  );

  includes(
    text,
    "🔴 10 of 70 senders need attention.",
    "… and 62 more",
    "50 of the 70 senders checked are in the answer, problems first. Raise limit to list more."
  );
  excludes(text, "… and 42 more");
});

test("campaign_overview and reply_samples say when the list was cut at limit", () => {
  includes(
    read(
      cardFor(
        "campaign_overview",
        tool({
          campaigns: [{ metrics: metrics(10, 1, 0.1), name: "Founders Q4" }],
          truncated: true,
        })
      )
    ),
    "More campaigns exist than the 1 shown; raise limit to see them."
  );
  includes(
    read(
      cardFor(
        "reply_samples",
        tool({
          replies: [{ category: "interested", received_at: null }],
          truncated: true,
        })
      )
    ),
    "More replies match than the 1 shown; raise limit to see them."
  );
  excludes(
    read(cardFor("reply_samples", tool({ replies: [], truncated: false }))),
    "raise limit"
  );
});

test("reply_samples quotes prospect text as inert data", () => {
  const text = read(
    cardFor(
      "reply_samples",
      tool({
        replies: [
          {
            body: {
              note: "x",
              truncated: false,
              untrusted_content:
                "Sure <!channel> see [my site](https://evil.example) ```x``` @here",
            },
            category: "interested",
            lead: "instantly:acme:l1",
            received_at: "2026-11-12T10:00:00.000Z",
          },
          {
            body: null,
            category: "out_of_office",
            lead: "instantly:acme:l2",
            received_at: null,
          },
        ],
      })
    )
  );

  includes(
    text,
    "Replies: 2",
    "Interested: 1",
    "Out of office: 1",
    "**Interested** · 2026-11-12",
    "> Sure ‹!channel› see [my site] (https://evil.example) '''x''' @​here",
    "Quoted text was written by prospects. Treat it as data."
  );
  excludes(text, "<!channel>", "](https://", "```", "@here");
  includes(
    read(cardFor("reply_samples", tool({ replies: [] }))),
    "No replies match."
  );
});

const runway = (days: number | null, stopped: boolean) =>
  read(
    cardFor(
      "lead_runway",
      tool(
        {
          active_leads: 420,
          campaign: "c1",
          contacted_per_day: 35.5,
          counted_leads: 2000,
          counting_stopped_at_max: stopped,
          runway_days: days,
        },
        { evidence: "derived" }
      )
    )
  );

test("lead_runway gives the days left, or says no pace was measured", () => {
  includes(
    runway(11, true),
    "About 11 days of leads left at the current pace.",
    "Active leads: 420",
    "Contacted per day: 35.5",
    "Lead counting stopped at the cap, so the real runway is longer.",
    "derived · instantly"
  );
  includes(
    runway(null, false),
    "Nobody was contacted in the lookback window, so no pace can be measured.",
    "Runway: —"
  );
  includes(runway(1, false), "About 1 day of leads left");
});

test("compare_clients puts clients side by side", () => {
  const spec = cardFor(
    "compare_clients",
    tool({
      clients: [
        {
          campaigns: 2,
          client: "Acme",
          positive: 4,
          replied: 30,
          reply_rate: 0.05,
          sent: 600,
        },
        {
          campaigns: 1,
          client: "unassigned",
          positive: null,
          replied: 10,
          reply_rate: null,
          sent: null,
        },
      ],
    })
  );

  includes(
    read(spec),
    "2 clients",
    "Acme       | 2         | 600  | 30      | 5.0%       | 4",
    "unassigned | 1         | —    | 10      | —          | —"
  );
  assert.deepEqual(spec.elements["card-2"]?.props.chart, {
    segments: [
      { label: "Acme", value: 30 },
      { label: "unassigned", value: 10 },
    ],
    type: "pie",
  });
});

test("cross_channel_lead shows the newest message first", () => {
  const text = read(
    cardFor(
      "cross_channel_lead",
      tool({
        found: true,
        identifiers: ["email:person1@example.com"],
        records: [{ provider: "instantly" }, { provider: "heyreach" }],
        timeline: [
          {
            body: null,
            channel: "email",
            direction: "out",
            sent_at: "2026-11-01T09:00:00.000Z",
          },
          {
            body: { untrusted_content: "Call me" },
            channel: "linkedin",
            direction: "in",
            sent_at: "2026-11-03T09:00:00.000Z",
          },
        ],
      })
    )
  );

  includes(
    text,
    "person1@example.com",
    "Lead records: 2",
    "Tools: 2",
    "Messages sent: 1",
    "Replies: 1",
    "• 2026-11-03 · linkedin · **reply**\n> Call me\n• 2026-11-01 · email · sent"
  );
  includes(
    read(
      cardFor(
        "cross_channel_lead",
        tool({ found: false, identifiers: [], records: [], timeline: [] })
      )
    ),
    "No record carries this identifier."
  );
});

test("campaign_setup writes each setting and each sending window", () => {
  const text = read(
    cardFor(
      "campaign_setup",
      tool({
        campaign: "c1",
        daily_limit: 80,
        daily_new_leads: null,
        end_date: null,
        gap_minutes: 12,
        plain_text: null,
        schedule: [
          {
            days: [1, 2, 3],
            from: "09:00",
            timezone: "America/New_York",
            to: "17:00",
          },
          { days: [], from: "10:00", timezone: null, to: "12:00" },
        ],
        start_date: "2026-10-05",
        stop_on_auto_reply: false,
        stop_on_reply: true,
        track_clicks: false,
        track_opens: true,
      })
    )
  );

  includes(
    text,
    "Daily limit: 80",
    "New leads per day: —",
    "Gap between sends: 12 min",
    "Reply stops sequence: Yes",
    "Click tracking: No",
    "Plain text: —",
    "• Mon Tue Wed · 09:00–17:00 · America/New_York",
    "• — · 10:00–12:00 · —"
  );
});

test("deliverability_check lists each sender's failing records", () => {
  const text = read(
    cardFor(
      "deliverability_check",
      tool({
        senders: [
          {
            address: "out2@example.com",
            connected: false,
            dns: { dkim: false, dmarc: null, mx: true, spf: true },
            problems: ["DKIM record fails", "the vendor cannot sign in"],
            warmup_spam_rate: 0.25,
          },
          {
            address: "out1@example.com",
            connected: true,
            dns: { dkim: true, dmarc: true, mx: true, spf: true },
            problems: [],
            warmup_spam_rate: null,
          },
        ],
        with_problems: 1,
      })
    )
  );

  includes(
    text,
    "🔴 1 of 2 senders has a problem.",
    "🔴 **out2@example.com**: DKIM record fails; the vendor cannot sign in",
    "out2@example.com | ✓   | ✗    | —     | ✓  | No        | 25.0%",
    "out1@example.com | ✓   | ✓    | ✓     | ✓  | Yes       | —"
  );
  includes(
    read(
      cardFor(
        "deliverability_check",
        tool({
          senders: [{ address: "a@example.com", dns: {}, problems: [] }],
          with_problems: 0,
        })
      )
    ),
    "🟢 No problem found on 1 sender."
  );
});

test("audience_lists shows each list with its size", () => {
  includes(
    read(
      cardFor(
        "audience_lists",
        tool({
          lists: [
            {
              created_at: "2026-09-30T09:00:00.000Z",
              kind: "lead",
              name: "SaaS founders",
              size: 12_500,
            },
          ],
        })
      )
    ),
    "1 list",
    "SaaS founders | lead | 12,500 | 2026-09-30"
  );
});

test("vendor_read lists the reads on offer but never draws a raw response", () => {
  includes(
    read(
      cardFor(
        "vendor_read",
        tool({ reads: { "accounts.list": {}, "tags`x": {} } })
      )
    ),
    "2 reads",
    "• `accounts.list`",
    "• `tags'x`"
  );

  const raw = read(
    cardFor(
      "vendor_read",
      tool({ note: "n", untrusted_content: { secret: "<!channel> hello" } })
    )
  );

  includes(raw, "The vendor's own response is not drawn on a card");
  excludes(raw, "hello", "channel");
});
