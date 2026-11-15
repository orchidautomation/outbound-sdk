// Types a caller writes in their own code: an instance with plugins, the
// memory adapter's options, and a provider id checked at run time. The type
// check runs over this file, so each `@ts-expect-error` below fails it if the
// line it marks ever starts compiling.

import assert from "node:assert/strict";
import { test } from "node:test";

import { exporter } from "../src/exporter/index.ts";
import { createOutbound } from "../src/index.ts";
import type { Outbound, OutboundWith } from "../src/index.ts";
import { insights } from "../src/insights/index.ts";
import { ALL_PROVIDERS, fromEnv } from "../src/loader/index.ts";
import { demoData, memory } from "../src/memory/index.ts";
import type { MemoryOptions } from "../src/memory/index.ts";
import { isProviderId, providers } from "../src/providers/index.ts";
import type { ProviderId } from "../src/providers/index.ts";

const NOW = Date.parse("2026-11-14T12:00:00.000Z");

// A typed helper of the kind a test suite writes to try narrower vendors.
const instance = (capabilities?: MemoryOptions["capabilities"]) =>
  createOutbound({
    adapter: memory({ capabilities, data: demoData({ now: NOW }) }),
  });

// A provider name from a flag, checked without a cast.
const fromFlag = (value: string): ProviderId | typeof ALL_PROVIDERS | null =>
  value === ALL_PROVIDERS || isProviderId(value) ? value : null;

test("OutboundWith types an instance built with plugins", async () => {
  const plugins = [insights(), exporter()];

  const outbound: OutboundWith<typeof plugins> = createOutbound({
    adapter: memory({ data: demoData({ now: NOW }) }),
    plugins,
  });

  const one: OutboundWith<[ReturnType<typeof insights>]> = createOutbound({
    adapter: memory({ data: demoData({ now: NOW }) }),
    plugins: [insights()],
  });

  const hot = await outbound.insights.hotLeads({}, { now: NOW });
  assert.equal(hot.insight, "hot_leads");
  assert.equal(typeof outbound.export, "function");
  assert.equal(typeof one.insights.droppedReplies, "function");

  // An instance with plugins is still an instance.
  const bare: Outbound = one;
  assert.equal(bare.provider, "memory");

  // @ts-expect-error -- an instance with no plugins has no insights
  assert.equal(bare.insights, one.insights);

  // @ts-expect-error -- an instance without insights() is not one with them
  const missing: OutboundWith<[ReturnType<typeof insights>]> = createOutbound({
    adapter: memory(),
  });

  assert.equal(missing.provider, "memory");
});

test("MemoryOptions['capabilities'] types a helper that turns capabilities off", async () => {
  assert.equal(instance().capabilities["leads.get"], true);
  assert.equal(
    instance({ "leads.get": false }).capabilities["leads.get"],
    false
  );

  // @ts-expect-error -- not a capability
  assert.ok(instance({ "leads.nope": false }));

  await assert.rejects(
    async () => await instance({ "leads.get": false }).leads.get("lead_1"),
    { code: "Unsupported" }
  );
});

test("isProviderId accepts a catalog id and nothing else", () => {
  for (const provider of providers) {
    assert.equal(isProviderId(provider.id), true, provider.id);
  }

  assert.equal(isProviderId("heyreach"), true);
  assert.equal(isProviderId("nope"), false);
  assert.equal(isProviderId(ALL_PROVIDERS), false);
  assert.equal(isProviderId("Instantly"), false);
  assert.equal(isProviderId(""), false);
  assert.equal(isProviderId(undefined), false);
  assert.equal(isProviderId(42), false);
});

test("a provider name read as a string narrows to a ProviderId with no cast", async () => {
  const chosen = fromFlag("memory");
  assert.equal(chosen, "memory");
  assert.equal(fromFlag("nope"), null);

  // @ts-expect-error -- a plain string is not a ProviderId
  const unchecked: ProviderId = "memory" as string;
  assert.equal(unchecked, "memory");

  if (chosen !== null) {
    const adapter = await fromEnv({ provider: chosen });
    assert.equal(adapter.name, "memory");
  }
});
