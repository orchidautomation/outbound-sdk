import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { heyreach, NATIVE } from "../../src/heyreach/index.ts";
import {
  createOutbound,
  MemoryRateLimitStore,
  OutboundError,
} from "../../src/index.ts";
import type { Json, NativeParam, NativeRead } from "../../src/index.ts";
import { createFetch, json } from "../helpers/http.ts";
import { KEY } from "./suite.ts";

const BASE = "https://api.heyreach.io/api/public";
const ANSWER = { items: [{ id: 1 }], totalCount: 1 };

const client = () => {
  const http = createFetch(() => json(ANSWER));

  return {
    outbound: createOutbound({
      adapter: heyreach({ apiKey: KEY, workspaceId: "client-a" }),
      fetch: http.fetch,
      rateLimitStore: new MemoryRateLimitStore(),
      share: 1,
    }),
    requests: http.requests,
  };
};

const entries: [string, NativeRead][] = Object.entries(NATIVE);

const SAMPLES: Readonly<Record<NativeParam["type"], Json>> = {
  boolean: true,
  json: { ids: [1, 2] },
  list: ["first", "second"],
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

const placed = (read: NativeRead, where: NativeParam["in"]): [string, Json][] =>
  Object.entries(read.params ?? {}).flatMap(([name, param]) =>
    param.in === where ? [[name, SAMPLES[param.type]]] : []
  );

const asQuery = (value: Json): string =>
  typeof value === "object" ? JSON.stringify(value) : String(value);

/** The write rows of the coverage table, as `METHOD /path`. */
const documentedWrites = (): string[] =>
  readFileSync(
    path.resolve(import.meta.dirname, "../../../../docs/coverage/heyreach.md"),
    "utf-8"
  )
    .split("\n")
    .filter((line) => /\|\s*write\s*\|\s*\|\s*$/u.test(line))
    .map((line) => {
      const [, method = "", route = ""] = line.replaceAll("`", "").split("|");

      return `${method.trim()} ${route.trim()}`;
    });

test("heyreach: the adapter declares its native catalog", () => {
  const { outbound } = client();
  assert.equal(outbound.capabilities.native, true);
  assert.equal(outbound.native.provider, "heyreach");
  assert.deepEqual(
    Object.keys(outbound.native.catalog).toSorted(),
    Object.keys(NATIVE).toSorted()
  );
  assert.equal(entries.length, 25);
});

test("heyreach: every native read is a GET or a POST on HeyReach's own host, with a description and its docs page", () => {
  for (const [name, read] of entries) {
    assert.match(name, /^[a-z][A-Za-z0-9]+$/u, `${name} is camelCase`);
    assert.ok(["GET", "POST"].includes(read.method), `${name} method`);
    assert.ok(read.path.startsWith("/"), `${name} path`);
    assert.equal(read.baseUrl, undefined, `${name} has no other host`);
    assert.ok(read.description.length > 20, `${name} says what it answers`);
    assert.match(
      read.docs ?? "",
      /^https:\/\/docs\.heyreach\.io\/hey-reach-api\//u,
      `${name} docs`
    );

    for (const [param, spec] of Object.entries(read.params ?? {})) {
      assert.ok(spec.description.length > 5, `${name}.${param} is described`);
      assert.equal(
        spec.in === "path",
        read.path.includes(`{${param}}`),
        `${name}.${param} is in the path exactly when it is a path parameter`
      );
      assert.ok(
        read.method === "POST" || spec.in !== "body",
        `${name}.${param}: a GET has no body`
      );
    }
  }
});

test("heyreach: every native read builds the documented request and returns HeyReach's response", async () => {
  for (const [name, read] of entries) {
    const { outbound, requests } = client();
    // oxlint-disable-next-line no-await-in-loop -- one read at a time keeps a failure readable.
    const result = await outbound.native.read(name, sample(read));
    assert.deepEqual(result.data, ANSWER, name);
    assert.equal(result.meta.provider, "heyreach");
    assert.equal(requests.length, 1, `${name} is one request`);
    const [request] = requests;
    const url = new URL(request?.url ?? "");
    let expected = read.path;

    for (const [param, value] of placed(read, "path")) {
      expected = expected.replace(
        `{${param}}`,
        encodeURIComponent(String(value))
      );
    }

    assert.equal(request?.method, read.method, name);
    assert.equal(url.origin + url.pathname, BASE + expected, name);
    assert.equal(request?.headers["x-api-key"], KEY, name);
    const query = new Map(placed(read, "query"));

    for (const [param, value] of query) {
      assert.equal(url.searchParams.get(param), asQuery(value), name);
    }

    for (const param of url.searchParams.keys()) {
      assert.ok(
        query.has(param) || param === "includeCustomHeaders",
        `${name} sends no undeclared query parameter (${param})`
      );
    }

    if (read.method === "POST") {
      assert.deepEqual(
        JSON.parse(request?.body ?? ""),
        Object.fromEntries(placed(read, "body")),
        `${name} body`
      );
    } else {
      assert.equal(request?.body, undefined, `${name} sends no body`);
    }
  }
});

test("heyreach: a native read without its path or required parameters is refused before any request", async () => {
  let checked = 0;

  for (const [name, read] of entries) {
    const needed = Object.entries(read.params ?? {}).filter(
      ([, param]) => param.in === "path" || param.required === true
    );

    for (const [missing] of needed) {
      const { outbound, requests } = client();

      const params = Object.fromEntries(
        Object.entries(sample(read)).filter(([param]) => param !== missing)
      );

      // oxlint-disable-next-line no-await-in-loop -- one refusal at a time keeps a failure readable.
      await assert.rejects(
        async () => await outbound.native.read(name, params),
        (error) =>
          OutboundError.is(error) &&
          error.code === "Invalid" &&
          error.message.includes(`${name} needs "${missing}"`)
      );
      assert.equal(requests.length, 0);
      checked += 1;
    }
  }

  assert.equal(checked, 14, "six path and eight required parameters");
});

test("heyreach: no native read is a documented write, and raw agrees on what is a read", () => {
  const { raw } = heyreach({ apiKey: KEY });
  const writes = documentedWrites();
  assert.equal(writes.length, 61, "the table's writes were found");

  for (const [name, read] of entries) {
    assert.ok(
      !writes.includes(`${read.method} ${read.path}`),
      `${name} is not a write`
    );
    assert.ok(
      raw.isRead(read.method, read.path.replaceAll(/\{[^}]+\}/gu, "7")),
      `raw accepts ${name}`
    );
  }

  for (const write of writes) {
    const [method = "", route = ""] = write.split(" ");

    assert.equal(
      // SAFETY: the table's methods are checked by coverage-docs.test.ts.
      raw.isRead(method as "POST", route.replaceAll(/\{[^}]+\}/gu, "7")),
      false,
      `raw refuses ${write}`
    );
  }
});

