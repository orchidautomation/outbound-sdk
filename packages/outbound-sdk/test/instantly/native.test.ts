import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  createOutbound,
  MemoryRateLimitStore,
  OutboundError,
} from "../../src/index.ts";
import type { NativeParam, NativeRead } from "../../src/index.ts";
import { instantly, NATIVE } from "../../src/instantly/index.ts";
import { createClock } from "../helpers/clock.ts";
import { createFetch, json } from "../helpers/http.ts";
import type { RecordedRequest } from "../helpers/http.ts";
import { KEY } from "./suite.ts";

const BASE = "https://api.instantly.ai/api/v2";

const ENTRIES: [string, NativeRead][] = Object.entries(NATIVE);

const SAMPLES: Record<NativeParam["type"], unknown> = {
  boolean: true,
  json: { any: [1, "two"] },
  number: 7,
  string: "a b/c@d",
};

const echo = (request: RecordedRequest): Response =>
  json({ from: new URL(request.url).pathname });

const fill = (route: string): string => route.replaceAll(/\{\w+\}/gu, "x-1");

const client = (reply: (request: RecordedRequest) => Response = echo) => {
  const http = createFetch((request) => reply(request));
  const clock = createClock();

  const outbound = createOutbound({
    adapter: instantly({ apiKey: KEY, workspaceId: "client-a" }),
    fetch: http.fetch,
    rateLimitStore: new MemoryRateLimitStore(),
    runtime: clock.runtime,
    share: 1,
  });

  return { outbound, requests: http.requests, settle: clock.settle };
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

const sampleParams = (read: NativeRead): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(read.params ?? {}).map(([name, param]) => [
      name,
      SAMPLES[param.type],
    ])
  );

const placed = (read: NativeRead, place: NativeParam["in"]): string[] =>
  Object.entries(read.params ?? {}).flatMap(([name, param]) =>
    param.in === place ? [name] : []
  );

const expectedPath = (read: NativeRead): string =>
  read.path.replaceAll(/\{\w+\}/gu, "a%20b%2Fc%40d");

interface TableRow {
  readonly method: string;
  readonly path: string;
  readonly coverage: string;
  readonly through: string;
}

const table = (): TableRow[] =>
  readFileSync(
    path.resolve(import.meta.dirname, "../../../../docs/coverage/instantly.md"),
    "utf-8"
  )
    .split("\n")
    .filter((line) => /^\| `(?:GET|POST|PUT|PATCH|DELETE)` \|/u.test(line))
    .map((line) => {
      const [method = "", route = "", , coverage = "", through = ""] = line
        .split(/(?<!\\)\|/u)
        .slice(1, -1)
        .map((cell) => cell.trim().replaceAll("`", ""));

      return { coverage, method, path: route, through };
    });

test("instantly native: the catalog holds every native row of the inventory and nothing else", () => {
  const rows = table();
  assert.equal(rows.length, 268);

  assert.deepEqual(
    rows
      .filter((row) => row.coverage === "native")
      .map((row) => row.through)
      .toSorted(),
    Object.keys(NATIVE).toSorted()
  );

  for (const [name, read] of ENTRIES) {
    assert.match(name, /^[a-z][A-Za-z]+$/u, `${name} is camelCase`);
    assert.ok(read.description.endsWith("."), `${name} has a sentence`);
    assert.ok(
      read.docs?.startsWith("https://developer.instantly.ai/api-reference/"),
      `${name} links its reference page`
    );
    assert.equal(read.baseUrl, undefined, `${name} is on the main host`);
  }
});

test("instantly native: every read builds the documented request and returns what Instantly sent", async () => {
  const { outbound, requests, settle } = client();

  for (const [name, read] of ENTRIES) {
    const before = requests.length;

    // oxlint-disable-next-line no-await-in-loop -- one read at a time keeps the request order known.
    const result = await settle(
      // SAFETY: the samples follow each parameter's declared type.
      outbound.native.read(name, sampleParams(read) as never)
    );

    assert.equal(requests.length, before + 1, `${name} is one request`);
    const request = requests[before];
    const url = new URL(request?.url ?? "");
    const route = `/api/v2${expectedPath(read)}`;
    assert.equal(request?.method, read.method, `${name} method`);
    assert.equal(url.origin + url.pathname, `${BASE}${expectedPath(read)}`);
    assert.equal(request?.headers.authorization, `Bearer ${KEY}`);
    assert.deepEqual(result.data, { from: route }, `${name} response`);
    assert.equal(result.meta.provider, "instantly");

    assert.deepEqual(
      [...url.searchParams.keys()].toSorted(),
      placed(read, "query").toSorted(),
      `${name} query`
    );

    for (const key of placed(read, "query")) {
      const sample = SAMPLES[read.params?.[key]?.type ?? "string"];

      assert.equal(
        url.searchParams.get(key),
        Object(sample) === sample ? JSON.stringify(sample) : String(sample),
        `${name} ${key}`
      );
    }

    if (read.method === "GET") {
      assert.equal(request?.body, undefined, `${name} sends no body`);
      assert.deepEqual(placed(read, "body"), [], `${name} has no body`);
    } else {
      assert.deepEqual(
        JSON.parse(request?.body ?? "null"),
        Object.fromEntries(
          placed(read, "body").map((key) => [
            key,
            SAMPLES[read.params?.[key]?.type ?? "string"],
          ])
        ),
        `${name} body`
      );
    }
  }
});

