import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import { budget } from "../src/budget/index.ts";
import {
  createMcpServer,
  defineConfig,
  run,
  serveStdio,
} from "../src/cli/index.ts";
import {
  createOutbound,
  MemoryRateLimitStore,
  OutboundError,
} from "../src/index.ts";
import { demoData, memory } from "../src/memory/index.ts";
import { redact } from "../src/redact/index.ts";
import type { OutboundTool } from "../src/tools/index.ts";
import { createFetch, json, testAdapter } from "./helpers/http.ts";

const source = (folder: string): string =>
  pathToFileURL(path.resolve(import.meta.dirname, `../src/${folder}/index.ts`))
    .href;

const configFile = async (body: string): Promise<string> => {
  const directory = await mkdtemp(path.join(tmpdir(), "outbound-config-"));
  const file = path.join(directory, "outbound.config.mjs");
  await writeFile(file, body);

  return file;
};

interface Session {
  readonly code: number;
  readonly err: string;
  readonly out: string[];
  readonly responses: { id: number; result?: unknown; error?: unknown }[];
}

const outbound = async (
  argv: readonly string[],
  messages: readonly object[] = []
): Promise<Session> => {
  const out: string[] = [];
  const err: string[] = [];

  const code = await run(argv, {
    adapter: memory({ data: demoData(), workspaceId: "acme" }),
    stderr: (text) => {
      err.push(text);
    },
    stdin: () => messages.map((message) => JSON.stringify(message)),
    stdout: (text) => {
      out.push(text);
    },
  });

  return {
    code,
    err: err.join("\n"),
    out,
    responses: out.map((line) => JSON.parse(line) as never),
  };
};

const initialize = {
  id: 1,
  jsonrpc: "2.0",
  method: "initialize",
  params: { protocolVersion: "2025-06-18" },
};

const list = { id: 2, jsonrpc: "2.0", method: "tools/list" };

const replyBodies = {
  id: 3,
  jsonrpc: "2.0",
  method: "tools/call",
  params: { arguments: { include_bodies: true }, name: "reply_samples" },
};

// The result of the response at `index`. Fails the test when there is none.
const resultAt = <Result>(session: Session, index: number): Result => {
  const response = session.responses[index];
  assert.ok(
    response?.result !== undefined,
    `no result at ${index}: ${session.err}`
  );

  return response.result as Result;
};

const instructionsOf = (session: Session): string =>
  resultAt<{ instructions: string }>(session, 0).instructions;

const toolNames = (session: Session): string[] =>
  resultAt<{ tools: { name: string }[] }>(session, 1).tools.map(
    (tool) => tool.name
  );

const callResult = (session: Session, index: number) =>
  resultAt<{ structuredContent: { ok: boolean; error?: { code: string } } }>(
    session,
    index
  ).structuredContent;

test("outbound mcp masks personal fields by default and says so", async () => {
  const session = await outbound(["mcp"], [initialize, list, replyBodies]);

  assert.equal(session.code, 0);
  assert.match(instructionsOf(session), /Plugins on: redact, identity\./u);
  assert.match(instructionsOf(session), /reply text is not available/u);
  assert.ok(
    !toolNames(session).includes("cross_channel_lead"),
    "the person lookup needs identifiers redact masks"
  );
  assert.deepEqual(callResult(session, 2).error?.code, "Unsupported");
});

test("outbound mcp leaves out the insights redact keeps from matching, and no hint names them", async () => {
  const hotLeads = {
    id: 3,
    jsonrpc: "2.0",
    method: "tools/call",
    params: { arguments: {}, name: "hot_leads" },
  };

  const session = await outbound(["mcp"], [initialize, list, hotLeads]);
  const names = toolNames(session);

  const left = ["account_summary"];

  assert.ok(names.includes("hot_leads"), names.join(", "));
  // It looks a lead ref up by the tokens redact can put back.
  assert.ok(names.includes("person"), names.join(", "));
  // They match people on redact's keyed tokens.
  assert.ok(names.includes("list_hygiene"), names.join(", "));
  assert.deepEqual(
    names.filter((name) => left.includes(name)),
    []
  );

  const called = resultAt<{ structuredContent: { ok: boolean; next: string } }>(
    session,
    2
  ).structuredContent;

  assert.equal(called.ok, true);
  assert.ok(
    left.every((name) => !called.next.includes(name)),
    called.next
  );
});

