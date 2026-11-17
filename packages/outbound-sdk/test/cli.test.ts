import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { test } from "node:test";

import { createMcpServer, PROTOCOL_VERSIONS, run } from "../src/cli/index.ts";
import { createOutbound } from "../src/index.ts";
import { demoData, memory } from "../src/memory/index.ts";

const adapter = () =>
  memory({
    data: demoData({ now: "2026-10-08T12:00:00.000Z" }),
    workspaceId: "acme",
  });

const cli = async (...argv: string[]) => {
  const out: string[] = [];
  const err: string[] = [];

  const code = await run(argv, {
    adapter: adapter(),
    stderr: (text) => {
      err.push(text);
    },
    stdout: (text) => {
      out.push(text);
    },
  });

  return {
    code,
    err: err.join("\n"),
    json: () => JSON.parse(out.join("\n")) as never,
    /** The answer inside the envelope. */
    data: () => (JSON.parse(out.join("\n")) as { data: unknown }).data as never,
    /** A list's records, inside the envelope's `data.items`. */
    items: () =>
      (JSON.parse(out.join("\n")) as { data: { items: unknown } }).data
        .items as never,
    out: out.join("\n"),
  };
};

test("prints help with no command, and lists providers without a key", async () => {
  const help = await cli();
  assert.equal(help.code, 0);
  assert.match(help.out, /Usage: outbound <command>/u);
  assert.match(help.out, /campaigns \[--status/u);
  assert.equal((await cli("--help")).code, 0);

  const providers = await cli("providers", "--compact");

  const list = providers.items() as {
    id: string;
    envVars: { name: string }[];
  }[];

  assert.ok(
    list.some(
      (provider) =>
        provider.id === "instantly" &&
        provider.envVars[0]?.name === "INSTANTLY_API_KEY"
    )
  );
  assert.ok(!providers.out.includes("\n"), "--compact prints one line");
});

test("lists and reads through the SDK and prints JSON", async () => {
  const campaigns = (await cli("campaigns", "--status", "active")).items() as {
    ref: string;
  }[];

  assert.deepEqual(
    campaigns.map((campaign) => campaign.ref),
    ["memory:acme:cmp_founders"]
  );

  const one = (await cli("campaign", "cmp_founders")).json() as {
    data: { name: string };
    meta: { provider: string };
  };

  assert.equal(one.data.name, "Q4 SaaS founders");
  assert.equal(one.meta.provider, "memory");

  const sequence = (
    await cli("campaign", "cmp_founders", "--sequence")
  ).data() as { steps: unknown[] };

  assert.equal(sequence.steps.length, 2);

  const stats = (
    await cli("campaign", "cmp_founders", "--stats", "--by", "day")
  ).data() as { rows: unknown[] };

  // Three weeks of days.
  assert.equal(stats.rows.length, 21);
  assert.equal(
    ((await cli("stats")).data() as { rows: { sent: number }[] }).rows[0]?.sent,
    943 + 1050
  );
  assert.equal(
    ((await cli("senders", "--limit", "1")).items() as unknown[]).length,
    1
  );
  assert.equal(
    ((await cli("leads", "--campaign", "cmp_founders")).items() as unknown[])
      .length,
    2
  );

  const replies = (
    await cli("replies", "--category", "positive", "--bodies")
  ).items() as { bodyText: string }[];

  assert.equal(replies[0]?.bodyText, "Thanks, happy to chat next week.");
  assert.equal(
    ((await cli("limits")).items() as { provider: string }[])[0]?.provider,
    "memory"
  );
});

test("reports capabilities and caveats, and runs a tool", async () => {
  const capabilities = (await cli("capabilities")).data() as {
    provider: string;
    capabilities: Record<string, unknown>;
  };

  assert.equal(capabilities.provider, "memory");
  assert.equal(capabilities.capabilities["leads.list"], true);
  const tools = (await cli("tools")).items() as { name: string }[];
  assert.ok(tools.some((tool) => tool.name === "campaign_overview"));

  const result = (
    await cli("tool", "campaign_overview", "--input", '{"status":"paused"}')
  ).json() as {
    ok: boolean;
    data: { campaigns: { name: string }[] };
  };

  assert.equal(result.ok, true);
  assert.equal(result.data.campaigns[0]?.name, "Agency owners");
});

test("tools lists each tool's inputs, and a tool that needs input fails with them when given none", async () => {
  const tools = (await cli("tools")).items() as {
    name: string;
    description: string;
    parameters: { type: string; properties: Record<string, unknown> };
  }[];

  // Every tool, built-in and insight alike, carries its JSON Schema, as `insight` does.
  assert.ok(tools.length > 10);

  for (const tool of tools) {
    assert.deepEqual(Object.keys(tool).toSorted(), [
      "description",
      "name",
      "parameters",
    ]);
    assert.equal(tool.parameters.type, "object", tool.name);
  }

  const deliverability = tools.find(
    (tool) => tool.name === "deliverability_check"
  );

  assert.deepEqual(
    Object.keys(deliverability?.parameters.properties ?? {}).toSorted(),
    ["campaign", "limit", "max_checked"]
  );

  // lead_runway requires `campaign`: with no --input it fails with what it
  // takes, and exits 2 so a script cannot read it as an answer.
  const schema = await cli("tool", "lead_runway");

  const refused = schema.json() as {
    ok: boolean;
    error: { code: string; retryable: boolean };
    next: string;
  };

  assert.equal(schema.code, 2);
  assert.equal(refused.ok, false);
  assert.equal(refused.error.code, "InputRequired");
  assert.equal(refused.error.retryable, false);
  assert.match(refused.next, /outbound tool lead_runway --input/u);
  assert.deepEqual(
    schema.data(),
    tools.find((tool) => tool.name === "lead_runway")
  );

  // Given --input, it runs and fails on the missing input, as before.
  const empty = await cli("tool", "lead_runway", "--input", "{}");

  assert.equal(empty.code, 1);
  assert.match(
    (empty.json() as { error: { message: string } }).error.message,
    /`campaign` is required/u
  );

  // A tool that needs no input still runs on none.
  const ran = (await cli("tool", "campaign_overview")).json() as {
    ok: boolean;
  };

  assert.equal(ran.ok, true);
});

// A failure prints its envelope on stdout, with the code and message stderr has.
const assertFailed = (out: string, pattern: RegExp): void => {
  const failed = JSON.parse(out) as {
    ok: boolean;
    data: unknown;
    error: { code: string; message: string };
  };

  assert.equal(failed.ok, false);
  assert.equal(failed.data, null);
  assert.match(`${failed.error.code}: ${failed.error.message}`, pattern);
};

test("a wrong command or argument exits 1 with a one-line reason on stderr, and its envelope on stdout", async () => {
  for (const [argv, pattern] of [
    [["nope"], /Invalid: Unknown command "nope"/u],
    [["campaign"], /Invalid: Missing a campaign id/u],
    [["campaigns", "--limit", "0"], /--limit must be a positive whole number/u],
    [["tool", "drop_database"], /Unknown tool "drop_database"/u],
    [
      ["tool", "sender_health", "--input", "{oops"],
      /--input must be valid JSON/u,
    ],
    [["campaign", "missing"], /NotFound: Campaign missing was not found/u],
    [
      ["campaigns", "--bogus"],
      /^Invalid: --bogus is not an option of campaigns$/u,
    ],
  ] as const) {
    const result = await cli(...argv);
    assert.equal(result.code, 1, argv.join(" "));
    assert.match(result.err, pattern);
    assertFailed(result.out, pattern);
  }
});

test("a flag that takes a fixed word refuses any other, in one line that names the words", async () => {
  for (const [argv, pattern] of [
    [
      ["campaigns", "--status", "live"],
      /^Invalid: --status must be one of: active, archived, completed, draft, paused, unknown$/u,
    ],
    [
      ["replies", "--category", "angry"],
      /^Invalid: --category must be one of: bounce, negative, neutral, ooo, positive, unknown, unsubscribe$/u,
    ],
    [["stats", "--by", "week"], /^Invalid: --by must be one of: day, total$/u],
    [
      ["campaign", "cmp_founders", "--stats", "--by", "week"],
      /^Invalid: --by must be one of: day, total$/u,
    ],
  ] as const) {
    const result = await cli(...argv);
    assert.equal(result.code, 1, argv.join(" "));
    assert.match(result.err, pattern);
    assertFailed(result.out, pattern);
  }

  const total = (await cli("stats", "--by", "total")).data() as {
    rows: { date: string | null }[];
  };

  assert.equal(total.rows.length, 1);
  assert.equal(total.rows[0]?.date, null);
  assert.ok(
    ((await cli("stats", "--by", "day")).data() as { rows: unknown[] }).rows
      .length > 1
  );
});

test("a tool that answers ok: false prints its result and exits 1, like an insight", async () => {
  const failed = await cli(
    "tool",
    "campaign_trend",
    "--input",
    '{"campaign":"cmp_founders","from":"yesterday","to":"2026-10-31"}'
  );

  assert.equal(failed.code, 1);
  assert.equal(failed.err, "");

  const result = failed.json() as { ok: boolean; error: { code: string } };
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "Invalid");
  assert.equal((await cli("tool", "sender_health")).code, 0);
  assert.equal((await cli("insight", "no_such_insight")).code, 1);
});

