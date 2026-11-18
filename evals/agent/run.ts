// npm run eval:agent: the persona tasks (layer 2). A model gets only the
// default MCP server (`outbound mcp --provider all`) through a CLI already on
// this machine (`claude -p`) and one persona prompt per task. The SDK calls no
// model; this script is a test client outside the package.
//
//   npm run eval:agent                       every task, scored on the newest live invariant truth
//   npm run eval:agent -- --tasks 1,4 --model sonnet --checkout <worktree>
//
// Each run writes ~/outbound-evals/<stamp>.agent.{json,md}. Exit 75 when
// another run holds the lock.

import { spawn } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseArgs } from "node:util";

import type { Truth } from "../case.ts";
import { at, isRecord, list, num, parsed, text } from "../json.ts";
import { LockedError, takeLock } from "../lock.ts";
import { assertCountsOnly, previousResult, stamp } from "../report.ts";
import { commitOf, RESULTS_DIR } from "../run.ts";
import type { LoggedCall } from "./proxy.ts";
import { answerBlock, forbiddenClaim, TASKS } from "./tasks.ts";
import type { Task } from "./tasks.ts";

const PROXY = path.join(import.meta.dirname, "proxy.ts");

/** Give a throttled call room: OUT-154's progress may not reach every client. */
const TOOL_TIMEOUT_MS = 600_000;

/** Truth from the live invariant runs of the last day, newest first per case. */
/**
 * The truth of the newest live layer-1 run from the last 24 hours at
 * `commit`, so a task is scored only against the code it ran on. A case
 * that run has no truth for leaves its tasks unscored.
 */
export const truthFor = (
  dir: string,
  now: number,
  commit: string | null
): Record<string, Truth> => {
  let names: string[] = [];

  try {
    names = readdirSync(dir)
      .filter((name) => name.endsWith(".invariants.json"))
      .toSorted()
      .toReversed();
  } catch {
    return {};
  }

  for (const name of names) {
    const run = parsed(readFileSync(path.join(dir, name), "utf-8"));
    const started = Date.parse(text(at(run, "startedAt")) ?? "");
    const truth = at(run, "truth");

    if (
      commit !== null &&
      at(run, "commit") === commit &&
      at(run, "mode") === "live" &&
      now - started < 86_400_000 &&
      isRecord(truth)
    ) {
      return truth as Record<string, Truth>;
    }
  }

  return {};
};

export interface TaskScore {
  readonly id: number;
  readonly persona: string;
  readonly correct: boolean | null;
  readonly answered: boolean;
  readonly forbidden: string | null;
  readonly toolCalls: number;
  readonly deadEnds: number;
  readonly requests: number;
  readonly seconds: number;
  readonly turns: number | null;
  readonly costUsd: number | null;
  /** Points for correct, no forbidden claim and no dead end. */
  readonly score: number;
  /** The points it could earn: 3, or 2 when correctness is unscored for want of truth. */
  readonly outOf: number;
  /** The answer block's counts and flags (and the reviewed campaign's ref), for reading a wrong answer back. */
  readonly answer: unknown;
}

/** Keeps an answer's numbers, flags and nulls, and only the \`campaign\` ref among its strings. */
export const keptAnswer = (value: unknown, key = ""): unknown => {
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([name, item]) => [
        name,
        keptAnswer(item, name),
      ])
    );
  }

  if (typeof value === "string") {
    return key === "campaign" ? value : "[text]";
  }

  return Array.isArray(value) ? value.length : (value ?? null);
};

const DEAD_END = new Set(["Unsupported", "Invalid", "rpc"]);

