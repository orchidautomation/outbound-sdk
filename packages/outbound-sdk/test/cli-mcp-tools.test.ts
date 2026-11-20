// `outbound mcp --tools` offers only the tools it names, so a client that
// needs a few tools does not pay for all of them in tools/list (OUT-120).

import assert from "node:assert/strict";
import { test } from "node:test";

import { run } from "../src/cli/index.ts";
import { demoData, memory } from "../src/memory/index.ts";

const LIST = { id: 1, jsonrpc: "2.0", method: "tools/list" };

const serve = async (argv: readonly string[], messages: readonly object[]) => {
  const out: string[] = [];
  const err: string[] = [];

  const code = await run(["mcp", ...argv], {
    adapter: memory({ data: demoData(), workspaceId: "acme" }),
    stderr: (text) => {
      err.push(text);
    },
    stdin: () => messages.map((message) => JSON.stringify(message)),
    stdout: (text) => {
      out.push(text);
    },
  });

  return { code, err: err.join("\n"), out };
};

const listed = async (argv: readonly string[]) => {
  const session = await serve(argv, [LIST]);
  const [line = ""] = session.out;

  const { result } = JSON.parse(line) as {
    result: { tools: { name: string }[] };
  };

  return { bytes: line.length, names: result.tools.map((tool) => tool.name) };
};

test("--tools offers only the built-in tools and insights it names, in a smaller tools/list", async () => {
  const every = await listed([]);
  const two = await listed(["--tools", "campaign_overview, bounce_watch"]);

  assert.ok(every.names.length > 15);
  // An old name offers the listed tool it became, with only its own view or check.
  assert.deepEqual(two.names, ["campaigns", "sender_health"]);
  assert.ok(two.bytes * 5 < every.bytes, `${two.bytes} of ${every.bytes}`);

  const listedNames = await listed(["--tools", "campaigns,unanswered_replies"]);

  assert.deepEqual(listedNames.names, ["campaigns", "unanswered_replies"]);
});

const nextOf = (out: readonly string[]): string =>
  (
    JSON.parse(out[0] ?? "") as {
      result: { structuredContent: { next: string } };
    }
  ).result.structuredContent.next;

test("an insight --tools offers names no insight it left out in next", async () => {
  const call = {
    id: 2,
    jsonrpc: "2.0",
    method: "tools/call",
    params: { arguments: {}, name: "bounce_watch" },
  };

  const every = await serve([], [call]);
  const only = await serve(["--tools", "bounce_watch"], [call]);

  // Without --tools, bounce_watch points to its siblings.
  assert.match(nextOf(every.out), /domain_health|settings_audit/u);
  assert.doesNotMatch(nextOf(only.out), /domain_health|settings_audit/u);
});

test("--tools refuses a name it cannot offer, with the closest one, before serving", async () => {
  const typo = await serve(["--tools", "campaign_overveiw"], [LIST]);

  assert.equal(typo.code, 1);
  assert.match(
    typo.err,
    /^Invalid: --tools: "campaign_overveiw" is not a tool this server can offer\. Did you mean "campaign_overview"\?/u
  );

  const empty = await serve(["--tools", " , "], [LIST]);

  assert.equal(empty.code, 1);
  assert.match(empty.err, /^Invalid: --tools takes tool names/u);

  const elsewhere = await run(["campaigns", "--tools", "campaign_overview"], {
    adapter: memory({ data: demoData(), workspaceId: "acme" }),
    stderr: () => {},
    stdout: () => {},
  });

  assert.equal(elsewhere, 1);
});

test("--tools refuses a tool the server leaves out with the reason, before serving", async () => {
  const session = await serve(
    ["--tools", "campaign_overview,account_summary"],
    [LIST]
  );

  assert.equal(session.code, 1);
  assert.deepEqual(session.out, []);
  assert.match(
    session.err,
    /^Unsupported: --tools: account_summary is left out while the redact plugin is on: .* Start the server with --no-redact to offer it/u
  );
});
