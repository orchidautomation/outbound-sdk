import { z } from "zod";

import type { CapabilityKey } from "../internal/capabilities.ts";
import { OutboundError } from "../internal/errors.ts";
import { jsonInput, unknownKey } from "../internal/json.ts";
import type { Json } from "../internal/json.ts";
import type { OutboundApi } from "../internal/outbound/api.ts";
import { plural } from "../internal/plural.ts";
import { requestCounter, withGuard } from "../internal/request-cap.ts";
import { audienceLists, campaignSetup, vendorRead } from "./account-tools.ts";
import { routedByCampaign, withCampaign } from "./by-name.ts";
import {
  campaignOverview,
  campaignTrend,
  replySamples,
  winningSteps,
} from "./campaign-tools.ts";
import { deliverabilityCheck } from "./deliverability-check.ts";
import { inputProblem } from "./input-problem.ts";
import {
  compareClients,
  crossChannelLead,
  leadRunway,
} from "./people-tools.ts";
import { senderHealth } from "./sender-health.ts";
import { capNext, DEFAULT_TOOL_REQUESTS, failure } from "./shared.ts";
import type { ToolResult } from "./shared.ts";

/** The fields of a tool's input object, each a Zod schema. */
export type InputFields = z.ZodObject["shape"];

/** What a caller of `call` can set for that one call. */
export interface ToolCallOptions {
  /**
   * The most vendor requests this call may send, retries included. Replaces
   * the tool's default; `Infinity` removes it. `createTools` passes its
   * `maxRequestsPerToolCall` here.
   */
  readonly maxRequests?: number | undefined;
}

/** A tool with its input type erased, so tools of different inputs sit in one list. */
export interface OutboundTool {
  readonly name: string;
  readonly description: string;
  /** The input as JSON Schema, for any model API. */
  readonly parameters: Json;
  /** The input's fields as Zod schemas, for SDKs that take them one by one. */
  readonly fields: InputFields;
  readonly needs: readonly string[];
  /**
   * Validates the input and runs the tool. Never throws: a failure is a
   * result. The input is checked against the tool's schema when it runs, so
   * a model's arguments, an object typed from the schema and a
   * `Record<string, unknown>` are all taken as they are.
   */
  readonly call: (
    // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the input is parsed by the tool's own schema inside call()
    input: unknown,
    options?: ToolCallOptions
  ) => Promise<ToolResult>;
}

interface Definition<Input> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.ZodObject & z.ZodType<Input>;
  readonly needs: readonly string[];
  readonly run: (outbound: OutboundApi, input: Input) => Promise<ToolResult>;
}

/** Throws `Invalid` unless `cap` is a positive integer or `Infinity`. */
export const checkCap = (cap: number | undefined, setting: string): void => {
  if (
    cap !== undefined &&
    cap !== Infinity &&
    (!Number.isInteger(cap) || cap < 1)
  ) {
    throw new OutboundError(
      "Invalid",
      `${setting} must be a positive integer, or Infinity for no cap`
    );
  }
};