test("heyreach: typed native reads place query, path and body parameters", async () => {
  const { outbound, requests } = client();
  await outbound.native.reads.listById({ listId: 3457 });
  await outbound.native.reads.voiceUsage({ id: 12, kind: "PREDEFINED" });

  await outbound.native.reads.enrichEmailJob({ jobId: 88 });

  await outbound.native.reads.statsByCampaign({
    accountIds: [],
    campaignIds: [274_079],
    startDate: "2026-10-01T00:00:00.000Z",
  });

  await outbound.native.reads.campaignsForLead({
    limit: 10,
    offset: 0,
    profileUrl: "https://www.linkedin.com/in/example-person-1",
  });

  await outbound.native.reads.checkApiKey();
  const urls = requests.map((request) => new URL(request.url));

  assert.deepEqual(
    urls.map((url) => url.pathname.replace("/api/public", "") + url.search),
    [
      "/list/GetById?listId=3457",
      "/voice/GetVoiceUsage/12?kind=PREDEFINED",
      "/enrichment/enrich-email/check-job/88",
      "/stats/GetOverallStatsByCampaign",
      "/campaign/GetCampaignsForLead",
      "/auth/CheckApiKey",
    ]
  );
  assert.deepEqual(JSON.parse(requests[3]?.body ?? ""), {
    accountIds: [],
    campaignIds: [274_079],
    startDate: "2026-10-01T00:00:00.000Z",
  });
  assert.deepEqual(JSON.parse(requests[4]?.body ?? ""), {
    limit: 10,
    offset: 0,
    profileUrl: "https://www.linkedin.com/in/example-person-1",
  });

  const wrong = (): unknown[] => [
    // @ts-expect-error -- listId is required
    outbound.native.reads.listById(),
    // @ts-expect-error -- an id is a number
    outbound.native.reads.senderVoice({ accountId: "1101" }),
    // @ts-expect-error -- not in the catalog
    outbound.native.reads.accountProxy(),
  ];

  assert.equal(wrong.length, 0);
});

