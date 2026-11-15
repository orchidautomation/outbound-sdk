// Each tool call gets its own allowance of vendor requests, so a model calling
// tools in a loop cannot spend a vendor's quota on one question, and a cap
// stop tells the model not to call again with the same input.

import assert from "node:assert/strict";
import { test } from "node:test";

import { budget } from "../src/budget/index.ts";
import { createMcpServer } from "../src/cli/index.ts";
import { OutboundError } from "../src/index.ts";
import { insightTools } from "../src/insights/index.ts";
import { createTools, DEFAULT_TOOL_REQUESTS } from "../src/tools/index.ts";
import type { OutboundTool, ToolResult } from "../src/tools/index.ts";
import { CAMPAIGN, over, world } from "./insights/metered.ts";

const named = (tools: readonly OutboundTool[], name: string): OutboundTool => {
  const tool = tools.find((each) => each.name === name);

  assert.ok(tool, `${name} is offered`);

  return tool;
};

const failed = (result: ToolResult) => {
  assert.equal(result.ok, false);

  // SAFETY: just checked that the call failed.
  return result as Extract<ToolResult, { ok: false }>;
};

// 1,500 leads at 10 a page: counting them is 150 requests.
const MANY_LEADS = world(1, 1500);

test("a built-in tool call stops at 100 requests by default, and the model is told not to retry", async () => {
  const { http, outbound } = over(MANY_LEADS);
  const runway = named(createTools(outbound), "lead_runway");

  const result = failed(await runway.call({ campaign: CAMPAIGN }));

  assert.equal(http.requests.length, DEFAULT_TOOL_REQUESTS);
  assert.equal(result.error.code, "RateLimited");
  assert.equal(result.error.retryable, false);
  assert.deepEqual(result.meta, { requests: DEFAULT_TOOL_REQUESTS });
  assert.equal(
    result.next,
    "Do not call again with the same input. Ask the user to raise maxRequestsPerToolCall (default 100 here)."
  );
});

test("maxRequestsPerToolCall raises a tool call's allowance, and Infinity removes it", async () => {
  for (const cap of [200, Infinity]) {
    const { outbound } = over(MANY_LEADS);

    const runway = named(
      createTools(outbound, { maxRequestsPerToolCall: cap }),
      "lead_runway"
    );

    // oxlint-disable-next-line no-await-in-loop -- one cap at a time.
    const result = await runway.call({ campaign: CAMPAIGN });

    assert.equal(result.ok, true, `with ${cap}`);
  }
});

test("each tool call gets a fresh allowance", async () => {
  const { http, outbound } = over(world(1, 400));

  const runway = named(
    createTools(outbound, { maxRequestsPerToolCall: 50 }),
    "lead_runway"
  );

  for (let call = 0; call < 3; call += 1) {
    // oxlint-disable-next-line no-await-in-loop -- calls one after another, as a model makes them.
    const result = await runway.call({ campaign: CAMPAIGN });

    assert.equal(result.ok, true);
  }

  assert.ok(http.requests.length > 50);
});

test("a lower maxRequestsPerToolCall stops a call, naming the setting it was set to", async () => {
  const { outbound } = over(world(1, 400));

  const runway = named(
    createTools(outbound, { maxRequestsPerToolCall: 5 }),
    "lead_runway"
  );

  const result = failed(await runway.call({ campaign: CAMPAIGN }));

  assert.equal(result.error.retryable, false);
  assert.match(result.next, /\(set to 5 here\)/u);
});

test("maxRequestsPerToolCall must be a positive integer or Infinity", () => {
  const { outbound } = over(world(1, 1));

  assert.throws(
    () => createTools(outbound, { maxRequestsPerToolCall: 0 }),
    (error: unknown) => OutboundError.is(error) && error.code === "Invalid"
  );
});

test("an insight tool refuses a call it cannot afford, says which input to lower, and createTools passes its cap down", async () => {
  const { http, outbound } = over(world(60, 25));

  const tools = createTools(outbound, {
    extra: insightTools(outbound, { only: ["client_report"] }),
    maxRequestsPerToolCall: 30,
    only: [],
  });

  const result = failed(await named(tools, "client_report").call({}));

  assert.equal(result.error.code, "RateLimited");
  assert.equal(result.error.retryable, false);
  assert.equal(result.meta?.requests, http.requests.length);
  assert.match(
    result.next,
    /^Do not call again with the same input\. Lower max_campaigns to \d+ or less, or ask the user to raise maxRequestsPerToolCall \(set to 30 here\)\.$/u
  );
});

test("an insight tool's default allowance is what its input can cost, so it runs whole", async () => {
  const { outbound } = over(world(60, 25));
  const [report] = insightTools(outbound, { only: ["client_report"] });

  assert.ok(report);

  const result = await report.call({});

  assert.equal(result.ok, true);
});

test("an exhausted run budget is not something to retry", async () => {
  const { outbound } = over(world(1, 400), {
    plugins: [budget({ maxRequests: 3 })],
  });

  const runway = named(createTools(outbound), "lead_runway");
  const result = failed(await runway.call({ campaign: CAMPAIGN }));

  assert.equal(result.error.code, "RateLimited");
  assert.equal(result.error.retryable, false);
  assert.match(result.next, /^A request cap the user set was reached/u);
  assert.doesNotMatch(result.next, /try again/u);
});

test("the MCP server applies the same default to each tool call, on top of its budget reset", async () => {
  const { http, outbound } = over(MANY_LEADS);
  const server = createMcpServer(outbound);

  const response = (await server.handle({
    id: 1,
    jsonrpc: "2.0",
    method: "tools/call",
    params: { arguments: { campaign: CAMPAIGN }, name: "lead_runway" },
  })) as {
    result: {
      isError: boolean;
      structuredContent: { error: { code: string; retryable: boolean } };
    };
  };

  assert.equal(response.result.isError, true);
  assert.equal(response.result.structuredContent.error.code, "RateLimited");
  assert.equal(response.result.structuredContent.error.retryable, false);
  assert.equal(http.requests.length, DEFAULT_TOOL_REQUESTS);
});
