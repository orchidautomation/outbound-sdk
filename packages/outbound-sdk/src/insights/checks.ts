// The checks an insight's run starts with: its input parsed, whether the
// adapter supports it, and what its reads are priced at.

import type { ZodObject, ZodType } from "zod";

import type { Capabilities, CapabilityKey } from "../internal/capabilities.ts";
import type { Lead } from "../internal/entities.ts";
import { OutboundError } from "../internal/errors.ts";
import { unknownKey } from "../internal/json.ts";
import type { Json } from "../internal/json.ts";
import type { ListAll, OutboundApi } from "../internal/outbound/api.ts";
import type { CampaignScope } from "../internal/scope/rule.ts";
import { namesCampaign } from "../tools/by-name.ts";
import { inputProblem } from "../tools/input-problem.ts";
import type { InsightCost } from "./cost.ts";
import { scopeCost } from "./scope-campaigns.ts";

/** What the redact plugin masks on an instance. */
export interface Masking {
  readonly fields: readonly string[];
  readonly strategy: "hash" | "mask";
  /** The token the plugin writes in place of a value in a masked field. */
  readonly hash?: ((value: string) => string) | undefined;
  /**
   * What a token the plugin wrote stands for, `email` or `linkedin`, or
   * `null` when it cannot put the value back on a call to the vendor.
   */
  readonly resolves?:
    | ((token: string) => "email" | "linkedin" | null)
    | undefined;
  /** The leads behind address tokens, read through the plugin and returned masked. */
  readonly leadsByToken?:
    | ((tokens: readonly string[], campaign: string | null) => ListAll<Lead>)
    | undefined;
}

/**
 * Says why an insight cannot answer with these fields masked, for example
 * `email addresses, which it matches people by`, or `null` when it can.
 */
export type MaskedOut = (masking: Masking) => string | null;

/**
 * Names what this adapter does not report that the insight needs, for
 * example `campaign tags`, or `null` when it reports it.
 */
export type Lacks = (outbound: OutboundApi) => string | null;

/** What the checks read of an insight's definition. */
export interface Checkable<Input, Given> {
  readonly name: string;
  readonly inputSchema: ZodObject & ZodType<Input, Given>;
  readonly needs: readonly CapabilityKey[];
  readonly needsFor?:
    | ((input: Input, capabilities: Capabilities) => readonly CapabilityKey[])
    | undefined;
  readonly maskedOut?: MaskedOut | undefined;
  readonly lacks?: Lacks | undefined;
  readonly cost?: InsightCost<Input> | undefined;
}

interface Redacted {
  readonly redacted: Masking;
}

// The redact plugin says what it masks on the instance. Told apart by shape,
// so the insights do not import that plugin.
const isRedacted = (
  outbound: OutboundApi
): outbound is OutboundApi & Redacted => "redacted" in outbound;

/** What the redact plugin masks here, or `null` without it. */
export const maskingOf = (outbound: OutboundApi): Masking | null =>
  isRedacted(outbound) ? outbound.redacted : null;

/** Why the entry cannot answer under this instance's redact plugin, or `null`. */
export const maskedOutBy = (
  outbound: OutboundApi,
  entry: { readonly maskedOut?: MaskedOut | undefined }
): string | null => {
  const masking = maskingOf(outbound);

  return masking === null || entry.maskedOut === undefined
    ? null
    : entry.maskedOut(masking);
};

const missing = (
  outbound: OutboundApi,
  needs: readonly CapabilityKey[]
): CapabilityKey[] =>
  needs.filter((key) => outbound.capabilities[key] === false);

export const prepare = <Input, Given>(
  outbound: OutboundApi,
  spec: Checkable<Input, Given>,
  input: Json | undefined
): Input => {
  // A misspelt or unsupported filter is refused. Dropping it would let the
  // insight quietly answer a wider question than the one asked.
  const stray = unknownKey(Object.keys(spec.inputSchema.shape), input);

  if (stray !== undefined) {
    throw new OutboundError("Invalid", `${spec.name}: ${stray}`, {
      provider: outbound.provider,
    });
  }

  const parsed = spec.inputSchema.safeParse(input ?? {});

  if (!parsed.success) {
    const [issue] = parsed.error.issues;

    throw new OutboundError(
      "Invalid",
      `${spec.name}: ${inputProblem(input, issue)}`,
      { provider: outbound.provider }
    );
  }

  const blocked = maskedOutBy(outbound, spec);

  if (blocked !== null) {
    throw new OutboundError(
      "Unsupported",
      `${spec.name} is not available while the redact plugin masks ${blocked}`,
      { provider: outbound.provider }
    );
  }

  return parsed.data;
};

/** Refuses the run when the adapter lacks what the insight or this input needs. */
export const refuseUnsupported = <Input, Given>(
  outbound: OutboundApi,
  spec: Checkable<Input, Given>,
  input: Input
): void => {
  const lacked = spec.lacks?.(outbound) ?? null;

  if (lacked !== null) {
    throw new OutboundError(
      "Unsupported",
      `${spec.name} is not available: the ${outbound.provider} adapter does not report ${lacked}`,
      { provider: outbound.provider }
    );
  }

  const absent = missing(outbound, spec.needs);

  // What only this input needs is named apart, so the caller knows another input may work.
  const forInput = missing(
    outbound,
    spec.needsFor?.(input, outbound.capabilities) ?? []
  );

  if (absent.length > 0 || forInput.length > 0) {
    throw new OutboundError(
      "Unsupported",
      `${spec.name} is not available${absent.length > 0 ? "" : " for this input"}: the ${outbound.provider} adapter does not support ${[...new Set([...absent, ...forInput])].join(", ")}`,
      { provider: outbound.provider }
    );
  }
};

export const COMBINED = "combined";

/** Whether any tool of a combined instance can serve the insight. Its workspaces are its tools, listed with no request. */
export const someMemberServes = async <Input, Given>(
  outbound: OutboundApi,
  spec: Checkable<Input, Given>,
  input: Input
): Promise<boolean> => {
  const { items } = await outbound.workspaces.list();

  return items.some((tool) => {
    try {
      refuseUnsupported(
        outbound.workspace(`${tool.provider}:${tool.workspaceId}`),
        spec,
        input
      );

      return true;
    } catch (error) {
      if (OutboundError.is(error) && error.code === "Unsupported") {
        return false;
      }

      throw error;
    }
  });
};

/** The most campaigns a name is looked up among, for the cost of the lookup. */
const NAMED_AMONG = 1000;

/**
 * The spec, its cost raised by the campaign listing a campaign given by name
 * needs, and by the reads that find a campaign scope's campaigns.
 */
export const priced = <Input, Given, Spec extends Checkable<Input, Given>>(
  outbound: OutboundApi,
  spec: Spec,
  input: Input,
  scope: CampaignScope | null
): Spec => {
  const { cost } = spec;
  const named = namesCampaign(outbound, input);

  if (cost === undefined || (!named && scope === null)) {
    return spec;
  }

  return {
    ...spec,
    cost: (values, price) => {
      const lookup = named ? price.list("campaigns.list", NAMED_AMONG) : 0;

      return cost(values, price) + lookup + scopeCost(scope, price);
    },
  };
};