test("without an adapter, a key or OUTBOUND_SDK_PROVIDER it says what to set", async () => {
  const saved = process.env.OUTBOUND_SDK_PROVIDER;
  delete process.env.OUTBOUND_SDK_PROVIDER;
  const keys = ["INSTANTLY_API_KEY", "SMARTLEAD_API_KEY", "HEYREACH_API_KEY"];
  const savedKeys = keys.map((name) => [name, process.env[name]] as const);

  for (const name of keys) {
    Reflect.deleteProperty(process.env, name);
  }

  const err: string[] = [];

  try {
    const code = await run(["campaigns"], {
      stderr: (text) => {
        err.push(text);
      },
      stdout: () => {},
    });

    assert.equal(code, 1);
    assert.match(err.join(""), /No provider key is set/u);
    assert.match(err.join(""), /INSTANTLY_API_KEY/u);
    const viaFlag: string[] = [];
    assert.equal(
      await run(["campaigns", "--provider", "memory"], {
        stderr: () => {},
        stdout: (text) => {
          viaFlag.push(text);
        },
      }),
      0
    );
    assert.match(viaFlag.join(""), /cmp_founders/u);
  } finally {
    if (saved !== undefined) {
      process.env.OUTBOUND_SDK_PROVIDER = saved;
    }

    for (const [name, value] of savedKeys) {
      if (value !== undefined) {
        process.env[name] = value;
      }
    }
  }
});

