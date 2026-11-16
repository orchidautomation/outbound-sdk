// copy_audit: problems in a sequence's copy, found before it sends.

import { z } from "zod";

import type { SequenceStep, SequenceVariant } from "../../internal/entities.ts";
import { defineInsight } from "../define.ts";
import { stepAt } from "../step.ts";
import type { StepPosition } from "../step.ts";
import {
  allCaps,
  bodyTooLong,
  CHECKS,
  connectionTooLong,
  DEFAULT_SPAM_WORDS,
  exclamationMarks,
  image,
  malformedVariable,
  spamWords,
  subjectTooLong,
  threadKey,
  tooManyLinks,
} from "./copy-checks.ts";
import type { CheckName, Limits, Problem, Severity } from "./copy-checks.ts";

const limit = (fallback: number, description: string) =>
  z.number().int().min(0).default(fallback).describe(description);

const input = z.object({
  campaign: z
    .string()
    .min(1)
    .describe("The campaign's ref, for example `instantly:acme:abc123`"),
  max_body_words: limit(150, "The most words a body may have."),
  max_caps_words: limit(
    1,
    "How many words of four or more letters may be in capitals, so one acronym is not a finding."
  ),
  max_connection_chars: limit(
    300,
    "The most characters a LinkedIn connection request may have."
  ),
  max_exclamations: limit(1, "How many exclamation marks a message may have."),
  max_links: limit(1, "The most links an email body may have."),
  max_subject_chars: limit(60, "The most characters a subject may have."),
  spam_words: z
    .array(z.string().min(1))
    .default([...DEFAULT_SPAM_WORDS])
    .describe(
      "Words and phrases to flag in email copy, matched whole and without case. Replaces the default list."
    ),
});

export interface CopyFinding extends StepPosition {
  readonly variantKey: string;
  readonly action: string;
  readonly check: CheckName;
  readonly severity: Severity;
  readonly finding: string;
  /** The text that triggered the check. */
  readonly text: string;
}

export interface CheckCount {
  readonly check: CheckName;
  readonly severity: Severity;
  readonly count: number;
}

export interface CopyAudit {
  readonly campaign: string;
  /** The campaign's name, from the campaign record the audit reads. */
  readonly campaignName: string;
  readonly channel: "email" | "linkedin";
  /** `true` when no check found anything in the copy that could be read. */
  readonly clean: boolean;
  /** High severity first, then by step and variant. */
  readonly findings: readonly CopyFinding[];
  /** Every check that was run, with how often it fired. */
  readonly byCheck: readonly CheckCount[];
  readonly bySeverity: {
    readonly high: number;
    readonly medium: number;
    readonly low: number;
  };
  readonly stepsChecked: number;
  readonly variantsChecked: number;
  /** Variants whose body the vendor did not return; their body checks were skipped. */
  readonly variantsWithoutBody: number;
}

const RANK: Readonly<Record<Severity, number>> = { high: 0, low: 2, medium: 1 };

const EMAIL_ONLY: readonly CheckName[] = [
  "image",
  "missing_subject",
  "spam_words",
  "subject_breaks_thread",
  "subject_too_long",
  "too_many_links",
];

const LINKEDIN_ONLY: readonly CheckName[] = ["connection_request_too_long"];

interface Thread {
  /** The first email step. `null` when the sequence has none. */
  readonly first: number | null;
  /** The subjects the first email step sends under. */
  readonly subjects: ReadonlySet<string>;
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

  if (step.index !== thread.first && key !== "" && !thread.subjects.has(key)) {
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

const auditVariant = (
  step: SequenceStep,
  variant: SequenceVariant,
  limits: Limits,
  thread: Thread | null
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
            severity: CHECKS[problem.check],
            ...stepAt(step.index),
            variantKey: variant.variantKey,
          },
        ]
  );
};

