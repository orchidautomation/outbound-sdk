// The shared adapter suite. Every adapter runs these same tests, offline,
// against its documented payloads in fixtures/<provider>/.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CAPABILITY_KEYS,
  createOutbound,
  MemoryRateLimitStore,
  OutboundError,
  outboundEventSchema,
  resolveCapabilities,
} from "../../src/index.ts";
import type {
  Adapter,
  CapabilityKey,
  EventType,
  Outbound,
} from "../../src/index.ts";
import { createClock } from "./clock.ts";
import { fieldCoverageTests } from "./field-coverage.ts";
import type { CoverageSuite } from "./field-coverage.ts";
import { fixture, fixtureText } from "./fixtures.ts";
import { createFetch, json } from "./http.ts";
import type { Handler, RecordedRequest } from "./http.ts";

export interface RouteRequest {
  readonly method: string;
  readonly url: URL;
  readonly body: unknown;
}

export interface FixtureRoute {
  readonly method: "GET" | "POST";
  readonly path: string | RegExp;
  /** The fixture file that answers this request. */
  readonly fixture: string | ((request: RouteRequest) => string);
}

export interface AdapterSuite {
  readonly provider: string;
  /** Builds the adapter with a test key and the workspace label `client-a`. */
  readonly make: () => Adapter;
  /** The test key, to prove it never leaks. */
  readonly secret: string;
  /** Every request must go to this origin. */
  readonly origin: string;
  /** A sister service the vendor serves on another host with the same key. */
  readonly sisterOrigins?: readonly string[];
  readonly routes: readonly FixtureRoute[];
  readonly isAuthorized: (request: RecordedRequest) => boolean;
  /** Ids that exist in the fixtures. */
  readonly ids: {
    readonly campaign: string;
    readonly lead?: string;
    readonly sender?: string;
    /** A saved lead list. */
    readonly list?: string;
    /** A `threadId` that messages in the fixtures carry. */
    readonly thread?: string;
    /** A webhook subscription. */
    readonly webhook?: string;
  };
  /** Records across every fixture page, per listing the adapter supports. */
  readonly totals: Partial<
    Record<
      | "blocklist"
      | "campaigns"
      | "leads"
      | "lists"
      | "messages"
      | "replies"
      | "senders"
      | "subsequences"
      | "tags"
      | "webhooks",
      number
    >
  >;
  /** Webhook fixture file -> the event type it must become. */
  readonly webhooks: Readonly<Record<string, EventType>>;
  /** Fields the adapter fills that the default fixtures do not show. */
  readonly unsampled?: CoverageSuite["unsampled"];
}

const WORKSPACE = "client-a";

/** The rejection of a promise, or `undefined` when it resolved. */
const rejection = async (promise: Promise<unknown>): Promise<unknown> => {
  try {
    await promise;

    return undefined;
  } catch (error) {
    return error;
  }
};

interface Harness {
  readonly outbound: Outbound;
  readonly adapter: Adapter;
  readonly requests: RecordedRequest[];
  readonly unrouted: string[];
  readonly settle: <Value>(promise: Promise<Value>) => Promise<Value>;
}

const routeFor = (
  suite: AdapterSuite,
  request: RouteRequest
): string | undefined => {
  const route = suite.routes.find(
    (candidate) =>
      candidate.method === request.method &&
      (typeof candidate.path === "string"
        ? candidate.path === request.url.pathname
        : candidate.path.test(request.url.pathname))
  );

  if (route === undefined) {
    return undefined;
  }

  return typeof route.fixture === "string"
    ? route.fixture
    : route.fixture(request);
};

/** A fake fetch handler that answers each vendor's requests from its own fixtures. */
export const fixtureHandler =
  (suites: readonly AdapterSuite[], unrouted: string[] = []): Handler =>
  (recorded) => {
    const url = new URL(recorded.url);

    const suite = suites.find(
      (candidate) =>
        candidate.origin === url.origin ||
        (candidate.sisterOrigins ?? []).includes(url.origin)
    );

    const file =
      suite === undefined
        ? undefined
        : routeFor(suite, {
            body:
              recorded.body === undefined
                ? undefined
                : JSON.parse(recorded.body),
            method: recorded.method,
            url,
          });

    if (suite === undefined || file === undefined) {
      unrouted.push(
        `${recorded.method} ${url.origin}${url.pathname}${url.search}`
      );

      return json({ error: "no fixture for this request" }, 599);
    }

    return json(fixture(suite.provider, file));
  };