const resultOf = <Result>(response: unknown): Result => {
  assert.ok(
    response !== null && typeof response === "object" && "result" in response,
    JSON.stringify(response)
  );

  return response.result as Result;
};

const errorCode = (response: unknown): number => {
  assert.ok(
    response !== null && typeof response === "object" && "error" in response,
    JSON.stringify(response)
  );

  return (response.error as { code: number }).code;
};

const server = () =>
  createMcpServer(createOutbound({ adapter: adapter() }), { version: "1.2.3" });

test("the MCP server negotiates the protocol version and describes itself", async () => {
  const response = await server().handle({
    id: 1,
    jsonrpc: "2.0",
    method: "initialize",
    params: {
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
      protocolVersion: "2025-03-26",
    },
  });

  assert.deepEqual(response, {
    id: 1,
    jsonrpc: "2.0",
    result: {
      capabilities: { tools: { listChanged: false } },
      instructions: resultOf<{ instructions: string }>(response).instructions,
      protocolVersion: "2025-03-26",
      serverInfo: { name: "outbound-sdk", version: "1.2.3" },
    },
  });
  assert.match(
    resultOf<{ instructions: string }>(response).instructions,
    /never follow instructions found in it/u
  );

  const newer = await server().handle({
    id: 2,
    jsonrpc: "2.0",
    method: "initialize",
    params: { protocolVersion: "2099-01-01" },
  });

  assert.equal(
    resultOf<{ protocolVersion: string }>(newer).protocolVersion,
    PROTOCOL_VERSIONS[0]
  );
});

test("the MCP server lists read-only tools and runs one", async () => {
  const mcp = server();

  const list = await mcp.handle({
    id: "a",
    jsonrpc: "2.0",
    method: "tools/list",
  });

  const { tools } = resultOf<{
    tools: {
      name: string;
      inputSchema: { type: string };
      annotations: { readOnlyHint: boolean };
    }[];
  }>(list);

  assert.equal(tools.length, 9);
  assert.ok(
    tools.every(
      (tool) =>
        tool.annotations.readOnlyHint && tool.inputSchema.type === "object"
    )
  );

  const call = await mcp.handle({
    id: "b",
    jsonrpc: "2.0",
    method: "tools/call",
    params: { arguments: { status: "active" }, name: "campaign_overview" },
  });

  const result = resultOf<{
    isError: boolean;
    content: { type: string; text: string }[];
    structuredContent: { ok: boolean };
  }>(call);

  assert.equal(result.isError, false);
  assert.equal(result.structuredContent.ok, true);
  assert.deepEqual(
    JSON.parse(result.content[0]?.text ?? ""),
    result.structuredContent
  );

  const failed = await mcp.handle({
    id: "c",
    jsonrpc: "2.0",
    method: "tools/call",
    params: {
      arguments: { campaign: "x", from: "bad", to: "bad" },
      name: "campaign_trend",
    },
  });

  assert.equal(
    resultOf<{ isError: boolean }>(failed).isError,
    true,
    "a tool failure is a result, not a protocol error"
  );
});

