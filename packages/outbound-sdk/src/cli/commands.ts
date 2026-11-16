// The CLI's commands. Each takes parsed arguments and returns a JSON value
// to print. The CLI is a thin shell over the SDK: it adds no behaviour.

import {
  campaignStatusSchema,
  replyCategorySchema,
} from "../internal/entities.ts";
import { OutboundError } from "../internal/errors.ts";
import { parseJson, toJson } from "../internal/json.ts";
import type { Json } from "../internal/json.ts";
import type { OutboundApi } from "../internal/outbound/api.ts";
import { providers } from "../providers/index.ts";
import { resolveCampaign } from "../tools/by-name.ts";
import type { ToolResult } from "../tools/index.ts";
import { leftOutReason } from "../tools/registry.ts";
import {
  campaignOption,
  confirmScope,
  listOption,
  searchCampaigns,
} from "./by-name.ts";
import { insightCaps, insightToolCaps } from "./config.ts";
import { Answer, coverageOf, sections } from "./envelope.ts";
import type { Printed } from "./envelope.ts";
import { listedReplies, listing, WINDOW_LIMIT } from "./listing.ts";
import { readNative } from "./native.ts";
import { describeTool, offeredTools, requiresInput } from "./offered.ts";
import { didYouMean } from "./suggest.ts";

export interface CommandInput {
  readonly positionals: readonly string[];
  readonly flags: Readonly<Record<string, string | boolean | undefined>>;
  /** Writes a line for the person to stderr, apart from the JSON on stdout. */
  readonly note: (text: string) => void;
}

