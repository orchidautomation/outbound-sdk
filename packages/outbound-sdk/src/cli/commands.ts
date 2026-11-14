// The CLI's commands. Each takes parsed arguments and returns a JSON value
// to print. The CLI is a thin shell over the SDK: it adds no behaviour.

import {
  campaignStatusSchema,
  replyCategorySchema,
} from "../internal/entities.ts";
import { OutboundError } from "../internal/errors.ts";
import { isJsonObject, parseJson, toJson } from "../internal/json.ts";
import type { Json } from "../internal/json.ts";
import type { OutboundApi } from "../internal/outbound/api.ts";
import { providers } from "../providers/index.ts";
import { createTools } from "../tools/index.ts";

export interface CommandInput {
  readonly positionals: readonly string[];
  readonly flags: Readonly<Record<string, string | boolean | undefined>>;
}

type Command = (outbound: OutboundApi, input: CommandInput) => Promise<Json>;

const text = (input: CommandInput, name: string): string | undefined => {
  const value = input.flags[name];

  return value === undefined || value === true || value === false
    ? undefined
    : value;
};

const count = (input: CommandInput, name: string, fallback: number): number => {
  const value = text(input, name);
  const parsed = value === undefined ? fallback : Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new OutboundError(
      "Invalid",
      `--${name} must be a positive whole number`
    );
  }

  return parsed;
};

const parseInput = (source: string | undefined): Json => {
  const parsed = source === undefined ? {} : parseJson(source);

  if (parsed === undefined) {
    throw new OutboundError("Invalid", "--input must be valid JSON");
  }

  return parsed;
};

const required = (input: CommandInput, index: number, what: string): string => {
  const value = input.positionals[index];

  if (value === undefined) {
    throw new OutboundError("Invalid", `Missing ${what}`);
  }

  return value;
};

const asJson = toJson;

const listing = async <Item>(walk: {
  readonly toArray: () => Promise<Item[]>;
}): Promise<Json> => asJson(await walk.toArray());

export interface CommandSpec {
  readonly help: string;
  readonly run: Command;
}

