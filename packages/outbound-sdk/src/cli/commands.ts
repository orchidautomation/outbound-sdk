// The CLI's commands. Each takes parsed arguments and returns a JSON value
// to print. The CLI is a thin shell over the SDK: it adds no behaviour.

import {
  campaignStatusSchema,
  replyCategorySchema,
} from "../internal/entities.ts";
import { OutboundError } from "../internal/errors.ts";
import { isJsonObject, parseJson, toJson } from "../internal/json.ts";
import type { Json } from "../internal/json.ts";
import { plural } from "../internal/numbers.ts";
import type { ListAll, OutboundApi } from "../internal/outbound/api.ts";
import { providers } from "../providers/index.ts";
import { createTools } from "../tools/index.ts";
import type { OutboundTool, ToolResult } from "../tools/index.ts";

export interface CommandInput {
  readonly positionals: readonly string[];
  readonly flags: Readonly<Record<string, string | boolean | undefined>>;
  /** Writes a line for the person to stderr, apart from the JSON on stdout. */
  readonly note: (text: string) => void;
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

/** A flag that takes one of a fixed set of words. Anything else is refused, never guessed. */
const choice = <Value extends string>(
  input: CommandInput,
  name: string,
  allowed: readonly Value[]
): Value | undefined => {
  const value = text(input, name);
  const match = allowed.find((candidate) => candidate === value);

  if (value !== undefined && match === undefined) {
    throw new OutboundError(
      "Invalid",
      `--${name} must be one of: ${allowed.join(", ")}`
    );
  }

  return match;
};

const BY = ["day", "total"] as const;

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

// Only what is not read straight from the vendor: the fields the adapter
// derives, and the ones it never fills (`false`). Most fields are neither.
const fieldExceptions = (outbound: OutboundApi): Json =>
  Object.fromEntries(
    Object.entries(outbound.fields).flatMap(([record, grades]) => {
      const stated = Object.entries(grades).filter(
        ([, grade]) => grade !== "exact"
      );

      return stated.length === 0 ? [] : [[record, Object.fromEntries(stated)]];
    })
  );

/**
 * Every record of a walk. When `--limit` stopped it while more exist, a note
 * on stderr says so; stdout stays the JSON. `one` and `many` name a record.
 */
const listing = async <Item>(
  walk: ListAll<Item>,
  input: CommandInput,
  one: string,
  many?: string
): Promise<Json> => {
  const items = await walk.toArray();

  if (walk.truncated) {
    input.note(
      `Stopped at ${plural(items.length, one, many)}; more exist. Pass --limit to read more.`
    );
  }

  return asJson(items);
};

const wantsCard = (input: CommandInput): boolean =>
  input.flags.slack === true || input.flags.card === true;

/**
 * A tool result as it should be printed: itself, or with `--card` its card,
 * or with `--slack` that card as a Slack message, ready to post.
 */
const drawn = async (
  name: string,
  result: ToolResult,
  input: CommandInput
): Promise<Json> => {
  if (!wantsCard(input)) {
    return asJson(result);
  }

  // Loaded on demand, so the other commands do not pay for the cards.
  const { cardFor, toSlackMessage } = await import("../cards/index.ts");
  const card = cardFor(name, result);

  return asJson(input.flags.slack === true ? toSlackMessage(card) : card);
};

/** The tools `outbound mcp` offers: the built-in ones, then the insights. */
export const offeredTools = async (
  outbound: OutboundApi
): Promise<OutboundTool[]> => {
  // Loaded on demand, so the other commands do not pay for the insights.
  const { insightTools } = await import("../insights/index.ts");

  return createTools(outbound, { extra: insightTools(outbound) });
};

/** A tool as `outbound tools` lists it: its inputs as JSON Schema, as `outbound insight` lists them. */
const describeTool = (tool: OutboundTool): Json => ({
  description: tool.description,
  name: tool.name,
  parameters: tool.parameters,
});

/** Whether the tool has an input with no default, so it cannot run on none. */
const requiresInput = (tool: OutboundTool): boolean => {
  const { parameters } = tool;

  return (
    isJsonObject(parameters) &&
    Array.isArray(parameters.required) &&
    parameters.required.length > 0
  );
};

/** Lists the insights, or runs the one the first argument names. */
const runInsight: Command = async (outbound, input) => {
  // Loaded on demand, so the other commands do not pay for the insights.
  const { insightTools, listInsights, runInsightByName } =
    await import("../insights/index.ts");

  const [name] = input.positionals;

  if (name === undefined) {
    return asJson(listInsights());
  }

  const insightInput = parseInput(text(input, "input"));

  // A card is drawn from the tool form of the answer.
  const [asTool] = wantsCard(input)
    ? insightTools(outbound, { only: [name] })
    : [];

  return asTool === undefined
    ? asJson(await runInsightByName(outbound, name, insightInput))
    : drawn(name, await asTool.call(insightInput), input);
};

export interface CommandSpec {
  readonly help: string;
  /** The options this command takes, besides the ones every command takes. */
  readonly flags: readonly string[];
  readonly run: Command;
}

/** The options every command takes. */
export const GLOBAL_FLAGS = [
  "cache",
  "compact",
  "config",
  "help",
  "max-requests",
  "no-redact",
  "provider",
  "raw",
  "redact",
];

/** Refuses an option the command does not take, instead of ignoring it. */
export const checkFlags = (
  name: string,
  flags: readonly string[],
  given: readonly string[]
): void => {
  const stray = given.find(
    (flag) => !GLOBAL_FLAGS.includes(flag) && !flags.includes(flag)
  );

  if (stray !== undefined) {
    throw new OutboundError(
      "Invalid",
      `--${stray} is not an option of ${name}`
    );
  }
};

// `campaign <id>` reads one section per flag. Two or more print together,
// keyed by section.
const SECTIONS = ["sequence", "settings", "stats", "subsequences"] as const;

const COMMAND_TABLE = {
  blocklist: {
    flags: ["limit"],
    help: "blocklist [--limit N]",
    run: (outbound, input) =>
      listing(
        outbound.blocklist.listAll({ max: count(input, "limit", 50) }),
        input,
        "entry",
        "entries"
      ),
  },
  campaign: {
    flags: [
      "by",
      "from",
      "sequence",
      "settings",
      "stats",
      "subsequences",
      "to",
    ],
    help: "campaign <id> [--stats] [--sequence] [--subsequences] [--settings] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--by day|total]",
    run: async (outbound, input) => {
      const campaign = outbound.campaign(required(input, 0, "a campaign id"));
      const by = choice(input, "by", BY);

      const read = {
        sequence: async () => asJson(await campaign.sequence()),
        settings: async () => asJson(await campaign.settings()),
        stats: async () =>
          asJson(
            await campaign.stats({
              by,
              from: text(input, "from"),
              to: text(input, "to"),
            })
          ),
        subsequences: () =>
          listing(campaign.subsequences.listAll(), input, "subsequence"),
      };

      const wanted = SECTIONS.filter(
        (section) => input.flags[section] === true
      );

      if (wanted.length === 0) {
        return asJson(await campaign.get());
      }

      const answers = await Promise.all(
        wanted.map(async (section) => [section, await read[section]()] as const)
      );

      return answers.length === 1
        ? (answers[0]?.[1] ?? null)
        : Object.fromEntries(answers);
    },
  },
  campaigns: {
    flags: ["limit", "status"],
    help: "campaigns [--status active|paused|draft|completed|archived] [--limit N]",
    run: (outbound, input) =>
      listing(
        outbound.campaigns.listAll({
          max: count(input, "limit", 50),
          status: choice(input, "status", campaignStatusSchema.options),
        }),
        input,
        "campaign"
      ),
  },
  capabilities: {
    flags: [],
    help: "capabilities",
    run: (outbound) =>
      Promise.resolve({
        capabilities: { ...outbound.capabilities },
        caveats: [...outbound.caveats],
        fields: fieldExceptions(outbound),
        maturity: outbound.maturity,
        provider: outbound.provider,
        workspaceId: outbound.workspaceId,
      }),
  },
  health: {
    flags: [],
    help: "health <sender id>",
    run: async (outbound, input) =>
      asJson(await outbound.sender(required(input, 0, "a sender id")).health()),
  },
  insight: {
    flags: ["card", "input", "slack"],
    help: "insight [name] [--input JSON] [--card | --slack]  computed answers; no name lists them",
    run: runInsight,
  },
  leads: {
    flags: ["campaign", "limit", "list"],
    help: "leads [--campaign ID | --list ID] [--limit N]",
    run: (outbound, input) =>
      listing(
        outbound.leads.listAll({
          campaignId: text(input, "campaign"),
          listId: text(input, "list"),
          max: count(input, "limit", 50),
        }),
        input,
        "lead"
      ),
  },
  lists: {
    flags: ["limit"],
    help: "lists [--limit N]",
    run: (outbound, input) =>
      listing(
        outbound.lists.listAll({ max: count(input, "limit", 50) }),
        input,
        "list"
      ),
  },
  limits: {
    flags: [],
    help: "limits",
    run: async (outbound) => asJson(await outbound.limits()),
  },
  native: {
    flags: ["input"],
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
  person: {
    flags: ["card", "limit", "slack"],
    help: "person <email or LinkedIn URL> [--limit N] [--card | --slack]  one person's campaigns across every tool",
    // The person_summary insight, with its input taken from the arguments.
    run: (outbound, input) =>
      runInsight(outbound, {
        ...input,
        flags: {
          ...input.flags,
          input: JSON.stringify({
            max_campaigns: count(input, "limit", 20),
            person: required(input, 0, "an email address or a LinkedIn URL"),
          }),
        },
        positionals: ["person_summary"],
      }),
  },
  replies: {
    flags: ["bodies", "campaign", "category", "limit", "since"],
    help: "replies [--campaign ID] [--category positive|negative|neutral|ooo|...] [--since ISO] [--limit N] [--bodies]",
    run: (outbound, input) =>
      listing(
        outbound.replies.listAll({
          campaignId: text(input, "campaign"),
          category: choice(input, "category", replyCategorySchema.options),
          include: input.flags.bodies === true ? ["body"] : undefined,
          max: count(input, "limit", 50),
          since: text(input, "since"),
        }),
        input,
        "reply",
        "replies"
      ),
  },
  senders: {
    flags: ["limit"],
    help: "senders [--limit N]",
    run: (outbound, input) =>
      listing(
        outbound.senders.listAll({ max: count(input, "limit", 50) }),
        input,
        "sender"
      ),
  },
  stats: {
    flags: ["by", "from", "to"],
    help: "stats [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--by day|total]",
    run: async (outbound, input) =>
      asJson(
        await outbound.stats({
          by: choice(input, "by", BY),
          from: text(input, "from"),
          to: text(input, "to"),
        })
      ),
  },
  tags: {
    flags: ["limit"],
    help: "tags [--limit N]",
    run: (outbound, input) =>
      listing(
        outbound.tags.listAll({ max: count(input, "limit", 50) }),
        input,
        "tag"
      ),
  },
  thread: {
    flags: ["bodies"],
    help: "thread <id> [--bodies]",
    run: async (outbound, input) =>
      asJson(
        await outbound.thread(required(input, 0, "a thread id")).messages({
          include: input.flags.bodies === true ? ["body"] : undefined,
        })
      ),
  },
  tool: {
    flags: ["card", "input", "slack"],
    help: "tool <name> [--input JSON] [--card | --slack]  without --input, a tool that needs input prints what it takes",
    run: async (outbound, input) => {
      const name = required(input, 0, "a tool name");

      const offered = await offeredTools(outbound);
      const tool = offered.find((candidate) => candidate.name === name);

      if (tool === undefined) {
        throw new OutboundError(
          "Invalid",
          `Unknown tool "${name}". Run "outbound tools" to list them`
        );
      }

      const given = text(input, "input");

      // Nothing to run on: say what the tool takes instead of failing on it.
      if (given === undefined && requiresInput(tool)) {
        return describeTool(tool);
      }

      return drawn(name, await tool.call(parseInput(given)), input);
    },
  },
  tools: {
    flags: [],
    help: "tools",
    run: async (outbound) => {
      const offered = await offeredTools(outbound);

      return offered.map(describeTool);
    },
  },
  webhooks: {
    flags: ["campaign", "limit"],
    help: "webhooks [--campaign ID] [--limit N]",
    run: (outbound, input) =>
      listing(
        outbound.webhooks.listAll({
          campaignId: text(input, "campaign"),
          max: count(input, "limit", 50),
        }),
        input,
        "webhook"
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
    note: provider.note,
  }));

const GLOBAL_HELP = [
  "Options:",
  "  --provider <id>          the adapter to use, or all for every provider whose key is set (default: OUTBOUND_SDK_PROVIDER)",
  "  --compact                print JSON on one line",
  "  --raw                    keep each record's raw vendor payload (left out by default)",
  "  --config <file>          load plugins from a file whose default export is defineConfig({ plugins })",
  "  --redact                 mask personal fields (on by default for mcp)",
  "  --no-redact              do not mask personal fields, even for mcp",
  "  --cache <seconds>        reuse an answer for this long",
  "  --max-requests <n>       the most vendor requests one command, or one MCP tool call, may make",
  "",
  "Each adapter reads its own key from the environment, for example INSTANTLY_API_KEY.",
];

/** Every command with its options, then the options every command takes. */
export const helpText = (): string =>
  [
    "outbound: read-only access to outbound sending tools",
    "",
    "Usage: outbound <command> [options]",
    "",
    "  providers",
    ...[...COMMANDS.values()].map((command) => `  ${command.help}`),
    "  mcp                      start a local MCP server on stdio (redact is on)",
    "  version                  print the installed version (also --version, -v)",
    "  update                   check npm for a newer version and say how to get it",
    "",
    ...GLOBAL_HELP,
  ].join("\n");

/** One command's options, then the options every command takes. */
export const commandHelp = (command: CommandSpec): string =>
  [`Usage: outbound ${command.help}`, "", ...GLOBAL_HELP].join("\n");
