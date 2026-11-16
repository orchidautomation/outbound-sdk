// copy_audit's checks on one variant: the rules every variant runs, and the
// email or LinkedIn ones for its channel.

import type { SequenceStep, SequenceVariant } from "../../internal/entities.ts";
import { stepAt } from "../step.ts";
import type { StepPosition } from "../step.ts";
import {
  allCaps,
  bodyTooLong,
  CHECKS,
  connectionTooLong,
  exclamationMarks,
  image,
  malformedVariable,
  spamWords,
  subjectTooLong,
  threadKey,
  tooManyLinks,
} from "./copy-checks.ts";
import type { CheckName, Limits, Problem, Severity } from "./copy-checks.ts";

export interface CopyFinding extends StepPosition {
  readonly variantKey: string;
  readonly action: string;
  readonly check: CheckName;
  readonly severity: Severity;
  readonly finding: string;
  /** The text that triggered the check. */
  readonly text: string;
  /**
   * The lead whose rendered copy triggered it, for copy written per lead in
   * variables. `null` when the finding is in the copy as the campaign stores
   * it. Always set; optional in the type so a finding built by hand still fits.
   */
  readonly lead?: string | null;
}

export interface Thread {
  /** The first email step. `null` when the sequence has none. */
  readonly first: number | null;
  /**
   * The subjects the first email step sends under. `null` when they are
   * written per lead and not known, so no follow-up is judged against them.
   */
  readonly subjects: ReadonlySet<string> | null;
}

const emailChecks = (
  step: SequenceStep,
  variant: SequenceVariant,
  limits: Limits,
  thread: Thread
): (Problem | null)[] => {
  const subject = variant.subject?.trim() ?? "";
  const body = variant.body ?? "";
  const key = threadKey(subject);

  const problems: (Problem | null)[] = [
    subject === "" ? null : subjectTooLong(subject, limits),
    spamWords(`${subject}\n${body}`, limits),
    tooManyLinks(body, limits),
    image(body),
  ];

  if (step.index === thread.first && subject === "") {
    problems.push({
      check: "missing_subject",
      finding: "The first email has no subject.",
      text: "",
    });
  }

  if (
    step.index !== thread.first &&
    key !== "" &&
    thread.subjects !== null &&
    !thread.subjects.has(key)
  ) {
    problems.push({
      check: "subject_breaks_thread",
      finding:
        "This follow-up has a subject that differs from the first email's, so it starts a new thread instead of continuing the first.",
      text: subject,
    });
  }

  return problems;
};

const linkedinChecks = (
  step: SequenceStep,
  variant: SequenceVariant,
  limits: Limits
): (Problem | null)[] =>
  step.action.toLowerCase().includes("connect") && variant.body !== null
    ? [connectionTooLong(variant.body, limits)]
    : [];

/** Every finding in one variant. `thread` is `null` on a LinkedIn campaign. */
export const auditVariant = (
  step: SequenceStep,
  variant: SequenceVariant,
  limits: Limits,
  thread: Thread | null,
  lead: string | null
): CopyFinding[] => {
  const body = variant.body ?? "";
  const whole = `${variant.subject ?? ""}\n${body}`;

  const problems = [
    malformedVariable(whole),
    bodyTooLong(body, limits),
    allCaps(whole, limits),
    exclamationMarks(whole, limits),
    ...(thread === null
      ? linkedinChecks(step, variant, limits)
      : emailChecks(step, variant, limits, thread)),
  ];

  return problems.flatMap((problem) =>
    problem === null
      ? []
      : [
          {
            ...problem,
            action: step.action,
            lead,
            severity: CHECKS[problem.check],
            ...stepAt(step.index),
            variantKey: variant.variantKey,
          },
        ]
  );
};

/**
 * The first step and its subjects. `perLead` says whether a variant of it is
 * written per lead; then its subjects are not known from the template.
 */
export const threadOf = (
  steps: readonly SequenceStep[],
  perLead: (variant: SequenceVariant) => boolean
): Thread => {
  const [first] = steps.toSorted((left, right) => left.index - right.index);
  const variants = first?.variants ?? [];

  return {
    first: first?.index ?? null,
    subjects:
      first !== undefined && variants.some((variant) => perLead(variant))
        ? null
        : new Set(
            variants.flatMap((variant) => {
              const key = threadKey(variant.subject);

              return key === "" ? [] : [key];
            })
          ),
  };
};
