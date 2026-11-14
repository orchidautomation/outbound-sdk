import assert from "node:assert/strict";
import { test } from "node:test";

import { combine } from "../src/combine/index.ts";
import { createOutbound, defineNative, OutboundError } from "../src/index.ts";
import type { Adapter } from "../src/index.ts";
import { redact } from "../src/redact/index.ts";
import { API, createFetch, json, KEY, testAdapter } from "./helpers/http.ts";

const NATIVE = defineNative({
  inboxUnread: {
    description: "Unread replies in the shared inbox.",
    docs: "https://docs.vendor.test/inbox-unread",
    lane: "inbox",
    method: "POST",
    params: {
      filters: { description: "Vendor filters.", in: "body", type: "json" },
      limit: { description: "Page size.", in: "body", type: "number" },
      verbose: { description: "More fields.", in: "query", type: "boolean" },
    },
    path: "/inbox/unread",
  },
  leadNotes: {
    description: "Notes written on one lead.",
    method: "GET",
    params: {
      leadId: { description: "The lead.", in: "path", type: "string" },
      since: {
        description: "Only notes after this day.",
        in: "query",
        required: true,
        type: "string",
      },
      tags: { description: "Only these tags.", in: "query", type: "json" },
    },
    path: "/leads/{leadId}/notes",
  },
  placementTests: {
    baseUrl: "https://delivery.vendor.test/v2",
    description: "Inbox placement tests from the sister service.",
    method: "GET",
    path: "/tests",
  },
});

const adapter = (capabilities = {}): Adapter<typeof NATIVE> => ({
  ...testAdapter({
    capabilities: { native: true, ...capabilities },
    limits: {
      lanes: { inbox: [{ perMs: 1000, requests: 1000 }] },
      source: "test",
      windows: [{ perMs: 1000, requests: 1000 }],
    },
  }),
  native: NATIVE,
});

