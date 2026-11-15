import { z } from "zod";

import type { CapabilityKey } from "../internal/capabilities.ts";
import { OutboundError } from "../internal/errors.ts";
import { jsonInput, unknownKey } from "../internal/json.ts";
import type { Json } from "../internal/json.ts";
import type { OutboundApi } from "../internal/outbound/api.ts";
import {
  audienceLists,
  campaignSetup,
  deliverabilityCheck,
  vendorRead,
} from "./account-tools.ts";
import {
  campaignOverview,
  campaignTrend,
  replySamples,
  senderHealth,
  winningSteps,
} from "./campaign-tools.ts";
import { inputProblem } from "./input-problem.ts";
import {
  compareClients,
  crossChannelLead,
  leadRunway,
} from "./people-tools.ts";
import { failure } from "./shared.ts";
import type { ToolResult } from "./shared.ts";

/** The fields of a tool's input object, each a Zod schema. */
export type InputFields = z.ZodObject["shape"];

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
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- the input is parsed by the tool's own schema inside call()
  readonly call: (input: unknown) => Promise<ToolResult>;
}

interface Definition<Input> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.ZodObject & z.ZodType<Input>;
  readonly needs: readonly string[];
  readonly run: (outbound: OutboundApi, input: Input) => Promise<ToolResult>;
}

const bind = <Input>(
  outbound: OutboundApi,
  definition: Definition<Input>
): OutboundTool => ({
  call: async (given) => {
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

    try {
      const result = await definition.run(outbound, parsed.data);

      return result.ok
        ? {
            ...result,
            meta: {
              ...result.meta,
              today: new Date().toISOString().slice(0, 10),
            },
          }
        : result;
    } catch (error) {
      return failure(error);
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
        call: async (input) => {
          const result = await tool.call(input);

          return hidden.some((name) => result.next.includes(name))
            ? { ...result, next: NEXT_FALLBACK }
            : result;
        },
      };
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

  // The clients plugin adds `clients`; the identity plugin adds `person`.
  const added = new Map([
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

  const { capabilities } = outbound;

  const isCapability = (need: string): need is CapabilityKey =>
    Object.hasOwn(capabilities, need);

  // Anything else a tool needs is a capability key. An unknown name is unmet.
  const met = (need: string): boolean =>
    added.get(need) ?? (isCapability(need) && capabilities[need] !== false);

  const offered = [
    ...all.filter(
      (tool) =>
        (wanted === undefined || wanted.has(tool.name)) && tool.needs.every(met)
    ),
    ...(options.extra ?? []),
  ];

  const names = new Set(offered.map((tool) => tool.name));

  return offered.map((tool) => withOfferedHints(tool, names));
};
