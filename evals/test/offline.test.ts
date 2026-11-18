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
