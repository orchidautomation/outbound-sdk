import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { envVars as heyreachEnvVars, heyreach } from "../src/heyreach/index.ts";
import { OutboundError } from "../src/index.ts";
import {
  envVars as instantlyEnvVars,
  instantly,
} from "../src/instantly/index.ts";
import { fromEnv, loadableProviders } from "../src/loader/index.ts";
import {
  findProvider,
  PROVIDER_ENV,
  providers,
} from "../src/providers/index.ts";
import {
  envVars as smartleadEnvVars,
  smartlead,
} from "../src/smartlead/index.ts";

const manifest = JSON.parse(
  readFileSync(path.resolve(import.meta.dirname, "../package.json"), "utf-8")
) as { exports: Record<string, unknown> };

// Each adapter's own declaration, to compare the catalog against.
const adapters: Record<
  string,
  { envVars: readonly string[]; maturity: string }
> = {
  heyreach: {
    envVars: heyreachEnvVars,
    maturity: heyreach({ apiKey: "hr_key_for_catalog_test" }).maturity,
  },
  instantly: {
    envVars: instantlyEnvVars,
    maturity: instantly({ apiKey: "inst_key_for_catalog_test" }).maturity,
  },
  smartlead: {
    envVars: smartleadEnvVars,
    maturity: smartlead({ apiKey: "sl_key_for_catalog_test" }).maturity,
  },
};

test("every provider in the catalog is a public subpath, and can be loaded from the environment", () => {
  for (const provider of providers) {
    assert.ok(
      manifest.exports[`./${provider.id}`],
      `package.json exports ./${provider.id}`
    );
  }

  assert.deepEqual(
    loadableProviders(),
    providers.map((provider) => provider.id).toSorted()
  );
});

test("the catalog lists exactly the environment variables each adapter reads", () => {
  for (const [id, adapter] of Object.entries(adapters)) {
    const entry = findProvider(id);
    assert.ok(entry, `${id} is in the catalog`);
    assert.deepEqual(
      entry.envVars.map((variable) => variable.name).toSorted(),
      [...adapter.envVars].toSorted()
    );
    assert.equal(entry.maturity, adapter.maturity, `${id} maturity`);
    assert.ok(
      entry.envVars.some((variable) => variable.required),
      `${id} has a required key`
    );
  }

  const real = providers
    .filter((provider) => provider.id !== "memory")
    .map((provider) => provider.id);

  assert.deepEqual(
    real.toSorted(),
    Object.keys(adapters).toSorted(),
    "every real provider is checked here"
  );
});

test("provider ids are unique and lower-case", () => {
  const ids = providers.map((provider) => provider.id);
  assert.equal(new Set(ids).size, ids.length);

  for (const id of ids) {
    assert.match(id, /^[a-z][a-z0-9-]*$/u);
  }

  assert.equal(findProvider("nope"), undefined);
});

test("fromEnv builds the adapter named by the environment", async () => {
  const saved = {
    key: process.env.INSTANTLY_API_KEY,
    provider: process.env[PROVIDER_ENV],
  };

  try {
    process.env[PROVIDER_ENV] = "instantly";
    process.env.INSTANTLY_API_KEY = "inst_env_key_for_loader_test";
    const adapter = await fromEnv();
    assert.equal(adapter.name, "instantly");
    assert.equal((await fromEnv({ provider: "memory" })).name, "memory");

    // With no provider named, the vendor whose key is set is chosen.
    Reflect.deleteProperty(process.env, PROVIDER_ENV);
    assert.equal((await fromEnv()).name, "instantly");
    await assert.rejects(
      fromEnv({ provider: "mailchimp" }),
      (error) =>
        OutboundError.is(error) &&
        error.code === "Invalid" &&
        /Unknown provider "mailchimp"/u.test(error.message)
    );
  } finally {
    for (const [name, value] of [
      ["INSTANTLY_API_KEY", saved.key],
      [PROVIDER_ENV, saved.provider],
    ] as const) {
      if (value === undefined) {
        Reflect.deleteProperty(process.env, name);
      } else {
        process.env[name] = value;
      }
    }
  }
});
