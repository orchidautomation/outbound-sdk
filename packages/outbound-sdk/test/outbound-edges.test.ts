import assert from "node:assert/strict";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { test } from "node:test";

import {
  createOutbound,
  MemoryRateLimitStore,
  OutboundError,
} from "../src/index.ts";
import type { Adapter, CapabilityDeclaration } from "../src/index.ts";
import { demoData, memory } from "../src/memory/index.ts";
import { testAdapter } from "./helpers/http.ts";

const ALL: CapabilityDeclaration = {
  "leads.get": true,
  "leads.list": true,
  "messages.list": true,
  "replies.list": true,
  "senders.get": true,
  "senders.list": true,
  sequence: true,
  "stats.workspace": "exact",
  workspaces: true,
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

test("an adapter that declares a capability it does not implement fails as Unsupported", async () => {
  const base = memory({ data: demoData() });

  const hollow: Adapter = {
    capabilities: ALL,
    getCampaign: base.getCampaign,
    limits: base.limits,
    listCampaigns: base.listCampaigns,
    mapError: base.mapError,
    maturity: "unverified",
    name: "hollow",
    raw: base.raw,
    secrets: [],
    workspaceId: "default",
  };

  const outbound = createOutbound({ adapter: hollow });

  for (const [kind, action] of [
    ["leads.list", () => outbound.leads.list()],
    ["leads.get", () => outbound.leads.get("x")],
    ["messages.list", () => outbound.messages.list()],
    ["replies.list", () => outbound.replies.list()],
    ["senders.list", () => outbound.senders.list()],
    ["senders.get", () => outbound.senders.get("x")],
    ["sequence.get", () => outbound.campaign("x").sequence()],
    ["stats", () => outbound.stats()],
    ["workspaces.list", () => outbound.workspaces.list()],
  ] as const) {
    const error = await failure(action);
    assert.equal(error.code, "Unsupported", kind);
    assert.match(
      error.message,
      new RegExp(
        `The hollow adapter does not implement ${kind.replace(".", "\\.")}`,
        "u"
      )
    );
  }
});

test("client-side date filtering drops records with no date and keeps the range inclusive", async () => {
  const outbound = createOutbound({
    adapter: memory({
      capabilities: {
        "leads.since": "client",
        "messages.since": "client",
        "replies.since": "client",
      },
      data: {
        leads: [
          { createdAt: "2026-10-01T00:00:00.000Z", id: "a" },
          { createdAt: "2026-10-02T00:00:00.000Z", id: "b" },
          { id: "undated" },
        ],
        messages: [
          { direction: "out", id: "m1", sentAt: "2026-10-01T00:00:00.000Z" },
          { direction: "in", id: "m2", sentAt: "2026-10-03T00:00:00.000Z" },
        ],
      },
    }),
  });

  const leads = await outbound.leads.list({
    since: "2026-10-01T00:00:00Z",
    until: "2026-10-01T00:00:00Z",
  });

  assert.deepEqual(
    leads.items.map((lead) => lead.sourceId),
    ["a"]
  );
  assert.equal(
    (await outbound.leads.list()).items.length,
    3,
    "no range, no filtering"
  );
  const messages = await outbound.messages.list({ until: "2026-10-02" });
  assert.deepEqual(
    messages.items.map((message) => message.sourceId),
    ["m1"]
  );
  assert.equal(messages.meta.evidence, "derived");
  const replies = await outbound.replies.list({ since: "2026-10-02" });
  assert.deepEqual(
    replies.items.map((reply) => reply.sourceId),
    ["m2"]
  );
});

test("a workspace label cannot be empty or contain the ref separator", () => {
  for (const workspaceId of ["", "client:a"]) {
    assert.throws(
      () => memory({ workspaceId }),
      (error) =>
        OutboundError.is(error) &&
        error.code === "Invalid" &&
        /workspaceId must be/u.test(error.message)
    );
  }
});

test("raw is not available on an instance that fronts several adapters", async () => {
  const base = memory();
  const outbound = createOutbound({ adapter: { ...base, members: [base] } });
  const error = await failure(() => outbound.raw.get("/anything"));
  assert.equal(error.code, "Unsupported");
  assert.match(error.message, /Use outbound\.workspace\(id\)\.raw/u);
});

test("an adapter without caveats reports none", () => {
  assert.deepEqual(createOutbound({ adapter: memory() }).caveats, []);
});

// Everything else injects fetch and a virtual clock. This one uses the real
// fetch, clock and timers against a local server.
test("works end to end over real HTTP with the default runtime", async () => {
  let hits = 0;

  const server = createServer((request, response) => {
    hits += 1;

    if (hits === 1) {
      response.writeHead(503, { "retry-after": "0" }).end("{}");

      return;
    }

    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({ items: [{ id: "live", name: request.url }] })
    );
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = server.address() as AddressInfo;
  const base = testAdapter();

  try {
    const outbound = createOutbound({
      adapter: {
        ...base,
        listCampaigns: async (_query, ctx) => {
          const response = await ctx.request({
            method: "GET",
            url: `http://127.0.0.1:${port}/campaigns`,
          });

          const body = response.body as {
            items: { id: string; name: string }[];
          };

          return {
            items: body.items.map((item) => ({
              channel: "email" as const,
              createdAt: null,
              name: item.name,
              provider: "testvendor",
              raw: item,
              ref: `testvendor:default:${item.id}`,
              schemaVersion: 1 as const,
              sourceId: item.id,
              status: "active" as const,
              tags: [],
              workspaceId: "default",
            })),
          };
        },
      },
      rateLimitStore: new MemoryRateLimitStore(),
      retries: { backoff: () => 1, max: 2 },
    });

    const page = await outbound.campaigns.list();
    assert.equal(page.items[0]?.name, "/campaigns");
    assert.equal(
      page.meta.requests,
      2,
      "the 503 was retried over the real network"
    );
    assert.ok(Date.parse(page.meta.fetchedAt) > Date.UTC(2026, 0, 1));
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => {
      server.close(resolve);
    });
  }
});

test("a vendor with leads and senders only per campaign serves the scoped listing alone", async () => {
  const outbound = createOutbound({
    adapter: memory({
      capabilities: { "leads.list": false, "senders.list": false },
      data: demoData(),
    }),
  });

  assert.equal(
    (await outbound.campaign("cmp_founders").leads.list()).items.length,
    2
  );
  assert.equal(
    (await outbound.campaign("cmp_founders").senders.list()).items.length,
    2
  );
  assert.equal(
    (await failure(() => outbound.leads.list())).code,
    "Unsupported"
  );
  assert.equal(
    (await failure(() => outbound.senders.list())).code,
    "Unsupported"
  );

  const unscopedOnly = createOutbound({
    adapter: memory({
      capabilities: { "leads.byCampaign": false },
      data: demoData(),
    }),
  });

  assert.equal((await unscopedOnly.leads.list()).items.length, 3);
  assert.equal(
    (await failure(() => unscopedOnly.campaign("cmp_founders").leads.list()))
      .code,
    "Unsupported"
  );
});
