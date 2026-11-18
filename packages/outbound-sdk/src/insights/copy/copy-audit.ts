// copy_audit: problems in a sequence's copy, found before it sends.

import { z } from "zod";

import type { Lead, Sequence } from "../../internal/entities.ts";
import { plural } from "../../internal/numbers.ts";
import { defineInsight } from "../define.ts";
import type { InsightContext } from "../define.ts";
import { capNote } from "../tracked-reads.ts";
import {
  auditSamples,
  perLeadKeys,
  pickSamples,
  writtenPerLead,
} from "./audit-samples.ts";
import type { SampleAudit } from "./audit-samples.ts";
import { auditVariant, threadOf } from "./audit-variant.ts";
import type { CopyFinding } from "./audit-variant.ts";
import { CHECKS, DEFAULT_SPAM_WORDS } from "./copy-checks.ts";
import type { CheckName, Limits, Severity } from "./copy-checks.ts";

export type { CopyFinding } from "./audit-variant.ts";

const limit = (fallback: number, description: string) =>
  z.number().int().min(0).default(fallback).describe(description);

const input = z.object({
  campaign: z
    .string()
    .min(1)
    .describe(
      "The campaign's ref, for example `instantly:acme:abc123`, or its name"
    ),
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
  max_leads: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .default(100)
    .describe(
      "The most leads to read when picking the samples. Read only when copy is written per lead."
    ),
  max_subject_chars: limit(60, "The most characters a subject may have."),
  samples: z
    .number()
    .int()
    .min(0)
    .max(20)
    .default(3)
    .describe(
      "Leads' rendered copy to audit when copy is mostly variables; the leads filling the most are used. 0 audits stored copy only."
    ),
  spam_words: z
    .array(z.string().min(1))
    .default([...DEFAULT_SPAM_WORDS])
    .describe(
      "Words and phrases to flag in email copy, matched whole and without case. Replaces the default list."
    ),
});

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
  /**
   * `true` when no check found anything and every variant was audited.
   * `false` on any finding, and also when copy written per lead could not be
   * audited for every variant: then `variantsNotAudited` is above 0 and a
   * note says why, and no finding does not mean a problem was found.
   */
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
  /**
   * Variants whose subject or body is mostly variables, such as `{{body_1}}`.
   * They are audited as sample leads receive them, not as stored. This and
   * `leadsAudited` are always set; optional in the type so an audit built by
   * hand still fits.
   */
  readonly variantsWrittenPerLead?: number;
  /** The leads whose rendered copy was audited. Empty when no copy is written per lead. */
  readonly leadsAudited?: readonly string[];
  /**
   * Variants written per lead that no sample lead's copy could be rendered
   * for, so they were not audited at all. Above 0 makes `clean` `false`.
   */
  readonly variantsNotAudited?: number;
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

/** Clean only with no finding and nothing left unaudited: copy not read is never called clean. */
const cleanOf = (findings: number, unaudited: number): boolean =>
  findings === 0 && unaudited === 0;

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

interface Samples {
  readonly leads: readonly Lead[];
  /** Why no lead was sampled. `null` when some were, or none were needed. */
  readonly reason: string | null;
  /** `true` when `max_leads` stopped the read with more leads left. */
  readonly capped: boolean;
}

/** The sample leads for copy written per lead, or why there are none. */
const readSamples = async (
  context: InsightContext,
  args: z.infer<typeof input>,
  sequence: Sequence
): Promise<Samples> => {
  if (!sequence.steps.some((step) => step.variants.some(writtenPerLead))) {
    return { capped: false, leads: [], reason: null };
  }

  if (args.samples === 0) {
    return { capped: false, leads: [], reason: "samples is 0" };
  }

  if (context.outbound.capabilities["leads.byCampaign"] === false) {
    return {
      capped: false,
      leads: [],
      reason: "this tool does not list a campaign's leads",
    };
  }

  // Read past `context.all`, which would mark the answer incomplete at the
  // cap: the cap matters only when the leads read gave too few samples.
  const walk = context.outbound
    .campaign(args.campaign)
    .leads.listAll({ max: args.max_leads });

  const leads = await walk.toArray();

  if (walk.meta !== undefined) {
    context.one({ meta: walk.meta });
  }

  return leads.length === 0
    ? { capped: false, leads: [], reason: "the campaign has no leads" }
    : {
        capped: walk.truncated,
        leads: pickSamples(leads, perLeadKeys(sequence.steps), args.samples),
        reason: null,
      };
};

