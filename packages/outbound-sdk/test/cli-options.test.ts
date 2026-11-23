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

test("a negative --limit, or none, gets the CLI's own Invalid, not parseArgs' words", async () => {
  // What the stress test met: `--limit -5` was refused as an ambiguous option.
  for (const argv of [
    ["campaigns", "--limit", "-5"],
    ["leads", "--limit", "-5", "--compact"],
  ]) {
    const result = await cli(...argv);

    assert.equal(result.code, 1);
    assert.equal(
      result.err,
      "Invalid: --limit must be a positive whole number"
    );
  }

  const missing = await cli("campaigns", "--limit");

  assert.equal(missing.code, 1);
  assert.match(
    missing.err,
    /^Invalid: Option '--limit <value>' argument missing$/u
  );
});

test("a listing stopped at --limit says so on stderr and in stdout's meta", async () => {
  const two = await cli("leads", "--limit", "2", "--compact");
  const listed = JSON.parse(two.out) as Listed;

  assert.equal(two.code, 3, "a list --limit cut exits 3");
  assert.equal(listed.data.items.length, 2);
  assert.match(
    two.err,
    /^Stopped at 2 leads; more exist\. Pass --limit to read more\.\nTo resume, pass --cursor \S+\.$/u
  );
  assert.equal(listed.meta.complete, false);
  assert.deepEqual(listed.meta.notes, two.err.split("\n"));

  const one = await cli("campaigns", "--limit", "1", "--compact");

  assert.equal(one.code, 3);
  assert.match(
    one.err,
    /^Stopped at 1 campaign; more exist\. Pass --limit to read more\./u
  );

  // Everything fits under the default: nothing to say.
  const all = await cli("campaigns", "--compact");

  assert.equal(all.code, 0);
  assert.equal(all.err, "");
  assert.equal((JSON.parse(all.out) as Listed).meta.complete, true);
});

test("a flag a command does not take is Invalid, and exits 1 before any read", async () => {
  for (const [argv, message] of [
    [["leads", "--sender", "x"], "Invalid: --sender is not an option of leads"],
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
    /^Usage: outbound leads \[--campaign ID\|NAME \| --list ID\|NAME\] \[--since DATE\] \[--limit N\] \[--cursor C\] \[--jsonl\] /mu
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

// OUTB-26: --from took only a day and --since only an ISO time, each refused
// in its own words.
test("every date option takes a day or an ISO date and time, and refuses anything else alike", async () => {
  const day = await cli(
    "stats",
    "--from",
    "2026-10-01",
    "--to",
    "2026-10-07",
    "--compact"
  );

  const time = await cli(
    "stats",
    "--from",
    "2026-10-01T09:30:00Z",
    "--to",
    "2026-10-07T23:00:00+00:00",
    "--compact"
  );

  assert.equal(day.code, 0, day.err);
  assert.equal(time.code, 0, time.err);
  assert.deepEqual(JSON.parse(time.out).data, JSON.parse(day.out).data);

  const sinceDay = await cli("replies", "--since", "2026-10-01", "--compact");

  const sinceTime = await cli(
    "replies",
    "--since",
    "2026-10-01T00:00:00Z",
    "--compact"
  );

  assert.equal(sinceDay.code, 0, sinceDay.err);
  assert.deepEqual(
    JSON.parse(sinceDay.out).data,
    JSON.parse(sinceTime.out).data
  );

  for (const [command, flag, value] of [
    ["stats", "--from", "11/10/2026"],
    ["stats", "--to", "2026-02-30"],
    ["campaign", "--from", "yesterday"],
    ["replies", "--since", "11/10/2026"],
    ["leads", "--since", "2026-10-01T09:30"],
  ] as const) {
    const args =
      command === "campaign"
        ? [command, "cmp_founders", "--stats", flag, value]
        : [command, flag, value];

    const result = await cli(...args, "--compact");

    assert.equal(result.code, 1, args.join(" "));
    assert.equal(
      result.err,
      `Invalid: ${flag} must be a day, YYYY-MM-DD, or an ISO 8601 date and time such as 2026-11-10T09:00:00Z, got "${value}"`
    );
  }
});

test("insight takes the campaign scope as flags, merged into --input, and a key given twice is refused", async () => {
  const tagged = await cli(
    "insight",
    "campaign_ranking",
    "--tag",
    "client-a",
    "--input",
    '{"statuses":["active","paused"]}'
  );

  assert.equal(tagged.code, 0, tagged.err);
  assert.match(
    tagged.out,
    /Campaign scope \(tag client-a\): 1 campaign of memory:acme match/u
  );

  const named = await cli(
    "insight",
    "campaign_ranking",
    "--campaign-ids",
    "nosuch, memory:acme:other",
    "--campaign-name",
    "Q4*"
  );

  assert.equal(named.code, 0, named.err);
  assert.match(named.out, /2 campaign ids and name Q4\*\): 0 campaigns/u);

  const twice = await cli(
    "insight",
    "campaign_ranking",
    "--tag",
    "client-a",
    "--input",
    '{"tag":"client-b"}'
  );

  assert.equal(twice.code, 1);
  assert.equal(
    twice.err,
    "Invalid: tag is given in --input and as --tag: give it once"
  );
});
