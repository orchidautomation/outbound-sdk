// The MCP surface: merged tools picked by view or checks, a scope on every
// tool, old names kept as aliases, each result sent once, and a ceiling on
// what tools/list costs a model before its first call (OUT-168).

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createMcpServer,
  OUTPUT_SCHEMA,
  RENAMED_TOOLS,
  run,
} from "../src/cli/index.ts";
import { combine } from "../src/combine/index.ts";
import { createOutbound } from "../src/index.ts";
import type { Adapter, Json } from "../src/index.ts";
import { demoData, memory } from "../src/memory/index.ts";
import type { OutboundTool, ToolResult } from "../src/tools/index.ts";
import { harness } from "./helpers/adapter-suite.ts";
import { suite as heyreachSuite } from "./heyreach/suite.ts";
import { suite as instantlySuite } from "./instantly/suite.ts";

/**
 * The most tools/list may weigh, in bytes, for the widest catalog: Instantly
 * and HeyReach together under redact. It was 84,528 bytes for 36 tools
 * before OUT-168. Raise it only with a reason in the pull request.
 */
const TOOLS_LIST_CEILING = 56_000;

/** The longest a listed tool's description may be. */
const DESCRIPTION_CEILING = 600;

interface Answer {
  readonly ok: boolean;
  readonly data?: Record<string, unknown>;
  readonly error?: { readonly code: string; readonly message: string };
  readonly meta?: {
    readonly notes: readonly string[];
    readonly requests: number;
    readonly complete: boolean;
  };
  readonly next: string;
}

interface Listed {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: {
    readonly properties: Record<
      string,
      {
        readonly enum?: readonly string[];
        readonly items?: { readonly enum?: readonly string[] };
      }
    >;
    readonly required?: readonly string[];
  };
  readonly outputSchema: unknown;
}

const demo = (): Adapter => memory({ data: demoData(), workspaceId: "acme" });

const both = (): Adapter =>
  combine([instantlySuite.make(), heyreachSuite.make()]);

const initialize = (version = "2025-06-18") => ({
  id: 0,
  jsonrpc: "2.0",
  method: "initialize",
  params: { protocolVersion: version },
});

const LIST = { id: 1, jsonrpc: "2.0", method: "tools/list" };

const call = (
  id: number,
  name: string,
  args: Readonly<Record<string, unknown>> = {}
) => ({
  id,
  jsonrpc: "2.0",
  method: "tools/call",
  params: { arguments: args, name },
});

/** Runs `outbound mcp` over the messages, each answer found by its id. */
const serve = async (
  adapter: Adapter,
  messages: readonly object[],
  argv: readonly string[] = []
) => {
  const out: string[] = [];

  await run(["mcp", ...argv], {
    adapter,
    stderr: () => {},
    stdin: () => messages.map((message) => JSON.stringify(message)),
    stdout: (text) => {
      out.push(text);
    },
  });

  const answers = new Map(
    out.map((line) => {
      const parsed = JSON.parse(line) as { id: number };

      return [parsed.id, { line, parsed }] as const;
    })
  );

  const at = (id: number) =>
    answers.get(id)?.parsed as unknown as {
      result: {
        tools: Listed[];
        instructions: string;
        content: { text: string }[];
        structuredContent: Answer;
      };
    };

  return {
    answer: (id: number) => at(id).result.structuredContent,
    at,
    line: (id: number) => answers.get(id)?.line ?? "",
  };
};

