// --provider all and redact offer every tool one tool can serve, and the
// CLI's three catalogs agree (OUT-152); a combined instance reads a thread by
// its id (OUT-153). Instantly and HeyReach adapters in their live shape, over
// the documented fixtures, with fetch injected.

import assert from "node:assert/strict";
import { test } from "node:test";

import { RENAMED_TOOLS, run } from "../src/cli/index.ts";
import { combine } from "../src/combine/index.ts";
import type { Adapter } from "../src/index.ts";
import { fixtureHandler } from "./helpers/adapter-suite.ts";
import { createFetch } from "./helpers/http.ts";
import { suite as heyreachSuite } from "./heyreach/suite.ts";
import { suite as instantlySuite } from "./instantly/suite.ts";

const INSTANTLY_CAMPAIGN =
  "instantly:client-a:01a1d77f-5e23-7a9a-9112-a6f7089f329f";

const HEYREACH_CAMPAIGN = "heyreach:client-a:274079";

const both = (): Adapter =>
  combine([instantlySuite.make(), heyreachSuite.make()]);

interface Session {
  readonly code: number;
  readonly err: string;
  readonly out: readonly string[];
  readonly requests: number;
}

/** One CLI run over the fixtures, its standard output split by line. */
const cli = async (
  adapter: Adapter,
  argv: readonly string[],
  messages: readonly object[] = []
): Promise<Session> => {
  const out: string[] = [];
  const err: string[] = [];
  const http = createFetch(fixtureHandler([instantlySuite, heyreachSuite]));

  const code = await run(argv, {
    adapter,
    fetch: http.fetch,
    stderr: (text) => {
      err.push(text);
    },
    stdin: () => messages.map((message) => JSON.stringify(message)),
    stdout: (text) => {
      out.push(text);
    },
  });

  return { code, err: err.join("\n"), out, requests: http.requests.length };
};

const INITIALIZE = { id: 0, jsonrpc: "2.0", method: "initialize" };
const LIST = { id: 1, jsonrpc: "2.0", method: "tools/list" };

const call = (
  id: number,
  name: string,
  args: Readonly<Record<string, number | string>>
) => ({
  id,
  jsonrpc: "2.0",
  method: "tools/call",
  params: { arguments: args, name },
});

const listedBy = async (
  adapter: Adapter,
  flags: readonly string[] = []
): Promise<string[]> => {
  const session = await cli(adapter, ["mcp", ...flags], [LIST]);

  const { result } = JSON.parse(session.out[0] ?? "") as {
    result: { tools: { name: string }[] };
  };

  return result.tools.map((tool) => tool.name);
};

interface ToolOutcome {
  readonly ok: boolean;
  readonly error?: { code: string; message: string };
  readonly meta?: { complete: boolean; notes: string[]; requests: number };
  readonly next: string;
}

const outcomeAt = (session: Session, index: number): ToolOutcome =>
  (
    JSON.parse(session.out[index] ?? "") as {
      result: { structuredContent: ToolOutcome };
    }
  ).result.structuredContent;

test("--provider all offers every tool one of its tools serves, under redact, as each tool alone does", async () => {
  const [instantlyAlone, heyreachAlone, combined] = await Promise.all([
    listedBy(instantlySuite.make()),
    listedBy(heyreachSuite.make()),
    listedBy(both()),
  ]);

  // 0.12.0 dropped these beside HeyReach (variant_test, copy_reuse and
  // winning_steps now answer as copy_review and step_funnel), and
  // person_summary (now person) under redact.
  for (const name of [
    "step_funnel",
    "copy_review",
    "settings_audit",
    "campaign_setup",
    "person",
  ]) {
    assert.ok(combined.includes(name), name);
  }

  assert.deepEqual(
    [...new Set([...instantlyAlone, ...heyreachAlone])].filter(
      (name) => !combined.includes(name)
    ),
    []
  );
});

test("a tool one member lacks refuses a campaign of that member before any request, naming the one that serves it", async () => {
  const session = await cli(
    both(),
    ["mcp"],
    [
      call(1, "step_funnel", { campaign: HEYREACH_CAMPAIGN }),
      call(2, "winning_steps", { campaign: HEYREACH_CAMPAIGN }),
      call(3, "campaign_setup", { campaign: HEYREACH_CAMPAIGN }),
    ]
  );

  const [funnel, steps, setup] = [0, 1, 2].map((index) =>
    outcomeAt(session, index)
  );

  assert.equal(session.requests, 0);
  assert.equal(funnel?.error?.code, "Unsupported");
  assert.match(
    funnel?.error?.message ?? "",
    /heyreach adapter does not support stats\.byStep/u
  );
  assert.equal(
    funnel?.next,
    "On this instance only instantly:client-a can serve step_funnel: call it again with a campaign of that tool, by its ref or name."
  );
  assert.match(
    steps?.error?.message ?? "",
    /^winning_steps is not available for this campaign: the heyreach adapter does not support stats\.byStep$/u
  );
  assert.match(
    setup?.error?.message ?? "",
    /heyreach adapter does not support campaigns\.settings/u
  );
});

