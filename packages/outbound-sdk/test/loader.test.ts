import assert from "node:assert/strict";
import process from "node:process";
import { test } from "node:test";

import { OutboundError } from "../src/index.ts";
import type { Adapter } from "../src/index.ts";
import { configuredProviders, fromEnv } from "../src/loader/index.ts";

const VARIABLES = [
  "OUTBOUND_SDK_PROVIDER",
  "INSTANTLY_API_KEY",
  "SMARTLEAD_API_KEY",
  "HEYREACH_API_KEY",
] as const;

/** Runs `body` with exactly these variables set, then puts the environment back. */
const withEnv = async (
  values: Partial<Record<(typeof VARIABLES)[number], string>>,
  body: () => Promise<void>
): Promise<void> => {
  const saved = new Map(VARIABLES.map((name) => [name, process.env[name]]));

  for (const name of VARIABLES) {
    const value = values[name];

    if (value === undefined) {
      Reflect.deleteProperty(process.env, name);
    } else {
      process.env[name] = value;
    }
  }

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

const memberNames = (adapter: Adapter) =>
  adapter.members?.map((member) => member.name);

test("with no provider named, every vendor whose key is set is combined", async () => {
  await withEnv(
    { HEYREACH_API_KEY: "hr-test", INSTANTLY_API_KEY: "in-test" },
    async () => {
      assert.deepEqual(configuredProviders(), ["instantly", "heyreach"]);

      const adapter = await fromEnv();

      assert.equal(adapter.name, "combined");
      assert.deepEqual(memberNames(adapter), ["instantly", "heyreach"]);
    }
  );
});

test("one key set gives that adapter alone, not a combined one", async () => {
  await withEnv({ HEYREACH_API_KEY: "hr-test" }, async () => {
    const adapter = await fromEnv();

    assert.equal(adapter.name, "heyreach");
    assert.equal(adapter.members, undefined);
  });
});

test("a named provider wins over the keys that are set, and a comma list combines", async () => {
  await withEnv(
    {
      HEYREACH_API_KEY: "hr-test",
      INSTANTLY_API_KEY: "in-test",
      OUTBOUND_SDK_PROVIDER: "instantly",
    },
    async () => {
      assert.equal((await fromEnv()).name, "instantly");
      assert.equal((await fromEnv({ provider: "heyreach" })).name, "heyreach");

      const listed = await fromEnv({ provider: "heyreach, memory" });
      assert.deepEqual(memberNames(listed), ["heyreach", "memory"]);
    }
  );
});

test("with no key and no provider it names the variables to set", async () => {
  await withEnv({}, async () => {
    assert.deepEqual(configuredProviders(), []);

    await assert.rejects(
      fromEnv(),
      (error) =>
        OutboundError.is(error) &&
        error.code === "Invalid" &&
        error.message.includes("INSTANTLY_API_KEY") &&
        error.message.includes("HEYREACH_API_KEY") &&
        error.message.includes("OUTBOUND_SDK_PROVIDER")
    );
  });
});

test("a named provider that is unknown, or a list of only commas, is refused", async () => {
  await withEnv({}, async () => {
    await assert.rejects(
      fromEnv({ provider: "mailchimp" }),
      /Unknown provider "mailchimp"/u
    );
    await assert.rejects(fromEnv({ provider: " , " }), /names no provider/u);
  });
});
