// copy_preview: each step's copy as written, and as one real lead gets it.

import { z } from "zod";

import type {
  Lead,
  Sequence,
  SequenceVariant,
} from "../../internal/entities.ts";
import { htmlToText, looksLikeHtml } from "../../internal/text.ts";
import { defineInsight, maskingOf } from "../define.ts";
import { leadsOf } from "../people/read.ts";
import { refOf } from "../ref.ts";
import { stepAt } from "../step.ts";
import type { StepPosition } from "../step.ts";
import {
  fillVariables,
  keyOf,
  keysWithValue,
  variablesIn,
} from "../variables.ts";

const input = z.object({
  campaign: z
    .string()
    .min(1)
    .describe(
      "The campaign's ref, for example `instantly:acme:abc123`, or its name"
    ),
  lead: z
    .string()
    .min(1)
    .nullable()
    .default(null)
    .describe(
      "The lead's ref to render the copy for. null picks the lead read with the most variables filled."
    ),
  max_leads: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .default(100)
    .describe(
      "The most leads to read when picking one. Ignored when `lead` is given."
    ),
});

export interface CopyText {
  readonly subject: string | null;
  readonly body: string | null;
}

export interface RenderedCopy extends CopyText {
  /** The rendered body as plain text, with HTML tags removed. `null` when there is no body. */
  readonly bodyText: string | null;
}

export interface PreviewVariant {
  readonly variantKey: string;
  /** The copy exactly as the campaign stores it. */
  readonly template: CopyText;
  /** The copy with the lead's values, or each variable's fallback, put in. */
  readonly rendered: RenderedCopy;
  /**
   * Variables left as written because the lead has no value and the copy no
   * fallback. A sender signature or another variable the tool fills itself
   * at send time is listed here too.
   */
  readonly unfilled: readonly string[];
}

export interface PreviewStep extends StepPosition {
  readonly action: string;
  readonly delayDays: number | null;
  readonly variants: readonly PreviewVariant[];
}

export interface PreviewLead {
  readonly lead: string;
  readonly email: string | null;
  readonly linkedinUrl: string | null;
  /** How many of the copy's variables this lead has a value for. */
  readonly variablesFilled: number;
}

export interface CopyPreview {
  readonly campaign: string;
  /** The lead the copy is rendered for. `null` when no lead was read. */
  readonly lead: PreviewLead | null;
  readonly steps: readonly PreviewStep[];
  readonly totals: {
    readonly steps: number;
    readonly variants: number;
    /** Distinct variables in the copy. */
    readonly variables: number;
    /** Distinct variables left as written in at least one variant. */
    readonly unfilled: number;
  };
}

// The lead fields a variable can be filled from, as the redact plugin names them.
const LEAD_FIELDS = new Set(["company", "custom", "email", "name"]);

/** Distinct variable keys across every subject and body. */
export const keysIn = (sequence: Sequence): Set<string> =>
  new Set(
    sequence.steps.flatMap((step) =>
      step.variants.flatMap((variant) =>
        [variant.subject ?? "", variant.body ?? ""].flatMap((text) =>
          variablesIn(text).map((match) => keyOf(match.name))
        )
      )
    )
  );

/** Leads by how many of `keys` they fill, most first; the first read wins a tie. */
export const rankLeads = (
  leads: readonly Lead[],
  keys: ReadonlySet<string>
): Lead[] =>
  leads
    .map((lead) => {
      const has = keysWithValue(lead);

      return { lead, score: [...keys].filter((key) => has.has(key)).length };
    })
    .toSorted((left, right) => right.score - left.score)
    .map(({ lead }) => lead);

const render = (
  text: string | null,
  lead: Lead | undefined,
  unfilled: Set<string>
): string | null => {
  if (text === null) {
    return null;
  }

  if (lead === undefined) {
    for (const match of variablesIn(text)) {
      if (match.fallback === null) {
        unfilled.add(match.name);
      }
    }

    return text;
  }

  const filled = fillVariables(text, lead);

  for (const name of filled.unfilled) {
    unfilled.add(name);
  }

  return filled.text;
};

const plain = (body: string | null): string | null => {
  if (body === null) {
    return null;
  }

  return looksLikeHtml(body) ? htmlToText(body) : body.trim();
};

export interface RenderedVariant extends CopyText {
  /** Variables left as written, as the copy writes them. */
  readonly unfilled: readonly string[];
}

/**
 * One variant's subject and body as `lead` receives them. With no lead, the
 * copy comes back as written and every variable without a fallback is unfilled.
 */