test("a tool one member serves answers for that member's campaign on --provider all", async () => {
  const session = await cli(
    both(),
    ["mcp"],
    [
      call(1, "step_funnel", { campaign: INSTANTLY_CAMPAIGN }),
      call(2, "campaign_setup", { campaign: INSTANTLY_CAMPAIGN }),
    ]
  );

  const funnel = outcomeAt(session, 0);
  const setup = outcomeAt(session, 1);

  assert.equal(funnel.ok, true, JSON.stringify(funnel.error));
  assert.equal(setup.ok, true, JSON.stringify(setup.error));
  assert.ok(session.requests > 0);
});

test("an insight that reads every campaign answers for the one member that serves it, marked incomplete", async () => {
  const session = await cli(
    both(),
    ["mcp"],
    [call(1, "settings_audit", { max_campaigns: 2 })]
  );

  const audit = outcomeAt(session, 0);

  assert.equal(audit.ok, true, JSON.stringify(audit.error));
  assert.equal(audit.meta?.complete, false);
  assert.match(
    audit.meta?.notes[0] ?? "",
    /^Covers instantly:client-a only, the one tool on this instance that serves settings_audit\. settings_audit is not available: the heyreach adapter does not support campaigns\.settings\.$/u
  );
});

const items = (session: Session): { name: string }[] =>
  (
    JSON.parse(session.out.join("\n")) as {
      data: { items: { name: string }[] };
    }
  ).data.items;

const notes = (session: Session): string[] =>
  (JSON.parse(session.out.join("\n")) as { meta: { notes: string[] } }).meta
    .notes;

test("outbound tools, outbound insight and tools/list read one catalog, and name what each leaves out with the reason", async () => {
  for (const [adapter, flags] of [
    [both, ["--redact"]],
    [() => heyreachSuite.make(), []],
    [() => instantlySuite.make(), []],
  ] as const) {
    // oxlint-disable-next-line no-await-in-loop -- each setup reads its own fixtures.
    const listed = await listedBy(
      adapter(),
      flags.length === 0 ? ["--no-redact"] : []
    );

    // oxlint-disable-next-line no-await-in-loop -- as above.
    const tools = await cli(adapter(), ["tools", "--compact", ...flags]);
    // oxlint-disable-next-line no-await-in-loop -- as above.
    const insight = await cli(adapter(), ["insight", "--compact", ...flags]);

    const toolNames = items(tools).map((tool) => tool.name);
    const insightNames = items(insight).map((each) => each.name);

    assert.deepEqual(toolNames, listed);

    // Every insight is listed, or answered by the listed tool it became.
    for (const name of insightNames) {
      const becomes = RENAMED_TOOLS[name]?.split(" ")[0] ?? name;

      assert.ok(toolNames.includes(becomes), name);
    }

    assert.equal(insightNames.length > 0, true);
    assert.equal(tools.requests + insight.requests, 0);
  }

  const heyreach = await cli(heyreachSuite.make(), ["tools", "--compact"]);

  assert.ok(
    notes(heyreach).includes(
      "step_funnel is not available: the heyreach adapter does not support stats.byStep"
    ),
    notes(heyreach).join("\n")
  );
});

test("--tools and outbound tool refuse a tool the catalog leaves out with its reason", async () => {
  const served = await cli(
    heyreachSuite.make(),
    ["mcp", "--tools", "step_funnel"],
    [LIST]
  );

  assert.equal(served.code, 1);
  assert.match(
    served.err,
    /^Unsupported: --tools: step_funnel is not available: the heyreach adapter does not support stats\.byStep/u
  );

  const ran = await cli(heyreachSuite.make(), [
    "tool",
    "step_funnel",
    "--input",
    "{}",
  ]);

  assert.equal(ran.code, 1);
  assert.match(
    ran.err,
    /step_funnel is not available: the heyreach adapter does not support stats\.byStep/u
  );
});

test("a tool only one member serves on its own is named with the --provider that offers it", async () => {
  const session = await cli(
    both(),
    ["mcp", "--no-redact"],
    [INITIALIZE, call(1, "vendor_read", {})]
  );

  // Answers are written as they finish, so each is found by its id.
  const byId = (id: number) =>
    session.out
      .map(
        (line) =>
          JSON.parse(line) as {
            id: number;
            result: { instructions: string };
            error: { message: string };
          }
      )
      .find((each) => each.id === id);

  const { instructions } = byId(0)?.result ?? { instructions: "" };

  assert.match(
    instructions,
    / Left out of this server: [a-z_, ]*vendor_read[a-z_, ]*\. A call to one returns the reason\./u
  );
  assert.match(
    byId(1)?.error.message ?? "",
    /^vendor_read is not available: it needs native, which this instance does not offer\. Run it with --provider instantly to read instantly on its own\.$/u
  );
});
