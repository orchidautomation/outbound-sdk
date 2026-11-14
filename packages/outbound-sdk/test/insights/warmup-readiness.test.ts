import assert from "node:assert/strict";
import { test } from "node:test";

import type { MemoryData } from "../../src/memory/index.ts";
import { NOW, single } from "./helpers.ts";
import { pair, ref, refused } from "./senders-helpers.ts";

const DATA: MemoryData = {
  senders: [
    {
      address: "ready@example.com",
      dailyLimit: 31,
      health: { dkim: false, mx: false, warmup: { sent: 200, spam: 30 } },
      id: "r1",
      warmup: { enabled: true, score: 95 },
    },
    {
      address: "off@example.com",
      dailyLimit: 32,
      id: "r2",
      warmup: { enabled: false, score: 96 },
    },
    {
      address: "low@example.com",
      dailyLimit: 33,
      id: "r3",
      name: "Low",
      warmup: { enabled: true, score: 72 },
    },
    // No warmup on the sender; the health record carries a score of 93.
    {
      address: "new@example.com",
      dailyLimit: 34,
      health: { warmup: { score: 93, sent: 100, spam: 10 } },
      id: "r4",
    },
    {
      address: "bad@example.com",
      id: "r5",
      status: "paused",
      warmup: { enabled: false, score: 40 },
    },
    {
      health: { spf: false },
      id: "r6",
      linkedinUrl: "https://www.linkedin.com/in/seat-6",
      status: "disconnected",
    },
    { id: "r7", linkedinUrl: "https://www.linkedin.com/in/seat-7" },
    {
      address: "edge@example.com",
      dailyLimit: 38,
      id: "r8",
      warmup: { enabled: true, score: 90 },
    },
  ],
};

const reasons = (data: {
  notReady: readonly { sender: string; reasons: readonly string[] }[];
}) =>
  Object.fromEntries(
    data.notReady.map((sender) => [
      sender.sender.replace("memory:agency:", ""),
      sender.reasons,
    ])
  );

test("warmup_readiness names each sender that is not ready, the one with the most reasons first", async () => {
  const result = await single(DATA).insights.warmupReadiness({}, { now: NOW });
  const { data } = result;

  assert.equal(result.insight, "warmup_readiness");
  assert.deepEqual(
    data.notReady.map((sender) => [sender.sender, sender.reasons]),
    [
      [ref("r5"), ["not_active", "warmup_off", "score_low", "no_daily_limit"]],
      [ref("r2"), ["warmup_off"]],
      [ref("r3"), ["score_low"]],
      [ref("r4"), ["score_unknown"]],
      // A LinkedIn seat is judged on its status only: no score, no limit.
      [ref("r6"), ["not_active"]],
    ]
  );
  assert.deepEqual(data.notReady[0], {
    address: "bad@example.com",
    dailyLimit: null,
    findings: [
      "Status is paused",
      "Warmup is off",
      "Warmup score 40 is under 90",
      "No daily limit is set or reported",
    ],
    kind: "mailbox",
    name: null,
    reasons: ["not_active", "warmup_off", "score_low", "no_daily_limit"],
    score: 40,
    sender: ref("r5"),
    status: "paused",
    warmupEnabled: false,
  });
  assert.deepEqual(data.notReady[2], {
    address: "low@example.com",
    dailyLimit: 33,
    findings: ["Warmup score 72 is under 90"],
    kind: "mailbox",
    name: "Low",
    reasons: ["score_low"],
    score: 72,
    sender: ref("r3"),
    status: "active",
    warmupEnabled: true,
  });
  assert.deepEqual(data.byReason, {
    dns_failing: 0,
    no_daily_limit: 1,
    not_active: 2,
    score_low: 2,
    score_unknown: 1,
    warmup_off: 2,
    warmup_spam_high: 0,
  });
  // r1, r7 and r8: a score of exactly 90 meets the bar.
  assert.equal(data.ready, 3);
  assert.equal(data.total, 8);
  assert.equal(data.linkedinSeats, 2);
  assert.equal(data.healthChecked, false);
  assert.equal(result.meta.complete, true);
});

test("warmup_readiness keeps an unreported score and warmup state as null", async () => {
  const { data } = await single(DATA).insights.warmupReadiness({});
  const fresh = data.notReady.find((sender) => sender.sender === ref("r4"));
  const seat = data.notReady.find((sender) => sender.sender === ref("r6"));

  assert.equal(fresh?.score, null);
  assert.equal(fresh?.warmupEnabled, null);
  assert.deepEqual(fresh?.findings, ["The vendor reports no warmup score"]);
  assert.equal(seat?.kind, "linkedin");
  assert.equal(seat?.address, null);
  assert.deepEqual(seat?.findings, ["Status is disconnected"]);
});

