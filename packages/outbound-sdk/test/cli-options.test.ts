// What the CLI says about a listing it cut short, and the flags each
// command takes: one it does not take is refused, never ignored.

import assert from "node:assert/strict";
import { test } from "node:test";

import { run } from "../src/cli/index.ts";
import { demoData, memory } from "../src/memory/index.ts";

const cli = async (...argv: string[]) => {
  const out: string[] = [];
  const err: string[] = [];

  const code = await run(argv, {
    adapter: memory({
      data: demoData({ now: "2026-10-08T12:00:00.000Z" }),
      workspaceId: "acme",
    }),
    stderr: (text) => {
      err.push(text);
    },
    stdout: (text) => {
      out.push(text);
    },
  });

  return { code, err: err.join("\n"), out: out.join("\n") };
};

interface Listed {
  data: { items: unknown[] };
  meta: { complete: boolean; notes: string[] };
}

test("a listing stopped at --limit says so on stderr and in stdout's meta", async () => {
  const two = await cli("leads", "--limit", "2", "--compact");
  const listed = JSON.parse(two.out) as Listed;

  assert.equal(two.code, 0);
  assert.equal(listed.data.items.length, 2);
  assert.equal(
    two.err,
    "Stopped at 2 leads; more exist. Pass --limit to read more."
  );
  assert.equal(listed.meta.complete, false);
  assert.deepEqual(listed.meta.notes, [two.err]);

  const one = await cli("campaigns", "--limit", "1", "--compact");

  assert.equal(
    one.err,
    "Stopped at 1 campaign; more exist. Pass --limit to read more."
  );

  // Everything fits under the default: nothing to say.
  const all = await cli("campaigns", "--compact");

  assert.equal(all.code, 0);
  assert.equal(all.err, "");
  assert.equal((JSON.parse(all.out) as Listed).meta.complete, true);
});

test("a flag a command does not take is Invalid, and exits 1 before any read", async () => {
  for (const [argv, message] of [
    [
      ["leads", "--since", "2030-01-01"],
      "Invalid: --since is not an option of leads",
    ],
    [
      ["senders", "--campaign", "x"],
      "Invalid: --campaign is not an option of senders",
    ],
    [
      ["capabilities", "--limit", "3"],
      "Invalid: --limit is not an option of capabilities",
    ],
    [
      ["campaigns", "--bogus"],
      "Invalid: --bogus is not an option of campaigns",
    ],
  ] as const) {
    // oxlint-disable-next-line no-await-in-loop -- one command at a time.
    const result = await cli(...argv);

    assert.equal(result.code, 1, argv.join(" "));
    assert.equal(result.err, message);

    const failed = JSON.parse(result.out) as {
      ok: boolean;
      error: { code: string; message: string };
    };

    assert.equal(failed.ok, false);
    assert.equal(`${failed.error.code}: ${failed.error.message}`, message);
  }

  // The options every command takes stay accepted.
  assert.equal((await cli("senders", "--compact", "--cache", "5")).code, 0);
});

test("--help lists each command's options, and each one listed is taken", async () => {
  const help = await cli("--help");
  const lines = help.out.split("\n").filter((line) => /^ {2}[a-z]/u.test(line));

  for (const line of lines) {
    const [name] = line.trim().split(" ");

    const flags = [...line.matchAll(/--(?<flag>[a-z-]+)/gu)].map(
      (match) => match.groups?.flag
    );

    for (const flag of flags) {
      // oxlint-disable-next-line no-await-in-loop -- one command at a time.
      const result = await cli(name ?? "", `--${flag ?? ""}`, "x");

      assert.doesNotMatch(
        result.err,
        /is not an option of/u,
        `${name} --${flag}`
      );
    }
  }

  const leads = await cli("leads", "--help");

  assert.equal(leads.code, 0);
  assert.match(
    leads.out,
    /^Usage: outbound leads \[--campaign ID\|NAME \| --list ID\|NAME\] \[--limit N\]$/mu
  );
  assert.match(leads.out, /--provider <id>/u);
});

test("campaign --stats --sequence prints both", async () => {
  const both = await cli("campaign", "cmp_founders", "--stats", "--sequence");

  assert.equal(both.code, 0);

  const parsed = (
    JSON.parse(both.out) as {
      data: { sequence: { steps: unknown[] }; stats: { rows: unknown[] } };
    }
  ).data;

  assert.deepEqual(Object.keys(parsed), ["sequence", "stats"]);
  assert.ok(parsed.sequence.steps.length > 0);
  assert.ok(parsed.stats.rows.length > 0);

  // One section alone is the envelope's data itself.
  const stats = (
    JSON.parse((await cli("campaign", "cmp_founders", "--stats")).out) as {
      data: { rows: unknown[] };
    }
  ).data;

  assert.ok(Array.isArray(stats.rows));
});

test("records print without raw unless --raw asks for it", async () => {
  const base = memory({
    data: demoData({ now: "2026-10-08T12:00:00.000Z" }),
    workspaceId: "acme",
  });

  // A vendor like Instantly puts the whole quoted thread in raw, bodies or not.
  const quoted = {
    body: { html: "<div>old thread</div>", text: "old thread" },
  };

  const { listReplies } = base;

  assert.ok(listReplies);

  const adapter: typeof base = {
    ...base,
    listReplies: async (query, ctx) => {
      const page = await listReplies(query, ctx);

      return {
        ...page,
        items: page.items.map((reply) => ({ ...reply, raw: quoted })),
      };
    },
  };

  const replies = async (...flags: string[]) => {
    const out: string[] = [];

    const code = await run(["replies", "--compact", ...flags], {
      adapter,
      stderr: () => {},
      stdout: (text) => {
        out.push(text);
      },
    });

    assert.equal(code, 0);

    return (
      JSON.parse(out.join("")) as {
        data: { items: Record<string, unknown>[] };
      }
    ).data.items;
  };

  const lean = await replies();

  assert.ok(lean.length > 0);
  assert.ok(lean.every((reply) => !("raw" in reply)));
  assert.ok(lean.every((reply) => typeof reply.ref === "string"));

  const full = await replies("--raw");

  assert.deepEqual(full[0]?.raw, quoted);

  // A command that prints no records is untouched, raw key or not.
  const tags = await cli("tags", "--compact");

  assert.ok(!tags.out.includes('"raw"'));
  assert.equal((await cli("help")).out.includes("--raw"), true);
});
