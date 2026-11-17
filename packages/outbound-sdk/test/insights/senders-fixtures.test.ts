// The senders insights over recorded vendor payloads: what a vendor does not
// report stays unknown, a campaign's limit is held against its senders' own
// limits, and one mailbox the vendor no longer finds is left out with a note
// instead of failing the whole answer.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createOutbound,
  MemoryRateLimitStore,
  OutboundError,
} from "../../src/index.ts";
import { insights } from "../../src/insights/index.ts";
import { fixtureHandler } from "../helpers/adapter-suite.ts";
import type { AdapterSuite } from "../helpers/adapter-suite.ts";
import { createClock } from "../helpers/clock.ts";
import { createFetch, json } from "../helpers/http.ts";
import type { RecordedRequest } from "../helpers/http.ts";
import { suite as instantly } from "../instantly/suite.ts";
import { suite as smartlead } from "../smartlead/suite.ts";
import { NOW } from "./helpers.ts";

const GONE = "person11@example.com";

/**
 * An instance over one vendor's fixtures; `answer` may replace a response.
 * `oneByOne` turns off reading health a page at a time, so each mailbox's
 * health is its own read.
 */
const over = (
  suite: AdapterSuite,
  answer: (request: RecordedRequest) => Response | undefined = () => {},
  oneByOne = false
) => {
  const clock = createClock();
  const unrouted: string[] = [];
  const fromFixtures = fixtureHandler([suite], unrouted);

  const http = createFetch(
    (request, index) => answer(request) ?? fromFixtures(request, index)
  );

  const adapter = suite.make();

  const outbound = createOutbound({
    adapter: oneByOne
      ? {
          ...adapter,
          capabilities: {
            ...adapter.capabilities,
            "senders.healthList": false,
          },
        }
      : adapter,
    fetch: http.fetch,
    plugins: [insights()],
    rateLimitStore: new MemoryRateLimitStore(),
    runtime: clock.runtime,
    share: 1,
  });

  return { outbound, settle: clock.settle, unrouted };
};

/** Answers `status` for every read of the one mailbox's account. */
const failing =
  (status: number) =>
  (request: RecordedRequest): Response | undefined =>
    decodeURIComponent(new URL(request.url).pathname).endsWith(
      `/accounts/${GONE}`
    )
      ? json({ message: "Not found" }, status)
      : undefined;

test("domain_health on Smartlead keeps an unreported block list as null and an unreported DNS as unknown risk", async () => {
  const { outbound, settle, unrouted } = over(smartlead);
  const result = await settle(outbound.insights.domainHealth({}));

  assert.deepEqual(unrouted, []);
  assert.ok(result.data.domains.length > 0);

  for (const domain of result.data.domains) {
    assert.equal(domain.blacklisted, null);
    assert.equal(domain.risk, "unknown");
    assert.deepEqual(
      domain.notReported.filter((check) =>
        ["spf", "dkim", "dmarc", "mx"].includes(check)
      ),
      ["spf", "dkim", "dmarc", "mx"]
    );
  }

  assert.equal(result.data.totals.low, 0);
  assert.equal(result.data.totals.unknown, result.data.domains.length);
});

test("settings_audit on Instantly holds a daily limit against what the senders can send", async () => {
  const { outbound, settle, unrouted } = over(instantly);
  const result = await settle(outbound.insights.settingsAudit({}));

  assert.deepEqual(unrouted, []);
  assert.equal(result.data.byCheck.limit_over_senders, 0);
});

test("sender_capacity on Instantly counts only the days in its window", async () => {
  const { outbound, settle } = over(instantly);

  // The recorded daily stats are all dated 2025-03-01, outside the window.
  const result = await settle(
    outbound.insights.senderCapacity({}, { now: NOW })
  );

  assert.equal(result.data.sends?.daysWithData, 0);
  assert.equal(result.data.sends?.total, null);
  assert.equal(result.data.utilization, null);
});

test("domain_health and warmup_readiness leave out a mailbox the vendor no longer finds", async () => {
  const domains = over(instantly, failing(404), true);

  const health = await domains.settle(
    domains.outbound.insights.domainHealth({})
  );

  const addresses = health.data.domains.flatMap((domain) =>
    domain.mailboxes.map((mailbox) => mailbox.address)
  );

  assert.deepEqual(addresses, ["person1@example.com", "person21@example.com"]);
  assert.equal(health.data.totals.senders, 2);
  assert.equal(health.meta.complete, false);
  assert.ok(health.meta.notes.some((note) => note.includes(GONE)));

  const warmup = over(instantly, failing(404), true);

  const readiness = await warmup.settle(
    warmup.outbound.insights.warmupReadiness({ check_health: true })
  );

  assert.deepEqual(
    readiness.data.notReady.map((sender) => sender.address),
    ["person1@example.com", "person21@example.com"]
  );
  assert.equal(readiness.data.total, 2);
  assert.equal(readiness.meta.complete, false);
  assert.ok(readiness.meta.notes.some((note) => note.includes(GONE)));
});

const denied = (error: unknown): boolean =>
  OutboundError.is(error) && error.code === "Unauthorized";

test("domain_health and warmup_readiness still fail when one mailbox's read is refused", async () => {
  const domains = over(instantly, failing(401), true);

  await assert.rejects(
    domains.settle(domains.outbound.insights.domainHealth({})),
    denied
  );

  const warmup = over(instantly, failing(401), true);

  await assert.rejects(
    warmup.settle(
      warmup.outbound.insights.warmupReadiness({ check_health: true })
    ),
    denied
  );
});
