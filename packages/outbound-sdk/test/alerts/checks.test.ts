// Checks written as data (OUT-8): each default check is plain JSON, a
// malformed one is rejected with what to fix, and a broken one fails with the
// numbers that broke it. The expected numbers are worked out in check-data.ts.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { z } from "zod";

import {
  alerts,
  CHECK_METRICS,
  checkRule,
  checkSchema,
  evaluateCheck,
  parseCheck,
  validateCheck,
} from "../../src/alerts/index.ts";
import type { Alert, Check, CheckResult } from "../../src/alerts/index.ts";
import { createOutbound, OutboundError } from "../../src/index.ts";
import { memory } from "../../src/memory/index.ts";
import { C1, C2, DATA, instance, NOW, S2 } from "./check-data.ts";

// The plan's defaults, as someone would store them: JSON text.
const DEFAULTS = {
  blocked: `{ "metric": "blocked_leads", "op": ">", "value": 0 }`,
  bounce: `{ "name": "bounce-spike", "metric": "bounce_rate", "op": ">", "value": 0.03 }`,
  quiet: `{ "metric": "sent", "op": "==", "value": 0, "scope": { "campaign": "${C1}" }, "window": { "days": 7 } }`,
  runway: `{ "metric": "lead_runway_days", "op": "<", "value": 7 }`,
  status: `{ "metric": "sender_status", "op": "!=", "value": "active" }`,
  variable: `{ "metric": "broken_variable_leads", "op": ">", "value": 0 }`,
  waiting: `{ "metric": "positive_reply_waiting_hours", "op": ">", "value": 48 }`,
};

// Read the way a stored check is: parsed JSON, then validated.
const json = (key: keyof typeof DEFAULTS): Check =>
  parseCheck(JSON.parse(DEFAULTS[key]));

const dailyStats = () =>
  instance().stats({
    by: "day",
    from: "2026-11-01",
    scope: "campaign",
    to: "2026-11-13",
  });

const failed = (result: CheckResult) => {
  assert.equal(result.status, "fail", result.reason ?? "no breach");

  return result.breaches;
};

test("every default check is accepted as JSON", () => {
  for (const [key, text] of Object.entries(DEFAULTS)) {
    const validation = validateCheck(JSON.parse(text));

    assert.equal(validation.ok, true, `${key}: ${JSON.stringify(validation)}`);
  }
});

test("bounce rate fails on the row above the threshold, with its counts", async () => {
  const result = evaluateCheck(json("bounce"), await dailyStats(), {
    now: NOW,
  });

  const [breach, ...others] = failed(result);

  // 18 of 200 is 9%. c2's 1 in 100 passes; its 40-send day is below min_sent 50.
  assert.deepEqual(others, []);
  assert.equal(result.check, "bounce-spike");
  assert.equal(breach?.rule, "bounce-spike");
  assert.equal(breach?.subject, C1);
  assert.equal(breach?.day, "2026-11-12");
  assert.equal(breach?.value, 0.09);
  assert.equal(breach?.threshold, 0.03);
  assert.deepEqual(breach?.numbers, { bounced: 18, sent: 200 });
  assert.equal(breach?.message, "bounce_rate is 9%, above 3%");
  // c1's day with no sends has no rate, and c2's small day is too small.
  assert.equal(result.skipped, 2);
});

test("min_sent lets a small row count", async () => {
  const check = { ...json("bounce"), min_sent: 10 };
  const breaches = failed(evaluateCheck(check, await dailyStats()));

  // c2's 10 bounces in 40 sends on 11-01 is 25%.
  assert.deepEqual(
    breaches.map((each) => [each.subject, each.day, each.value]),
    [
      [C2, "2026-11-01", 0.25],
      [C1, "2026-11-12", 0.09],
    ]
  );
});