export const scoreTask = (
  task: Task,
  reply: string,
  calls: readonly LoggedCall[],
  truth: Readonly<Record<string, Truth>>,
  facts: {
    readonly seconds: number;
    readonly turns: number | null;
    readonly costUsd: number | null;
  }
): TaskScore => {
  const answer = answerBlock(reply);
  const correct = answer === undefined ? false : task.correct(answer, truth);

  const incomplete =
    task.incomplete(truth) || calls.some((call) => call.complete === false);

  const forbidden =
    answer === undefined ? null : forbiddenClaim(answer, incomplete);

  const deadEnds = calls.filter(
    (call) => !call.listed || (call.code !== null && DEAD_END.has(call.code))
  ).length;

  return {
    ...facts,
    answer: keptAnswer(answer),
    answered: answer !== undefined,
    correct,
    deadEnds,
    forbidden,
    id: task.id,
    outOf: correct === null ? 2 : 3,
    persona: task.persona,
    requests: calls.reduce<number>(
      (sum, call) => sum + (call.requests ?? 0),
      0
    ),
    score:
      (correct === true ? 1 : 0) +
      (forbidden === null ? 1 : 0) +
      (deadEnds === 0 ? 1 : 0),
    toolCalls: calls.length,
  };
};

const promptFor = (task: Task): string =>
  [
    `You are an ${task.persona} at an outbound agency. Use only the outbound tools you have; every one of them only reads.`,
    task.prompt,
    `End your reply with one fenced json block, exactly this shape and nothing else in it: ${task.answer}`,
  ].join("\n\n");

interface ModelRun {
  readonly reply: string;
  readonly turns: number | null;
  readonly costUsd: number | null;
  readonly model: string | null;
}

const runModel = (
  prompt: string,
  config: string,
  cwd: string,
  model: string,
  log: string
): Promise<ModelRun> =>
  new Promise((resolve) => {
    const proc = spawn(
      "claude",
      [
        "-p",
        prompt,
        "--mcp-config",
        config,
        "--strict-mcp-config",
        "--tools",
        "",
        "--allowedTools",
        "mcp__outbound",
        "--setting-sources",
        "project",
        "--output-format",
        "stream-json",
        "--verbose",
        "--model",
        model,
        "--no-session-persistence",
      ],
      {
        cwd,
        env: {
          ...process.env,
          EVAL_CALL_LOG: log,
          MCP_TIMEOUT: "120000",
          MCP_TOOL_TIMEOUT: String(TOOL_TIMEOUT_MS),
        },
        stdio: ["ignore", "pipe", "ignore"],
      }
    );

    let buffered = "";

    const found = {
      costUsd: null as number | null,
      model: null as string | null,
      reply: "",
      turns: null as number | null,
    };

    proc.stdout.on("data", (chunk: Buffer) => {
      buffered += chunk.toString("utf-8");
      const lines = buffered.split("\n");
      buffered = lines.pop() ?? "";

      for (const line of lines) {
        const event = parsed(line);

        if (at(event, "type") === "system" && at(event, "subtype") === "init") {
          found.model = text(at(event, "model"));
        }

        if (at(event, "type") === "result") {
          found.costUsd = num(at(event, "total_cost_usd"));
          found.reply = text(at(event, "result")) ?? "";
          found.turns = num(at(event, "num_turns"));
        }
      }
    });

    proc.on("close", () => {
      resolve(found);
    });
  });

const loggedCalls = (log: string): LoggedCall[] => {
  try {
    return readFileSync(log, "utf-8")
      .split("\n")
      .flatMap((line) => {
        const call = parsed(line);

        return isRecord(call) ? [call as unknown as LoggedCall] : [];
      });
  } catch {
    return [];
  }
};

const correctLabel = (task: TaskScore): string => {
  if (task.correct === null) {
    return "no truth";
  }

  if (task.correct) {
    return "yes";
  }

  return task.answered ? "no" : "no answer";
};