export const renderVariant = (
  variant: Pick<SequenceVariant, "body" | "subject">,
  lead: Lead | undefined
): RenderedVariant => {
  const unfilled = new Set<string>();
  const subject = render(variant.subject, lead, unfilled);
  const body = render(variant.body, lead, unfilled);

  return { body, subject, unfilled: [...unfilled] };
};

// A single brace holding a `|` is spintax, as variables.ts reads copy.
const SPINTAX = /(?<!\{)\{[^{}]*\|[^{}]*\}(?!\})/u;

const hasSpintax = (variant: SequenceVariant): boolean =>
  [variant.subject, variant.body].some(
    (text) => text !== null && SPINTAX.test(text)
  );

const previewStep = (
  step: Sequence["steps"][number],
  lead: Lead | undefined
): PreviewStep => ({
  action: step.action,
  delayDays: step.delayDays,
  ...stepAt(step.index),
  variants: step.variants.map((variant) => {
    const { body, subject, unfilled } = renderVariant(variant, lead);

    return {
      rendered: { body, bodyText: plain(body), subject },
      template: { body: variant.body, subject: variant.subject },
      unfilled,
      variantKey: variant.variantKey,
    };
  }),
});

export const copyPreview = defineInsight({
  description:
    "A campaign's copy as written and as one real lead receives it. Returns every step and variant with its subject and body as stored, the same copy with the lead's values put into each {{variable}}, {variable} and %variable%, the rendered body as plain text, and the variables left unfilled. Use it to read templated copy, such as {{content1}} filled from a custom field. A variable takes the lead or custom field of the same name, ignoring case, spaces, underscores and hyphens, else the copy's own fallback. Costs 1 request for the sequence, plus 1 for a given lead or 1 per page of leads read.",
  inputSchema: input,
  key: "copyPreview",
  cost: (values, price) =>
    price.one("sequence.get") +
    (values.lead === null
      ? price.upTo(1) * price.list("leads.list", values.max_leads)
      : price.one("leads.get")),
  scales: "max_leads",
  name: "copy_preview",
  needs: ["sequence", "leads.byCampaign"],
  next: "Use personalization_gaps to find every lead who would get a variable left as written.",
  run: async (context, values) => {
    const sequence = context.one(
      await context.outbound.campaign(values.campaign).sequence()
    );

    const keys = keysIn(sequence);
    let lead: Lead | undefined;

    if (values.lead !== null) {
      lead = context.one(await context.outbound.lead(values.lead).get());
    } else if (keys.size === 0) {
      context.note("The copy uses no variables, so no lead was read.");
    } else {
      [lead] = rankLeads(
        await leadsOf(context, values.campaign, values.max_leads, "max_leads"),
        keys
      );

      if (lead === undefined) {
        context.note(
          "The campaign has no leads, so the copy is shown as written."
        );
      }
    }

    const masked = maskingOf(context.outbound)?.fields.some((field) =>
      LEAD_FIELDS.has(field)
    );

    if (lead !== undefined && masked === true) {
      context.note(
        "The redact plugin masks the lead's fields, so the rendered copy shows them masked. Read it without redact to see the values."
      );
    }

    const steps = sequence.steps.map((step) => previewStep(step, lead));

    const unfilled = new Set(
      steps.flatMap((step) =>
        step.variants.flatMap((variant) => variant.unfilled.map(keyOf))
      )
    );

    if (lead !== undefined && unfilled.size > 0) {
      context.note(
        `Left as written: ${[
          ...new Set(
            steps.flatMap((step) =>
              step.variants.flatMap((variant) => variant.unfilled)
            )
          ),
        ].join(
          ", "
        )}. The lead has no value and the copy no fallback, or the sending tool fills it at send time, such as a signature.`
      );
    }

    if (sequence.steps.some((step) => step.variants.some(hasSpintax))) {
      context.note(
        "Spintax such as {Hi|Hello} is shown as written, not resolved."
      );
    }

    const has = lead === undefined ? null : keysWithValue(lead);

    const answer: CopyPreview = {
      campaign: refOf(context.outbound, values.campaign),
      lead:
        lead === undefined || has === null
          ? null
          : {
              email: lead.email,
              lead: lead.ref,
              linkedinUrl: lead.linkedinUrl,
              variablesFilled: [...keys].filter((key) => has.has(key)).length,
            },
      steps,
      totals: {
        steps: steps.length,
        unfilled: unfilled.size,
        variables: keys.size,
        variants: steps.reduce((sum, step) => sum + step.variants.length, 0),
      },
    };

    return answer;
  },
});
