// Types a caller writes in their own code: an instance with plugins, the
// memory adapter's options, and a provider id checked at run time. The type
// check runs over this file, so each `@ts-expect-error` below fails it if the
// line it marks ever starts compiling.

import assert from "node:assert/strict";
import { test } from "node:test";

import type { z } from "zod";

import { exporter } from "../src/exporter/index.ts";
import type { ExportOptions, RowWriter } from "../src/exporter/index.ts";
import { createOutbound } from "../src/index.ts";
import type { Outbound, OutboundWith } from "../src/index.ts";
import { insights } from "../src/insights/index.ts";
import { instantly } from "../src/instantly/index.ts";
import { ALL_PROVIDERS, fromEnv } from "../src/loader/index.ts";
import { demoData, memory } from "../src/memory/index.ts";
import type { MemoryOptions } from "../src/memory/index.ts";
import { isProviderId, providers } from "../src/providers/index.ts";
import type { ProviderId } from "../src/providers/index.ts";
import { smartlead } from "../src/smartlead/index.ts";
import { createTools } from "../src/tools/index.ts";

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

// An adapter picked at run time, the way an app reads a setting.
const pick = (vendor: string) =>
  createOutbound({
    adapter:
      vendor === "smartlead"
        ? smartlead({ apiKey: "sl_test_key_0123456789abcdef" })
        : instantly({ apiKey: "inst_test_key_0123456789abcdef" }),
    plugins: [insights()],
  });

test("an adapter chosen with a ternary builds an instance with no cast", () => {
  const outbound: Outbound = pick("instantly");
  assert.equal(outbound.provider, "instantly");
  assert.equal(pick("smartlead").provider, "smartlead");
  assert.equal(typeof pick("smartlead").insights.hotLeads, "function");

  // Either vendor may be behind it, so a read only Smartlead has is not typed.
  const { reads } = pick("smartlead").native;
  // @ts-expect-error -- campaignLeadSearch is Smartlead's alone
  assert.equal(typeof reads.campaignLeadSearch, "function");

  // A vendor's own reads stay typed when the adapter is known.
  const known = createOutbound({
    adapter: smartlead({ apiKey: "sl_test_key_0123456789abcdef" }),
  });

  assert.equal(typeof known.native.reads.campaignLeadSearch, "function");

  // @ts-expect-error -- not a read of this vendor
  assert.equal(known.native.reads.nope, undefined);
});

test("a tool takes an input typed from its schema or as a plain record", async () => {
  const tool = createTools(
    createOutbound({ adapter: memory({ data: demoData({ now: NOW }) }) })
  ).find((each) => each.name === "campaign_overview");

  assert.ok(tool);

  const record: Record<string, unknown> = { limit: 1 };

  const typed: z.input<z.ZodObject<{ limit: z.ZodOptional<z.ZodNumber> }>> = {
    limit: 1,
  };

  interface Asked {
    readonly limit?: number;
  }

  const asked: Asked = { limit: 1 };

  for (const input of [record, typed, asked]) {
    const result = await tool.call(input);
    assert.equal(result.ok, true, JSON.stringify(result));
  }

  const wrong = await tool.call({ limit: "many" });
  assert.equal(wrong.ok, false, "the input is still checked when it runs");
});

test("export takes an array or any iterable as well as a listing", async () => {
  const outbound = createOutbound({
    adapter: memory({ data: demoData({ now: NOW }) }),
    plugins: [exporter()],
  });

  const written: string[] = [];

  const to: RowWriter = {
    close: async () => {
      // Nothing to release.
    },
    write: (row) => {
      written.push(String(row.sourceId));

      return Promise.resolve();
    },
  };

  const options: ExportOptions = { columns: ["sourceId"], to };
  const leads = await outbound.leads.listAll().toArray();

  assert.ok(leads.length > 0);

  for (const source of [leads, new Set(leads), outbound.leads.listAll()]) {
    written.length = 0;
    assert.equal((await outbound.export(source, options)).rows, leads.length);
    assert.deepEqual(
      written,
      leads.map((lead) => lead.sourceId)
    );
  }

  // @ts-expect-error -- a single record is not a listing
  await assert.rejects(outbound.export(leads[0], options));
});