const threadOf = (steps: readonly SequenceStep[]): Thread => {
  const [first] = steps.toSorted((left, right) => left.index - right.index);

  return {
    first: first?.index ?? null,
    subjects: new Set(
      (first?.variants ?? []).flatMap((variant) => {
        const key = threadKey(variant.subject);

        return key === "" ? [] : [key];
      })
    ),
  };
};

// SAFETY: CHECKS is a fixed object, so its keys are exactly CheckName.
const CHECK_NAMES = Object.keys(CHECKS) as CheckName[];

const countsOf = (
  findings: readonly CopyFinding[],
  isEmail: boolean
): CheckCount[] =>
  CHECK_NAMES.filter(
    (check) => !(isEmail ? LINKEDIN_ONLY : EMAIL_ONLY).includes(check)
  )
    .map((check) => ({
      check,
      count: findings.filter((finding) => finding.check === check).length,
      severity: CHECKS[check],
    }))
    .toSorted(
      (left, right) =>
        right.count - left.count ||
        RANK[left.severity] - RANK[right.severity] ||
        left.check.localeCompare(right.check)
    );

export const copyAudit = defineInsight({
  description:
    "Problems in a campaign's copy before it sends. Checks every step and variant for a long subject, a long body, too many links, spam words, unbalanced or empty {{ }} variables, words in capitals, repeated exclamation marks, an image or tracking pixel, a missing subject on the first email, and a follow-up whose subject breaks the thread; a LinkedIn campaign skips the email-only checks and flags a connection request over the character limit. Returns each finding with a severity and the text that triggered it, and a count per check. Costs 2 requests. Fixed rules only, no model. A variant whose body the vendor does not return is counted, not judged.",
  inputSchema: input,
  key: "copyAudit",
  cost: (_input, price) =>
    price.one("campaigns.get") + price.one("sequence.get"),
  name: "copy_audit",
  needs: ["sequence"],
  next: "Use step_funnel to see whether the steps with findings are also the ones with few replies.",
  run: async (context, args) => {
    const handle = context.outbound.campaign(args.campaign);
    const campaign = context.one(await handle.get());
    const sequence = context.one(await handle.sequence());
    const isEmail = campaign.channel === "email";

    const limits: Limits = {
      maxBodyWords: args.max_body_words,
      maxCapsWords: args.max_caps_words,
      maxConnectionChars: args.max_connection_chars,
      maxExclamations: args.max_exclamations,
      maxLinks: args.max_links,
      maxSubjectChars: args.max_subject_chars,
      spamWords: args.spam_words,
    };

    const thread = isEmail ? threadOf(sequence.steps) : null;

    const variants = sequence.steps.flatMap((step) =>
      step.variants.map((variant) => ({ step, variant }))
    );

    const findings = variants
      .flatMap(({ step, variant }) =>
        auditVariant(step, variant, limits, thread)
      )
      .toSorted(
        (left, right) =>
          RANK[left.severity] - RANK[right.severity] ||
          left.step - right.step ||
          left.variantKey.localeCompare(right.variantKey) ||
          left.check.localeCompare(right.check)
      );

    const withoutBody = variants.filter(
      ({ variant }) => variant.body === null
    ).length;

    if (withoutBody > 0) {
      context.note(
        withoutBody === 1
          ? "1 variant has no body in the vendor's answer, so its body checks were skipped."
          : `${withoutBody} variants have no body in the vendor's answer, so their body checks were skipped.`
      );
    }

    const severity = (level: Severity): number =>
      findings.filter((finding) => finding.severity === level).length;

    const audit: CopyAudit = {
      byCheck: countsOf(findings, isEmail),
      bySeverity: {
        high: severity("high"),
        low: severity("low"),
        medium: severity("medium"),
      },
      campaign: campaign.ref,
      campaignName: campaign.name,
      channel: campaign.channel,
      clean: findings.length === 0,
      findings,
      stepsChecked: sequence.steps.length,
      variantsChecked: variants.length,
      variantsWithoutBody: withoutBody,
    };

    return audit;
  },
});
