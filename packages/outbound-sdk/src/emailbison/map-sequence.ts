// A campaign's sequence steps -> Sequence, and the place of each step id, for
// the step statistics. Pure functions, no I/O.
//
// `GET /api/campaigns/v1.1/{id}/sequence-steps` lists every step and every
// variant as one flat list. A variant has `variant: true` and names the step
// it varies in `variant_from_step_id`; the documented variant has `null`
// there, so a variant without one joins the step with the same `order`.

import type { Sequence, SequenceStep } from "../internal/entities.ts";
import { count, field, objects, text } from "../internal/json.ts";
import type { Json, JsonObject } from "../internal/json.ts";
import { recordBase, refTo } from "../internal/record.ts";
import type { Identity } from "../internal/record.ts";
import { toVariant, variantKey } from "../internal/sequence.ts";

interface Grouped {
  readonly head: JsonObject;
  readonly variants: JsonObject[];
}

const orderOf = (step: JsonObject): number =>
  count(step.order) ?? Number.MAX_SAFE_INTEGER;

/** The steps in order, each with its variants: the step itself first. */
const groupSteps = (rows: readonly JsonObject[]): Grouped[] => {
  const heads = rows
    .filter((row) => row.variant !== true)
    .toSorted((left, right) => orderOf(left) - orderOf(right));

  const groups = heads.map((head) => ({ head, variants: [head] }));

  for (const row of rows.filter((candidate) => candidate.variant === true)) {
    const parent = text(row.variant_from_step_id);

    const group =
      groups.find((candidate) =>
        parent === null
          ? orderOf(candidate.head) === orderOf(row)
          : text(candidate.head.id) === parent
      ) ?? undefined;

    if (group === undefined) {
      // A variant of no step is a step of its own, at its order.
      groups.push({ head: row, variants: [row] });
    } else {
      group.variants.push(row);
    }
  }

  return groups.toSorted(
    (left, right) => orderOf(left.head) - orderOf(right.head)
  );
};

/** The step list of a sequence answer: `data.sequence_steps`. */
export const stepRows = (body: Json | undefined): JsonObject[] =>
  objects(field(field(body, "data"), "sequence_steps"));

export const toSequence = (
  identity: Identity,
  campaignId: string,
  body: Json
): Sequence => {
  const steps: SequenceStep[] = groupSteps(stepRows(body)).map(
    (group, index) => ({
      action: "email",
      branch: null,
      delayDays: count(group.head.wait_in_days),
      index,
      parentIndex: index === 0 ? null : index - 1,
      variants: group.variants.map((variant, position) =>
        toVariant(
          text(variant.email_subject),
          text(variant.email_body),
          variantKey(position)
        )
      ),
    })
  );

  return {
    ...recordBase(identity, campaignId, body),
    campaignRef: refTo(identity, campaignId) ?? "",
    kind: "main",
    name: null,
    steps,
  };
};

export interface StepPlace {
  readonly stepIndex: number;
  readonly variantKey: string;
}

/** Where each step id sits in the sequence: its step and its variant. */
export const stepPlaces = (body: Json | undefined): Map<string, StepPlace> =>
  new Map(
    groupSteps(stepRows(body)).flatMap((group, stepIndex) =>
      group.variants.flatMap((variant, position) => {
        const id = text(variant.id);

        return id === null
          ? []
          : [[id, { stepIndex, variantKey: variantKey(position) }] as const];
      })
    )
  );
