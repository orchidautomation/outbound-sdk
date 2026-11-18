// OUT-150: one key, one token. redact reads OUTBOUND_REDACT_KEY as the CLI
// and `outbound mcp` do, `hash` uses the key when there is one, and a redact
// with no key says so: `hash` warns once on stderr that its tokens can be
// computed from a guessed address, and both strategies note it on answers.
// The warning is once per process, so this file is the first to build an
// unkeyed hash in its process.

import assert from "node:assert/strict";
import process from "node:process";
import { mock, test } from "node:test";

import { run } from "../src/cli/index.ts";
import { createOutbound, OutboundError } from "../src/index.ts";
import { demoData, memory } from "../src/memory/index.ts";
import { REDACT_KEY_ENV, redact } from "../src/redact/index.ts";
import type { RedactOptions } from "../src/redact/index.ts";

// Test keys only, with no meaning outside this file.
const KEY = "test-key-0123456789abcdef0123456789abcdef";
const OTHER = "test-key-fedcba9876543210fedcba9876543210";

/** Runs `body` with OUTBOUND_REDACT_KEY set to `key`, or unset. */
const withEnv = async <T>(
  key: string | undefined,
  body: () => Promise<T> | T
): Promise<T> => {
  const before = process.env.OUTBOUND_REDACT_KEY;

  if (key === undefined) {
    delete process.env.OUTBOUND_REDACT_KEY;
  } else {
    process.env.OUTBOUND_REDACT_KEY = key;
  }

  try {
    return await body();
  } finally {
    if (before === undefined) {
      delete process.env.OUTBOUND_REDACT_KEY;
    } else {
      process.env.OUTBOUND_REDACT_KEY = before;
    }
  }
};

const instance = (options: RedactOptions) =>
  createOutbound({
    adapter: memory({ data: demoData(), workspaceId: "acme" }),
    plugins: [redact(options)],
  });

const leadsOf = async (options: RedactOptions) =>
  await instance(options).leads.list();

/** Each lead's ref, email, name and profile as redact wrote them. */
const tokens = async (options: RedactOptions) =>
  (await leadsOf(options)).items.map((lead) => [
    lead.ref,
    lead.email,
    lead.firstName,
    lead.linkedinUrl,
  ]);

const DEPRECATED =
  /hash strategy has no key, so anyone can compute a token from a guessed email address/u;

const PER_PROCESS =
  /redact has no key, so its tokens .* hold only within this instance or process/u;

test("unkeyed hash still works, warns once on stderr and notes it on every answer that holds a token", async () => {
  const warn = mock.method(console, "warn", () => {});

  try {
    const first = await withEnv(undefined, () => leadsOf({ strategy: "hash" }));

    const second = await withEnv(undefined, () =>
      leadsOf({ strategy: "hash" })
    );

    assert.equal(warn.mock.callCount(), 1);
    const [message] = warn.mock.calls[0]?.arguments ?? [];
    assert.match(String(message), DEPRECATED);
    assert.match(
      String(message),
      /OUTBOUND_REDACT_KEY or pass redact\(\{ key \}\)/u
    );

    assert.match(first.items[0]?.email ?? "", /^redacted:[0-9a-f]{16}$/u);
    assert.deepEqual(
      second.items.map((lead) => lead.email),
      first.items.map((lead) => lead.email),
      "unkeyed hash is still the same from one instance to the next"
    );

    for (const page of [first, second]) {
      assert.equal(
        page.meta.notes.filter((note) => DEPRECATED.test(note)).length,
        1
      );
    }

    await withEnv(KEY, () => leadsOf({ strategy: "hash" }));
    await withEnv(undefined, () => leadsOf({ key: KEY, strategy: "hash" }));
    await withEnv(undefined, () => leadsOf({}));
    assert.equal(warn.mock.callCount(), 1, "a key, or mask, never warns");
  } finally {
    warn.mock.restore();
  }
});

