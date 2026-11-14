import { z } from "zod";

import { OutboundError } from "../internal/errors.ts";
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
  /** Validates the input and runs the tool. Never throws: a failure is a result. */
  readonly call: (input: Json) => Promise<ToolResult>;
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
  call: async (input) => {
    const parsed = definition.inputSchema.safeParse(input ?? {});

    if (!parsed.success) {
      const [issue] = parsed.error.issues;

      return failure(
        new OutboundError(
          "Invalid",
          `${definition.name}: ${issue?.path.join(".") ?? "input"} ${issue?.message ?? "is invalid"}`
        )
      );
    }

    try {
      return await definition.run(outbound, parsed.data);
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
}

/**
 * The tool set for one instance. A tool that needs a plugin the instance does
 * not have is left out, so a model is never offered a tool that cannot work.
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
  const available = new Map([
    ["clients", "clients" in outbound],
    ["identity", "person" in outbound],
    // Offered only when the vendor has reads of its own and no plugin turned them off.
    [
      "native",
      outbound.capabilities.native &&
        Object.keys(outbound.native.catalog).length > 0,
    ],
  ]);

  return all.filter(
    (tool) =>
      (wanted === undefined || wanted.has(tool.name)) &&
      tool.needs.every((need) => available.get(need) ?? false)
  );
};
