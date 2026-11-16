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

  assert.ok(every.names.length > 20);
  assert.deepEqual(two.names, ["campaign_overview", "bounce_watch"]);
  assert.ok(two.bytes * 5 < every.bytes, `${two.bytes} of ${every.bytes}`);
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

test("a tool --tools names that redact left out still answers with the reason", async () => {
  const session = await serve(
    ["--tools", "campaign_overview,person_summary"],
    [
      LIST,
      {
        id: 2,
        jsonrpc: "2.0",
        method: "tools/call",
        params: {
          arguments: { person: "a@example.com" },
          name: "person_summary",
        },
      },
    ]
  );

  const [list = "", call = ""] = session.out;

  assert.deepEqual(
    (
      JSON.parse(list) as { result: { tools: { name: string }[] } }
    ).result.tools.map((tool) => tool.name),
    ["campaign_overview"]
  );
  assert.match(
    (JSON.parse(call) as { error: { message: string } }).error.message,
    /^person_summary is left out while the redact plugin is on/u
  );
});
