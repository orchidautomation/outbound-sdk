import assert from "node:assert/strict";
import { test } from "node:test";

import { createOutbound, OutboundError } from "../src/index.ts";
import type { Adapter, OutboundApi, OutboundPlugin } from "../src/index.ts";
import { demoData, memory } from "../src/memory/index.ts";

const adapter = (): Adapter => memory({ data: demoData() });

const recorder = (name: string, log: string[]): OutboundPlugin => ({
  name,
  wrap: async (operation, next) => {
    log.push(`${name}:in:${operation.kind}`);
    const output = await next(operation);
    log.push(`${name}:out`);

    return output;
  },
});

test("plugins wrap operations as an ordered onion, first plugin outermost", async () => {
  const log: string[] = [];

  const outbound = createOutbound({
    adapter: adapter(),
    plugins: [recorder("outer", log), recorder("inner", log)],
  });

  await outbound.campaigns.list();
  assert.deepEqual(log, [
    "outer:in:campaigns.list",
    "inner:in:campaigns.list",
    "inner:out",
    "outer:out",
  ]);
});

test("a plugin can rewrite the operation and the result", async () => {
  const forcePaused: OutboundPlugin = {
    name: "force-paused",
    wrap: async (operation, next) => {
      const output = await next(
        operation.kind === "campaigns.list"
          ? { ...operation, query: { ...operation.query, status: "paused" } }
          : operation
      );

      return { ...output, evidence: "sampled" };
    },
  };

  const outbound = createOutbound({
    adapter: adapter(),
    plugins: [forcePaused],
  });

  const page = await outbound.campaigns.list();
  assert.deepEqual(
    page.items.map((item) => item.sourceId),
    ["cmp_agencies"]
  );
  assert.equal(page.meta.evidence, "sampled");
});

test("a plugin can answer without calling the adapter", async () => {
  const empty: OutboundPlugin = {
    name: "empty",
    wrap: () => Promise.resolve({ evidence: "exact", items: [], stale: true }),
  };

  const page = await createOutbound({
    adapter: adapter(),
    plugins: [empty],
  }).campaigns.list();

  assert.deepEqual(page.items, []);
  assert.equal(page.meta.stale, true);
});

test("a plugin sees what the call has used through info.state", async () => {
  const seen: number[] = [];

  const watcher: OutboundPlugin = {
    name: "watcher",
    wrap: async (operation, next, info) => {
      const output = await next(operation);
      seen.push(info.state.requests);
      assert.equal(info.provider, "memory");
      assert.equal(info.workspaceId, "default");

      return output;
    },
  };

  await createOutbound({
    adapter: adapter(),
    plugins: [watcher],
  }).campaigns.list();
  assert.deepEqual(seen, [0]);
});

test("a plugin can turn a capability off, and the error names the plugin", async () => {
  const noBodies: OutboundPlugin = {
    capabilities: (capabilities) => ({
      ...capabilities,
      "messages.body": false,
    }),
    name: "no-bodies",
  };

  const outbound = createOutbound({ adapter: adapter(), plugins: [noBodies] });
  assert.equal(outbound.capabilities["messages.body"], false);
  assert.equal(outbound.capabilities["messages.list"], true);
  await assert.rejects(
    () => outbound.messages.list({ include: ["body"] }),
    (error) =>
      OutboundError.is(error) &&
      error.code === "Unsupported" &&
      /the no-bodies plugin turned it off \(messages\.body\)/u.test(
        error.message
      )
  );
  assert.equal(
    (await outbound.messages.list()).items.length,
    3,
    "listing without bodies still works"
  );
});

test("a plugin cannot widen what the adapter declared", () => {
  const greedy: OutboundPlugin = {
    capabilities: (capabilities) => ({
      ...capabilities,
      "replies.category": "vendor",
      workspaces: true,
    }),
    name: "greedy",
  };

  const outbound = createOutbound({
    adapter: memory({
      capabilities: { "replies.category": false, workspaces: false },
    }),
    plugins: [greedy],
  });

  assert.equal(outbound.capabilities["replies.category"], false);
  assert.equal(outbound.capabilities.workspaces, false);
});

test("a plugin can lower a grade without turning the capability off", () => {
  const derive: OutboundPlugin = {
    capabilities: (capabilities) => ({
      ...capabilities,
      "stats.byDay": "derived",
    }),
    name: "derive",
  };

  const outbound = createOutbound({ adapter: adapter(), plugins: [derive] });
  assert.equal(outbound.capabilities["stats.byDay"], "derived");
});

test("extend adds typed methods to the instance", async () => {
  const counter: OutboundPlugin<{ countCampaigns: () => Promise<number> }> = {
    extend: (outbound: OutboundApi) => ({
      countCampaigns: async () =>
        (await outbound.campaigns.listAll().toArray()).length,
    }),
    name: "counter",
  };

  const outbound = createOutbound({ adapter: adapter(), plugins: [counter] });
  assert.equal(await outbound.countCampaigns(), 2);
});

test("extend cannot replace something that already exists", () => {
  const clash: OutboundPlugin<{ campaigns: number }> = {
    extend: () => ({ campaigns: 1 }),
    name: "clash",
  };

  assert.throws(
    () => createOutbound({ adapter: adapter(), plugins: [clash] }),
    (error) =>
      OutboundError.is(error) &&
      error.code === "Invalid" &&
      /The clash plugin adds "campaigns", which already exists/u.test(
        error.message
      )
  );
});

test("the same plugin cannot be listed twice", () => {
  const log: string[] = [];
  assert.throws(
    () =>
      createOutbound({
        adapter: adapter(),
        plugins: [recorder("twice", log), recorder("twice", log)],
      }),
    /The twice plugin is listed twice/u
  );
});

test("the instance lists its plugins outermost first", () => {
  const log: string[] = [];

  const outbound = createOutbound({
    adapter: adapter(),
    plugins: [recorder("a", log), recorder("b", log)],
  });

  assert.deepEqual(
    outbound.plugins.map((plugin) => plugin.name),
    ["a", "b"]
  );
});