const COMMAND_TABLE = {
  blocklist: {
    help: "blocklist [--limit N]",
    run: (outbound, input) =>
      listing(outbound.blocklist.listAll({ max: count(input, "limit", 50) })),
  },
  campaign: {
    help: "campaign <id> [--stats] [--sequence] [--subsequences] [--settings] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--by day]",
    run: async (outbound, input) => {
      const campaign = outbound.campaign(required(input, 0, "a campaign id"));

      if (input.flags.sequence === true) {
        return asJson(await campaign.sequence());
      }

      if (input.flags.subsequences === true) {
        return await listing(campaign.subsequences.listAll());
      }

      if (input.flags.settings === true) {
        return asJson(await campaign.settings());
      }

      if (input.flags.stats === true) {
        return asJson(
          await campaign.stats({
            by: text(input, "by") === "day" ? "day" : "total",
            from: text(input, "from"),
            to: text(input, "to"),
          })
        );
      }

      return asJson(await campaign.get());
    },
  },
  campaigns: {
    help: "campaigns [--status active|paused|draft|completed|archived] [--limit N]",
    run: (outbound, input) => {
      const status = text(input, "status");

      return listing(
        outbound.campaigns.listAll({
          max: count(input, "limit", 50),
          status:
            status === undefined
              ? undefined
              : campaignStatusSchema.parse(status),
        })
      );
    },
  },
  capabilities: {
    help: "capabilities",
    run: (outbound) =>
      Promise.resolve({
        capabilities: { ...outbound.capabilities },
        caveats: [...outbound.caveats],
        maturity: outbound.maturity,
        provider: outbound.provider,
        workspaceId: outbound.workspaceId,
      }),
  },
  health: {
    help: "health <sender id>",
    run: async (outbound, input) =>
      asJson(await outbound.sender(required(input, 0, "a sender id")).health()),
  },
  insight: {
    help: "insight [name] [--input JSON]  computed answers; no name lists them",
    run: async (outbound, input) => {
      // Loaded on demand, so the other commands do not pay for the insights.
      const { listInsights, runInsightByName } =
        await import("../insights/index.ts");

      const [name] = input.positionals;

      return name === undefined
        ? asJson(listInsights())
        : asJson(
            await runInsightByName(
              outbound,
              name,
              parseInput(text(input, "input"))
            )
          );
    },
  },
  leads: {
    help: "leads [--campaign ID | --list ID] [--limit N]",
    run: (outbound, input) =>
      listing(
        outbound.leads.listAll({
          campaignId: text(input, "campaign"),
          listId: text(input, "list"),
          max: count(input, "limit", 50),
        })
      ),
  },
  lists: {
    help: "lists [--limit N]",
    run: (outbound, input) =>
      listing(outbound.lists.listAll({ max: count(input, "limit", 50) })),
  },
  limits: {
    help: "limits",
    run: async (outbound) => asJson(await outbound.limits()),
  },
  native: {
    help: "native [name] [--input JSON]   the vendor's own reads; no name lists them",
    run: async (outbound, input) => {
      const [name] = input.positionals;

      if (name === undefined) {
        return asJson(outbound.native.catalog);
      }

      const params = parseInput(text(input, "input"));

      if (!isJsonObject(params)) {
        throw new OutboundError("Invalid", "--input must be a JSON object");
      }

      return asJson(await outbound.native.read(name, params));
    },
  },
  replies: {
    help: "replies [--campaign ID] [--category positive|negative|neutral|ooo|...] [--since ISO] [--limit N] [--bodies]",
    run: (outbound, input) => {
      const category = text(input, "category");

      return listing(
        outbound.replies.listAll({
          campaignId: text(input, "campaign"),
          category:
            category === undefined
              ? undefined
              : replyCategorySchema.parse(category),
          include: input.flags.bodies === true ? ["body"] : undefined,
          max: count(input, "limit", 50),
          since: text(input, "since"),
        })
      );
    },
  },
  senders: {
    help: "senders [--limit N]",
    run: (outbound, input) =>
      listing(outbound.senders.listAll({ max: count(input, "limit", 50) })),
  },
  stats: {
    help: "stats [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--by day]",
    run: async (outbound, input) =>
      asJson(
        await outbound.stats({
          by: text(input, "by") === "day" ? "day" : "total",
          from: text(input, "from"),
          to: text(input, "to"),
        })
      ),
  },
  tags: {
    help: "tags [--limit N]",
    run: (outbound, input) =>
      listing(outbound.tags.listAll({ max: count(input, "limit", 50) })),
  },
  thread: {
    help: "thread <id> [--bodies]",
    run: async (outbound, input) =>
      asJson(
        await outbound.thread(required(input, 0, "a thread id")).messages({
          include: input.flags.bodies === true ? ["body"] : undefined,
        })
      ),
  },
  tool: {
    help: "tool <name> [--input JSON]",
    run: async (outbound, input) => {
      const name = required(input, 0, "a tool name");

      const tool = createTools(outbound).find(
        (candidate) => candidate.name === name
      );

      if (tool === undefined) {
        throw new OutboundError(
          "Invalid",
          `Unknown tool "${name}". Run "outbound tools" to list them`
        );
      }

      return asJson(await tool.call(parseInput(text(input, "input"))));
    },
  },
  tools: {
    help: "tools",
    run: (outbound) =>
      Promise.resolve(
        createTools(outbound).map((tool) => ({
          description: tool.description,
          name: tool.name,
        }))
      ),
  },
  webhooks: {
    help: "webhooks [--campaign ID] [--limit N]",
    run: (outbound, input) =>
      listing(
        outbound.webhooks.listAll({
          campaignId: text(input, "campaign"),
          max: count(input, "limit", 50),
        })
      ),
  },
} satisfies Record<string, CommandSpec>;

export const COMMANDS = new Map<string, CommandSpec>(
  Object.entries(COMMAND_TABLE)
);

/** The provider catalog. Needs no adapter and no key. */
export const listProviders = (): Json =>
  providers.map((provider) => ({
    channels: [...provider.channels],
    envVars: provider.envVars.map((variable) => ({
      name: variable.name,
      required: variable.required,
    })),
    id: provider.id,
    maturity: provider.maturity,
    name: provider.name,
  }));

export const helpText = (): string =>
  [
    "outbound: read-only access to outbound sending tools",
    "",
    "Usage: outbound <command> [options]",
    "",
    "  providers",
    ...[...COMMANDS.values()].map((command) => `  ${command.help}`),
    "  mcp                      start a local MCP server on stdio",
    "",
    "Options:",
    "  --provider <id>          the adapter to use (default: OUTBOUND_SDK_PROVIDER)",
    "  --compact                print JSON on one line",
    "",
    "Each adapter reads its own key from the environment, for example INSTANTLY_API_KEY.",
  ].join("\n");