test("tools/list stays under its byte ceiling, every tool short, with a scope and an outputSchema", async () => {
  const session = await serve(both(), [initialize(), LIST]);
  const listed = session.at(1).result.tools;
  const bytes = Buffer.byteLength(JSON.stringify(session.at(1).result));

  assert.ok(
    bytes <= TOOLS_LIST_CEILING,
    `tools/list is ${bytes} bytes, over ${TOOLS_LIST_CEILING}`
  );
  assert.ok(listed.length <= 25, `${listed.length} tools`);

  for (const tool of listed) {
    assert.ok(
      tool.description.length <= DESCRIPTION_CEILING,
      `${tool.name}: ${tool.description.length} characters`
    );
    assert.deepEqual(tool.outputSchema, OUTPUT_SCHEMA, tool.name);
    assert.ok(Object.hasOwn(tool.inputSchema.properties, "scope"), tool.name);
    // No description repeats how to read an answer: initialize says it once.
    assert.doesNotMatch(tool.description, /meta\.complete/u, tool.name);
    // No old name is listed, nor named in a description.
    assert.equal(Object.hasOwn(RENAMED_TOOLS, tool.name), false, tool.name);
  }

  const { instructions } = session.at(0).result;

  assert.equal(instructions.match(/meta\.complete: false/gu)?.length, 1);
  assert.match(
    instructions,
    /This server reads instantly:client-a and heyreach:client-a together; scope\.provider reads one\./u
  );
  assert.match(instructions, /use the CLI's --jsonl output or the SDK/u);
  // An old or CLI insight name is named once, so calling it is not a guess.
  assert.match(instructions, /still answer until 0\.17\.0/u);

  for (const name of [
    "dropped_replies",
    "warmup_readiness",
    "campaign_ranking",
  ]) {
    assert.ok(instructions.includes(name), name);
  }
});

test("the size check fails a list over the ceiling", () => {
  const over = "x".repeat(TOOLS_LIST_CEILING + 1);

  assert.ok(
    Buffer.byteLength(JSON.stringify({ tools: [over] })) > TOOLS_LIST_CEILING
  );
});

test("each result is sent once: a summary as text beside structuredContent, or the whole answer to an older client", async () => {
  const current = await serve(demo(), [initialize(), call(1, "campaigns")]);
  const text = current.at(1).result.content[0]?.text ?? "";

  assert.match(
    text,
    /^campaigns: complete answer from memory, 0 vendor requests\. structuredContent\.data holds campaigns \(\d+\), period\. Next: /u
  );
  assert.throws(() => JSON.parse(text) as unknown, SyntaxError);
  assert.equal(current.answer(1).ok, true);

  const older = await serve(demo(), [
    initialize("2025-03-26"),
    call(1, "campaigns"),
  ]);

  assert.deepEqual(
    JSON.parse(older.at(1).result.content[0]?.text ?? ""),
    older.answer(1)
  );
});

test("every old name still answers as it did, with a note naming what replaced it", async () => {
  const names = Object.keys(RENAMED_TOOLS);

  const session = await serve(
    demo(),
    [
      initialize(),
      LIST,
      ...names.map((name, index) =>
        call(
          index + 2,
          name,
          name === "account_summary" ? { domain: "example.com" } : {}
        )
      ),
    ],
    ["--no-redact"]
  );

  const listed = new Set(session.at(1).result.tools.map((tool) => tool.name));

  for (const [index, name] of names.entries()) {
    const answer = session.answer(index + 2);
    const said = answer.ok ? answer.meta?.notes.join(" ") : answer.next;

    assert.ok(
      said?.includes(
        `${name} is an old name kept until 0.17.0: call ${RENAMED_TOOLS[name]} instead.`
      ),
      `${name}: ${said ?? ""}`
    );
    assert.ok(listed.has(RENAMED_TOOLS[name]?.split(" ")[0] ?? ""), name);
  }
});

test("a hint names tools as they are listed, never by an old name", async () => {
  const session = await serve(demo(), [
    initialize(),
    call(1, "campaigns"),
    call(2, "sender_health", { checks: ["bounces"] }),
  ]);

  const old = new RegExp(
    `\\b(?:${Object.keys(RENAMED_TOOLS).join("|")})\\b`,
    "u"
  );

  for (const id of [1, 2]) {
    assert.doesNotMatch(JSON.stringify(session.answer(id)), old);
  }

  assert.match(session.answer(1).next, /campaigns with view "trend"/u);
});

test("a view runs one tool, and checks run several in one answer, each under its own key", async () => {
  const session = await serve(demo(), [
    initialize(),
    call(1, "campaigns", { metric: "reply_rate", view: "ranking" }),
    call(2, "campaign_ranking", { metric: "reply_rate" }),
    call(3, "sender_health", { checks: ["status", "warmup"] }),
    call(4, "sender_health", { checks: ["status", "nope"] }),
    call(5, "campaigns", { view: "list", min_sent: 5 }),
    call(6, "campaigns", { nonsense: 1 }),
  ]);

  assert.deepEqual(session.answer(1).data, session.answer(2).data);

  const checks = session.answer(3);

  assert.equal(checks.ok, true);
  assert.deepEqual(Object.keys(checks.data ?? {}), ["status", "warmup"]);
  assert.ok(
    checks.meta?.notes.every((note) =>
      /^(?:status|warmup)(?:: | failed)/u.test(note)
    ),
    checks.meta?.notes.join("\n") ?? ""
  );

  assert.equal(session.answer(4).error?.code, "Invalid");
  assert.match(
    session.answer(4).error?.message ?? "",
    /checks must be a list of "status", "deliverability", "warmup", "domains", "bounces"/u
  );

  // A field another view takes is not used, and the answer says so.
  assert.equal(session.answer(5).ok, true);
  assert.ok(
    session
      .answer(5)
      .meta?.notes.includes("min_sent not used: list does not take it.")
  );

  assert.equal(session.answer(6).error?.code, "Invalid");
});

test("scope reads one tool of a combined instance, and refuses what the server does not read", async () => {
  const twoWorkspaces = combine([
    memory({ data: demoData(), workspaceId: "acme" }),
    memory({ data: demoData(), workspaceId: "beta" }),
  ]);

  const combined = await serve(twoWorkspaces, [
    initialize(),
    call(1, "campaigns", { scope: { workspace: "beta" } }),
    call(2, "campaigns", { scope: { provider: "smartlead" } }),
    call(3, "campaigns", { scope: { tag: "client-a" } }),
    call(4, "campaigns", { scope: { provider: "memory" } }),
  ]);

  const beta = combined.answer(1);

  assert.equal(beta.ok, true, JSON.stringify(beta));
  assert.ok(
    beta.meta?.notes.includes("Reads memory:beta only, as scope asked.")
  );
  assert.ok(JSON.stringify(beta.data).includes("memory:beta:"));
  assert.ok(!JSON.stringify(beta.data).includes("memory:acme:"));

  assert.match(
    combined.answer(2).error?.message ?? "",
    /Nothing this server reads matches scope smartlead\. It reads memory:acme, memory:beta/u
  );
  assert.match(
    combined.answer(3).error?.message ?? "",
    /cannot read by campaign tag/u
  );
  assert.match(
    combined.answer(4).error?.message ?? "",
    /add scope\.workspace to pick one/u
  );

  const alone = await serve(demo(), [
    initialize(),
    call(1, "campaigns", { scope: { provider: "heyreach" } }),
    call(2, "campaigns", { scope: { provider: "memory", workspace: "acme" } }),
  ]);

  assert.match(
    alone.answer(1).error?.message ?? "",
    /This server reads memory:acme only/u
  );
  assert.equal(alone.answer(2).ok, true);
});

test("a workspace alone that two tools share is refused, not read on the first of them", async () => {
  const session = await serve(both(), [
    initialize(),
    call(1, "client_report", { scope: { workspace: "client-a" } }),
    call(2, "campaigns", { scope: { workspace: "client-a" } }),
  ]);

  for (const id of [1, 2]) {
    assert.match(
      session.answer(id).error?.message ?? "",
      /scope names 2 workspaces \(instantly:client-a, heyreach:client-a\): add scope\.provider to pick one/u,
      String(id)
    );
  }
});

// sender_health's checks on Instantly's fixtures, under a cap or none.
const checked = async (cap: number | undefined, checks: string[]) => {
  const { outbound, settle } = harness(instantlySuite);

  const server = createMcpServer(
    outbound,
    cap === undefined ? {} : { maxRequestsPerToolCall: cap }
  );

  await server.handle(initialize());

  const message = call(1, "sender_health", { checks, impact: false });

  const response = (await settle(
    server.handle(message as unknown as Json)
  )) as unknown as { result: { structuredContent: Answer } };

  return response.result.structuredContent;
};

test("a merged tool's checks share the server's request cap, and a check left nothing is not run", async () => {
  // The cap is exactly what the status check spends alone.
  const alone = await checked(undefined, ["status"]);
  const cap = alone.meta?.requests ?? 0;

  assert.equal(alone.ok, true, JSON.stringify(alone));
  const answer = await checked(cap, ["status", "deliverability"]);

  assert.ok(cap > 0);
  assert.equal(answer.ok, true, JSON.stringify(answer));
  assert.equal(answer.meta?.requests, cap);
  assert.equal(answer.meta?.complete, false);
  assert.ok(
    answer.meta?.notes.includes(
      `deliverability failed: deliverability was not run: the checks before it spent the call's cap of ${cap} requests.`
    ),
    JSON.stringify(answer.meta?.notes)
  );
});

test("a tool narrowed by --tools defaults to a check it still has", async () => {
  const session = await serve(
    demo(),
    [initialize(), LIST, call(2, "sender_health")],
    ["--tools", "bounce_watch"]
  );

  const listed = session
    .at(1)
    .result.tools.find((tool) => tool.name === "sender_health");

  assert.deepEqual(listed?.inputSchema.properties["checks"]?.items?.enum, [
    "bounces",
  ]);

  const checksField = listed?.inputSchema.properties["checks"] as
    | { readonly default?: unknown }
    | undefined;

  assert.deepEqual(checksField?.default, ["bounces"]);

  const answer = session.answer(2);

  assert.equal(answer.ok, true, JSON.stringify(answer));
  assert.ok(Object.hasOwn(answer.data ?? {}, "bounces"));
});

test("outbound tool answers one check under data.<check> in JSON, as two checks are", async () => {
  const out: string[] = [];

  await run(["tool", "sender_health", "--input", '{"checks":["status"]}'], {
    adapter: demo(),
    stderr: () => {},
    stdout: (text) => {
      out.push(text);
    },
  });

  const answer = JSON.parse(out.join("\n")) as Answer;

  assert.equal(answer.ok, true, JSON.stringify(answer));
  assert.deepEqual(Object.keys(answer.data ?? {}), ["status"]);
});

test("unanswered_replies with include thread carries each reply's conversation in its item", async () => {
  const session = await serve(
    demo(),
    [
      initialize(),
      call(1, "unanswered_replies", { include: "thread", older_than_hours: 0 }),
      call(2, "unanswered_replies", { older_than_hours: 0 }),
    ],
    ["--no-redact"]
  );

  const inline = session.answer(1);
  const plain = session.answer(2);

  const items = (inline.data?.["dropped"] ?? []) as {
    lead: string | null;
    thread?: { lead: string | null } | null;
  }[];

  assert.equal(inline.ok, true, JSON.stringify(inline));
  assert.ok(items.length > 0, "the demo data has an unanswered reply");

  for (const item of items) {
    assert.equal(item.thread?.lead, item.lead);
  }

  assert.ok((inline.meta?.requests ?? 0) >= (plain.meta?.requests ?? 0));
  assert.ok(Object.hasOwn(inline.data ?? {}, "threadCoverage"));
  assert.ok(!Object.hasOwn(plain.data ?? {}, "threadCoverage"));
});

test("person is listed under redact, and a view that needs identifiers answers with the masked summary", async () => {
  const session = await serve(demo(), [
    initialize(),
    LIST,
    call(2, "person", { lead_ref: "memory:acme:lead_1", view: "timeline" }),
    call(3, "cross_channel_lead", { lead_ref: "memory:acme:lead_1" }),
  ]);

  const person = session
    .at(1)
    .result.tools.find((tool) => tool.name === "person");

  assert.deepEqual(person?.inputSchema.properties["view"]?.enum, [
    "summary",
    "timeline",
    "account",
  ]);

  const answer = session.answer(2);

  assert.equal(answer.ok, true, JSON.stringify(answer));
  assert.match(
    answer.meta?.notes[0] ?? "",
    /^view timeline needs identifiers the redact plugin masks, so this is the masked summary view\./u
  );

  // The old name of a covered view answers through it, not as an unknown tool.
  const old = session.answer(3);

  assert.equal(old.ok, true, JSON.stringify(old));
  assert.deepEqual(old.meta?.notes.slice(0, 2), [
    `cross_channel_lead is an old name kept until 0.17.0: call ${RENAMED_TOOLS["cross_channel_lead"]} instead.`,
    answer.meta?.notes[0],
  ]);
});

test("scope refuses a malformed scope, and passes provider and tag to a tool that takes them", async () => {
  const twoWorkspaces = combine([
    memory({ data: demoData(), workspaceId: "acme" }),
    memory({ data: demoData(), workspaceId: "beta" }),
  ]);

  const session = await serve(twoWorkspaces, [
    initialize(),
    call(1, "campaigns", { scope: "beta" }),
    call(2, "campaigns", { scope: { nope: 1 } }),
    call(3, "campaigns", { scope: { provider: " " } }),
    call(4, "campaigns", { scope: {} }),
    call(5, "client_report", {
      scope: { provider: "memory", tag: "q4", workspace: "beta" },
    }),
  ]);

  assert.match(
    session.answer(1).error?.message ?? "",
    /scope must be an object/u
  );
  assert.match(
    session.answer(2).error?.message ?? "",
    /scope takes provider, workspace and tag, not nope/u
  );
  assert.match(
    session.answer(3).error?.message ?? "",
    /scope\.provider must be a non-empty string/u
  );
  assert.equal(session.answer(4).ok, true);
  assert.notEqual(
    session.answer(5).error?.code,
    "Invalid",
    JSON.stringify(session.answer(5))
  );
});

// A stand-in for an insight, so the edges of include "thread" can be set.
const standIn = (
  name: string,
  answer: (input: unknown) => ToolResult
): OutboundTool => ({
  call: (input) => Promise.resolve(answer(input)),
  description: name,
  fields: {},
  name,
  needs: [],
  parameters: {
    properties: { older_than_hours: { type: "number" } },
    type: "object",
  },
});

const answered = (data: Json, requests = 1): ToolResult => ({
  data,
  meta: {
    complete: true,
    evidence: "exact",
    notes: [],
    provider: "memory",
    requests,
  },
  next: "Use thread_context.",
  ok: true,
});

const droppedOf = (count: number) =>
  standIn("dropped_replies", () =>
    answered({
      dropped: Array.from({ length: count }, (_, index) => ({
        lead: `memory:acme:l${index}`,
      })),
    })
  );

const handled = async (extra: readonly OutboundTool[], args: unknown) => {
  const server = createMcpServer(createOutbound({ adapter: demo() }), {
    extra,
    only: [],
  });

  await server.handle(initialize());

  const response = (await server.handle({
    id: 1,
    jsonrpc: "2.0",
    method: "tools/call",
    params: { arguments: args as Json, name: "unanswered_replies" },
  })) as unknown as { result: { structuredContent: Answer } };

  return response.result.structuredContent;
};

test("include thread says when conversations could not be read, or were left to thread_context", async () => {
  const failing = standIn("thread_context", () => ({
    error: {
      code: "RateLimited",
      message: "the cap was reached",
      retryable: false,
    },
    meta: { requests: 2 },
    next: "Ask for less.",
    ok: false,
  }));

  const failed = await handled([droppedOf(2), failing], { include: "thread" });

  assert.equal(failed.meta?.complete, false);
  assert.ok(
    failed.meta?.notes.includes(
      "The conversations were not read: the cap was reached"
    )
  );
  assert.equal(failed.meta?.requests, 3);

  const reading = standIn("thread_context", (input) =>
    answered({
      coverage: {},
      threads: (input as { leads: string[] }).leads.map((lead) => ({ lead })),
    })
  );

  const many = await handled([droppedOf(51), reading], { include: "thread" });

  assert.equal(many.meta?.complete, false);
  assert.ok(
    many.meta?.notes.some((note) =>
      note.startsWith(
        "Conversations are inline for the first 50 people; thread_context reads the other 1"
      )
    )
  );

  const none = await handled([droppedOf(0), reading], { include: "thread" });

  assert.equal(none.meta?.requests, 1);

  // Without thread_context there is no include, and the answer is dropped_replies' own.
  const alone = await handled([droppedOf(1)], {});

  assert.equal(alone.ok, true);
});