const noteSamples = (
  context: InsightContext,
  perLead: number,
  samples: Samples,
  audit: SampleAudit
): void => {
  if (perLead === 0) {
    return;
  }

  const variants = plural(perLead, "variant");

  const reason =
    samples.reason ?? "no lead read has values for their variables";

  if (audit.leads.length === 0) {
    context.note(
      `${variants} ${perLead === 1 ? "is" : "are"} written per lead in variables, and the copy could not be audited as any lead receives it: ${reason}.`
    );

    return;
  }

  context.note(
    `${variants} ${perLead === 1 ? "is" : "are"} written per lead in variables, so the rendered copy of ${plural(audit.leads.length, "sample lead")} was audited; each finding names its lead.`
  );

  if (audit.unaudited > 0) {
    context.note(
      `${plural(audit.unaudited, "variant")} written per lead could not be audited: no sample lead has values for ${audit.unaudited === 1 ? "its" : "their"} variables.`
    );
  }
};

export const copyAudit = defineInsight({
  description:
    "Problems in a campaign's copy before it sends. Checks every step and variant against fixed rules: subject and body length, links, spam words, broken {{ }} variables, words in capitals, exclamation marks, images or tracking pixels, a missing first subject, a follow-up subject that breaks the thread, and on LinkedIn a connection request over the limit. Returns each finding with its severity and the text behind it, and a count per check. Copy written per lead in variables is audited as sample leads receive it. Costs 2 requests, plus 1 per page of leads when copy is written per lead.",
  inputSchema: input,
  key: "copyAudit",
  cost: (values, price) =>
    price.one("campaigns.get") +
    price.one("sequence.get") +
    (values.samples === 0
      ? 0
      : price.upTo(1) * price.list("leads.list", values.max_leads)),
  scales: "max_leads",
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

    const thread = isEmail ? threadOf(sequence.steps, writtenPerLead) : null;

    const variants = sequence.steps.flatMap((step) =>
      step.variants.map((variant) => ({ step, variant }))
    );

    const perLead = variants.filter(({ variant }) =>
      writtenPerLead(variant)
    ).length;

    const samples = await readSamples(context, args, sequence);

    const sampled = auditSamples(
      sequence.steps,
      samples.leads,
      limits,
      isEmail
    );

    const findings = [
      ...variants.flatMap(({ step, variant }) =>
        writtenPerLead(variant)
          ? []
          : auditVariant(step, variant, limits, thread, null)
      ),
      ...sampled.findings,
    ].toSorted(
      (left, right) =>
        RANK[left.severity] - RANK[right.severity] ||
        left.stepIndex - right.stepIndex ||
        left.variantKey.localeCompare(right.variantKey) ||
        left.check.localeCompare(right.check) ||
        (left.lead ?? "").localeCompare(right.lead ?? "")
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

    noteSamples(context, perLead, samples, sampled);

    // A cap that left leads unread matters only when the leads read gave
    // fewer samples than asked for, or left a variant unaudited.
    if (
      samples.capped &&
      (sampled.unaudited > 0 || sampled.leads.length < args.samples)
    ) {
      context.partial(
        capNote({ input: "max_leads", max: args.max_leads, what: "leads" })
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
      clean: cleanOf(findings.length, sampled.unaudited),
      findings,
      stepsChecked: sequence.steps.length,
      variantsChecked: variants.length,
      leadsAudited: sampled.leads,
      variantsWithoutBody: withoutBody,
      variantsNotAudited: sampled.unaudited,
      variantsWrittenPerLead: perLead,
    };

    return audit;
  },
});