export const harness = (
  suite: AdapterSuite,
  respond?: (request: RecordedRequest) => Response | undefined
): Harness => {
  const unrouted: string[] = [];
  const clock = createClock();
  const fromFixtures = fixtureHandler([suite], unrouted);

  const http = createFetch(
    (recorded, index) => respond?.(recorded) ?? fromFixtures(recorded, index)
  );

  const adapter = suite.make();

  return {
    adapter,
    outbound: createOutbound({
      adapter,
      fetch: http.fetch,
      rateLimitStore: new MemoryRateLimitStore(),
      runtime: clock.runtime,
      share: 1,
    }),
    requests: http.requests,
    settle: clock.settle,
    unrouted,
  };
};

type Probe = (outbound: Outbound, ids: AdapterSuite["ids"]) => Promise<unknown>;

// A vendor with no list of every lead is read through one campaign.
const leadsOf = (outbound: Outbound, ids: AdapterSuite["ids"]) =>
  outbound.capabilities["leads.list"]
    ? outbound.leads
    : outbound.campaign(ids.campaign).leads;

const SINCE = "2020-01-01T00:00:00Z";

// One read per capability. A supported one must succeed; an unsupported one
// must throw Unsupported before any request leaves.
const PROBES: Partial<Record<CapabilityKey, Probe>> = {
  blocklist: (outbound) => outbound.blocklist.list(),
  "campaigns.bySender": (outbound, ids) =>
    outbound.sender(ids.sender ?? "missing").campaigns.list(),
  "campaigns.progress": (outbound, ids) =>
    outbound.campaign(ids.campaign).progress(),
  "campaigns.settings": (outbound, ids) =>
    outbound.campaign(ids.campaign).settings(),
  "lists.get": (outbound, ids) => outbound.lists.get(ids.list ?? "missing"),
  "lists.leads": (outbound, ids) =>
    outbound.list(ids.list ?? "missing").leads.list(),
  "lists.list": (outbound) => outbound.lists.list(),
  "messages.byThread": (outbound, ids) =>
    outbound.thread(ids.thread ?? "missing").messages(),
  "senders.health": (outbound, ids) =>
    outbound.sender(ids.sender ?? "missing").health(),
  "sequence.subsequences": (outbound, ids) =>
    outbound.campaign(ids.campaign).subsequences.list(),
  tags: (outbound) => outbound.tags.list(),
  "webhooks.get": (outbound, ids) =>
    outbound.webhooks.get(ids.webhook ?? "missing"),
  "webhooks.list": (outbound) => outbound.webhooks.list(),
  "campaigns.status": (outbound) =>
    outbound.campaigns.list({ status: "active" }),
  "leads.byCampaign": (outbound, ids) =>
    outbound.campaign(ids.campaign).leads.list(),
  "leads.get": (outbound, ids) => outbound.leads.get(ids.lead ?? "missing"),
  "leads.list": (outbound) => outbound.leads.list(),
  "leads.since": (outbound, ids) =>
    leadsOf(outbound, ids).list({ since: SINCE }),
  "leads.timeline": (outbound, ids) =>
    outbound.lead(ids.lead ?? "missing").timeline(),
  "messages.body": (outbound) => outbound.messages.list({ include: ["body"] }),
  "messages.list": (outbound) => outbound.messages.list(),
  "messages.since": (outbound) => outbound.messages.list({ since: SINCE }),
  "placementTests.list": (outbound) => outbound.placementTests.list(),
  "replies.category": (outbound) =>
    outbound.replies.list({ category: "positive" }),
  "replies.list": (outbound) => outbound.replies.list(),
  "replies.since": (outbound) => outbound.replies.list({ since: SINCE }),
  "replies.unread": (outbound) => outbound.replies.list({ unread: true }),
  "senders.byCampaign": (outbound, ids) =>
    outbound.campaign(ids.campaign).senders.list(),
  "senders.get": (outbound, ids) =>
    outbound.senders.get(ids.sender ?? "missing"),
  "senders.list": (outbound) => outbound.senders.list(),
  "senders.warmup": (outbound, ids) =>
    outbound.sender(ids.sender ?? "missing").warmup(),
  sequence: (outbound, ids) => outbound.campaign(ids.campaign).sequence(),
  "stats.byDay": (outbound) => outbound.stats({ by: "day" }),
  "stats.bySender": (outbound, ids) =>
    outbound.sender(ids.sender ?? "missing").stats(),
  "stats.byStep": (outbound, ids) =>
    outbound.campaign(ids.campaign).stats({ scope: "step" }),
  "stats.allCampaigns": (outbound) => outbound.stats({ scope: "campaign" }),
  "stats.campaign": (outbound, ids) => outbound.campaign(ids.campaign).stats(),
  "stats.workspace": (outbound) => outbound.stats(),
  workspaces: (outbound) => outbound.workspaces.list(),
};