test("a quiet campaign fails on its silent day inside the window", async () => {
  const stats = await dailyStats();
  const [breach] = failed(evaluateCheck(json("quiet"), stats, { now: NOW }));

  assert.equal(breach?.day, "2026-11-13");
  assert.equal(breach?.value, 0);
  assert.deepEqual(breach?.numbers, { sent: 0 });
  assert.equal(breach?.message, "sent is 0, equal to 0");

  // A one-day window from 11-14 leaves both of c1's days out.
  const today = { ...json("quiet"), window: { days: 1 } };
  const result = evaluateCheck(today, stats, { now: NOW });

  assert.equal(result.status, "pass");
  assert.equal(result.checked, 0);
});

test("a sender that is not active fails with its status", async () => {
  const outbound = instance();

  const [breach, ...others] = failed(
    evaluateCheck(json("status"), await outbound.senders.list())
  );

  assert.deepEqual(others, []);
  assert.equal(breach?.subject, S2);
  assert.equal(breach?.subjectName, "down@example.com");
  assert.equal(breach?.value, "disconnected");
  assert.equal(breach?.threshold, "active");
});

test("a positive reply waiting too long fails with its hours", async () => {
  const answer = await instance().insights.droppedReplies({}, { now: NOW });
  const [breach] = failed(evaluateCheck(json("waiting"), answer));

  // Received 2026-11-11T08:00Z, 76 hours before NOW.
  assert.equal(breach?.value, 76);
  assert.equal(breach?.subjectName, "Rae");
  assert.deepEqual(breach?.numbers, {
    hoursWaiting: 76,
    receivedAt: "2026-11-11T08:00:00.000Z",
    unansweredReplies: 1,
  });
  assert.equal(
    breach?.message,
    "positive_reply_waiting_hours is 76 hours, above 48 hours"
  );

  // Scoped to another person, nothing is measured.
  const other = {
    ...json("waiting"),
    scope: { person: "memory:agency:a1" },
  };

  assert.equal(evaluateCheck(other, answer).status, "pass");
});

test("a short lead runway fails with the leads and the pace behind it", async () => {
  const answer = await instance().insights.pipelineForecast(
    { campaign: C1 },
    { now: NOW }
  );

  const [breach] = failed(evaluateCheck(json("runway"), answer));

  // 30 active leads at 200 contacted over the last 7 days: 30 / (200 / 7).
  assert.equal(breach?.subject, C1);
  assert.equal(breach?.subjectName, "Founders Q4");
  assert.equal(breach?.value, 1.05);
  assert.equal(breach?.numbers.remaining, 30);
  assert.equal(breach?.message, "lead_runway_days is 1.1 days, below 7 days");

  // The answer's `data` alone is read the same way.
  assert.equal(evaluateCheck(json("runway"), answer.data).status, "fail");
});

test("a block-listed lead still in a campaign fails for that campaign", async () => {
  const answer = await instance().insights.suppressionCheck({});
  const [breach, ...others] = failed(evaluateCheck(json("blocked"), answer));

  assert.deepEqual(others, []);
  assert.equal(breach?.subject, C2);
  assert.deepEqual(breach?.numbers, { leadsRead: 2, violations: 1 });
});

test("a broken merge variable fails with the leads it breaks", async () => {
  const answer = await instance().insights.personalizationGaps({
    campaign: C1,
  });

  const [breach, ...others] = failed(evaluateCheck(json("variable"), answer));

  // {{firstName}} is set on every lead; {{company}} on none of the 30.
  assert.deepEqual(others, []);
  assert.equal(breach?.subjectName, "company");
  assert.equal(breach?.value, 30);
  assert.deepEqual(breach?.numbers, {
    leadsAffected: 30,
    leadsRead: 30,
    leadsWithoutValue: 30,
  });
});

