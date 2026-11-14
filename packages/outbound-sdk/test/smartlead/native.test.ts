// The Smartlead native catalog: every entry builds the request the reference
// documents and returns Smartlead's response unchanged.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  createOutbound,
  MemoryRateLimitStore,
  OutboundError,
} from "../../src/index.ts";
import type { Json, NativeParam, NativeRead } from "../../src/index.ts";
import { smartlead } from "../../src/smartlead/index.ts";
import { createClock } from "../helpers/clock.ts";
import { createFetch, json } from "../helpers/http.ts";
import type { RecordedRequest } from "../helpers/http.ts";
import { KEY, urlOf } from "./suite.ts";

const BASE = "https://server.smartlead.ai/api/v1";
const PAYLOAD = { data: [{ id: 1 }], ok: true };

const client = (respond: () => Response = () => json(PAYLOAD)) => {
  const clock = createClock();
  const http = createFetch(respond);
  const adapter = smartlead({ apiKey: KEY, workspaceId: "client-a" });

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
  };
};

const entries = (): [string, NativeRead][] =>
  Object.entries(client().adapter.native ?? {});

const SAMPLES: Readonly<Record<NativeParam["type"], Json>> = {
  boolean: true,
  json: ["a", 2],
  number: 7,
  string: "a b/c",
};

const sample = (read: NativeRead): Record<string, Json> =>
  Object.fromEntries(
    Object.entries(read.params ?? {}).map(([name, param]) => [
      name,
      SAMPLES[param.type],
    ])
  );

const named = (
  read: NativeRead,
  place: NativeParam["in"]
): [string, NativeParam][] =>
  Object.entries(read.params ?? {}).filter(([, param]) => param.in === place);

/** The path with every `{name}` filled by the encoded sample string. */
const filled = (read: NativeRead): string =>
  read.path.replaceAll(/\{[^}]+\}/gu, encodeURIComponent("a b/c"));

const queryValue = (param: NativeParam): string =>
  param.type === "json"
    ? JSON.stringify(SAMPLES.json)
    : String(SAMPLES[param.type]);

const checkRequest = (
  name: string,
  read: NativeRead,
  request: RecordedRequest | undefined
): void => {
  const url = urlOf(request);
  assert.equal(request?.method, read.method, `${name}: method`);

  assert.equal(
    url.origin + url.pathname,
    (read.baseUrl ?? BASE) + filled(read),
    `${name}: host and path`
  );

  assert.equal(url.searchParams.get("api_key"), KEY, `${name}: the key`);
  assert.equal(request?.headers.authorization, undefined, name);

  for (const [param, spec] of named(read, "query")) {
    assert.equal(
      url.searchParams.get(param),
      queryValue(spec),
      `${name}: ${param} is in the query`
    );
  }

  const query = named(read, "query").length + 1;
  assert.equal([...url.searchParams].length, query, `${name}: query size`);

  if (read.method === "GET") {
    assert.equal(request?.body, undefined, `${name}: a GET has no body`);
    assert.deepEqual(named(read, "body"), [], `${name}: no body parameter`);

    return;
  }

  assert.deepEqual(
    JSON.parse(request?.body ?? "null"),
    Object.fromEntries(
      named(read, "body").map(([param, spec]) => [param, SAMPLES[spec.type]])
    ),
    `${name}: the body`
  );
};

const failure = async (action: () => unknown): Promise<OutboundError> => {
  try {
    await action();
  } catch (error) {
    assert.ok(OutboundError.is(error), String(error));

    return error;
  }

  throw new Error("expected the call to fail");
};

test("smartlead native: the adapter declares the catalog", () => {
  const { adapter, outbound } = client();
  assert.equal(adapter.capabilities?.native, true);
  assert.equal(outbound.capabilities.native, true);
  assert.equal(outbound.native.provider, "smartlead");
  assert.equal(Object.keys(outbound.native.catalog).length, 78);
});

test("smartlead native: every entry builds its documented request and returns the response as sent", async () => {
  const { outbound, requests, settle } = client();

  for (const [name, read] of entries()) {
    // oxlint-disable-next-line no-await-in-loop -- one request at a time keeps the recorded order.
    const result = await settle(outbound.native.read(name, sample(read)));
    assert.deepEqual(result.data, PAYLOAD, name);
    assert.equal(result.meta.provider, "smartlead");
    checkRequest(name, read, requests.at(-1));
  }

  assert.equal(requests.length, entries().length);
});