type Listed = Record<string, unknown> & { readonly ref: string };

const LISTINGS: Record<
  keyof AdapterSuite["totals"],
  (outbound: Outbound, ids: AdapterSuite["ids"]) => Promise<Listed[]>
> = {
  blocklist: (outbound) => outbound.blocklist.listAll().toArray(),
  lists: (outbound) => outbound.lists.listAll().toArray(),
  subsequences: (outbound, ids) =>
    outbound.campaign(ids.campaign).subsequences.listAll().toArray(),
  tags: (outbound) => outbound.tags.listAll().toArray(),
  webhooks: (outbound) => outbound.webhooks.listAll().toArray(),
  campaigns: (outbound) => outbound.campaigns.listAll().toArray(),
  leads: (outbound, ids) => leadsOf(outbound, ids).listAll().toArray(),
  messages: (outbound) => outbound.messages.listAll().toArray(),
  replies: (outbound) => outbound.replies.listAll().toArray(),
  senders: (outbound) => outbound.senders.listAll().toArray(),
};

const assertNormalized = (
  suite: AdapterSuite,
  record: Record<string, unknown>
): void => {
  assert.equal(record.provider, suite.provider);
  assert.equal(record.workspaceId, WORKSPACE);
  assert.equal(
    record.ref,
    `${suite.provider}:${WORKSPACE}:${String(record.sourceId)}`
  );
  assert.notEqual(record.sourceId, "", "every record has a vendor id");
  assert.notEqual(record.raw, undefined, "the vendor payload is kept");

  for (const key of ["email", "address"]) {
    const value = record[key];

    if (typeof value === "string") {
      assert.equal(
        value,
        value.trim().toLowerCase(),
        `${key} is lowercased and trimmed`
      );
    }
  }

  for (const key of ["createdAt", "sentAt"]) {
    const value = record[key];

    if (typeof value === "string") {
      assert.match(
        value,
        /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/u,
        `${key} is ISO 8601 UTC`
      );
    }
  }
};

const webhookRequest = (
  suite: AdapterSuite,
  file: string,
  rawBody = fixtureText(suite.provider, file)
) => ({
  body: JSON.parse(rawBody),
  headers: new Headers({ "content-type": "application/json" }),
  rawBody,
  url: "https://hooks.example.com/outbound",
});

const listingTests = (suite: AdapterSuite): void => {
  for (const [name, expected] of Object.entries(suite.totals)) {
    test(`${suite.provider}: ${name} lists every record across pages, normalized, with no duplicates`, async () => {
      const { outbound, settle, unrouted } = harness(suite);

      const records = await settle(
        LISTINGS[name as keyof AdapterSuite["totals"]](outbound, suite.ids)
      );

      assert.equal(records.length, expected);
      assert.equal(
        new Set(records.map((record) => record.ref)).size,
        expected,
        "refs are unique"
      );

      for (const record of records) {
        assertNormalized(suite, record);
      }

      assert.deepEqual(unrouted, []);
    });
  }
};

const capabilityTests = (suite: AdapterSuite): void => {
  const declared = resolveCapabilities(suite.make().capabilities);

  for (const key of CAPABILITY_KEYS) {
    const probe = PROBES[key];

    if (probe === undefined) {
      continue;
    }

    if (declared[key] === false) {
      test(`${suite.provider}: ${key} is refused as Unsupported before any request`, async () => {
        const { outbound, requests } = harness(suite);
        await assert.rejects(
          async () => await probe(outbound, suite.ids),
          (error) => OutboundError.is(error) && error.code === "Unsupported"
        );
        assert.equal(requests.length, 0);
      });
    } else {
      test(`${suite.provider}: ${key} (${String(declared[key])}) returns data`, async () => {
        const { outbound, settle, unrouted } = harness(suite);
        await settle(probe(outbound, suite.ids));
        assert.deepEqual(
          unrouted,
          [],
          "only documented endpoints with fixtures are called"
        );
      });
    }
  }
};