const client = (capabilities = {}) => {
  const http = createFetch(() => json({ rows: [1, 2] }));

  return {
    outbound: createOutbound({
      adapter: adapter(capabilities),
      fetch: http.fetch,
    }),
    requests: http.requests,
  };
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

test("the catalog lists what the vendor offers beyond the normalized reads", () => {
  const { outbound } = client();
  assert.deepEqual(Object.keys(outbound.native.catalog), [
    "inboxUnread",
    "leadNotes",
    "placementTests",
  ]);
  assert.equal(
    outbound.native.catalog.inboxUnread.docs,
    "https://docs.vendor.test/inbox-unread"
  );
  assert.equal(outbound.native.provider, "testvendor");
  assert.equal(outbound.capabilities.native, true);
});

test("a typed native read places each parameter in the path, query or body and returns the vendor's response", async () => {
  const { outbound, requests } = client();

  const notes = await outbound.native.reads.leadNotes({
    leadId: "a b/c",
    since: "2026-11-01",
    tags: ["x", "y"],
  });

  assert.deepEqual(notes.data, { rows: [1, 2] });
  assert.equal(notes.meta.provider, "testvendor");
  assert.equal(notes.meta.requests, 1);
  assert.equal(notes.meta.evidence, "exact");
  const get = new URL(requests[0]?.url ?? "");
  assert.equal(requests[0]?.method, "GET");
  assert.equal(get.origin + get.pathname, `${API}/leads/a%20b%2Fc/notes`);
  assert.equal(get.searchParams.get("since"), "2026-11-01");
  assert.equal(get.searchParams.get("tags"), '["x","y"]');
  assert.equal(requests[0]?.body, undefined);
  assert.equal(requests[0]?.headers.authorization, `Bearer ${KEY}`);

  await outbound.native.reads.inboxUnread({
    filters: { campaign: 7 },
    limit: 20,
    verbose: true,
  });

  const post = new URL(requests[1]?.url ?? "");
  assert.equal(requests[1]?.method, "POST");
  assert.equal(post.pathname, "/inbox/unread");
  assert.equal(post.searchParams.get("verbose"), "true");
  assert.deepEqual(JSON.parse(requests[1]?.body ?? ""), {
    filters: { campaign: 7 },
    limit: 20,
  });
});

test("a read with no parameters needs none, a POST still sends a body, and a sister service keeps its own host", async () => {
  const { outbound, requests } = client();
  await outbound.native.reads.placementTests();
  await outbound.native.reads.inboxUnread();
  assert.equal(
    new URL(requests[0]?.url ?? "").origin +
      new URL(requests[0]?.url ?? "").pathname,
    "https://delivery.vendor.test/v2/tests"
  );
  assert.deepEqual(JSON.parse(requests[1]?.body ?? ""), {});
});

test("a read can be called by a name learned at run time", async () => {
  const { outbound, requests } = client();

  const result = await outbound.native.read("leadNotes", {
    leadId: "42",
    since: "2026-01-01",
  });

  assert.deepEqual(result.data, { rows: [1, 2] });
  assert.equal(new URL(requests[0]?.url ?? "").pathname, "/leads/42/notes");
});

test("a bad native call is refused as Invalid before any request", async () => {
  const { outbound, requests } = client();
  const { read } = outbound.native;

  const cases: [() => unknown, RegExp][] = [
    [() => read("nope"), /no native read "nope"/u],
    [() => read("toString"), /no native read "toString"/u],
    [
      () => read("inboxUnread", { page: 2 }),
      /no parameter "page"\. It takes: filters, limit, verbose/u,
    ],
    [
      () => read("placementTests", { page: 2 }),
      /no parameter "page"\. It takes: nothing/u,
    ],
    [() => read("leadNotes", { since: "2026-01-01" }), /needs "leadId"/u],
    [() => read("leadNotes", { leadId: "1" }), /needs "since"/u],
    [() => read("leadNotes", { leadId: "1", since: null }), /needs "since"/u],
    [() => read("inboxUnread", { limit: "20" }), /"limit" must be a number/u],
    [
      () => read("inboxUnread", { verbose: "yes" }),
      /"verbose" must be a boolean/u,
    ],
    [
      () => read("leadNotes", { leadId: 7, since: "x" }),
      /"leadId" must be a string/u,
    ],
  ];

  for (const [action, message] of cases) {
    // oxlint-disable-next-line no-await-in-loop -- one assertion at a time keeps the failure readable.
    const error = await failure(action);
    assert.equal(error.code, "Invalid");
    assert.match(error.message, message);
  }

  assert.equal(requests.length, 0);
});

test("the compiler rejects a wrong parameter on a typed native read", () => {
  const { outbound } = client();

  const wrong = (): unknown[] => [
    // @ts-expect-error -- limit is a number
    outbound.native.reads.inboxUnread({ limit: "20" }),
    // @ts-expect-error -- leadId and since are required
    outbound.native.reads.leadNotes(),
    // @ts-expect-error -- since is required
    outbound.native.reads.leadNotes({ leadId: "1" }),
    // @ts-expect-error -- not in the catalog
    outbound.native.reads.missing(),
  ];

  assert.equal(wrong.length, 0);
});

test("native reads are off unless the adapter declares them, and off under redact", async () => {
  const off = client({ native: false });
  const error = await failure(() => off.outbound.native.read("inboxUnread"));
  assert.equal(error.code, "Unsupported");
  assert.equal(off.requests.length, 0);
  const http = createFetch(() => json({}));

  const redacted = createOutbound({
    adapter: adapter(),
    fetch: http.fetch,
    plugins: [redact({ fields: ["email"] })],
  });

  const refused = await failure(() => redacted.native.reads.inboxUnread());
  assert.equal(refused.code, "Unsupported");
  assert.match(refused.message, /redact plugin turned it off/u);
  assert.equal(http.requests.length, 0);
});

test("a combined instance has no native reads of its own; each workspace keeps its own", async () => {
  const http = createFetch(() => json({ ok: true }));

  const outbound = createOutbound({
    adapter: combine([adapter()]),
    fetch: http.fetch,
  });

  assert.deepEqual(outbound.native.catalog, {});
  const error = await failure(() => outbound.native.read("inboxUnread"));
  assert.equal(error.code, "Unsupported");
  assert.match(error.message, /workspace\(id\)\.native/u);

  const result = await outbound
    .workspace("default")
    .native.read("placementTests");

  assert.deepEqual(result.data, { ok: true });
});

test("a failed native read is a normalized error without the key", async () => {
  const http = createFetch(() => json({ message: `bad key ${KEY}` }, 401));

  const outbound = createOutbound({
    adapter: adapter(),
    fetch: http.fetch,
    retries: 0,
  });

  const error = await failure(() => outbound.native.reads.placementTests());
  assert.equal(error.code, "Unauthorized");
  assert.ok(!error.message.includes(KEY));
});