test("a keyed hash differs from the unkeyed one and from another key's, and is the same in every instance", async () => {
  const unkeyed = await withEnv(undefined, () => tokens({ strategy: "hash" }));

  const keyed = await withEnv(undefined, () =>
    tokens({ key: KEY, strategy: "hash" })
  );

  assert.ok(
    keyed.flat().some((value) => String(value).startsWith("redacted:"))
  );
  assert.deepEqual(
    await withEnv(undefined, () => tokens({ key: KEY, strategy: "hash" })),
    keyed
  );

  for (const [index, row] of keyed.entries()) {
    for (const [field, value] of row.entries()) {
      if (String(value).startsWith("redacted:")) {
        assert.notEqual(
          value,
          unkeyed[index]?.[field],
          "keyed is not the plain digest"
        );
      }
    }
  }

  assert.notDeepEqual(
    await withEnv(undefined, () => tokens({ key: OTHER, strategy: "hash" })),
    keyed
  );

  const page = await withEnv(undefined, () =>
    leadsOf({ key: KEY, strategy: "hash" })
  );

  assert.deepEqual(page.meta.notes, [], "a keyed hash notes nothing");
});

test("the SDK reads OUTBOUND_REDACT_KEY by default, and an explicit key wins", async () => {
  const fromEnv = await withEnv(KEY, () => tokens({}));
  const explicit = await withEnv(undefined, () => tokens({ key: KEY }));

  assert.deepEqual(fromEnv, explicit);
  assert.deepEqual(await withEnv(OTHER, () => tokens({ key: KEY })), explicit);
  assert.deepEqual(
    await withEnv(KEY, () => tokens({ strategy: "hash" })),
    await withEnv(undefined, () => tokens({ key: KEY, strategy: "hash" }))
  );
});

test("under one key, hash and mask give an address the same token", async () => {
  const masked = await withEnv(undefined, () => leadsOf({ key: KEY }));

  const hashed = await withEnv(undefined, () =>
    leadsOf({ key: KEY, strategy: "hash" })
  );

  assert.ok(masked.items.some((lead) => lead.email?.startsWith("redacted:")));
  assert.deepEqual(
    hashed.items.map((lead) => lead.email),
    masked.items.map((lead) => lead.email)
  );
});

test("the CLI and the SDK give the same tokens for the same key", async () => {
  const out: string[] = [];
  const err: string[] = [];

  const code = await withEnv(KEY, () =>
    run(["leads", "--redact", "--compact"], {
      adapter: memory({ data: demoData(), workspaceId: "acme" }),
      stderr: (text) => {
        err.push(text);
      },
      stdout: (text) => {
        out.push(text);
      },
    })
  );

  assert.equal(code, 0, err.join("\n"));

  const cli = (
    JSON.parse(out.join("\n")) as {
      data: { items: { ref: string; email: string | null }[] };
    }
  ).data.items.map((lead) => [lead.ref, lead.email]);

  const sdk = (await withEnv(undefined, () => leadsOf({ key: KEY }))).items.map(
    (lead) => [lead.ref, lead.email]
  );

  assert.ok(cli.some(([, email]) => email?.startsWith("redacted:")));
  assert.deepEqual(cli, sdk);
  assert.ok(!out.join("").includes(KEY.slice(0, 20)));
  assert.ok(!err.join("").includes(KEY.slice(0, 20)));
});

test("a mask with no key notes that its tokens are per process, only on answers that hold one", async () => {
  const leads = await withEnv(undefined, () => leadsOf({}));

  const campaigns = await withEnv(undefined, () =>
    instance({}).campaigns.list()
  );

  assert.equal(
    leads.meta.notes.filter((note) => PER_PROCESS.test(note)).length,
    1
  );
  assert.deepEqual(campaigns.meta.notes, [], "no token, nothing to say");
  assert.deepEqual(
    (await withEnv(KEY, () => leadsOf({}))).meta.notes,
    [],
    "a key from the environment notes nothing"
  );
});

test("a short OUTBOUND_REDACT_KEY is refused when the plugin is built, naming the variable and not the key", async () => {
  const short = KEY.slice(0, 20);

  await withEnv(short, () =>
    assert.throws(
      () => redact(),
      (error) =>
        OutboundError.is(error) &&
        error.code === "Invalid" &&
        error.message.includes(REDACT_KEY_ENV) &&
        !JSON.stringify({ ...error, message: error.message }).includes(short)
    )
  );
});