const requestTests = (suite: AdapterSuite): void => {
  test(`${suite.provider}: every request is authorized, goes to the vendor and is a read`, async () => {
    const { adapter, outbound, requests, settle } = harness(suite);
    const declared = resolveCapabilities(adapter.capabilities);

    for (const key of CAPABILITY_KEYS) {
      const probe = PROBES[key];

      if (probe !== undefined && declared[key] !== false) {
        await settle(probe(outbound, suite.ids));
      }
    }

    assert.ok(requests.length > 0);

    for (const request of requests) {
      const url = new URL(request.url);
      assert.ok(
        [suite.origin, ...(suite.sisterOrigins ?? [])].includes(url.origin),
        `${url.origin} is not the vendor's`
      );
      assert.ok(
        suite.isAuthorized(request),
        `unauthorized request: ${request.method} ${url.pathname}`
      );
      assert.ok(
        adapter.raw.isRead(
          request.method as "GET",
          url.pathname.replace(new URL(adapter.raw.baseUrl).pathname, "")
        ),
        `${request.method} ${url.pathname} is not declared as a read`
      );
    }
  });

  test(`${suite.provider}: vendor errors map to codes and never leak the key`, async () => {
    for (const [status, code] of [
      [401, "Unauthorized"],
      [404, "NotFound"],
      [500, "Provider"],
    ] as const) {
      const { outbound, settle } = harness(suite, () =>
        json(
          {
            error: `denied for ${suite.secret}`,
            message: `denied for ${suite.secret}`,
          },
          status
        )
      );

      const error = await rejection(
        settle(outbound.campaigns.get(suite.ids.campaign, { retries: 0 }))
      );

      assert.ok(OutboundError.is(error), `status ${status}`);
      assert.equal(error.code, code);
      assert.equal(error.provider, suite.provider);
      assert.ok(!error.message.includes(suite.secret), error.message);
    }
  });

  test(`${suite.provider}: raw refuses writes and declares its limits and maturity`, async () => {
    const { adapter, outbound, requests } = harness(suite);
    await assert.rejects(
      async () => await outbound.raw.request("DELETE", "/anything/1"),
      (error) => OutboundError.is(error) && error.code === "Unsupported"
    );
    assert.equal(requests.length, 0);
    assert.ok(adapter.limits.windows.length > 0);
    assert.match(
      adapter.limits.source,
      /https?:\/\//u,
      "limits cite where they came from"
    );
    assert.ok(["beta", "stable", "unverified"].includes(adapter.maturity));
    assert.deepEqual(adapter.secrets, [suite.secret]);
  });
};

const webhookTests = (suite: AdapterSuite): void => {
  for (const [file, type] of Object.entries(suite.webhooks)) {
    test(`${suite.provider}: ${file} parses to ${type} with a stable id`, () => {
      const { events } = suite.make();
      assert.ok(events, "the adapter declares an event format");
      const request = webhookRequest(suite, file);
      assert.equal(events.detect(request), true);
      const first = events.parse(request, WORKSPACE);
      const again = events.parse(webhookRequest(suite, file), WORKSPACE);
      assert.ok(first.length > 0);

      for (const [index, event] of first.entries()) {
        assert.deepEqual(
          outboundEventSchema.parse(event),
          event,
          "the event matches the schema"
        );
        assert.equal(event.type, type);
        assert.equal(event.provider, suite.provider);
        assert.equal(event.workspaceId, WORKSPACE);
        assert.equal(
          event.id,
          again[index]?.id,
          "redelivery produces the same id"
        );
        assert.ok(!JSON.stringify(event.data).includes("undefined"));
      }
    });
  }

  test(`${suite.provider}: an unknown webhook event is kept as type unknown, never dropped`, () => {
    const { events } = suite.make();
    const [file] = Object.keys(suite.webhooks);

    if (events === undefined || file === undefined) {
      return;
    }

    const rawBody = fixtureText(suite.provider, file).replace(
      // The name is a string, or the `type` of an `event` object (EmailBison).
      /(?<key>"(?:event_type|eventType|event)"\s*:\s*(?:\{\s*"type"\s*:\s*)?")[^"]+(?<quote>")/u,
      "$<key>something_new_the_vendor_added$<quote>"
    );

    const parsed = events.parse(
      webhookRequest(suite, file, rawBody),
      WORKSPACE
    );

    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]?.type, "unknown");
    assert.deepEqual(parsed[0]?.raw, JSON.parse(rawBody));
  });
};

/** Registers the shared tests for one adapter. */
export const runAdapterSuite = (suite: AdapterSuite): void => {
  listingTests(suite);
  fieldCoverageTests(suite, () => harness(suite));
  capabilityTests(suite);
  requestTests(suite);
  webhookTests(suite);
};