/** A call to the tool `name` about one person. */
const personCall = (id: number, name: string) => ({
  id,
  jsonrpc: "2.0",
  method: "tools/call",
  params: { arguments: { person: "person1@example.com" }, name },
});

const byRef = (id: number, name: string) => ({
  id,
  jsonrpc: "2.0",
  method: "tools/call",
  params: { arguments: { lead_ref: "memory:acme:lead_1" }, name },
});

test("outbound mcp answers a tool redact masks with the masked person view, naming --no-redact", async () => {
  const session = await outbound(
    ["mcp"],
    [
      byRef(1, "account_summary"),
      byRef(2, "cross_channel_lead"),
      personCall(3, "no_such_tool"),
    ]
  );

  const byId = (id: number) =>
    session.responses.find((response) => response.id === id) as {
      result?: {
        structuredContent: { ok: boolean; meta: { notes: string[] } };
      };
      error?: { message: string };
    };

  // Each old name answers through person's masked summary view (OUT-168).
  for (const [index, name] of [
    "account_summary",
    "cross_channel_lead",
  ].entries()) {
    const answer = byId(index + 1).result?.structuredContent;

    assert.equal(answer?.ok, true, JSON.stringify(answer));
    assert.match(
      answer?.meta.notes.join(" ") ?? "",
      /needs identifiers the redact plugin masks, so this is the masked summary view\. Start the server with --no-redact for it\./u,
      name
    );
  }

  // A name no tool has is still unknown.
  assert.equal(byId(3).error?.message, "Unknown tool: no_such_tool");

  // Without redact the same call is answered.
  const open = await outbound(
    ["mcp", "--no-redact"],
    [personCall(1, "person_summary")]
  );

  assert.equal(
    resultAt<{ structuredContent: { ok: boolean } }>(open, 0).structuredContent
      .ok,
    true
  );
});

test("outbound mcp names the tools redact left out in its instructions, and --no-redact names none", async () => {
  const masked = instructionsOf(await outbound(["mcp"], [initialize]));

  // person still lists its timeline and account views and answers them
  // with the masked summary, so nothing is left out here (OUT-168).
  assert.doesNotMatch(masked, /Left out/u);

  // They are named only as old names that still answer.
  const [listed = "", old = ""] = masked.split(" Old names, ");

  for (const name of [
    "account_summary",
    "cross_channel_lead",
    "person_summary",
    "lead_collisions",
    "suppression_check",
  ]) {
    assert.ok(!listed.includes(name), name);
    assert.ok(old.includes(name), name);
  }

  // The memory adapter has no native reads, so vendor_read is not named.
  assert.ok(!masked.includes("vendor_read"), masked);

  const open = instructionsOf(
    await outbound(["mcp", "--no-redact"], [initialize])
  );

  assert.doesNotMatch(open, /Left out/u);
});

// The instructions a server built in code gives on initialize.
const serverInstructions = async (
  plugins: Parameters<typeof createOutbound>[0]["plugins"],
  leftOut?: Record<string, string>
): Promise<string> => {
  const server = createMcpServer(
    createOutbound({
      adapter: memory({ data: demoData(), workspaceId: "acme" }),
      plugins,
    }),
    { leftOut }
  );

  const response = (await server.handle(initialize)) as {
    result: { instructions: string };
  };

  return response.result.instructions;
};

test("createMcpServer describes leftOut in initialize only when it names a tool", async () => {
  const why = { vendor_read: "needs native reads" };

  assert.match(
    await serverInstructions([redact()], why),
    /Left out while redact is on: vendor_read\. .*which redact masks \(vendor_read returns unmasked vendor payloads\)\. Start the server with --no-redact/u
  );

  // Without redact the reason is not redact's.
  const plain = await serverInstructions([], why);
  assert.match(
    plain,
    / Left out of this server: vendor_read\. A call to one returns the reason\.$/u
  );
  assert.doesNotMatch(plain, /--no-redact/u);

  for (const leftOut of [undefined, {}]) {
    assert.doesNotMatch(
      await serverInstructions([redact()], leftOut),
      /Left out/u,
      JSON.stringify(leftOut)
    );
  }
});

