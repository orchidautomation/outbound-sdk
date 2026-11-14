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
import {
  ALL_PROVIDERS,
  configuredProviders,
  fromEnv,
  loadableProviders,
} from "../src/loader/index.ts";
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

const KEY_VARS = [
  "INSTANTLY_API_KEY",
  "SMARTLEAD_API_KEY",
  "HEYREACH_API_KEY",
] as const;

/** Runs `body` with exactly these provider keys set, then restores the environment. */
const withKeys = async (
  keys: Partial<Record<(typeof KEY_VARS)[number], string>>,
  body: () => Promise<void>
): Promise<void> => {
  const names = [...KEY_VARS, PROVIDER_ENV];
  const saved = names.map((name) => [name, process.env[name]] as const);

  for (const name of names) {
    Reflect.deleteProperty(process.env, name);
  }

  Object.assign(process.env, keys);

  try {
    await body();
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) {
        Reflect.deleteProperty(process.env, name);
      } else {
        process.env[name] = value;
      }
    }
  }
};

test("`all` combines every provider whose key is set, and no other", async () => {
  await withKeys(
    {
      HEYREACH_API_KEY: "hr_env_key_for_loader_test",
      INSTANTLY_API_KEY: "inst_env_key_for_loader_test",
    },
    async () => {
      assert.deepEqual(configuredProviders(), ["instantly", "heyreach"]);

      const adapter = await fromEnv({ provider: ALL_PROVIDERS });

      assert.deepEqual(
        adapter.members?.map((member) => member.name),
        ["instantly", "heyreach"],
        "Smartlead has no key and memory needs none, so neither is included"
      );

      // The environment variable works like the option.
      process.env[PROVIDER_ENV] = "all";
      assert.equal((await fromEnv()).members?.length, 2);
    }
  );
});

test("`all` with one key is that provider alone, not a combined instance", async () => {
  await withKeys(
    { SMARTLEAD_API_KEY: "sl_env_key_for_loader_test" },
    async () => {
      const adapter = await fromEnv({ provider: "all" });

      assert.equal(adapter.name, "smartlead");
      assert.equal(adapter.members, undefined);
    }
  );
});

test("`all` with no key set says which variables to set, and an empty key does not count", async () => {
  await withKeys({ INSTANTLY_API_KEY: "  " }, async () => {
    assert.deepEqual(configuredProviders(), []);

    await assert.rejects(
      fromEnv({ provider: "all" }),
      (error) =>
        OutboundError.is(error) &&
        error.code === "Invalid" &&
        KEY_VARS.every((name) => error.message.includes(name))
    );
  });
});

test("no provider is named `all`, so the word can never pick one tool", () => {
  assert.equal(findProvider(ALL_PROVIDERS), undefined);
  assert.ok(!loadableProviders().includes(ALL_PROVIDERS));
});