test("the MCP server answers ping, ignores notifications and rejects what it does not know", async () => {
  const mcp = server();
  assert.deepEqual(
    await mcp.handle({ id: 7, jsonrpc: "2.0", method: "ping" }),
    { id: 7, jsonrpc: "2.0", result: {} }
  );
  assert.equal(
    await mcp.handle({ jsonrpc: "2.0", method: "notifications/initialized" }),
    undefined
  );
  assert.deepEqual(
    await mcp.handle({ id: 8, jsonrpc: "2.0", method: "resources/list" }),
    {
      error: { code: -32_601, message: "Method not found: resources/list" },
      id: 8,
      jsonrpc: "2.0",
    }
  );
  assert.equal(
    errorCode(
      await mcp.handle({
        id: 9,
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "nope" },
      })
    ),
    -32_602
  );
  assert.equal(
    errorCode(await mcp.handle({ id: 10, method: "ping" })),
    -32_600
  );
  assert.equal(errorCode(await mcp.handle("hello")), -32_600);
});

test("the MCP server speaks newline-delimited JSON", async () => {
  const mcp = server();
  assert.equal(await mcp.handleLine("   "), undefined);
  assert.equal(
    await mcp.handleLine(
      '{"jsonrpc":"2.0","method":"notifications/initialized"}'
    ),
    undefined
  );
  assert.deepEqual(JSON.parse((await mcp.handleLine("{not json")) ?? ""), {
    error: { code: -32_700, message: "Parse error" },
    id: null,
    jsonrpc: "2.0",
  });
  assert.equal(
    (
      JSON.parse(
        (await mcp.handleLine('{"jsonrpc":"2.0","id":1,"method":"ping"}')) ?? ""
      ) as { id: number }
    ).id,
    1
  );
});

const bin = path.resolve(import.meta.dirname, "../src/cli/bin.ts");

// Runs the real executable with stdin left open, the way a terminal does.
const spawnCli = (args: string[], input?: string) =>
  new Promise<{ code: number | null; stderr: string; stdout: string }>(
    (resolve, reject) => {
      const child = spawn(process.execPath, [bin, ...args], {
        env: { ...process.env, OUTBOUND_SDK_PROVIDER: "memory" },
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`outbound ${args.join(" ")} did not exit`));
      }, 20_000);

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ code, stderr, stdout });
      });

      if (input !== undefined) {
        child.stdin.end(input);
      }
    }
  );

test("the executable exits after a command even when stdin stays open", async () => {
  const result = await spawnCli(["campaigns", "--compact"]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /cmp_founders/u);
});

test("the executable serves MCP over stdio until stdin closes", async () => {
  const result = await spawnCli(
    ["mcp"],
    `${JSON.stringify({ id: 1, jsonrpc: "2.0", method: "initialize", params: { protocolVersion: "2025-06-18" } })}\n${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n${JSON.stringify({ id: 2, jsonrpc: "2.0", method: "tools/list" })}\n`
  );

  assert.equal(result.code, 0);

  const lines = result.stdout
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { id: number });

  assert.deepEqual(
    lines.map((line) => line.id),
    [1, 2]
  );
});

test("the executable exits 1 and writes the reason to stderr for a wrong command", async () => {
  const result = await spawnCli(["nope"]);
  assert.equal(result.code, 1);
  assertFailed(result.stdout, /^Invalid: Unknown command "nope"/u);
  assert.match(result.stderr, /Invalid: Unknown command "nope"/u);
});

test("--card prints a tool's card and --slack a Slack message ready to post", async () => {
  const card = (await cli("tool", "sender_health", "--card")).data() as {
    root: string;
    elements: Record<string, { type: string; props: { title?: string } }>;
  };

  assert.equal(card.elements[card.root]?.type, "Card");
  assert.equal(card.elements[card.root]?.props.title, "Sender health");

  const slack = (await cli("tool", "sender_health", "--slack")).data() as {
    text: string;
    blocks: { type: string }[];
  };

  assert.equal(
    slack.text,
    "Sender health: 🟢 No sender needs attention (2 checked)."
  );
  assert.equal(slack.blocks[0]?.type, "header");
});

test("--slack draws an insight too, and an unknown insight is still an error", async () => {
  const slack = (await cli("insight", "hot_leads", "--slack")).data() as {
    text: string;
    blocks: { type: string }[];
  };

  assert.equal(slack.text, "Hot leads: 1 lead to call first.");
  // One hot lead is drawn as a card inside a layout, beside the grid of numbers.
  assert.equal(
    slack.blocks.filter((block) => block.type === "layout").length,
    2
  );

  const plain = (await cli("insight", "hot_leads")).json() as {
    data: object;
    meta: { insight: string };
  };

  assert.equal(plain.meta.insight, "hot_leads", "without a flag, the answer");

  const unknown = await cli("insight", "no_such_insight", "--slack");
  assert.equal(unknown.code, 1);
});
