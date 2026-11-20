// The run's files: counts only, a diff against the last run, one run at a time.

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { callFacts } from "../agent/proxy.ts";
import {
  keptAnswer,
  scoreTask,
  summarizeAgent,
  truthFile,
  truthFor,
} from "../agent/run.ts";
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

test("a listed answer counts as its length where a count was asked for", () => {
  const task = TASKS.find((one) => one.id === 4);
  assert.ok(task);
  assert.equal(
    task.correct(
      { campaigns: ["a", "b"] },
      { "9": { complete: true, runningOutThisWeek: 2 } }
    ),
    true
  );
  assert.equal(
    task.correct(
      { campaigns: 3 },
      { "9": { complete: true, runningOutThisWeek: 2 } }
    ),
    false
  );
});

test("replies owed over an incomplete check: unknown or at least what was found is right, a false 0 is not", () => {
  const task = TASKS.find((one) => one.id === 1);
  assert.ok(task);
  const unchecked = { "1": { complete: false, owed: 1 } };
  assert.equal(task.correct({ complete: false, owed: null }, unchecked), true);
  assert.equal(task.correct({ complete: false, owed: 2 }, unchecked), true);
  assert.equal(task.correct({ complete: false, owed: 0 }, unchecked), false);
  assert.equal(task.correct({ complete: true, owed: 1 }, unchecked), false);
  const none = { "1": { complete: false, owed: 0 } };
  assert.equal(task.correct({ complete: false, owed: null }, none), true);
  assert.equal(
    forbiddenClaim({ complete: false, owed: 0 }, task.incomplete(none)),
    "gave 0 for something that was not fully checked"
  );
  assert.equal(
    task.correct({ owed: 3 }, { "1": { complete: true, owed: 3 } }),
    true
  );
});

test("a count over a population that was not fully checked is not scored, and unknown runway is not none", () => {
  const task = TASKS.find((one) => one.id === 4);
  assert.ok(task);
  const unchecked = { "9": { complete: false, runningOutThisWeek: 0 } };
  assert.equal(task.correct({ campaigns: 0 }, unchecked), null);
  assert.equal(task.incomplete(unchecked), true);
  assert.equal(
    task.correct(
      { campaigns: 0 },
      { "9": { complete: true, runningOutThisWeek: null } }
    ),
    null
  );
});

test("task 5 is scored on the workspace totals, and left unscored without them", () => {
  const task = TASKS.find((one) => one.id === 5);
  assert.ok(task);

  const answer = {
    meetings: { lastWeek: null, thisWeek: null },
    replies: { lastWeek: 24, thisWeek: 20 },
  };

  const truth = {
    workspaceKnown: true,
    workspaceMeetingsCurrent: null,
    workspaceMeetingsPrevious: null,
    workspaceRepliedCurrent: 20,
    workspaceRepliedPrevious: 24,
  };

  assert.equal(task.correct(answer, { "14": truth }), true);
  assert.equal(
    task.correct(answer, { "14": { ...truth, workspaceRepliedPrevious: 21 } }),
    false
  );
  assert.equal(task.correct(answer, { "14": { workspaceKnown: false } }), null);
});

test("task 7 scores the canLink claim only when a link was observed or ruled out", () => {
  const task = TASKS.find((one) => one.id === 7);
  assert.ok(task);
  assert.equal(
    task.correct({ canLink: true, people: 9 }, { "22": { canLink: true } }),
    true
  );
  assert.equal(
    task.correct({ canLink: true, people: 9 }, { "22": { canLink: false } }),
    false
  );
  assert.equal(
    task.correct({ canLink: true, people: 9 }, { "22": { canLink: null } }),
    null
  );
});

test("truth comes from the newest live run at the evaluated commit, never filled from another", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "evals-truth-"));
  const now = Date.parse("2026-11-18T20:00:00Z");

  const write = (
    name: string,
    commit: string,
    truth: Readonly<Record<string, Readonly<Record<string, number>>>>
  ) => {
    writeFileSync(
      path.join(dir, `${name}.invariants.json`),
      JSON.stringify({
        commit,
        mode: "live",
        startedAt: "2026-11-18T19:00:00Z",
        truth,
      })
    );
  };

  try {
    write("2026-11-18T1900", "aaa", { "1": { owed: 1 }, "9": { stalled: 2 } });
    write("2026-11-18T1910", "bbb", { "1": { owed: 3 } });
    assert.deepEqual(truthFor(dir, now, "bbb"), { "1": { owed: 3 } });
    assert.deepEqual(truthFor(dir, now, "aaa"), {
      "1": { owed: 1 },
      "9": { stalled: 2 },
    });
    assert.deepEqual(truthFor(dir, now, "ccc"), {});
    assert.deepEqual(truthFor(dir, now, null), {});
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
});

test("--truth scores against one named live run at any commit, and refuses one that cannot be truth", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "evals-truth-file-"));
  const now = Date.parse("2026-11-18T20:00:00Z");

  const write = (name: string, run: Readonly<Record<string, unknown>>) => {
    const file = path.join(dir, `${name}.invariants.json`);
    writeFileSync(
      file,
      JSON.stringify({
        commit: "aaa",
        layer: "invariants",
        mode: "live",
        startedAt: "2026-11-18T19:00:00Z",
        truth: { "9": { outOfLeads: 19 } },
        ...run,
      })
    );

    return file;
  };

  try {
    assert.deepEqual(truthFile(write("main", {}), now), {
      commit: "aaa",
      truth: { "9": { outOfLeads: 19 } },
    });

    const refused: readonly [
      string,
      Readonly<Record<string, unknown>>,
      RegExp,
    ][] = [
      ["offline", { mode: "offline" }, /not a live layer-1 run/u],
      ["agent", { layer: "agent" }, /not a live layer-1 run/u],
      ["stale", { startedAt: "2026-11-17T19:00:00Z" }, /older than 24 hours/u],
      ["empty", { truth: {} }, /recorded no truth/u],
    ];

    for (const [name, run, reason] of refused) {
      assert.throws(() => truthFile(write(name, run), now), reason);
    }

    assert.throws(
      () => truthFile(path.join(dir, "missing.invariants.json"), now),
      /cannot be read/u
    );
  } finally {
    rmSync(dir, { force: true, recursive: true });
  }
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
  assert.match(
    forbiddenClaim({ complete: false, opened: 0, owed: [] }, true) ?? "",
    /0/u
  );
  assert.equal(forbiddenClaim({ complete: false, owed: ["a"] }, true), null);
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
  assert.deepEqual([good.outOf, bad.outOf], [3, 3]);

  const unscored = scoreTask(
    task,
    'Done.\n```json\n{"owed": 2, "opened": 2, "complete": false}\n```',
    calls.slice(0, 1),
    {},
    facts
  );

  assert.deepEqual(
    [unscored.correct, unscored.score, unscored.outOf],
    [null, 2, 2]
  );
  assert.match(
    summarizeAgent(
      { commit: "abc1234", model: "m", tasks: [unscored] },
      undefined
    ),
    /agency ops lead 3\.0\/3/u
  );

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