test("smartlead native: every entry is a GET or a POST, is documented, and never declares the key", () => {
  const names = new Set<string>();

  for (const [name, read] of entries()) {
    assert.match(name, /^[a-z][A-Za-z]+$/u, `${name} is camelCase`);
    assert.ok(["GET", "POST"].includes(read.method), `${name}: ${read.method}`);
    assert.ok(read.path.startsWith("/"), `${name}: a path`);
    assert.ok(read.description.length > 15, `${name}: says what it answers`);

    assert.match(
      read.docs ?? "",
      /^https:\/\/api\.smartlead\.ai\/api-reference\/[a-z-]+\/[a-z-]+$/u,
      `${name}: a reference page`
    );

    assert.equal(read.params?.api_key, undefined, `${name}: no api_key`);

    for (const [param, spec] of Object.entries(read.params ?? {})) {
      assert.ok(spec.description.length > 5, `${name}.${param} is described`);
    }

    const placeholders = [
      ...read.path.matchAll(/\{(?<placeholder>[^}]+)\}/gu),
    ].map(([, placeholder]) => placeholder);

    assert.deepEqual(
      placeholders.toSorted(),
      named(read, "path")
        .map(([param]) => param)
        .toSorted(),
      `${name}: one path parameter per placeholder`
    );

    const key = `${read.method} ${read.baseUrl ?? ""}${read.path}`;
    assert.ok(!names.has(key), `${key} is catalogued once`);
    names.add(key);
  }
});

test("smartlead native: a path parameter is required, before any request", async () => {
  const { outbound, requests } = client();
  const withPath = entries().filter(([, read]) => read.path.includes("{"));
  assert.ok(withPath.length > 30);

  for (const [name, read] of withPath) {
    const [[first] = [""]] = named(read, "path");
    const { [first]: _dropped, ...rest } = sample(read);
    // oxlint-disable-next-line no-await-in-loop -- one assertion at a time keeps the failure readable.
    const error = await failure(() => outbound.native.read(name, rest));
    assert.equal(error.code, "Invalid", name);
    assert.match(error.message, new RegExp(`needs "${first}"`, "u"));
  }

  assert.equal(requests.length, 0);
});

const FOLDER = path.resolve(import.meta.dirname, "../../../../docs/coverage");

const endpoint = (method: string, route: string): string =>
  `${method} ${route.replaceAll(/\{[^}]+\}/gu, "{}").replace(/\/$/u, "")}`;

/** `METHOD path` of every row with the given coverage, ids blanked. */
const rows = (coverage: string): Set<string> =>
  new Set(
    readFileSync(path.join(FOLDER, "smartlead.md"), "utf-8")
      .split("\n")
      .filter((line) => line.startsWith("| `"))
      .map((line) => line.split("|").map((cell) => cell.trim()))
      .filter((cells) => cells[4] === coverage)
      .map((cells) =>
        endpoint(
          (cells[1] ?? "").replaceAll("`", ""),
          (cells[2] ?? "").replaceAll("`", "")
        )
      )
  );

test("smartlead native: no entry is a write or an excluded endpoint of the inventory", () => {
  const writes = rows("write");
  const excluded = rows("excluded");
  const native = rows("native");
  assert.ok(writes.size > 90, "the inventory lists the writes");
  assert.ok(excluded.size > 15, "the inventory lists the exclusions");

  for (const [name, read] of entries()) {
    const key = endpoint(read.method, read.path);
    assert.ok(!writes.has(key), `${name} is a write: ${key}`);
    assert.ok(!excluded.has(key), `${name} is excluded: ${key}`);
    assert.ok(native.has(key), `${name} is in the inventory: ${key}`);
  }
});

