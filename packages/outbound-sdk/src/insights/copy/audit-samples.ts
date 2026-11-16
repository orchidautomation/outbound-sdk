// copy_audit on copy written per lead. A variant whose subject or body is
// mostly variables, such as `{{body_1}}` filled from a custom field, says
// nothing as stored, so it is audited as sample leads receive it.

import type {
  Lead,
  SequenceStep,
  SequenceVariant,
} from "../../internal/entities.ts";
import { htmlToText, looksLikeHtml } from "../../internal/text.ts";
import { keyOf, variablesIn } from "../variables.ts";
import { auditVariant, threadOf } from "./audit-variant.ts";
import type { CopyFinding } from "./audit-variant.ts";
import type { Limits } from "./copy-checks.ts";
import { rankLeads, renderVariant } from "./copy-preview.ts";

/** Above this share of a text's characters in variables, the copy is written per lead. */
const PER_LEAD_SHARE = 0.8;

/** The share of a text's characters, tags and whitespace left out, that are variables. */
const variableShare = (text: string | null): number => {
  if (text === null) {
    return 0;
  }

  const plain = (looksLikeHtml(text) ? htmlToText(text) : text).replaceAll(
    /\s/gu,
    ""
  );

  if (plain === "") {
    return 0;
  }

  const inVariables = variablesIn(plain).reduce(
    (sum, match) => sum + match.raw.length,
    0
  );

  return inVariables / plain.length;
};

type Copy = Pick<SequenceVariant, "body" | "subject">;

/** Whether the variant's subject or body is mostly variables. */
export const writtenPerLead = (variant: Copy): boolean =>
  variableShare(variant.subject) > PER_LEAD_SHARE ||
  variableShare(variant.body) > PER_LEAD_SHARE;

/** The variable keys in the variants written per lead. */
export const perLeadKeys = (steps: readonly SequenceStep[]): Set<string> =>
  new Set(
    steps.flatMap((step) =>
      step.variants
        .filter(writtenPerLead)
        .flatMap((variant) =>
          [variant.subject ?? "", variant.body ?? ""].flatMap((text) =>
            variablesIn(text).map((match) => keyOf(match.name))
          )
        )
    )
  );

/** The `samples` leads that fill the most of `keys`. */
export const pickSamples = (
  leads: readonly Lead[],
  keys: ReadonlySet<string>,
  samples: number
): Lead[] => rankLeads(leads, keys).slice(0, samples);

export interface SampleAudit {
  readonly findings: readonly CopyFinding[];
  /** The leads whose rendered copy was audited in at least one variant. */
  readonly leads: readonly string[];
  /** Variants written per lead that no sample lead's values filled. */
  readonly unaudited: number;
}

const renderSteps = (
  steps: readonly SequenceStep[],
  lead: Lead
): SequenceStep[] =>
  steps.map((step) => ({
    ...step,
    variants: step.variants.map((variant) => {
      const { body, subject } = renderVariant(variant, lead);

      return { ...variant, body, subject };
    }),
  }));

/**
 * Audits each variant written per lead as each lead receives it. A lead
 * whose values leave the copy mostly variables still is skipped for that
 * variant: its gaps are personalization_gaps' to report.
 */
export const auditSamples = (
  steps: readonly SequenceStep[],
  leads: readonly Lead[],
  limits: Limits,
  isEmail: boolean
): SampleAudit => {
  const audited = new Set<string>();
  const findings: CopyFinding[] = [];
  const refs: string[] = [];

  for (const lead of leads) {
    const rendered = renderSteps(steps, lead);

    const thread = isEmail ? threadOf(rendered, writtenPerLead) : null;

    let any = false;

    for (const [at, step] of rendered.entries()) {
      for (const [index, variant] of step.variants.entries()) {
        const template = steps[at]?.variants[index];

        if (
          template !== undefined &&
          writtenPerLead(template) &&
          !writtenPerLead(variant)
        ) {
          any = true;
          audited.add(`${step.index}:${variant.variantKey}`);
          findings.push(
            ...auditVariant(step, variant, limits, thread, lead.ref)
          );
        }
      }
    }

    if (any) {
      refs.push(lead.ref);
    }
  }

  const perLead = steps.reduce(
    (sum, step) => sum + step.variants.filter(writtenPerLead).length,
    0
  );

  return { findings, leads: refs, unaudited: perLead - audited.size };
};
