// The whole invariant suite, offline over fixtures. Each case's verdict is
// held to evals/offline-expected.json, so a fix or a regression shows here
// as a change to review. After a real change, record it with
// UPDATE_EVALS=1 npm test and read the diff before committing.

import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { createContext } from "../context.ts";
import { summarize } from "../run.ts";
import { session } from "../session.ts";
import { CASES, runCases } from "../suite.ts";
import { child } from "../transport.ts";

const EXPECTED = path.join(import.meta.dirname, "../offline-expected.json");

test("every invariant case runs offline to its recorded verdict, and the summary holds counts only", async () => {
  const ctx = createContext({ live: false, maxRequests: 100_000 });
  const suite = await runCases(ctx);
  await ctx.close();

  const verdicts = Object.fromEntries(
    suite.cases.map((one) => [String(one.id), one.status])
  );

  assert.equal(suite.cases.length, CASES.length);
  assert.equal(new Set(CASES.map((one) => one.id)).size, 32);

  for (const one of suite.cases) {
    assert.doesNotMatch(
      one.detail,
      /the case itself failed/u,
      `case ${one.id} crashed`
    );
  }

  const summary = summarize(
    {
      ...suite,
      commit: null,
      layer: "invariants",
      maxRequests: 100_000,
      mode: "offline",
      seconds: 1,
      startedAt: "",
      version: "0.0.0",
    },
    undefined
  );

  assert.match(summary, /32 cases/u);

  if (process.env.UPDATE_EVALS === "1") {
    writeFileSync(EXPECTED, `${JSON.stringify(verdicts, null, 2)}\n`);
  }

  assert.deepEqual(verdicts, JSON.parse(readFileSync(EXPECTED, "utf-8")));
});

test("a server that exits before answering fails its pending request instead of hanging", async () => {
  const open = session(child([process.execPath, "-e", "process.exit(2)"]), {
    check: () => {},
    spend: () => {},
  });

  await assert.rejects(open.initialize(), /exited with code 2/u);
  await assert.rejects(open.call("client_report"), /exited/u);
  await open.close();
});

test("a retryable stop is waited out on the transport's clock once, and each attempt is charged and timed on its own", async () => {
  const listeners: ((line: string) => void)[] = [];
  const slept: number[] = [];
  const spent: (number | null)[] = [];
  let checks = 0;
  let clock = 0;
  let calls = 0;

  const answer = (id: unknown, result: Readonly<Record<string, unknown>>) => {
    for (const listener of listeners) {
      listener(JSON.stringify({ id, jsonrpc: "2.0", result }));
    }
  };

  const open = session(
    {
      close: async () => {},
      now: () => clock,
      onExit: () => {},
      onLine: (listener) => {
        listeners.push(listener);
      },
      send: (message) => {
        if (message.id === undefined) {
          return;
        }

        if (message.method !== "tools/call") {
          answer(message.id, {});

          return;
        }

        calls += 1;
        clock += calls === 1 ? 5 : 40;
        answer(
          message.id,
          calls === 1
            ? {
                isError: true,
                structuredContent: {
                  error: {
                    code: "RateLimited",
                    retryAfterMs: 30_000,
                    retryable: true,
                  },
                  meta: { requests: 3 },
                  ok: false,
                },
              }
            : {
                structuredContent: {
                  meta: { complete: true, requests: 7 },
                  ok: true,
                },
              }
        );
      },
      settle: (promise) => promise,
      sleep: (ms) => {
        slept.push(ms);
        clock += ms;

        return Promise.resolve();
      },
    },
    {
      check: () => {
        checks += 1;
      },
      spend: (requests) => {
        spent.push(requests);
      },
    }
  );

  const outcome = await open.call("reply_samples");

  assert.deepEqual(
    [outcome.code, outcome.ms, outcome.requests, slept, spent, checks],
    [null, 40, 7, [31_000], [3, 7], 2]
  );
  assert.deepEqual(
    open.calls.map((call) => [call.code, call.ms, call.requests]),
    [
      ["RateLimited", 5, 3],
      [null, 40, 7],
    ]
  );
});