const REJECTED: readonly [string, unknown, string, string][] = [
  ["not an object", "bounce_rate > 3%", "", "a check is a JSON object"],
  ["no metric", { op: ">", value: 1 }, "metric", "is required"],
  [
    "a camelCase metric",
    { metric: "bounceRate", op: ">", value: 0.1 },
    "metric",
    "Did you mean bounce_rate?",
  ],
  [
    "an op alias",
    { metric: "sent", op: "=", value: 0 },
    "op",
    "Write == for =",
  ],
  [
    "threshold for value",
    { metric: "sent", op: ">", threshold: 1 },
    "threshold",
    "write value",
  ],
  [
    "a percent for a rate",
    { metric: "bounce_rate", op: ">", value: 3 },
    "value",
    "write 0.03 for 3%",
  ],
  [
    "a string number",
    { metric: "lead_runway_days", op: "<", value: "7" },
    "value",
    "compares a number",
  ],
  [
    "a negative count",
    { metric: "blocked_leads", op: ">", value: -1 },
    "value",
    "never below 0",
  ],
  [
    "an unknown status",
    { metric: "sender_status", op: "==", value: "dead" },
    "value",
    "one of active, disconnected",
  ],
  [
    "an order on a status",
    { metric: "sender_status", op: ">", value: "active" },
    "op",
    "takes == or !=",
  ],
  [
    "a campaign name for a ref",
    { metric: "sent", op: "==", scope: { campaign: "Founders Q4" }, value: 0 },
    "scope.campaign",
    "campaign's ref",
  ],
  [
    "a scope the metric lacks",
    {
      metric: "bounce_rate",
      op: ">",
      scope: { person: "memory:agency:a1" },
      value: 0.1,
    },
    "scope.person",
    "takes client, campaign, sender",
  ],
  [
    "an unknown scope key",
    { metric: "sent", op: "==", scope: { senderId: "s1" }, value: 0 },
    "scope.senderId",
    "write sender",
  ],
  [
    "a window on an insight",
    { metric: "lead_runway_days", op: "<", value: 7, window: { days: 7 } },
    "window",
    "takes no window",
  ],
  [
    "a zero-day window",
    { metric: "sent", op: "==", value: 0, window: { days: 0 } },
    "window.days",
    "at least 1",
  ],
  [
    "min_sent on a count",
    { metric: "sent", min_sent: 10, op: "==", value: 0 },
    "min_sent",
    "only to bounce_rate and reply_rate",
  ],
];

for (const [what, input, at, says] of REJECTED) {
  test(`a check with ${what} is rejected at ${at || "the top"}`, () => {
    const validation = validateCheck(input);

    assert.equal(validation.ok, false);
    assert.ok(
      !validation.ok &&
        validation.issues.some(
          (issue) => issue.path === at && issue.message.includes(says)
        ),
      JSON.stringify(validation)
    );
  });
}

test("a malformed check throws Invalid naming every problem", async () => {
  // A JavaScript caller, or JSON typed as `any`, can pass anything.
  const malformed = {
    metric: "bounce_rate",
    op: "gt",
    value: 5,
  } as unknown as Check;

  assert.throws(
    () => parseCheck(malformed),
    (error: unknown) =>
      OutboundError.is(error) &&
      error.code === "Invalid" &&
      error.message.includes("op: must be one of") &&
      error.message.includes(
        "value: bounce_rate is a fraction from 0 to 1: write 0.05 for 5%"
      )
  );
  const stats = await dailyStats();

  assert.throws(() => evaluateCheck(malformed, stats), OutboundError);
});

test("a check on the wrong read is not checked, and says what to pass", async () => {
  const answer = await instance().insights.suppressionCheck({});
  const result = evaluateCheck(json("runway"), answer);

  assert.equal(result.status, "not_checked");
  assert.match(result.reason ?? "", /pipelineForecast/u);

  const rows = evaluateCheck(json("bounce"), answer);

  assert.equal(rows.status, "not_checked");
  assert.match(rows.reason ?? "", /stats rows/u);
});