test("smartlead native: nothing in the catalog returns secrets", () => {
  const secret =
    /api-key|fetch-email-account-details|auth-secret|order-details|^\/email-accounts\/(?:\{|$)/u;

  for (const [name, read] of entries()) {
    assert.doesNotMatch(read.path, secret, name);
  }

  const { catalog } = client().outbound.native;
  assert.ok(!("includeWhitelabel" in catalog.client.params));
  assert.ok(!("private_api_key" in catalog.campaignMailboxStatistics.params));
});

test("smartlead native: the two rate-limited reads use their own lanes", () => {
  const { adapter, outbound } = client();
  const { catalog } = outbound.native;
  const lanes = adapter.limits.lanes ?? {};
  assert.equal(catalog.campaignLeadStatistics.lane, "leads-statistics");
  assert.equal(catalog.analyticsMailboxDomainHealth.lane, "domain-wise-health");

  const used = entries().flatMap(([, read]) => read.lane ?? []);
  assert.deepEqual(used.toSorted(), ["domain-wise-health", "leads-statistics"]);

  for (const lane of used) {
    assert.deepEqual(lanes[lane], [{ perMs: 60_000, requests: 10 }], lane);
  }
});

test("smartlead native: a laned read waits for its own 10 per 60 seconds", async () => {
  const { outbound, requests, settle } = client();
  const clock = Date.now();

  for (let index = 0; index < 11; index += 1) {
    // oxlint-disable-next-line no-await-in-loop -- the eleventh call must queue behind the first ten.
    const result = await settle(
      outbound.native.reads.campaignLeadStatistics({ campaign_id: "372" })
    );

    assert.equal(result.meta.requests, 1);
  }

  assert.equal(requests.length, 11);
  assert.ok(Date.now() - clock < 5000, "the wait ran on the virtual clock");
});

test("smartlead native: typed reads place path, query and body parameters", async () => {
  const { outbound, requests, settle } = client();

  await settle(
    outbound.native.reads.campaignLeadSearch({
      campaignId: "372",
      leadStatuses: ["INPROGRESS"],
      limit: 50,
      searchText: "ada",
    })
  );

  const search = urlOf(requests[0]);
  assert.equal(requests[0]?.method, "POST");
  assert.equal(search.pathname, "/api/v1/campaigns/372/leads/filter");

  assert.deepEqual(JSON.parse(requests[0]?.body ?? ""), {
    leadStatuses: ["INPROGRESS"],
    limit: 50,
    searchText: "ada",
  });

  await settle(
    outbound.native.reads.inboxUnread({
      fetch_message_history: true,
      filters: { campaignId: [372], replyTimeBetween: ["2026-01-01", "2026"] },
      limit: 20,
    })
  );

  const unread = urlOf(requests[1]);
  assert.equal(unread.pathname, "/api/v1/master-inbox/unread-replies");
  assert.equal(unread.searchParams.get("fetch_message_history"), "true");

  assert.deepEqual(JSON.parse(requests[1]?.body ?? ""), {
    filters: { campaignId: [372], replyTimeBetween: ["2026-01-01", "2026"] },
    limit: 20,
  });

  await settle(
    outbound.native.reads.analyticsDailyBySentTime({
      end_date: "2026-01-31",
      start_date: "2026-01-01",
      timezone: "America/New_York",
    })
  );

  const daily = urlOf(requests[2]);

  assert.equal(
    daily.pathname,
    "/api/v1/analytics/day-wise-overall-stats-by-sent-time"
  );

  assert.equal(daily.searchParams.get("timezone"), "America/New_York");
  assert.equal(requests[2]?.body, undefined);
});

test("smartlead native: a sister service keeps its own host and still gets the key", async () => {
  const { outbound, requests, settle } = client();

  await settle(outbound.native.reads.deliveryTest({ spamTestId: "test_1" }));
  await settle(outbound.native.reads.deliveryTests());
  await settle(outbound.native.reads.prospectContacts({ filter_id: 327_105 }));
  await settle(outbound.native.reads.smartSendersDomains());
  await settle(
    outbound.native.reads.smartServers({ withCampaignData: "true" })
  );

  const urls = requests.map((request) => urlOf(request));

  assert.deepEqual(
    urls.map((url) => url.origin + url.pathname),
    [
      "https://smartdelivery.smartlead.ai/api/v1/spam-test/test_1",
      "https://smartdelivery.smartlead.ai/api/v1/spam-test/report",
      "https://prospect-api.smartlead.ai/api/v1/search-email-leads/get-contacts",
      "https://smart-senders.smartlead.ai/api/v1/smart-senders/get-domain-list",
      "https://smartservers.smartlead.ai/api/v1/smart-server/",
    ]
  );

  for (const url of urls) {
    assert.equal(url.searchParams.get("api_key"), KEY);
  }

  assert.deepEqual(
    JSON.parse(requests[1]?.body ?? ""),
    {},
    "a POST has a body"
  );
  assert.deepEqual(JSON.parse(requests[2]?.body ?? ""), { filter_id: 327_105 });
});

test("smartlead native: the lead export comes back as CSV text", async () => {
  const csv = "id,email,open_count\n1,ada@example.com,3\n";

  const { outbound, requests, settle } = client(
    () => new Response(csv, { headers: { "content-type": "text/csv" } })
  );

  const result = await settle(
    outbound.native.reads.campaignLeadsExport({ campaign_id: "372" })
  );

  assert.equal(result.data, csv);

  assert.equal(
    urlOf(requests[0]).pathname,
    "/api/v1/campaigns/372/leads-export"
  );
});

test("smartlead native: a bad call is refused and a failure never shows the key", async () => {
  const { outbound, requests } = client();
  const { read } = outbound.native;

  const cases: [() => unknown, RegExp][] = [
    [() => read("clientApiKeys"), /no native read "clientApiKeys"/u],
    [
      () => read("client", { id: "9", includeWhitelabel: true }),
      /no parameter "includeWhitelabel"/u,
    ],
    [() => read("leadByEmail"), /needs "email"/u],
    [
      () => read("analyticsCampaignPerformance", { start_date: "2026-01-01" }),
      /needs "end_date"/u,
    ],
    [
      () => read("senderTagsByEmail", { email_ids: undefined }),
      /needs "email_ids"/u,
    ],
    [() => read("inboxSent", { limit: "20" }), /"limit" must be a number/u],
  ];

  for (const [action, message] of cases) {
    // oxlint-disable-next-line no-await-in-loop -- one assertion at a time keeps the failure readable.
    const error = await failure(action);
    assert.equal(error.code, "Invalid");
    assert.match(error.message, message);
  }

  assert.equal(requests.length, 0);

  const refused = client(() =>
    json({ message: `Invalid API Key ${KEY}` }, 401)
  );

  const error = await failure(() =>
    refused.settle(refused.outbound.native.reads.inboxArchived())
  );

  assert.equal(error.code, "Unauthorized");
  assert.ok(!error.message.includes(KEY));
});

test("smartlead native: raw accepts every catalogued POST read and still refuses writes", () => {
  const { raw } = client().adapter;

  for (const [name, read] of entries()) {
    const route = read.path.replaceAll(/\{[^}]+\}/gu, "12");
    assert.equal(raw.isRead(read.method, route), true, `${name}: ${route}`);
  }

  const writes = [
    "/master-inbox/saved-views",
    "/master-inbox/create-note",
    "/email-accounts/tag-mapping",
    "/email-accounts/tag-manager",
    "/spam-test/manual",
    "/spam-test/delete",
    "/spam-test/folder",
    "/search-email-leads/fetch-contacts",
    "/search-email-leads/search-contacts",
    "/smart-infra/mapping",
    "/campaigns/12/prompt-template",
  ];

  for (const route of writes) {
    assert.equal(raw.isRead("POST", route), false, route);
  }
});

test("smartlead native: the compiler knows each read's parameters", () => {
  const { outbound } = client();

  const wrong = (): unknown[] => [
    // @ts-expect-error -- campaign_id is required
    outbound.native.reads.campaignLeadsExport(),
    // @ts-expect-error -- start_date and end_date are required
    outbound.native.reads.analyticsLeadStats({ timezone: "UTC" }),
    // @ts-expect-error -- limit is a number
    outbound.native.reads.inboxSent({ limit: "20" }),
    // @ts-expect-error -- the whitelabel credentials are not readable
    outbound.native.reads.client({ id: "9", includeWhitelabel: true }),
    // @ts-expect-error -- client API keys are not in the catalog
    outbound.native.reads.clientApiKeys(),
  ];

  assert.equal(wrong.length, 0);
});