test("instantly native: a read with a path parameter is refused without it, before any request", async () => {
  const { outbound, requests } = client();
  const withPath = ENTRIES.filter(([, read]) => read.path.includes("{"));
  assert.ok(withPath.length > 40);

  for (const [name, read] of withPath) {
    const holes = [...read.path.matchAll(/\{(?<hole>\w+)\}/gu)].map(
      (match) => match.groups?.hole ?? ""
    );

    assert.deepEqual(holes.toSorted(), placed(read, "path").toSorted(), name);

    // oxlint-disable-next-line no-await-in-loop -- one assertion at a time keeps the failure readable.
    const error = await failure(() => outbound.native.read(name));
    assert.equal(error.code, "Invalid", name);
    assert.match(error.message, /needs "/u);
  }

  assert.equal(requests.length, 0);
});

test("instantly native: only GET and POST reads, none of them a write in the inventory", () => {
  const rows = table();

  const writes = new Set(
    rows
      .filter((row) => row.coverage === "write")
      .map((row) => `${row.method} ${row.path}`)
  );

  assert.equal(writes.size, 137);

  for (const [name, read] of ENTRIES) {
    assert.ok(["GET", "POST"].includes(read.method), `${name} method`);
    assert.ok(!writes.has(`${read.method} ${read.path}`), `${name} reads`);
  }
});

test("instantly native: raw accepts every catalogued POST read and still refuses every POST write", async () => {
  const { raw } = instantly({ apiKey: KEY });
  const posts = ENTRIES.filter(([, read]) => read.method === "POST");
  assert.equal(posts.length, 13);

  for (const [name, read] of posts) {
    assert.ok(raw.isRead("POST", fill(read.path)), `${name} is a read`);
    assert.ok(raw.isRead("POST", `/api/v2${fill(read.path)}/`), name);
  }

  for (const row of table()) {
    if (row.coverage === "write") {
      assert.ok(
        // SAFETY: the table's method column holds only the five HTTP methods.
        !raw.isRead(row.method as "DELETE", fill(row.path)),
        `${row.method} ${row.path} is not a read`
      );
    }
  }

  assert.ok(!raw.isRead("POST", "/campaigns/x-1/export/again"));
  assert.ok(!raw.isRead("POST", "/custom-tagsXsearch"));
  const { outbound, requests } = client();

  const error = await failure(() =>
    outbound.raw.request("POST", "/campaigns/x-1/pause")
  );

  assert.equal(error.code, "Unsupported");
  assert.equal(requests.length, 0);
});

test("instantly native: a path parameter is encoded and a query parameter goes on the URL", async () => {
  const { outbound, requests, settle } = client();

  await settle(
    outbound.native.reads.campaignSendingStatus({
      id: "01a1/d77f",
      with_ai_summary: true,
    })
  );

  await settle(
    outbound.native.reads.inboxManagerReply({ id: "m 1", reply_id: "r#2" })
  );

  await settle(
    outbound.native.reads.senderCampaigns({
      email: "person1@example.com",
      limit: 50,
      starting_after: "cursor-1",
    })
  );

  assert.deepEqual(
    requests.map((request) => request.url),
    [
      `${BASE}/campaigns/01a1%2Fd77f/sending-status?with_ai_summary=true`,
      `${BASE}/ai-agents/inbox-manager/m%201/replies/r%232`,
      `${BASE}/account-campaign-mappings/person1%40example.com?limit=50&starting_after=cursor-1`,
    ]
  );
});

test("instantly native: a POST read sends its parameters as a JSON body, and an empty body when it has none", async () => {
  const { outbound, requests, settle } = client();

  await settle(
    outbound.native.reads.inboxPlacementInsights({
      recipient_esp: [1, 2],
      show_previous: true,
      test_id: "test-1",
    })
  );

  await settle(outbound.native.reads.campaignExport({ id: "c-1" }));
  await settle(outbound.native.reads.dfyPreWarmedDomains());

  assert.deepEqual(
    requests.map((request) => [
      request.method,
      new URL(request.url).pathname,
      new URL(request.url).search,
      JSON.parse(request.body ?? "null"),
    ]),
    [
      [
        "POST",
        "/api/v2/inbox-placement-analytics/deliverability-insights",
        "",
        { recipient_esp: [1, 2], show_previous: true, test_id: "test-1" },
      ],
      ["POST", "/api/v2/campaigns/c-1/export", "", {}],
      [
        "POST",
        "/api/v2/dfy-email-account-orders/domains/pre-warmed-up-list",
        "",
        {},
      ],
    ]
  );
});

test("instantly native: required parameters and types are checked, by the compiler and before the request", async () => {
  const { outbound, requests } = client();
  const { read, reads } = outbound.native;

  const cases: [() => unknown, RegExp][] = [
    [() => read("subsequenceAnalytics"), /needs "campaign_id"/u],
    [() => read("inboxPlacementResults", { limit: 5 }), /needs "test_id"/u],
    [() => read("superSearchLeadCount", {}), /needs "search_filters"/u],
    [
      () => read("auditLogs", { activity_type: "login" }),
      /"activity_type" must be a number/u,
    ],
    [
      () => read("dfyAccounts", { with_passwords: true }),
      /no parameter "with_passwords"/u,
    ],
    [() => read("apiKeys"), /no native read "apiKeys"/u],
  ];

  for (const [action, message] of cases) {
    // oxlint-disable-next-line no-await-in-loop -- one assertion at a time keeps the failure readable.
    const error = await failure(action);
    assert.equal(error.code, "Invalid");
    assert.match(error.message, message);
  }

  const wrong = (): unknown[] => [
    // @ts-expect-error -- campaign_id is required
    reads.subsequenceAnalytics(),
    // @ts-expect-error -- id is a string
    reads.subsequence({ id: 7 }),
    // @ts-expect-error -- passwords cannot be asked for
    reads.dfyAccounts({ with_passwords: true }),
    // @ts-expect-error -- API keys are not in the catalog
    reads.apiKeys(),
  ];

  assert.equal(wrong.length, 0);
  assert.equal(requests.length, 0);
});

test("instantly native: a read with its own limit names a lane the adapter declares, and waits for it", async () => {
  const adapter = instantly({ apiKey: KEY });
  const lanes = adapter.limits?.lanes ?? {};

  const laned = Object.fromEntries(
    ENTRIES.flatMap(([name, read]) =>
      read.lane === undefined ? [] : [[name, read.lane]]
    )
  );

  assert.deepEqual(laned, {
    leadLabelPrediction: "labelPrediction",
    localBusinessFilters: "localBusinessFilters",
    localBusinessSearch: "localBusinessSearch",
  });
  assert.deepEqual(lanes.labelPrediction, [
    { perMs: 2_592_000_000, requests: 500 },
  ]);
  assert.deepEqual(lanes.localBusinessFilters, [
    { perMs: 86_400_000, requests: 100 },
  ]);
  assert.deepEqual(lanes.localBusinessSearch, [
    { perMs: 86_400_000, requests: 200 },
  ]);

  const { outbound, requests, settle } = client();

  for (let call = 0; call < 100; call += 1) {
    // oxlint-disable-next-line no-await-in-loop -- the calls are counted one by one.
    await settle(outbound.native.reads.localBusinessFilters({ input: "x" }));
  }

  assert.equal(requests.length, 100);
  const blocked = outbound.native.reads.localBusinessFilters({ input: "x" });
  const other = await settle(outbound.native.reads.inboxUnreadCount());
  assert.deepEqual(other.data, { from: "/api/v2/emails/unread/count" });
  assert.equal(requests.length, 101, "the lane is full; other reads go on");
  blocked.catch(() => null);
});

test("instantly native: the block list download comes back as CSV text", async () => {
  const csv = "value,type\nexample.com,domain\n";

  const { outbound, settle } = client(
    () => new Response(csv, { headers: { "content-type": "text/csv" } })
  );

  const result = await settle(
    outbound.native.reads.blocklistCsv({ domains_only: true })
  );

  assert.equal(result.data, csv);
});

test("instantly native: a sub workspace key and a failed read behave like every other read", async () => {
  const http = createFetch(() =>
    json({ error: "Payment Required", message: `no plan ${KEY}` }, 402)
  );

  const outbound = createOutbound({
    adapter: instantly({ apiKey: KEY, asWorkspace: "sub-1" }),
    fetch: http.fetch,
    retries: 0,
  });

  const error = await failure(() => outbound.native.reads.auditLogs());
  assert.equal(error.code, "Unsupported");
  assert.ok(!error.message.includes(KEY));
  assert.equal(http.requests[0]?.headers["x-as-workspace"], "sub-1");
});
