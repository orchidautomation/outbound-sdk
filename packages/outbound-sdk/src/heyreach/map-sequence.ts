// HeyReach's sequence tree -> ordered steps. Pure functions, no I/O.
//
// GetCampaignSequence returns one node. Each node has `unconditionalNode` (the
// next node, or the "no" branch) and `conditionalNode` (the "yes" branch: a
// connection request accepted, a check that passed, a reply to a message).
// `END` closes a path and the `START` node is never returned.
//
// The flattening rule: a node that acts on the lead becomes a step; a `CHECK_*`
// node is a condition, not a step. When only one branch of a node holds
// further steps, the walk follows it. When both do, they are compared: a real
// HeyReach campaign starts with CHECK_IS_CONNECTION, whose "already connected"
// branch is the same messages as the tail of the "send a connection request"
// branch. If one branch is the tail of the other, the longer one is the
// sequence. If they hold different steps there is no single order, and the
// sequence is refused with a clear error. A step after a branching node runs
// only for the leads who took that branch.
//
// The CHECK_IS_CONNECTION layout was read from live campaigns on 2026-11-14.

import type { Sequence, SequenceStep } from "../internal/entities.ts";
import { OutboundError } from "../internal/errors.ts";
import { count, isJsonObject, list, objects, text } from "../internal/json.ts";
import type { Json, JsonObject } from "../internal/json.ts";
import { recordBase, refTo } from "../internal/record.ts";
import type { Identity } from "../internal/record.ts";
import { stableId } from "../internal/sha256.ts";

const isStep = (node: Json | undefined): node is JsonObject =>
  isJsonObject(node) && text(node.nodeType) !== "END";

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

const toStep = (node: JsonObject, index: number): SequenceStep => ({
  action: (text(node.nodeType) ?? "unknown").toLowerCase(),
  delayDays: delayDays(node),
  index,
  variants: variantBodies(node.payload).map((body, variantIndex) => ({
    body,
    contentHash: stableId(null, body),
    subject: null,
    // Variants are positional: 0 is "A".
    variantKey: String.fromCodePoint(65 + variantIndex),
  })),
});

const isCondition = (node: JsonObject): boolean =>
  (text(node.nodeType) ?? "").startsWith("CHECK_");

// Two nodes are the same step when they do the same thing with the same text.
const signature = (node: JsonObject): string =>
  stableId(text(node.nodeType), ...variantBodies(node.payload));

const endsWith = (
  longer: readonly JsonObject[],
  shorter: readonly JsonObject[]
): boolean => {
  const tail = longer.slice(longer.length - shorter.length);

  return shorter.every(
    (node, index) => signature(node) === signature(tail[index] ?? {})
  );
};

const walk = (identity: Identity, node: Json | undefined): JsonObject[] => {
  if (!isStep(node)) {
    return [];
  }

  const own = isCondition(node) ? [] : [node];
  const yes = walk(identity, node.conditionalNode);
  const no = walk(identity, node.unconditionalNode);
  const [longer, shorter] = yes.length >= no.length ? [yes, no] : [no, yes];

  if (!endsWith(longer, shorter)) {
    throw new OutboundError(
      "Unsupported",
      `This HeyReach sequence branches at a ${text(node.nodeType) ?? "node"} into two paths that hold different steps, so it has no single step order. Read the node tree with raw.get("/campaign/GetCampaignSequence")`,
      { provider: identity.provider }
    );
  }

  return [...own, ...longer];
};

/** An empty response (`null`) is a campaign with no sequence. */
export const toSequence = (
  identity: Identity,
  campaignId: string,
  raw: Json
): Sequence => ({
  ...recordBase(identity, campaignId, raw),
  campaignRef: refTo(identity, campaignId) ?? "",
  steps: walk(identity, raw).map(toStep),
});