test("warmup_readiness moves senders with the score bar", async () => {
  const strict = await single(DATA).insights.warmupReadiness({ min_score: 97 });

  assert.deepEqual(reasons(strict.data), {
    r1: ["score_low"],
    r2: ["warmup_off", "score_low"],
    r3: ["score_low"],
    r4: ["score_unknown"],
    r5: ["not_active", "warmup_off", "score_low", "no_daily_limit"],
    r6: ["not_active"],
    r8: ["score_low"],
  });
  assert.equal(strict.data.ready, 1);

  const loose = await single(DATA).insights.warmupReadiness({ min_score: 70 });

  assert.equal(reasons(loose.data).r3, undefined);
  assert.equal(loose.data.byReason.score_low, 1);
  assert.equal(loose.data.ready, 4);
});

test("warmup_readiness adds DNS and warmup spam when check_health is on", async () => {
  const checked = await single(DATA).insights.warmupReadiness({
    check_health: true,
  });

  assert.equal(checked.data.healthChecked, true);
  assert.deepEqual(reasons(checked.data), {
    // 30 of 200 warmup emails in spam is 0.15, over 0.1.
    r1: ["dns_failing", "warmup_spam_high"],
    r2: ["warmup_off"],
    r3: ["score_low"],
    r5: ["not_active", "warmup_off", "score_low", "no_daily_limit"],
    // The seat's health is not read, so its failing SPF is not a reason.
    r6: ["not_active"],
  });

  const first = checked.data.notReady.find(
    (sender) => sender.sender === ref("r1")
  );

  assert.deepEqual(first?.findings, [
    "DKIM, MX failing",
    "30 of 200 warmup emails landed in spam (0.15, over 0.1)",
  ]);
  assert.equal(checked.data.byReason.dns_failing, 1);
  assert.equal(checked.data.byReason.warmup_spam_high, 1);
  // r4 takes its score of 93 from the health record, and 10 of 100 is not over 0.1.
  assert.equal(checked.data.ready, 3);

  const strict = await single(DATA).insights.warmupReadiness({
    check_health: true,
    max_spam_rate: 0.05,
  });

  assert.deepEqual(reasons(strict.data).r4, ["warmup_spam_high"]);

  const loose = await single(DATA).insights.warmupReadiness({
    check_health: true,
    max_spam_rate: 0.2,
  });

  assert.deepEqual(reasons(loose.data).r1, ["dns_failing"]);
});

test("warmup_readiness says what it skipped when health cannot be read", async () => {
  const result = await single(DATA, {
    "senders.health": false,
  }).insights.warmupReadiness({ check_health: true });

  assert.equal(result.data.healthChecked, false);
  assert.equal(reasons(result.data).r1, undefined);
  assert.deepEqual(reasons(result.data).r4, ["score_unknown"]);
  assert.deepEqual(result.meta.notes, [
    "DNS records and warmup spam were not checked: the adapter cannot read a sender's health.",
  ]);

  const unasked = await single(DATA, {
    "senders.health": false,
  }).insights.warmupReadiness({});

  assert.deepEqual(unasked.meta.notes, []);
});

test("warmup_readiness has nothing to report with no senders, and says so when the cap cuts the list", async () => {
  const empty = await single({}).insights.warmupReadiness({});

  assert.deepEqual(empty.data, {
    byReason: {
      dns_failing: 0,
      no_daily_limit: 0,
      not_active: 0,
      score_low: 0,
      score_unknown: 0,
      warmup_off: 0,
      warmup_spam_high: 0,
    },
    healthChecked: false,
    linkedinSeats: 0,
    notReady: [],
    ready: 0,
    total: 0,
  });
  assert.equal(empty.meta.complete, true);

  const capped = await single(DATA).insights.warmupReadiness({
    max_senders: 2,
  });

  assert.equal(capped.data.total, 2);
  assert.equal(capped.data.ready, 1);
  assert.equal(capped.meta.complete, false);
});

test("warmup_readiness is refused when the adapter cannot list senders", async () => {
  await refused(
    () => single(DATA, { "senders.list": false }).insights.warmupReadiness({}),
    "senders.list"
  );
});

test("warmup_readiness judges mailboxes and LinkedIn seats of two tools together", async () => {
  const outbound = pair(
    {
      senders: [
        {
          address: "a@example.com",
          dailyLimit: 20,
          id: "a",
          warmup: { enabled: true, score: 55 },
        },
      ],
    },
    {
      senders: [
        {
          id: "seat",
          linkedinUrl: "https://www.linkedin.com/in/seat-1",
          status: "error",
        },
        { id: "ok", linkedinUrl: "https://www.linkedin.com/in/seat-2" },
      ],
    }
  );

  const { data } = await outbound.insights.warmupReadiness({});

  assert.deepEqual(
    data.notReady.map((sender) => [sender.sender, sender.reasons]),
    [
      ["mailtool:agency:a", ["score_low"]],
      ["lntool:agency:seat", ["not_active"]],
    ]
  );
  assert.equal(data.ready, 1);
  assert.equal(data.linkedinSeats, 2);
});
