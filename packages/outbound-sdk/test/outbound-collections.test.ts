import assert from "node:assert/strict";
import { test } from "node:test";

import { createOutbound, OutboundError } from "../src/index.ts";
import type { Adapter, CapabilityDeclaration } from "../src/index.ts";
import { demoData, memory } from "../src/memory/index.ts";
import type { MemoryData } from "../src/memory/index.ts";

const campaigns = (count: number): MemoryData => ({
  campaigns: Array.from({ length: count }, (_, index) => ({
    id: `c${String(index + 1).padStart(2, "0")}`,
    status: index % 2 === 0 ? ("active" as const) : ("paused" as const),
  })),
});

const client = (
  data: MemoryData = demoData(),
  capabilities?: CapabilityDeclaration,
  pageSize = 50
) =>
  createOutbound({
    adapter: memory({ capabilities, data, pageSize, workspaceId: "client-a" }),
  });

// Counts calls that reach the adapter, to prove a refusal happened before any I/O.
const counting = (
  adapter: Adapter
): { adapter: Adapter; calls: () => number } => {
  let calls = 0;

  const counted = Object.fromEntries(
    Object.entries(adapter).map(([key, value]) => [
      key,
      typeof value === "function" &&
      (key.startsWith("list") || key.startsWith("get") || key === "stats")
        ? (...parameters: unknown[]) => {
            calls += 1;

            return (value as (...inner: unknown[]) => unknown)(...parameters);
          }
        : value,
    ])
  ) as unknown as Adapter;

  return { adapter: counted, calls: () => calls };
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

test("list returns one page with a cursor, and the cursor continues it", async () => {
  const outbound = client(campaigns(5), undefined, 2);
  const first = await outbound.campaigns.list();
  assert.deepEqual(
    first.items.map((item) => item.sourceId),
    ["c01", "c02"]
  );
  assert.equal(first.complete, false);
  assert.equal(first.meta.complete, false);
  assert.ok(first.cursor);
  const second = await outbound.campaigns.list({ cursor: first.cursor });
  assert.deepEqual(
    second.items.map((item) => item.sourceId),
    ["c03", "c04"]
  );
  const last = await outbound.campaigns.list({ cursor: second.cursor });
  assert.deepEqual(
    last.items.map((item) => item.sourceId),
    ["c05"]
  );
  assert.equal(last.cursor, undefined);
  assert.equal(last.complete, true);
});

test("every record carries provider, workspace and a provider-qualified ref", async () => {
  const outbound = client();
  const { items } = await outbound.campaigns.list();
  assert.equal(items[0]?.ref, "memory:client-a:cmp_founders");
  assert.equal(items[0]?.provider, "memory");
  assert.equal(items[0]?.workspaceId, "client-a");
  assert.equal(items[0]?.schemaVersion, 1);
});

test("listAll walks every page and exposes a cursor to resume from", async () => {
  const outbound = client(campaigns(7), undefined, 3);
  const walk = outbound.campaigns.listAll();
  const seen: string[] = [];
  let resumeFrom: string | undefined;

  for await (const campaign of walk) {
    seen.push(campaign.sourceId);

    if (seen.length === 3) {
      // After the first page is handed out, the walker fetches the second.
      resumeFrom = walk.cursor;
    }
  }

  assert.deepEqual(seen, ["c01", "c02", "c03", "c04", "c05", "c06", "c07"]);
  assert.equal(walk.cursor, undefined);
  assert.equal(walk.meta?.complete, true);

  assert.equal(
    resumeFrom,
    undefined,
    "the cursor only advances once a page is fully handed out"
  );

  // A walk that died while reading page two restarts at page two, so the
  // record it was on is delivered again: at-least-once, never skipped.
  const partial = outbound.campaigns.listAll();
  const iterator = partial[Symbol.asyncIterator]();

  for (let taken = 0; taken < 4; taken += 1) {
    await iterator.next();
  }

  assert.ok(
    partial.cursor,
    "the cursor points at page two while page two is being read"
  );

  const resumed = await outbound.campaigns
    .listAll({ cursor: partial.cursor })
    .toArray();

  assert.deepEqual(
    resumed.map((item) => item.sourceId),
    ["c04", "c05", "c06", "c07"]
  );
});

test("listAll stops at max and respects the page size hint", async () => {
  const outbound = client(campaigns(9), undefined, 50);

  const firstFour = await outbound.campaigns
    .listAll({ limit: 2, max: 4 })
    .toArray();

  assert.deepEqual(
    firstFour.map((item) => item.sourceId),
    ["c01", "c02", "c03", "c04"]
  );
});

test("a cursor from another listing or workspace is rejected", async () => {
  const outbound = client(campaigns(5), undefined, 2);
  const { cursor } = await outbound.campaigns.list();
  assert.ok(cursor);
  const wrongListing = await failure(() => outbound.leads.list({ cursor }));
  assert.equal(wrongListing.code, "Invalid");
  assert.match(
    wrongListing.message,
    /not valid for leads\.list \(it belongs to campaigns\.list\)/u
  );

  const other = createOutbound({
    adapter: memory({ data: campaigns(5), workspaceId: "client-b" }),
  });

  assert.equal(
    (await failure(() => other.campaigns.list({ cursor }))).code,
    "Invalid"
  );
  assert.equal(
    (await failure(() => outbound.campaigns.list({ cursor: "garbage" }))).code,
    "Invalid"
  );
});

test("get returns the record with meta and throws NotFound for a missing one", async () => {
  const outbound = client();
  const campaign = await outbound.campaigns.get("cmp_founders");
  assert.equal(campaign.name, "Q4 SaaS founders");
  assert.equal(campaign.meta.evidence, "exact");
  assert.equal(campaign.meta.complete, true);
  assert.equal(campaign.meta.provider, "memory");
  assert.match(campaign.meta.fetchedAt, /^\d{4}-\d{2}-\d{2}T/u);
  const error = await failure(() => outbound.campaigns.get("nope"));
  assert.equal(error.code, "NotFound");
});

test("get accepts a ref, and rejects a ref from another workspace", async () => {
  const outbound = client();
  const campaign = await outbound.campaigns.get("memory:client-a:cmp_founders");
  assert.equal(campaign.sourceId, "cmp_founders");

  const error = await failure(() =>
    outbound.campaigns.get("memory:client-b:cmp_founders")
  );

  assert.equal(error.code, "Invalid");
  assert.match(error.message, /belongs to workspace client-b, not client-a/u);
});

test("exists never throws for a missing record", async () => {
  const outbound = client();
  assert.equal(await outbound.campaigns.exists("cmp_founders"), true);
  assert.equal(await outbound.campaigns.exists("nope"), false);
});

test("getMany returns partial failure as data, in request order", async () => {
  const outbound = client();

  const result = await outbound.campaigns.getMany(
    ["cmp_agencies", "nope", "cmp_founders"],
    {
      concurrency: 2,
    }
  );

  assert.deepEqual(
    result.results.map((entry) => entry.id),
    ["cmp_agencies", "cmp_founders"]
  );
  assert.deepEqual(
    result.errors.map((entry) => [entry.id, entry.error.code]),
    [["nope", "NotFound"]]
  );
});

test("filters campaigns by status", async () => {
  const outbound = client(campaigns(6));
  const { items, meta } = await outbound.campaigns.list({ status: "paused" });
  assert.deepEqual(
    items.map((item) => item.sourceId),
    ["c02", "c04", "c06"]
  );
  assert.equal(meta.evidence, "exact");
});

test("filters in the wrapper and marks the result derived when the vendor cannot filter", async () => {
  const outbound = client(campaigns(6), {
    "campaigns.status": "client",
    "leads.since": "client",
  });

  const paused = await outbound.campaigns.list({ status: "paused" });
  assert.deepEqual(
    paused.items.map((item) => item.sourceId),
    ["c02", "c04", "c06"]
  );
  assert.equal(paused.meta.evidence, "derived");

  const leads = await client(demoData(), {
    "leads.since": "client",
  }).leads.list({
    since: "2026-10-03T00:00:00Z",
  });

  assert.deepEqual(
    leads.items.map((item) => item.sourceId),
    ["lead_2"]
  );
  assert.equal(leads.meta.evidence, "derived");
});

test("refuses an unsupported filter before any adapter call", async () => {
  const spy = counting(
    memory({ capabilities: { "campaigns.status": false }, data: campaigns(3) })
  );

  const outbound = createOutbound({ adapter: spy.adapter });

  const error = await failure(() =>
    outbound.campaigns.list({ status: "active" })
  );

  assert.equal(error.code, "Unsupported");
  assert.match(
    error.message,
    /the memory adapter does not support it \(campaigns\.status\)/u
  );
  assert.equal(spy.calls(), 0);
  assert.equal(outbound.capabilities["campaigns.status"], false);
});

test("an adapter that declares nothing supports only campaigns", async () => {
  const bare = memory({ data: demoData() });

  const outbound = createOutbound({
    adapter: { ...bare, capabilities: undefined },
  });

  assert.equal((await outbound.campaigns.list()).items.length, 2);

  for (const action of [
    () => outbound.leads.list(),
    () => outbound.senders.list(),
    () => outbound.replies.list(),
    () => outbound.messages.list(),
    () => outbound.workspaces.list(),
    () => outbound.stats(),
    () => outbound.campaign("cmp_founders").sequence(),
    () => outbound.lead("lead_1").timeline(),
  ]) {
    assert.equal((await failure(action)).code, "Unsupported");
  }
});

test("rejects malformed input as Invalid before any adapter call", async () => {
  const spy = counting(memory({ data: demoData() }));
  const outbound = createOutbound({ adapter: spy.adapter });

  for (const action of [
    () => outbound.campaigns.list({ limit: 0 }),
    () => outbound.campaigns.list({ limit: 1.5 }),
    () => outbound.campaigns.get(" "),
    () => outbound.leads.list({ since: "yesterday" }),
    () => outbound.leads.list({ since: "2026-02-01", until: "2026-01-01" }),
    () => outbound.stats({ from: "2026/01/01" }),
    () => outbound.stats({ from: "2026-02-01", to: "2026-01-01" }),
    () => outbound.stats({ scope: "campaign" }),
  ]) {
    assert.equal((await failure(action)).code, "Invalid");
  }

  assert.equal(spy.calls(), 0);
});

test("an adapter that returns a malformed record fails loudly", async () => {
  const base = memory({ data: demoData() });

  const outbound = createOutbound({
    adapter: {
      ...base,
      getCampaign: async (id, ctx) => ({
        ...(await base.getCampaign(id, ctx)),
        status: "running" as never,
      }),
    },
  });

  const error = await failure(() => outbound.campaigns.get("cmp_founders"));
  assert.equal(error.code, "Provider");
  assert.match(
    error.message,
    /returned an invalid record for campaigns\.get at status/u
  );
});

test("an unexpected adapter exception becomes an OutboundError with the cause kept", async () => {
  const base = memory({ data: demoData() });
  const cause = new TypeError("cannot read properties of undefined");

  const outbound = createOutbound({
    adapter: { ...base, listCampaigns: () => Promise.reject(cause) },
  });

  const error = await failure(() => outbound.campaigns.list());
  assert.equal(error.code, "Provider");
  assert.equal(error.cause, cause);
});