export const summarizeAgent = (
  result: {
    readonly tasks: readonly TaskScore[];
    readonly model: string | null;
    readonly commit: string | null;
  },
  previous: unknown
): string => {
  const prior = list(at(previous, "tasks"));

  const delta = (task: TaskScore, key: "toolCalls" | "deadEnds"): string => {
    const before = num(
      at(
        prior.find((row) => at(row, "id") === task.id),
        key
      )
    );

    return before === null
      ? ""
      : ` (${task[key] - before >= 0 ? "+" : ""}${task[key] - before})`;
  };

  const personas = [...new Set(result.tasks.map((task) => task.persona))].map(
    (persona) => {
      const mine = result.tasks.filter((task) => task.persona === persona);

      const points = mine.reduce((sum, task) => sum + task.score, 0);
      const possible = mine.reduce((sum, task) => sum + task.outOf, 0);

      return `${persona} ${((3 * points) / possible).toFixed(1)}/3`;
    }
  );

  return assertCountsOnly(
    [
      `### Eval agent tasks (${result.model ?? "model ?"}${result.commit === null ? "" : ` at ${result.commit}`})`,
      "",
      `Per persona: ${personas.join(", ")}. Dead-end calls ${result.tasks.reduce((sum, task) => sum + task.deadEnds, 0)}, tool calls ${result.tasks.reduce((sum, task) => sum + task.toolCalls, 0)}.`,
      "",
      "| Task | Persona | Correct | Forbidden claim | Tool calls | Dead ends | Requests | Seconds | Score |",
      "|---|---|---|---|---|---|---|---|---|",
      ...result.tasks.map(
        (task) =>
          `| ${task.id} | ${task.persona} | ${correctLabel(task)} | ${task.forbidden ?? ""} | ${task.toolCalls}${delta(task, "toolCalls")} | ${task.deadEnds}${delta(task, "deadEnds")} | ${task.requests} | ${Math.round(task.seconds)} | ${task.score}/${task.outOf} |`
      ),
    ].join("\n")
  );
};

const main = async (): Promise<number> => {
  const { values } = parseArgs({
    options: {
      checkout: { type: "string" },
      model: { type: "string" },
      out: { type: "string" },
      tasks: { type: "string" },
    },
  });

  const out = values.out ?? RESULTS_DIR;

  const checkout = path.resolve(
    values.checkout ?? path.join(import.meta.dirname, "../..")
  );

  const model = values.model ?? "sonnet";

  const only =
    values.tasks === undefined
      ? undefined
      : new Set(values.tasks.split(",").map(Number));

  let release: () => void;

  try {
    release = takeLock(RESULTS_DIR);
  } catch (error) {
    if (error instanceof LockedError) {
      process.stderr.write(`${error.message}; try again when it finishes\n`);

      return 75;
    }

    throw error;
  }

  const work = mkdtempSync(path.join(tmpdir(), "outbound-evals-"));

  try {
    const truth = truthFor(out, Date.now(), commitOf(checkout));
    const bin = path.join(checkout, "packages/outbound-sdk/src/cli/bin.ts");
    const config = path.join(work, "mcp.json");
    writeFileSync(
      config,
      JSON.stringify({
        mcpServers: {
          outbound: {
            args: [PROXY, process.execPath, bin, "mcp", "--provider", "all"],
            command: process.execPath,
          },
        },
      })
    );
    const scores: TaskScore[] = [];
    let seenModel: string | null = null;

    for (const task of TASKS.filter(
      (one) => only === undefined || only.has(one.id)
    )) {
      const log = path.join(work, `task-${task.id}.jsonl`);
      const started = Date.now();
      const ran = await runModel(promptFor(task), config, work, model, log);
      seenModel ??= ran.model;
      scores.push(
        scoreTask(task, ran.reply, loggedCalls(log), truth, {
          costUsd: ran.costUsd,
          seconds: (Date.now() - started) / 1000,
          turns: ran.turns,
        })
      );
    }

    const result = {
      commit: commitOf(checkout),
      layer: "agent",
      mode: "live",
      model: seenModel ?? model,
      startedAt: new Date().toISOString(),
      tasks: scores,
      truthCases: Object.keys(truth),
    };

    const name = `${stamp(Date.now())}.agent`;

    const summary = summarizeAgent(
      result,
      previousResult(out, "agent", "live", `${name}.json`)
    );

    mkdirSync(out, { recursive: true });
    writeFileSync(
      path.join(out, `${name}.json`),
      `${JSON.stringify(result, null, 2)}\n`
    );
    writeFileSync(path.join(out, `${name}.md`), `${summary}\n`);
    process.stdout.write(`${summary}\n`);

    return 0;
  } finally {
    rmSync(work, { force: true, recursive: true });
    release();
  }
};

if (import.meta.main) {
  process.exitCode = await main();
}
