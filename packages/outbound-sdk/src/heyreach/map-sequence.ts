// HeyReach's sequence tree -> ordered steps. Pure functions, no I/O.
//
// GetCampaignSequence returns one node. Each node has `unconditionalNode` (the
// next node, or the "no" branch) and `conditionalNode` (the "yes" branch: a
// connection request accepted, a check that passed, a reply to a message).
// `END` closes a path and the `START` node is never returned.
//
// The flattening rule: starting at the root, a node becomes a step, then the
// walk follows the one branch that does not go straight to `END`. That order
// is unambiguous as long as at most one branch of every node holds further
// steps. When both do, there is no single order, and the sequence is refused
// with a clear error. A step after a branching node runs only for the leads
// who took that branch (for example, those who accepted the connection).

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

const walk = (identity: Identity, root: Json): JsonObject[] => {
  const nodes: JsonObject[] = [];
  let node: Json | undefined = root;

  while (isStep(node)) {
    nodes.push(node);
    const { conditionalNode, unconditionalNode }: JsonObject = node;

    if (isStep(conditionalNode) && isStep(unconditionalNode)) {
      throw new OutboundError(
        "Unsupported",
        `This HeyReach sequence branches after step ${nodes.length} into two paths that both hold steps, so it has no single step order. Read the node tree with raw.get("/campaign/GetCampaignSequence")`,
        { provider: identity.provider }
      );
    }

    node = isStep(conditionalNode) ? conditionalNode : unconditionalNode;
  }

  return nodes;
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