type Command = (outbound: OutboundApi, input: CommandInput) => Promise<Printed>;

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
const REPLIES_BY = ["person"] as const;

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
): Promise<Printed> => {
  if (!wantsCard(input)) {
    return asJson(result);
  }

  // Loaded on demand, so the other commands do not pay for the cards.
  const { cardFor, toSlackMessage } = await import("../cards/index.ts");
  const card = cardFor(name, result);

  // The card covers what the result covered.
  return new Answer(
    asJson(input.flags.slack === true ? toSlackMessage(card) : card),
    coverageOf(asJson(result))
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
    ? insightTools(outbound, {
        ...insightToolCaps(input.flags, false),
        only: [name],
      })
    : [];

  return asTool === undefined
    ? asJson(
        await runInsightByName(
          outbound,
          name,
          insightInput,
          insightCaps(input.flags, false)
        )
      )
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
    const hint = didYouMean(stray, [...flags, ...GLOBAL_FLAGS], "--");

    throw new OutboundError(
      "Invalid",
      `--${stray} is not an option of ${name}${hint === "" ? "" : `.${hint}`}`
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
    help: "campaign <id or name> [--stats] [--sequence] [--subsequences] [--settings] [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--by day|total]",
    run: async (outbound, input) => {
      const campaign = outbound.campaign(
        await resolveCampaign(
          outbound,
          required(input, 0, "a campaign id or name")
        )
      );

      const by = choice(input, "by", BY);

      const read: Record<(typeof SECTIONS)[number], () => Promise<Printed>> = {
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
        : sections(answers);
    },
  },
  campaigns: {
    flags: ["limit", "search", "status"],
    help: "campaigns [--status active|paused|draft|completed|archived] [--search TEXT] [--limit N]",
    run: (outbound, input) => {
      const search = text(input, "search");

      return search === undefined
        ? listing(
            outbound.campaigns.listAll({
              max: count(input, "limit", 50),
              status: choice(input, "status", campaignStatusSchema.options),
            }),
            input,
            "campaign"
          )
        : searchCampaigns(outbound, {
            max: count(input, "limit", 50),
            note: input.note,
            search,
            status: choice(input, "status", campaignStatusSchema.options),
          }).then(asJson);
    },
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
    help: "leads [--campaign ID|NAME | --list ID|NAME] [--limit N]",
    run: async (outbound, input) => {
      const scope = {
        campaignId: await campaignOption(outbound, text(input, "campaign")),
        listId: await listOption(outbound, text(input, "list")),
      };

      const walk = outbound.leads.listAll({
        ...scope,
        max: count(input, "limit", 50),
      });

      const answer = await listing(walk, input, "lead");

      await confirmScope(outbound, scope, answer.size);

      return answer;
    },
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
    run: (outbound, input) => {
      const [name] = input.positionals;

      return name === undefined
        ? Promise.resolve(asJson(outbound.native.catalog))
        : readNative(outbound, name, () => parseInput(text(input, "input")));
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
    flags: [
      "bodies",
      "by",
      "campaign",
      "category",
      "include-inbox",
      "limit",
      "since",
    ],
    help: "replies [--campaign ID|NAME] [--category positive|negative|neutral|ooo|...] [--since ISO] [--limit N] [--bodies] [--by person] [--include-inbox]  one record per message; --by person gives one row per person. --limit defaults to 50, or with --since to the whole window up to 2000. --include-inbox adds conversations outside every campaign (HeyReach)",
    run: async (outbound, input) => {
      const by = choice(input, "by", REPLIES_BY);
      const since = text(input, "since");

      // A time window means all of it, up to a ceiling, unless --limit says otherwise.
      const windowed =
        since !== undefined && text(input, "limit") === undefined;

      const walk = outbound.replies.listAll({
        campaignId: await campaignOption(outbound, text(input, "campaign")),
        category: choice(input, "category", replyCategorySchema.options),
        include: input.flags.bodies === true ? ["body"] : undefined,
        includeInbox: input.flags["include-inbox"] === true || undefined,
        max: count(input, "limit", windowed ? WINDOW_LIMIT : 50),
        since,
      });

      return listedReplies(walk, input, by === "person", windowed);
    },
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
    run: async (outbound, input) => {
      const id = required(input, 0, "a thread id");

      const thread = await outbound.thread(id).messages({
        include: input.flags.bodies === true ? ["body"] : undefined,
      });

      // An unknown thread fails as an unknown campaign does.
      if (thread.items.length === 0) {
        throw new OutboundError(
          "NotFound",
          `No thread ${id}, or it has no messages`
        );
      }

      // A list like every other: the messages, and whether there are more.
      return new Answer(
        asJson(thread.items),
        coverageOf(
          asJson({ meta: { ...thread.meta, complete: thread.complete } })
        ),
        true
      );
    },
  },
  tool: {
    flags: ["card", "input", "slack"],
    help: "tool <name> [--input JSON] [--card | --slack]  without --input, a tool that needs input fails with what it takes (exit 2)",
    run: async (outbound, input) => {
      const name = required(input, 0, "a tool name");

      const offered = await offeredTools(outbound, input.flags);
      const tool = offered.find((candidate) => candidate.name === name);

      if (tool === undefined) {
        const { insightLeftOutReason } = await import("../insights/tools.ts");

        // A tool this instance cannot serve is refused with the reason, as
        // running the insight would be, not called unknown.
        const why =
          leftOutReason(outbound, name) ?? insightLeftOutReason(outbound, name);

        if (why !== undefined) {
          throw new OutboundError("Unsupported", why, {
            provider: outbound.provider,
          });
        }

        throw new OutboundError(
          "Invalid",
          `Unknown tool "${name}".${didYouMean(
            name,
            offered.map((each) => each.name)
          )} Run "outbound tools" to list them`
        );
      }

      const given = text(input, "input");

      // Nothing to run on: a failure a script can tell from an answer, with
      // what the tool takes as its data.
      if (given === undefined && requiresInput(tool)) {
        return {
          data: describeTool(tool),
          error: {
            code: "InputRequired",
            message: `${name} needs --input. data.parameters lists what it takes`,
            retryable: false,
          },
          next: `Run outbound tool ${name} --input '<JSON>' with the inputs data.parameters lists.`,
          ok: false,
        };
      }

      return drawn(name, await tool.call(parseInput(given)), input);
    },
  },
  tools: {
    flags: [],
    help: "tools",
    run: async (outbound, input) => {
      const offered = await offeredTools(outbound, input.flags);

      return offered.map(describeTool);
    },
  },
  webhooks: {
    flags: ["campaign", "limit"],
    help: "webhooks [--campaign ID|NAME] [--limit N]",
    run: async (outbound, input) =>
      listing(
        outbound.webhooks.listAll({
          campaignId: await campaignOption(outbound, text(input, "campaign")),
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
