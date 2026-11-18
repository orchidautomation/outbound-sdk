// The run's files: counts only, a diff against the last run, one run at a time.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { callFacts } from "../agent/proxy.ts";
import { keptAnswer, scoreTask, summarizeAgent } from "../agent/run.ts";
import { answerBlock, forbiddenClaim, TASKS } from "../agent/tasks.ts";
import { LockedError, takeLock } from "../lock.ts";
import {
  assertCountsOnly,
  PersonalDataError,
  previousResult,
  statusChanges,
} from "../report.ts";

test("a counts-only summary passes, and one naming a person is refused", () => {
  assert.equal(
    assertCountsOnly("| 1 | dropped_replies | pass | 3 |"),
    "| 1 | dropped_replies | pass | 3 |"
  );

  for (const leak of [
    "owner a.person@example.com",
    "linkedin.com/in/someone",
    "see https://app.instantly.ai/x",
    "lead redacted:9e4e420e",
    "lead 01a1d77f-5156-7723-b616",
  ]) {
    assert.throws(() => assertCountsOnly(leak), PersonalDataError, leak);
  }
});

test("status changes name each case that moved, and nothing else", () => {
  assert.deepEqual(
    statusChanges(
      [
        { id: "1", status: "fail" },
        { id: "2", status: "pass" },
      ],
      [
        { id: "1", status: "pass" },
        { id: "2", status: "pass" },
        { id: "3", status: "skip" },
      ]
    ),
    ["1: fail → pass"]
  );
});

test("the previous result is the newest of the same layer and mode", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "evals-"));

  try {
    writeFileSync(
      path.join(dir, "2026-11-01T0300.invariants.json"),
      JSON.stringify({ mode: "live", n: 1 })
    );
    writeFileSync(
      path.join(dir, "2026-11-02T0300.invariants.json"),
      JSON.stringify({ mode: "offline", n: 2 })
    );
    writeFileSync(
      path.join(dir, "2026-11-03T0300.invariants.json"),
      JSON.stringify({ mode: "live", n: 3 })
    );
    assert.deepEqual(
      previousResult(
        dir,
        "invariants",
        "live",
        "2026-11-03T0300.invariants.json"
      ),
      { mode: "live", n: 1 }
    );
    assert.equal(
      previousResult(path.join(dir, "missing"), "invariants", "live", ""),
      undefined
    );
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("a second run is refused while the first holds the lock, and a dead holder's lock is taken over", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "evals-"));

  try {
    const release = takeLock(dir);
    assert.throws(() => takeLock(dir), LockedError);
    release();
    writeFileSync(path.join(dir, ".lock"), "999999999");
    takeLock(dir)();
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("the answer is the last fenced JSON block, and prose without one has none", () => {
  assert.deepEqual(
    answerBlock(
      'Here.\n```json\n{"owed": 1}\n```\nThen\n```json\n{"owed": 4}\n```'
    ),
    { owed: 4 }
  );
  assert.equal(answerBlock("No block here."), undefined);
});

test("a definite answer over an incomplete source is a forbidden claim; a hedged one is not", () => {
  assert.equal(forbiddenClaim({ complete: false, owed: 0 }, false), null);
  assert.match(
    forbiddenClaim({ complete: true, owed: 3 }, true) ?? "",
    /complete/u
  );
  assert.match(
    forbiddenClaim({ complete: false, violations: 0 }, true) ?? "",
    /0/u
  );
  assert.equal(forbiddenClaim({ complete: false, violations: 2 }, true), null);
});

test("a task scores correctness, forbidden claims and dead-end calls from the call log", () => {
  const [task] = TASKS;
  assert.ok(task);
  const truth = { "1": { complete: true, owed: 2 } };
  const facts = { costUsd: 0.1, seconds: 30, turns: 4 };

  const calls = [
    {
      code: null,
      complete: true,
      listed: true,
      ms: 10,
      name: "dropped_replies",
      requests: 5,
    },
    {
      code: "Unsupported",
      complete: null,
      listed: true,
      ms: 10,
      name: "thread_context",
      requests: 0,
    },
  ];

  const good = scoreTask(
    task,
    'Done.\n```json\n{"owed": 2, "opened": 2, "complete": true}\n```',
    calls.slice(0, 1),
    truth,
    facts
  );

  assert.deepEqual(
    [good.correct, good.forbidden, good.deadEnds, good.score, good.requests],
    [true, null, 0, 3, 5]
  );

  const bad = scoreTask(
    task,
    'Done.\n```json\n{"owed": 0, "opened": 0, "complete": true}\n```',
    [
      ...calls,
      {
        code: null,
        complete: false,
        listed: false,
        ms: 10,
        name: "step_funnel",
        requests: 0,
      },
    ],
    truth,
    facts
  );

  assert.deepEqual(
    [bad.correct, bad.deadEnds, bad.toolCalls, bad.score],
    [false, 2, 3, 0]
  );
  assert.notEqual(bad.forbidden, null);

  const summary = summarizeAgent(
    { commit: "abc1234", model: "m", tasks: [good, bad] },
    { tasks: [{ deadEnds: 0, id: 1, toolCalls: 1 }] }
  );

  assert.match(summary, /\| 1 \| agency ops lead \| yes \|/u);
  assert.match(summary, /Dead-end calls 2, tool calls 4/u);
});

test("a kept answer holds counts and the campaign ref, never other text", () => {
  assert.deepEqual(
    keptAnswer({
      campaign: "instantly:w:1",
      complete: false,
      note: "Jane at a@b.co",
      owed: 2,
      people: [1, 2],
    }),
    {
      campaign: "instantly:w:1",
      complete: false,
      note: "[text]",
      owed: 2,
      people: 2,
    }
  );
});

test("the proxy logs a tool's code, cost and completeness, never its content", () => {
  assert.deepEqual(
    callFacts({
      result: {
        content: [{ text: "secret" }],
        structuredContent: { meta: { complete: false, requests: 7 } },
      },
    }),
    { code: null, complete: false, requests: 7 }
  );
  assert.deepEqual(
    callFacts({
      result: {
        isError: true,
        structuredContent: { error: { code: "Unsupported" } },
      },
    }),
    { code: "Unsupported", complete: null, requests: null }
  );
  assert.deepEqual(callFacts({ error: { message: "Unknown tool" } }), {
    code: "rpc",
    complete: null,
    requests: null,
  });
});