test("--cache on a one-shot command says on stderr that it lasts one process", async () => {
  const cached = await outbound(["senders", "--compact", "--cache", "5"]);

  assert.equal(cached.code, 0);
  assert.equal(
    cached.err,
    "--cache lasts one process, so the next run reads from the vendor again. It helps outbound mcp; to persist, list cache({ ttl, store }) in a --config file."
  );
  // The answer still goes to stdout.
  assert.ok(
    Array.isArray(
      (JSON.parse(cached.out.join("")) as { data: { items: unknown } }).data
        .items
    )
  );

  assert.equal((await outbound(["senders", "--compact"])).err, "");
  // mcp is one long process, so the cache is reused there and nothing is said.
  assert.equal((await outbound(["mcp", "--cache", "5"], [initialize])).err, "");
});

test("outbound mcp reports the package's version as serverInfo.version", async () => {
  const manifest = JSON.parse(
    await readFile(
      path.resolve(import.meta.dirname, "../package.json"),
      "utf-8"
    )
  ) as { version: string };

  const session = await outbound(["mcp"], [initialize]);

  assert.equal(session.code, 0);
  assert.match(manifest.version, /^\d+\.\d+\.\d+/u);
  assert.deepEqual(resultAt<{ serverInfo: unknown }>(session, 0).serverInfo, {
    name: "outbound-sdk",
    version: manifest.version,
  });
});

test("--no-redact serves records unmasked, and reply text on request", async () => {
  const session = await outbound(
    ["mcp", "--no-redact"],
    [initialize, list, replyBodies]
  );

  assert.match(
    instructionsOf(session),
    /Plugins on: identity\. Personal fields .* are not masked/u
  );
  assert.equal(callResult(session, 2).ok, true);
  assert.match(JSON.stringify(callResult(session, 2)), /untrustedContent/u);
});

test("other commands are unmasked unless --redact is set", async () => {
  const plain = await outbound(["leads", "--compact"]);
  assert.match(plain.out.join(""), /person1@example\.com/u);

  const masked = await outbound(["leads", "--compact", "--redact"]);
  assert.equal(masked.code, 0);
  assert.doesNotMatch(masked.out.join(""), /person1@example\.com/u);
  assert.match(masked.out.join(""), /\[redacted\]/u);
});

test("--config adds a file's plugins inside the default redact", async () => {
  const file = await configFile(
    `import { clients } from ${JSON.stringify(source("clients"))};
export default { plugins: [clients({ rules: [{ campaignTag: "acme", client: "Acme" }] })] };`
  );

  const session = await outbound(
    ["mcp", "--config", file, "--cache", "60", "--max-requests", "20"],
    [initialize, list]
  );

  assert.equal(session.code, 0, session.err);
  assert.match(
    instructionsOf(session),
    /Plugins on: redact, clients, cache, budget, identity\./u
  );
  assert.ok(toolNames(session).includes("compare_clients"));
});

test("a redact() in the config file replaces the default one", async () => {
  const file = await configFile(
    `import { redact } from ${JSON.stringify(source("redact"))};
export default { plugins: [redact({ fields: ["email"] })] };`
  );

  const session = await outbound(
    ["mcp", "--config", file],
    [initialize, list, replyBodies]
  );

  assert.equal(session.code, 0, session.err);
  assert.match(
    instructionsOf(session),
    /Plugins on: redact, identity\. redact masks/u
  );
  // Only email is masked, so reply text stays readable.
  assert.equal(callResult(session, 2).ok, true);

  const conflict = await outbound(["mcp", "--config", file, "--no-redact"]);
  assert.equal(conflict.code, 1);
  assert.match(
    conflict.err,
    /^Invalid: --no-redact conflicts with redact\(\)/u
  );
});