test("a check scoped to a client runs only on that client's read", async () => {
  const stats = await dailyStats();
  const check = { ...json("bounce"), scope: { client: "acme" } };

  assert.match(
    evaluateCheck(check, stats).reason ?? "",
    /Pass \{ client: "acme" \}/u
  );
  assert.equal(
    evaluateCheck(check, stats, { client: "globex" }).status,
    "not_checked"
  );
  assert.equal(evaluateCheck(check, stats, { client: "acme" }).status, "fail");
});

test("the schema converts to JSON Schema and lists every metric", () => {
  const schema = z.toJSONSchema(checkSchema) as unknown as {
    properties: { metric: { enum: string[] } };
  };

  assert.deepEqual(schema.properties.metric.enum, Object.keys(CHECK_METRICS));
});

test("a check on records runs as an alert rule", async () => {
  const fired: Alert[] = [];

  const outbound = createOutbound({
    adapter: memory({ data: DATA, workspaceId: "agency" }),
    plugins: [
      alerts({
        notify: (found) => {
          fired.push(...found);
        },
        rules: [checkRule(json("bounce")), checkRule(json("status"))],
      }),
    ],
  });

  await outbound.stats({
    by: "day",
    from: "2026-11-01",
    scope: "campaign",
    to: "2026-11-13",
  });
  await outbound.senders.list();
  await new Promise((resolve) => {
    setImmediate(resolve);
  });

  assert.deepEqual(
    fired.map((alert) => [alert.rule, alert.subject, alert.value]),
    [
      ["bounce-spike", C1, 0.09],
      ["sender_status", S2, "disconnected"],
    ]
  );
});

test("a check on an insight cannot be an alert rule, and says what to call", () => {
  assert.throws(
    () => checkRule(json("runway")),
    (error: unknown) =>
      OutboundError.is(error) &&
      error.code === "Invalid" &&
      error.message.includes(
        "evaluateCheck(check, await outbound.insights.pipelineForecast"
      )
  );
});

test("a sender gone quiet fails on its own row, and scope.sender picks it", async () => {
  // The memory adapter keeps campaign stats only, so two of its daily rows
  // stand in for one sender's, as a tool with stats.bySender returns them.
  const { rows } = await dailyStats();

  const asSender = rows
    .filter((row) => row.scopeRef === C1)
    .map((row) => ({ ...row, scope: "sender" as const, scopeRef: S2 }));

  const quiet = parseCheck({
    metric: "sent",
    op: "==",
    value: 0,
    window: { days: 2 },
  });

  const [breach, ...others] = failed(
    evaluateCheck(quiet, asSender, { now: NOW })
  );

  assert.deepEqual(others, []);
  assert.equal(breach?.subject, S2);
  assert.equal(breach?.day, "2026-11-13");

  const another = { ...quiet, scope: { sender: "memory:agency:s1" } };

  assert.equal(evaluateCheck(another, asSender, { now: NOW }).checked, 0);
  // A campaign scope does not match a sender's row.
  const campaign = { ...quiet, scope: { campaign: C1 } };

  assert.equal(evaluateCheck(campaign, asSender, { now: NOW }).checked, 0);
});

test("the checks page lists every metric, and only those", () => {
  const page = readFileSync(
    path.join(
      import.meta.dirname,
      "../../../../site/content/docs/plugins/checks.mdx"
    ),
    "utf-8"
  );

  const section = page.split("## Metrics")[1]?.split("\n## ")[0] ?? "";

  const listed = [...section.matchAll(/^\| `(?<metric>[a-z_]+)` \|/gmu)].map(
    (match) => match.groups?.metric
  );

  assert.deepEqual(listed.toSorted(), Object.keys(CHECK_METRICS).toSorted());
});

test("a window counted back from a date that is not one is Invalid", async () => {
  const stats = await dailyStats();

  assert.throws(
    () => evaluateCheck(json("quiet"), stats, { now: "last tuesday" }),
    (error: unknown) =>
      OutboundError.is(error) &&
      error.code === "Invalid" &&
      error.message.includes("now is not a date")
  );
});
