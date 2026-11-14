// HeyReach's sequence tree -> steps. Pure functions, no I/O.
//
// GetCampaignSequence returns one node. Each node has `conditionalNode` (the
// "yes" branch: a connection request accepted, a check that passed, a reply
// to a message) and `unconditionalNode` (the next node, or the "no" branch).
// `END` closes a path and the `START` node is never returned.
//
// The whole tree is kept. A node that acts on the lead becomes a step; a
// `CHECK_*` node is a condition, not a step. Steps are numbered in the order
// the tree is walked: a node, then everything under its "yes" branch, then
// everything under its "no" branch. `parentIndex` is the step that ran before
// and `branch` is the outcome that leads to the step, so a campaign that
// starts with CHECK_IS_CONNECTION has two first steps, one per outcome.
//
// The layouts were read from live campaigns on 2026-11-14.

import type { Sequence, SequenceStep } from "../internal/entities.ts";
import { count, isJsonObject, list, objects, text } from "../internal/json.ts";
import type { Json, JsonObject } from "../internal/json.ts";
import { recordBase, refTo } from "../internal/record.ts";
import type { Identity } from "../internal/record.ts";
import { toVariant, variantKey } from "../internal/sequence.ts";

const DELAY_DAYS = new Map([
  ["DAY", 1],
  ["HOUR", 1 / 24],
]);

// `actionDelay` is the wait before the node runs.
const delayDays = (node: JsonObject): number | null => {
  const delay = count(node.actionDelay);
  const perUnit = DELAY_DAYS.get(text(node.actionDelayUnit) ?? "");

  return delay === null || perUnit === undefined ? null : delay * perUnit;
};

// `messages` holds the variants as strings; the V2 endpoint returns
// `messageVersions` objects with a `message` each.
const variantBodies = (payload: Json | undefined): (string | null)[] => {
  if (!isJsonObject(payload)) {
    return [];
  }

  const versions = objects(payload.messageVersions);

  return versions.length > 0
    ? versions.map((version) => text(version.message))
    : list(payload.messages).map((message) => text(message));
};

const typeOf = (node: JsonObject): string => text(node.nodeType) ?? "unknown";

const isCondition = (node: JsonObject): boolean =>
  typeOf(node).startsWith("CHECK_");

// What each outcome of a node is called: [conditionalNode, unconditionalNode].
// The docs name the conditions; a node they do not describe keeps HeyReach's
// own two words.
const OUTCOMES = new Map<string, readonly [string, string]>([
  ["CHECK_IS_CONNECTION", ["connected", "not_connected"]],
  ["CHECK_IS_OPEN_PROFILE", ["open_profile", "not_open_profile"]],
  ["CONNECTION_REQUEST", ["accepted", "not_accepted"]],
  ["FIND_EMAIL", ["email_found", "email_not_found"]],
  ["INMAIL", ["replied", "not_replied"]],
  ["MESSAGE", ["replied", "not_replied"]],
]);

const UNNAMED: readonly [string, string] = ["conditional", "unconditional"];

// The docs list these as the nodes that split the path. A MESSAGE or INMAIL
// also has a "yes" branch (the lead replied), but it only ever ends the
// sequence, so the node after a message is on the straight path.
const SPLITS = new Set(["CONNECTION_REQUEST", "FIND_EMAIL"]);

const hasSteps = (node: Json | undefined): boolean =>
  isJsonObject(node) &&
  typeOf(node) !== "END" &&
  (!isCondition(node) ||
    hasSteps(node.conditionalNode) ||
    hasSteps(node.unconditionalNode));

/** Where a node sits: the step before it, and how the lead got here. */
interface Position {
  readonly parentIndex: number | null;
  /** Outcomes since the parent step, outermost first. */
  readonly outcomes: readonly string[];
  /** Days waited at the conditions between the parent step and this node. */
  readonly waited: number;
}

const toStep = (
  node: JsonObject,
  index: number,
  position: Position
): SequenceStep => {
  const own = delayDays(node);

  return {
    action: typeOf(node).toLowerCase(),
    branch: position.outcomes.length === 0 ? null : position.outcomes.join("+"),
    delayDays: own === null ? null : own + position.waited,
    index,
    parentIndex: position.parentIndex,
    // Variants are positional and have no subject.
    variants: variantBodies(node.payload).map((body, variantIndex) =>
      toVariant(null, body, variantKey(variantIndex))
    ),
  };
};

const walk = (
  node: Json | undefined,
  position: Position,
  steps: SequenceStep[]
): void => {
  if (!isJsonObject(node) || typeOf(node) === "END") {
    return;
  }

  const [yes, no] = OUTCOMES.get(typeOf(node)) ?? UNNAMED;

  if (isCondition(node)) {
    const waited = position.waited + (delayDays(node) ?? 0);

    const under = (outcome: string): Position => ({
      outcomes: [...position.outcomes, outcome],
      parentIndex: position.parentIndex,
      waited,
    });

    walk(node.conditionalNode, under(yes), steps);
    walk(node.unconditionalNode, under(no), steps);

    return;
  }

  const index = steps.length;
  steps.push(toStep(node, index, position));

  const splits = SPLITS.has(typeOf(node)) || hasSteps(node.conditionalNode);
  const after = { parentIndex: index, waited: 0 };

  walk(node.conditionalNode, { ...after, outcomes: [yes] }, steps);
  walk(
    node.unconditionalNode,
    { ...after, outcomes: splits ? [no] : [] },
    steps
  );
};

/** An empty response (`null`) is a campaign with no sequence. */
export const toSequence = (
  identity: Identity,
  campaignId: string,
  raw: Json
): Sequence => {
  const steps: SequenceStep[] = [];
  walk(raw, { outcomes: [], parentIndex: null, waited: 0 }, steps);

  return {
    ...recordBase(identity, campaignId, raw),
    campaignRef: refTo(identity, campaignId) ?? "",
    kind: "main",
    name: null,
    steps,
  };
};
