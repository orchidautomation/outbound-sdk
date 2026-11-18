// The seven persona tasks (layer 2), each with its ground truth from a
// layer-1 run and how its answer is scored.

import type { Truth } from "../case.ts";
import { at, bool, num, text } from "../json.ts";

export interface Task {
  readonly id: number;
  readonly persona: "agency ops lead" | "SDR manager" | "data engineer";
  readonly prompt: string;
  /** The JSON block the answer must end with, as shown to the model. */
  readonly answer: string;
  /** The invariant cases whose truth it is scored on. */
  readonly cases: readonly number[];
  /** true or false when the truth decides; null when the layer-1 run has none. */
  readonly correct: (
    answer: unknown,
    truth: Readonly<Record<string, Truth>>
  ) => boolean | null;
  /** Whether the truth behind it was incomplete, so a definite count would be a forbidden claim. */
  readonly incomplete: (truth: Readonly<Record<string, Truth>>) => boolean;
}

const fact = (
  truth: Readonly<Record<string, Truth>>,
  id: number,
  key: string
): number | boolean | string | null => truth[String(id)]?.[key] ?? null;

const same = (
  answer: unknown,
  path: readonly string[],
  expected: number | boolean | string | null
): boolean | null => {
  if (expected === null) {
    return null;
  }

  return at(answer, ...path) === expected;
};

const all = (...checks: readonly (boolean | null)[]): boolean | null =>
  checks.includes(null) ? null : checks.every((check) => check === true);

export const TASKS: readonly Task[] = [
  {
    answer:
      '{"owed": <number of conversations that need a reply from us>, "opened": <number you read>, "complete": <true if every reply was checked>}',
    cases: [1, 4, 5],
    correct: (answer, truth) => same(answer, ["owed"], fact(truth, 1, "owed")),
    id: 1,
    incomplete: (truth) => fact(truth, 1, "complete") === false,
    persona: "agency ops lead",
    prompt:
      "Which replies are owed today? Open each conversation before you answer.",
  },
  {
    answer:
      '{"outOfLeads": <campaigns with no lead left to start>, "stalled": <campaigns that started no lead>, "complete": <true if the numbers cover everything>}',
    cases: [9, 13],
    correct: (answer, truth) =>
      all(
        same(answer, ["outOfLeads"], fact(truth, 9, "outOfLeadsNow")),
        same(answer, ["stalled"], fact(truth, 9, "stalled"))
      ),
    id: 2,
    incomplete: () => false,
    persona: "agency ops lead",
    prompt:
      "Prep me for a client call this afternoon: across every tool, which campaigns are out of leads, which have stalled, and is anything left out of the numbers?",
  },
  {
    answer:
      '{"violations": <people on the block list still in a live campaign>, "complete": <true if every campaign and block entry was checked>}',
    cases: [11],
    correct: (answer, truth) => {
      const found = fact(truth, 11, "foundRaised");

      if (typeof found !== "number") {
        return null;
      }

      return fact(truth, 11, "completeRaised") === true
        ? at(answer, "violations") === found
        : (num(at(answer, "violations")) ?? -1) >=
            (num(fact(truth, 11, "foundDefault")) ?? 0) &&
            bool(at(answer, "complete")) === false;
    },
    id: 3,
    incomplete: (truth) => fact(truth, 11, "completeRaised") !== true,
    persona: "SDR manager",
    prompt: "Is anyone on the block list still in a live campaign?",
  },
  {
    answer:
      '{"campaigns": <campaigns that run out of leads to start within 7 days, including any already out>}',
    cases: [9, 10],
    correct: (answer, truth) =>
      same(answer, ["campaigns"], fact(truth, 9, "runningOutThisWeek")),
    id: 4,
    incomplete: () => false,
    persona: "SDR manager",
    prompt: "Which campaigns run out of leads this week?",
  },
  {
    answer:
      '{"replies": {"thisWeek": <n>, "lastWeek": <n>}, "meetings": {"thisWeek": <n or null if not recorded>, "lastWeek": <n or null>}}',
    cases: [14, 29],
    correct: (answer, truth) =>
      all(
        same(
          answer,
          ["replies", "thisWeek"],
          fact(truth, 14, "repliedCurrent")
        ),
        same(
          answer,
          ["replies", "lastWeek"],
          fact(truth, 14, "repliedPrevious")
        ),
        at(answer, "meetings", "thisWeek") ===
          fact(truth, 14, "meetingsCurrent"),
        at(answer, "meetings", "lastWeek") ===
          fact(truth, 14, "meetingsPrevious")
      ),
    id: 5,
    incomplete: () => false,
    persona: "SDR manager",
    prompt:
      "Replies and meetings booked this week versus last week, across both tools (email and LinkedIn).",
  },
  {
    answer:
      '{"campaign": "<the campaign ref you reviewed>", "issues": <number of copy problems you found>}',
    cases: [16, 17, 30],
    correct: (answer, truth) => {
      const biggest = fact(truth, 30, "biggestCampaign");

      return typeof biggest === "string"
        ? text(at(answer, "campaign")) === biggest
        : null;
    },
    id: 6,
    incomplete: () => false,
    persona: "SDR manager",
    prompt:
      "Review the copy on our biggest campaign (the one that has sent the most) and tell me what to fix.",
  },
  {
    answer:
      '{"people": <distinct people who replied, or null if they cannot be deduplicated>, "canLink": <true if email and LinkedIn people could be matched>}',
    cases: [22],
    correct: (answer, truth) => {
      const canLink = fact(truth, 22, "canLink");

      if (canLink === null) {
        return null;
      }

      return canLink === false
        ? at(answer, "canLink") === false
        : same(answer, ["people"], fact(truth, 22, "peopleReplied"));
    },
    id: 7,
    incomplete: () => false,
    persona: "data engineer",
    prompt:
      "Who replied across email and LinkedIn in the last 30 days, deduplicated by person? I need the count.",
  },
];

/** The last fenced JSON block in a reply, parsed. */
export const answerBlock = (reply: string): unknown => {
  const blocks = [...reply.matchAll(/```(?:json)?\s*\n(?<body>[\s\S]*?)```/gu)];
  const last = blocks.at(-1)?.groups?.body;

  if (last === undefined) {
    return undefined;
  }

  try {
    return JSON.parse(last);
  } catch {
    return undefined;
  }
};

const COUNT_KEYS = [
  "owed",
  "violations",
  "campaigns",
  "people",
  "outOfLeads",
  "stalled",
];

/**
 * A forbidden claim: a definite answer (complete: true, or a count of 0)
 * where the source was incomplete. Decided by rule, not by a model.
 */
export const forbiddenClaim = (
  answer: unknown,
  sourceIncomplete: boolean
): string | null => {
  if (!sourceIncomplete) {
    return null;
  }

  if (at(answer, "complete") === true) {
    return "said complete while the source was incomplete";
  }

  return COUNT_KEYS.some((key) => at(answer, key) === 0)
    ? "gave 0 for something that was not fully checked"
    : null;
};