const bind = <Input>(
  outbound: OutboundApi,
  definition: Definition<Input>
): OutboundTool => ({
  call: async (given, options = {}) => {
    const input = jsonInput(given);

    if (input === undefined) {
      return failure(
        new OutboundError(
          "Invalid",
          `${definition.name}: the input is not JSON`
        )
      );
    }

    // An argument the tool does not take is reported to the model, not dropped.
    const stray = unknownKey(Object.keys(definition.inputSchema.shape), input);

    if (stray !== undefined) {
      return failure(
        new OutboundError("Invalid", `${definition.name}: ${stray}`)
      );
    }

    const parsed = definition.inputSchema.safeParse(input ?? {});

    if (!parsed.success) {
      const [issue] = parsed.error.issues;

      return failure(
        new OutboundError(
          "Invalid",
          `${definition.name}: ${inputProblem(input, issue)}`
        )
      );
    }

    checkCap(options.maxRequests, "maxRequests");
    const cap = options.maxRequests ?? DEFAULT_TOOL_REQUESTS;
    const isDefault = options.maxRequests === undefined;

    // Every request of this call, from every read in flight, counts against one allowance.
    const counter = requestCounter(
      cap,
      (provider) =>
        new OutboundError(
          "RateLimited",
          `${definition.name} stopped after ${plural(cap, "request")} to ${provider}, at ${isDefault ? "the default cap of a tool call" : "maxRequestsPerToolCall"}.`,
          { limit: "call", provider }
        )
    );

    try {
      const guarded = withGuard(outbound, counter);

      // A campaign given by name is looked up within this call's allowance,
      // and its requests are counted with the tool's own.
      const resolved = await withCampaign(guarded, parsed.data);
      const lookup = counter.used();
      // On a combined instance a campaign's own tool answers for it, so what
      // that tool supports applies, and a tool that cannot is refused here.
      const target = routedByCampaign(guarded, resolved);
      const unmet = definition.needs.filter((need) => !metOn(target)(need));

      if (unmet.length > 0) {
        return failure(
          new OutboundError(
            "Unsupported",
            `${definition.name} is not available for this campaign: the ${target.provider} adapter does not support ${unmet.join(", ")}`,
            { provider: target.provider }
          ),
          lookup,
          "Call it again with a campaign of a tool on this instance that supports it, or pick another of the listed tools."
        );
      }

      const result = await definition.run(target, resolved);

      return result.ok
        ? {
            ...result,
            meta: {
              ...result.meta,
              computedAt: result.meta.computedAt ?? new Date().toISOString(),
              requests: result.meta.requests + lookup,
              today: new Date().toISOString().slice(0, 10),
            },
          }
        : result;
    } catch (error) {
      return counter.stopped()
        ? failure(error, counter.used(), capNext(cap, isDefault))
        : failure(error, counter.used());
    }
  },
  description: definition.description,
  name: definition.name,
  needs: definition.needs,
  // SAFETY: a JSON Schema document is JSON by definition.
  parameters: z.toJSONSchema(definition.inputSchema, { io: "input" }) as Json,
  fields: definition.inputSchema.shape,
});