test("heyreach: one webhook is always read without its custom headers, which can hold a secret", async () => {
  const { outbound, requests } = client();
  await outbound.native.reads.webhookById({ webhookId: 42 });

  await outbound.raw.request(
    "GET",
    "/webhooks/GetWebhookById?webhookId=42&includeCustomHeaders=true"
  );

  assert.equal(
    Object.hasOwn(NATIVE.webhookById.params, "includeCustomHeaders"),
    false,
    "the catalog offers no way to ask for them"
  );

  for (const request of requests) {
    const url = new URL(request.url);
    assert.equal(url.searchParams.get("webhookId"), "42");
    assert.deepEqual(url.searchParams.getAll("includeCustomHeaders"), [
      "false",
    ]);
  }

  await assert.rejects(
    async () =>
      await outbound.native.read("webhookById", {
        includeCustomHeaders: true,
        webhookId: 42,
      }),
    /no parameter "includeCustomHeaders"/u
  );
});

test("heyreach: the reads that return secrets are not in the catalog and raw refuses them", async () => {
  const { outbound, requests } = client();
  const paths = entries.map(([, read]) => read.path);
  assert.ok(!paths.some((route) => /api-keys|GetAccountProxy/iu.test(route)));
  assert.ok(!paths.some((route) => route.includes("GetVoiceMessageAudio")));

  for (const route of [
    "/li_account/GetAccountProxy/1101",
    "/management/organizations/api-keys/workspaces/12",
  ]) {
    // oxlint-disable-next-line no-await-in-loop -- one refusal at a time keeps a failure readable.
    await assert.rejects(
      async () => await outbound.raw.request("GET", route),
      (error) => OutboundError.is(error) && error.code === "Unsupported"
    );
  }

  assert.equal(requests.length, 0);
});

test("heyreach: the organization reads draw on their own lane", async () => {
  const organization = entries.filter(([, read]) =>
    read.path.startsWith("/management/organizations")
  );

  assert.deepEqual(organization.map(([name]) => name).toSorted(), [
    "organizationLinkedInAccounts",
    "organizationUser",
    "organizationUsers",
    "organizationWorkspaces",
    "workspaceUsers",
  ]);

  for (const [name, read] of entries) {
    assert.equal(
      read.lane,
      organization.some(([other]) => other === name)
        ? "organization"
        : undefined,
      `${name} lane`
    );
    assert.equal(
      read.description.includes("organization API key"),
      read.lane === "organization",
      `${name} says which key it needs`
    );
  }

  const { outbound, requests } = client();
  await outbound.native.reads.organizationWorkspaces({ Limit: 50, Offset: 0 });
  await outbound.native.reads.workspaceUsers({ limit: 10, workspaceId: 12 });
  const [workspaces, users] = requests.map((request) => new URL(request.url));
  assert.equal(workspaces?.search, "?Limit=50&Offset=0");
  assert.equal(
    users?.pathname,
    "/api/public/management/organizations/users/workspaces/12"
  );
  assert.deepEqual(JSON.parse(requests[1]?.body ?? ""), { limit: 10 });
  const [snapshot] = await outbound.limits();

  assert.deepEqual(
    snapshot?.windows.map((window) => [window.lane, window.used]),
    [
      // The default budget has two windows: the burst and the minute.
      ["default", 2],
      ["default", 2],
      ["organization", 2],
    ]
  );
});
