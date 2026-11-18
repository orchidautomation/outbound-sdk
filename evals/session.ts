// An MCP client session: initialize, tools/list and tools/call, with each
// call's cost and outcome recorded. Only counts and names are kept, never a
// payload, so nothing personal outlives the run.

import { at, bool, isRecord, list, num, parsed, text } from "./json.ts";
import type { JsonObject, Transport } from "./transport.ts";

export interface ToolInfo {
  readonly name: string;
  readonly required: readonly string[];
}

export interface CallOutcome {
  readonly name: string;
  readonly ms: number;
  /** `structuredContent`, or `undefined` for a JSON-RPC error. */
  readonly structured: unknown;
  readonly isError: boolean;
  /** The tool's error code (`Unsupported`, `Invalid`, ...) or the JSON-RPC error's message. */
  readonly code: string | null;
  readonly requests: number | null;
  readonly complete: boolean | null;
  /** Bytes of the `content` text and of `structuredContent`, to tell a result sent twice. */
  readonly contentBytes: number;
  readonly structuredBytes: number;
  /** Milliseconds from the call to its first progress notification, or `null` for none. */
  readonly firstProgressMs: number | null;
}

export interface CallRecord {
  readonly name: string;
  readonly ms: number;
  readonly code: string | null;
  readonly requests: number | null;
  readonly complete: boolean | null;
}

export interface Session {
  readonly initialize: () => Promise<unknown>;
  readonly tools: () => Promise<readonly ToolInfo[]>;
  /** Bytes of the tools/list response line. */
  readonly listBytes: () => Promise<number>;
  readonly call: (
    name: string,
    args?: JsonObject,
    options?: { readonly progress?: boolean; readonly fresh?: boolean }
  ) => Promise<CallOutcome>;
  readonly calls: readonly CallRecord[];
  readonly close: () => Promise<void>;
}

/** The run's request budget: `check` throws once it is spent. */
export interface Budget {
  readonly check: () => void;
  readonly spend: (requests: number | null) => void;
}

const outcomeOf = (
  name: string,
  message: unknown,
  ms: number,
  firstProgressMs: number | null
): CallOutcome => {
  const error = at(message, "error");
  const result = at(message, "result");
  const structured = at(result, "structuredContent");
  const content = list(at(result, "content"));

  const contentBytes = content.reduce<number>(
    (sum, block) => sum + (text(at(block, "text"))?.length ?? 0),
    0
  );

  const isError = error !== undefined || at(result, "isError") === true;

  const code = isRecord(error)
    ? (text(error.message) ?? "rpc")
    : text(at(structured, "error", "code"));

  return {
    code: isError ? (code ?? "Error") : null,
    complete: bool(at(structured, "meta", "complete")),
    contentBytes,
    firstProgressMs,
    isError,
    ms,
    name,
    requests: num(at(structured, "meta", "requests")),
    structured,
    structuredBytes:
      structured === undefined ? 0 : JSON.stringify(structured).length,
  };
};

/** One JSON-RPC request channel over a transport, with progress notifications kept by token. */
const channel = (transport: Transport) => {
  const answers = new Map<number, (message: unknown) => void>();
  const progress = new Map<string, number>();
  const state = { listBytes: 0, nextId: 1 };

  transport.onLine((line) => {
    const message = parsed(line);
    const id = num(at(message, "id"));

    if (id !== null) {
      if (at(message, "result", "tools") !== undefined) {
        state.listBytes = line.length;
      }

      answers.get(id)?.(message);
      answers.delete(id);

      return;
    }

    const token = at(message, "params", "progressToken");

    if (
      at(message, "method") === "notifications/progress" &&
      typeof token === "string" &&
      !progress.has(token)
    ) {
      progress.set(token, transport.now());
    }
  });

  const request = async (
    method: string,
    params?: JsonObject
  ): Promise<unknown> => {
    const id = state.nextId;
    state.nextId += 1;

    const answer = new Promise<unknown>((resolve) => {
      answers.set(id, resolve);
    });

    const message: JsonObject = { id, jsonrpc: "2.0", method };

    transport.send(params === undefined ? message : { ...message, params });

    return await transport.settle(answer);
  };

  return { progress, request, state };
};

export const session = (transport: Transport, budget: Budget): Session => {
  const { progress, request, state } = channel(transport);
  const memo = new Map<string, Promise<CallOutcome>>();
  const calls: CallRecord[] = [];
  let initialized: Promise<unknown> | undefined;
  let listed: Promise<readonly ToolInfo[]> | undefined;

  const initialize = (): Promise<unknown> => {
    initialized ??= request("initialize", {
      capabilities: {},
      clientInfo: { name: "outbound-sdk-evals", version: "1" },
      protocolVersion: "2025-06-18",
    }).then((message) => {
      transport.send({ jsonrpc: "2.0", method: "notifications/initialized" });

      return at(message, "result");
    });

    return initialized;
  };

  const tools = (): Promise<readonly ToolInfo[]> => {
    listed ??= initialize()
      .then(() => request("tools/list"))
      .then((message) =>
        list(at(message, "result", "tools")).map((tool) => ({
          name: text(at(tool, "name")) ?? "",
          required: list(at(tool, "inputSchema", "required")).map(String),
        }))
      );

    return listed;
  };

  const callNow = async (
    name: string,
    args: JsonObject,
    withProgress: boolean
  ): Promise<CallOutcome> => {
    await initialize();
    budget.check();
    const token = `p${state.nextId}`;
    const started = transport.now();
    const params: JsonObject = { arguments: args, name };

    const message = await request(
      "tools/call",
      withProgress ? { ...params, _meta: { progressToken: token } } : params
    );

    const ms = transport.now() - started;
    const first = progress.get(token);

    const outcome = outcomeOf(
      name,
      message,
      ms,
      first === undefined ? null : first - started
    );

    calls.push({
      code: outcome.code,
      complete: outcome.complete,
      ms,
      name,
      requests: outcome.requests,
    });
    budget.spend(outcome.requests);

    return outcome;
  };

  return {
    call: (name, args = {}, options = {}) => {
      if (options.progress === true || options.fresh === true) {
        return callNow(name, args, options.progress === true);
      }

      const key = `${name} ${JSON.stringify(args)}`;
      const pending = memo.get(key) ?? callNow(name, args, false);
      memo.set(key, pending);

      return pending;
    },
    calls,
    close: () => transport.close(),
    initialize,
    listBytes: async () => {
      await tools();

      return state.listBytes;
    },
    tools,
  };
};