export const TOOL_NAMES = [
  "campaign_overview",
  "campaign_trend",
  "winning_steps",
  "sender_health",
  "reply_samples",
  "lead_runway",
  "compare_clients",
  "cross_channel_lead",
  "campaign_setup",
  "deliverability_check",
  "audience_lists",
  "vendor_read",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export interface ToolsOptions {
  /** Offer only these tools. Defaults to every tool the instance can serve. */
  readonly only?: readonly ToolName[] | undefined;
  /** More tools to offer after the built-in ones, for example `insightTools(outbound)`. */
  readonly extra?: readonly OutboundTool[] | undefined;
  /**
   * The most vendor requests one tool call may send, retries included,
   * counted across every read the call makes. Without it a built-in tool
   * call may send 100 and an insight tool call what its input can cost, at
   * most 500. `Infinity` removes the default. A `maxRequestsPerCall` on the
   * instance and `budget()` still apply under it.
   */
  readonly maxRequestsPerToolCall?: number | undefined;
  /**
   * On a combined instance, each of its tools as its own instance
   * (`membersOf` in `outbound-sdk/insights`). With them a tool that takes a
   * campaign is offered when one of them supports it, and answers for that
   * tool's campaigns.
   */
  readonly members?: readonly OutboundApi[] | undefined;
}

interface Redacted {
  readonly redacted: { readonly fields: readonly string[] };
}

const isRedacted = (
  outbound: OutboundApi
): outbound is OutboundApi & Redacted => "redacted" in outbound;

const masksIdentifiers = (outbound: OutboundApi): boolean =>
  isRedacted(outbound) &&
  outbound.redacted.fields.some(
    (field) => field === "email" || field === "linkedin"
  );

/** What `next` says when the hint a tool wrote names a tool that is not on offer. */
export const NEXT_FALLBACK = "Pick another of the listed tools to go further.";

// A hint may only name a tool the model was given.
const withOfferedHints = (
  tool: OutboundTool,
  offered: ReadonlySet<string>
): OutboundTool => {
  const hidden = TOOL_NAMES.filter((name) => !offered.has(name));

  return hidden.length === 0
    ? tool
    : {
        ...tool,
        call: async (input, options) => {
          const result = await tool.call(input, options);

          return hidden.some((name) => result.next.includes(name))
            ? { ...result, next: NEXT_FALLBACK }
            : result;
        },
      };
};

// The clients plugin adds `clients`; the identity plugin adds `person`.
const pluginsOf = (outbound: OutboundApi): ReadonlyMap<string, boolean> =>
  new Map([
    ["clients", "clients" in outbound],
    // person() refuses when redact masks the identifiers it links by.
    ["identity", "person" in outbound && !masksIdentifiers(outbound)],
    // Offered only when the vendor has reads of its own and no plugin turned them off.
    [
      "native",
      outbound.capabilities.native &&
        Object.keys(outbound.native.catalog).length > 0,
    ],
  ]);

/** Whether the instance meets one need of a tool: a plugin it has, or a capability it supports. */
const metOn = (outbound: OutboundApi): ((need: string) => boolean) => {
  const added = pluginsOf(outbound);
  const { capabilities } = outbound;

  const isCapability = (need: string): need is CapabilityKey =>
    Object.hasOwn(capabilities, need);

  // Anything else a tool needs is a capability key. An unknown name is unmet.
  return (need) =>
    added.get(need) ?? (isCapability(need) && capabilities[need] !== false);
};

interface Needs {
  readonly needs: readonly string[];
  /** Whether the tool takes a campaign, so a combined instance can route it to the campaign's tool. */
  readonly byCampaign: boolean;
}

const NEEDS: ReadonlyMap<string, Needs> = new Map(
  [
    campaignOverview,
    campaignTrend,
    winningSteps,
    senderHealth,
    replySamples,
    leadRunway,
    compareClients,
    crossChannelLead,
    campaignSetup,
    deliverabilityCheck,
    audienceLists,
    vendorRead,
  ].map((definition) => [
    definition.name,
    {
      byCampaign: Object.hasOwn(definition.inputSchema.shape, "campaign"),
      needs: definition.needs,
    },
  ])
);

/** Whether the instance, or for a tool that takes a campaign one of its tools, meets every need. */
const servedBy = (
  outbound: OutboundApi,
  members: readonly OutboundApi[],
  name: string,
  needs: readonly string[]
): boolean =>
  needs.every(metOn(outbound)) ||
  (NEEDS.get(name)?.byCampaign === true &&
    members.some((member) => needs.every(metOn(member))));

/**
 * Why `createTools` leaves a built-in tool out of this instance's set, in
 * the words of an `Unsupported` error. `undefined` for a name that is not a
 * built-in tool, or one the instance offers.
 */
export const leftOutReason = (
  outbound: OutboundApi,
  name: string,
  members: readonly OutboundApi[] = []
): string | undefined => {
  const needs = NEEDS.get(name)?.needs ?? [];
  const met = metOn(outbound);
  const unmet = needs.filter((need) => !met(need));

  if (unmet.length === 0 || servedBy(outbound, members, name, needs)) {
    return undefined;
  }

  const plugins = unmet.filter((need) => pluginsOf(outbound).has(need));
  const capabilities = unmet.filter((need) => !plugins.includes(need));

  return `${name} is not available: ${[
    ...(capabilities.length > 0
      ? [
          `the ${outbound.provider} adapter does not support ${capabilities.join(", ")}`,
        ]
      : []),
    ...(plugins.length > 0
      ? [`it needs ${plugins.join(", ")}, which this instance does not offer`]
      : []),
  ].join("; ")}`;
};

/**
 * The tool set for one instance. A tool that needs a plugin the instance does
 * not have, or a capability the adapter lacks or a plugin turned off, is left
 * out, so a model is never offered a tool that cannot work.
 */
export const createTools = (
  outbound: OutboundApi,
  options: ToolsOptions = {}
): OutboundTool[] => {
  checkCap(options.maxRequestsPerToolCall, "maxRequestsPerToolCall");

  const all = [
    bind(outbound, campaignOverview),
    bind(outbound, campaignTrend),
    bind(outbound, winningSteps),
    bind(outbound, senderHealth),
    bind(outbound, replySamples),
    bind(outbound, leadRunway),
    bind(outbound, compareClients),
    bind(outbound, crossChannelLead),
    bind(outbound, campaignSetup),
    bind(outbound, deliverabilityCheck),
    bind(outbound, audienceLists),
    bind(outbound, vendorRead),
  ];

  const wanted =
    options.only === undefined ? undefined : new Set<string>(options.only);

  const members = options.members ?? [];

  const offered = [
    ...all.filter(
      (tool) =>
        (wanted === undefined || wanted.has(tool.name)) &&
        servedBy(outbound, members, tool.name, tool.needs)
    ),
    ...(options.extra ?? []),
  ];

  const names = new Set(offered.map((tool) => tool.name));
  const perCall = options.maxRequestsPerToolCall;

  return offered.map((tool) => {
    const hinted = withOfferedHints(tool, names);

    // The cap set here is each call's, unless a caller passes its own.
    return perCall === undefined
      ? hinted
      : {
          ...hinted,
          call: (input, callOptions) =>
            hinted.call(input, {
              maxRequests: callOptions?.maxRequests ?? perCall,
            }),
        };
  });
};
