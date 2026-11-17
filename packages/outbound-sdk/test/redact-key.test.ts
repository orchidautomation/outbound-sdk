// A key given to redact makes its tokens the same in every instance and
// process that holds it, so redacted data joins across runs. The key itself
// never leaves the plugin: not in a record, an answer, an error or a note.

import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import { run } from "../src/cli/index.ts";
import { createOutbound, OutboundError } from "../src/index.ts";
import { insights, insightTools } from "../src/insights/index.ts";
import { demoData, memory } from "../src/memory/index.ts";
import { MIN_KEY_LENGTH, redact } from "../src/redact/index.ts";
import type { RedactOptions } from "../src/redact/index.ts";

// Test keys only, with no meaning outside this file.
const KEY = "test-key-0123456789abcdef0123456789abcdef";
const OTHER = "test-key-fedcba9876543210fedcba9876543210";

const instance = (options: RedactOptions) =>
  createOutbound({
    adapter: memory({ data: demoData(), workspaceId: "acme" }),
    plugins: [redact(options), insights()],
  });

/** Each lead's ref and its email and profile as redact wrote them. */
const tokens = async (options: RedactOptions) =>
  (await instance(options).leads.listAll().toArray()).map((lead) => [
    lead.ref,
    lead.email,
    lead.linkedinUrl,
  ]);

const isToken = (value: unknown): boolean =>
  typeof value === "string" && /^redacted:[0-9a-f]{16}$/u.test(value);

test("one key gives the same tokens in two instances, another key and no key give others", async () => {
  const first = await tokens({ key: KEY });
  const second = await tokens({ key: KEY });

  assert.ok(first.some(([, email]) => isToken(email)));
  assert.deepEqual(second, first);
  assert.notDeepEqual(await tokens({ key: OTHER }), first);
  assert.notDeepEqual(await tokens({}), first);
  assert.notDeepEqual(await tokens({}), await tokens({}));
});

/** Asserts `redact(options)` throws Invalid matching `pattern`, without the key in it. */
const refused = (options: RedactOptions, pattern: RegExp) =>
  assert.throws(
    () => redact(options),
    (error) =>
      OutboundError.is(error) &&
      error.code === "Invalid" &&
      pattern.test(error.message) &&
      !error.message.includes(options.key ?? "") &&
      !JSON.stringify(error).includes(options.key ?? "")
  );

test("a key that is too short, or given with hash, is refused when the plugin is built, without the key in the message", () => {
  const short = KEY.slice(0, MIN_KEY_LENGTH - 1);

  refused({ key: short }, /at least 32 characters/u);
  refused({ key: KEY, strategy: "hash" }, /only with strategy "mask"/u);
  assert.doesNotThrow(() => redact({ key: KEY.slice(0, MIN_KEY_LENGTH) }));
});

test("the key never appears in records, answers, tool results or refusals", async () => {
  const outbound = instance({ key: KEY });

  const seen: unknown[] = [
    await outbound.leads.listAll().toArray(),
    await outbound.replies.listAll().toArray(),
    await outbound.insights.leadCollisions({ include_past: true }),
    await outbound.insights.droppedReplies({}),
    await outbound.insights.hotLeads({}),
  ];

  for (const tool of insightTools(outbound)) {
    // oxlint-disable-next-line no-await-in-loop -- one call at a time keeps the order of what was seen.
    seen.push(await tool.call({}));
  }

  await assert.rejects(
    outbound.insights.personSummary({ person: "person1@example.com" }),
    (error) => {
      seen.push(error, String(error), (error as Error).stack);

      return OutboundError.is(error);
    }
  );

  const text = JSON.stringify(seen, (_key, value: unknown) =>
    value instanceof Error ? { ...value, message: value.message } : value
  );

  assert.ok(text.includes("redacted:"));
  assert.ok(!text.includes(KEY));
  assert.ok(!text.includes(KEY.slice(0, 16)));
});

/** Runs one CLI command with OUTBOUND_REDACT_KEY set to `key`. */
const cli = async (argv: readonly string[], key: string | undefined) => {
  const before = process.env.OUTBOUND_REDACT_KEY;
  const out: string[] = [];
  const err: string[] = [];

  if (key === undefined) {
    delete process.env.OUTBOUND_REDACT_KEY;
  } else {
    process.env.OUTBOUND_REDACT_KEY = key;
  }

  try {
    const code = await run(argv, {
      adapter: memory({ data: demoData(), workspaceId: "acme" }),
      stderr: (text) => {
        err.push(text);
      },
      stdout: (text) => {
        out.push(text);
      },
    });

    return { code, err: err.join("\n"), out: out.join("\n") };
  } finally {
    if (before === undefined) {
      delete process.env.OUTBOUND_REDACT_KEY;
    } else {
      process.env.OUTBOUND_REDACT_KEY = before;
    }
  }
};

test("the CLI keys redact with OUTBOUND_REDACT_KEY: two commands give the same tokens, and the key is never printed", async () => {
  const first = await cli(["leads", "--redact", "--compact"], KEY);
  const second = await cli(["leads", "--redact", "--compact"], KEY);
  const unkeyed = await cli(["leads", "--redact", "--compact"], undefined);

  assert.equal(first.code, 0, first.err);
  assert.match(first.out, /redacted:[0-9a-f]{16}/u);
  assert.equal(second.out, first.out);
  assert.notEqual(unkeyed.out, first.out);

  const short = await cli(["leads", "--redact"], KEY.slice(0, 20));

  assert.notEqual(short.code, 0);
  assert.match(short.err, /at least 32 characters/u);

  for (const each of [first, second, short]) {
    assert.ok(!each.out.includes(KEY.slice(0, 20)));
    assert.ok(!each.err.includes(KEY.slice(0, 20)));
  }
});

test("without --redact the CLI ignores OUTBOUND_REDACT_KEY, and a short one stops nothing", async () => {
  const plain = await cli(["leads", "--compact"], KEY.slice(0, 20));

  assert.equal(plain.code, 0, plain.err);
  assert.doesNotMatch(plain.out, /redacted:/u);
});

test("a config file's redact() keeps its own options, and the CLI says the key in the environment is not used", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "outbound-config-"));
  const file = path.join(directory, "outbound.config.mjs");

  const source = pathToFileURL(
    path.resolve(import.meta.dirname, "../src/redact/index.ts")
  ).href;

  await writeFile(
    file,
    `import { redact } from "${source}";\nexport default { plugins: [redact()] };\n`
  );

  const result = await cli(["leads", "--config", file, "--compact"], KEY);

  assert.equal(result.code, 0, result.err);
  assert.match(
    result.err,
    /OUTBOUND_REDACT_KEY is set, but the config file's redact\(\) takes its own options/u
  );
  assert.ok(!result.err.includes(KEY.slice(0, 20)));
  assert.ok(!result.out.includes(KEY.slice(0, 20)));
});