test("a config file that cannot be used is refused before the server starts", async () => {
  const missing = await outbound(["mcp", "--config", "/no/such/file.mjs"]);
  assert.equal(missing.code, 1);
  assert.match(missing.err, /^Invalid: Could not load the config file/u);
  assert.deepEqual(missing.out, []);

  const noDefault = await outbound([
    "mcp",
    "--config",
    await configFile("export const plugins = [];"),
  ]);

  assert.match(noDefault.err, /^Invalid: .* has no default export/u);

  const notPlugins = await outbound([
    "mcp",
    "--config",
    await configFile('export default { plugins: ["redact"] };'),
  ]);

  assert.match(notPlugins.err, /^Invalid: .* must export plugins as a list/u);
});

test("plugin flags reject values that are not positive whole numbers", async () => {
  for (const argv of [
    ["mcp", "--cache", "0"],
    ["mcp", "--max-requests", "ten"],
    ["mcp", "--max-requests", "1.5"],
  ]) {
    const session = await outbound(argv);
    assert.equal(session.code, 1, argv.join(" "));
    assert.match(session.err, /^Invalid: --\S+ takes a positive whole number/u);
  }

  const both = await outbound(["mcp", "--redact", "--no-redact"]);
  assert.equal(both.code, 1);
  assert.match(both.err, /cannot both be set/u);
});

// A tool that reads the campaign list twice: two vendor requests per call.
const twoReads = (
  instance: ReturnType<typeof createOutbound>
): OutboundTool => ({
  call: async () => {
    try {
      await instance.campaigns.list();
      await instance.campaigns.list();

      return {
        data: null,
        meta: {
          complete: true,
          evidence: "exact",
          notes: [],
          provider: "test",
          requests: 2,
        },
        next: "",
        ok: true,
      };
    } catch (error) {
      return {
        error: {
          code: OutboundError.is(error) ? error.code : "Error",
          message: String(error),
        },
        next: "",
        ok: false,
      };
    }
  },
  description: "Reads the campaign list twice.",
  fields: {},
  name: "two_reads",
  needs: [],
  parameters: { properties: {}, type: "object" },
});

test("a per-run budget on the MCP server caps each tool call, not the session", async () => {
  const http = createFetch(() => json({ items: [{ id: "c1" }] }));

  const instance = createOutbound({
    adapter: testAdapter(),
    fetch: http.fetch,
    plugins: [budget({ maxRequests: 3, per: "run" })],
    rateLimitStore: new MemoryRateLimitStore(),
    share: 1,
  });

  const server = createMcpServer(instance, { extra: [twoReads(instance)] });

  const call = async (id: number) =>
    (await server.handle({
      id,
      jsonrpc: "2.0",
      method: "tools/call",
      params: { arguments: {}, name: "two_reads" },
    })) as { result: { isError: boolean } };

  // Two requests each. Without a reset per call, the second would hit the cap of 3.
  assert.equal((await call(1)).result.isError, false);
  assert.equal((await call(2)).result.isError, false);
  assert.equal(http.requests.length, 4);
});

test("serveStdio answers each line in order and skips notifications", async () => {
  const server = createMcpServer(
    createOutbound({
      adapter: memory({ data: demoData(), workspaceId: "acme" }),
    })
  );

  const written: string[] = [];

  await serveStdio(server, {
    input: [
      JSON.stringify({ id: 1, jsonrpc: "2.0", method: "ping" }),
      JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      "",
      JSON.stringify({ id: 2, jsonrpc: "2.0", method: "ping" }),
    ],
    write: (line) => {
      written.push(line);
    },
  });

  assert.deepEqual(
    written.map((line) => (JSON.parse(line) as { id: number }).id),
    [1, 2]
  );
});

test("serveStdio writes to standard output when given no writer", async (t) => {
  const server = createMcpServer(
    createOutbound({
      adapter: memory({ data: demoData(), workspaceId: "acme" }),
    })
  );

  const written: string[] = [];

  t.mock.method(process.stdout, "write", (chunk: string) => {
    written.push(chunk);

    return true;
  });

  await serveStdio(server, {
    input: [JSON.stringify({ id: 9, jsonrpc: "2.0", method: "ping" })],
  });
  t.mock.restoreAll();

  assert.deepEqual(written, ['{"id":9,"jsonrpc":"2.0","result":{}}\n']);
});

test("defineConfig returns the config it is given", () => {
  const config = { plugins: [redact()] };
  assert.equal(defineConfig(config), config);
});
