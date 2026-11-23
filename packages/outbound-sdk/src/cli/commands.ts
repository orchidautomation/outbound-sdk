// The CLI's commands. Each takes parsed arguments and returns a JSON value
// to print. The CLI is a thin shell over the SDK: it adds no behaviour.

import {
  campaignStatusSchema,
  replyCategorySchema,
} from "../internal/entities.ts";
import { OutboundError } from "../internal/errors.ts";
import { toJson } from "../internal/json.ts";
import type { Json } from "../internal/json.ts";
import type { OutboundApi } from "../internal/outbound/api.ts";
import { providers } from "../providers/index.ts";
import { resolveCampaign } from "../tools/by-name.ts";
import {
  campaignOption,
  confirmScope,
  listOption,
  searchCampaigns,
} from "./by-name.ts";
import { insightCaps, insightToolCaps } from "./config.ts";
import { drawn, wantsCard } from "./drawn.ts";
import { Answer, coverageOf, sections } from "./envelope.ts";
import type { Printed } from "./envelope.ts";
import {
  BY,
  choice,
  clientFiltered,
  count,
  dayFlag,
  instantFlag,
  insightInputOf,
  parseInput,
  REPLIES_BY,
  required,
  STATS_SCOPES,
  text,
  walkOptions,
} from "./inputs.ts";
import type { CommandInput } from "./inputs.ts";
import {
  listedReplies,
  listing,
  WINDOW_LIMIT,
  WINDOW_STOP,
  withNotes,
} from "./listing.ts";
import { readNative } from "./native.ts";
import {
  describeTool,
  listedInsights,
  listedTool,
  listedTools,
  listedWith,
  offeredTools,
  refuseLeftOut,
  requiresInput,
} from "./offered.ts";
import { didYouMean } from "./suggest.ts";

type Command = (outbound: OutboundApi, input: CommandInput) => Promise<Printed>;

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

/** The catalog's left-out reasons, as notes on a list of what is offered. */
/**
 * Lists the insights this instance offers, from the catalog every surface
 * reads, or runs the one the first argument names.
 */
const runInsight: Command = async (outbound, input) => {
  // Loaded on demand, so the other commands do not pay for the insights.
  const { insightTools } = await import("../insights/index.ts");
  const { runPlaced } = await import("../insights/tools.ts");

  const offered = await offeredTools(outbound, input.flags);
  const [name] = input.positionals;

  if (name === undefined) {
    return await listedInsights(offered);
  }

  refuseLeftOut(outbound, offered, name);

  const insightInput = insightInputOf(input);

  // A card is drawn from the tool form of the answer.
  const [asTool] = wantsCard(input)
    ? insightTools(outbound, {
        ...insightToolCaps(input.flags, false),
        members: offered.members,
        only: [name],
      })
    : [];

  return asTool === undefined
    ? asJson(
        await runPlaced(
          outbound,
          name,
          insightInput,
          offered.members,
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
    flags: ["cursor", "jsonl", "limit"],
    help: "blocklist [--limit N] [--cursor C] [--jsonl]",
    run: (outbound, input) =>
      listing(
        outbound.blocklist.listAll(walkOptions(input)),
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
    help: "campaign <id or name> [--stats] [--sequence] [--subsequences] [--settings] [--from DATE] [--to DATE] [--by day|total]",
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
              from: dayFlag(input, "from"),
              to: dayFlag(input, "to"),
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
    flags: ["cursor", "jsonl", "limit", "search", "status"],
    help: "campaigns [--status active|paused|draft|completed|archived] [--search TEXT] [--limit N] [--cursor C] [--jsonl]",
    run: (outbound, input) => {
      const search = text(input, "search");

      if (search !== undefined && text(input, "cursor") !== undefined) {
        throw new OutboundError(
          "Invalid",
          "--cursor resumes a listing; --search reads every campaign, so it takes none"
        );
      }

      const status = choice(input, "status", campaignStatusSchema.options);

      return search === undefined
        ? listing(
            outbound.campaigns.listAll({
              ...walkOptions(
                input,
                50,
                status !== undefined &&
                  outbound.capabilities["campaigns.status"] === "client"
              ),
              status,
            }),
            input,
            "campaign"
          )
        : searchCampaigns(outbound, {
            max: count(input, "limit", 50),
            note: input.note,
            search,
            status: choice(input, "status", campaignStatusSchema.options),
          }).then(
            (found) =>
              new Answer(asJson(found), { complete: true, notes: [] }, true)
          );
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
    flags: [
      "campaign-ids",
      "campaign-name",
      "card",
      "input",
      "slack",
      "slack-text",
      "tag",
    ],
    help: "insight [name] [--input JSON] [--campaign-ids ID,ID] [--tag TAG] [--campaign-name NAME|GLOB|/REGEX/] [--card | --slack-text | --slack]  computed answers; no name lists them. The campaign flags read only the campaigns matching every one given. --card prints the answer as text, --slack-text as Slack mrkdwn to paste, --slack as a Slack message's JSON",
    run: runInsight,
  },
  leads: {
    flags: ["campaign", "cursor", "jsonl", "limit", "list", "since"],
    help: "leads [--campaign ID|NAME | --list ID|NAME] [--since DATE] [--limit N] [--cursor C] [--jsonl]  --since keeps the leads created since then (a lead updated later is not); with --since, --limit defaults to the whole window up to 2000",
    run: async (outbound, input) => {
      const since = instantFlag(input, "since");

      const windowed =
        since !== undefined && text(input, "limit") === undefined;

      const scope = {
        campaignId: await campaignOption(outbound, text(input, "campaign")),
        listId: await listOption(outbound, text(input, "list")),
      };

      const filtered = clientFiltered(
        outbound,
        "leads.since",
        text(input, "since"),
        input
      );

      const walk = outbound.leads.listAll({
        ...scope,
        ...walkOptions(
          input,
          windowed ? WINDOW_LIMIT : 50,
          filtered.length > 0
        ),
        since,
      });

      const answer = await listing(
        walk,
        input,
        "lead",
        undefined,
        windowed ? WINDOW_STOP : undefined
      );

      await confirmScope(outbound, scope, answer.walked.records ?? 0);

      return withNotes(answer, filtered);
    },
  },
  lists: {
    flags: ["cursor", "jsonl", "limit"],
    help: "lists [--limit N] [--cursor C] [--jsonl]",
    run: (outbound, input) =>
      listing(outbound.lists.listAll(walkOptions(input)), input, "list"),
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
    flags: ["card", "limit", "slack", "slack-text"],
    help: "person <email, LinkedIn URL or lead ref> [--limit N] [--card | --slack-text | --slack]  one person's campaigns across every tool; a lead ref is taken as another command printed it",
    // The person_summary insight, with its input taken from the arguments.
    run: (outbound, input) =>
      runInsight(outbound, {
        ...input,
        flags: {
          ...input.flags,
          input: JSON.stringify({
            max_campaigns: count(input, "limit", 20),
            person: required(
              input,
              0,
              "an email address, a LinkedIn URL or a lead ref"
            ),
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
      "cursor",
      "include-inbox",
      "jsonl",
      "limit",
      "since",
    ],
    help: "replies [--campaign ID|NAME] [--category positive|negative|neutral|ooo|...] [--since DATE] [--limit N] [--cursor C] [--jsonl] [--bodies] [--by person] [--include-inbox]  one record per message; --by person gives one row per person. --since keeps the replies received since then; --limit defaults to 50, or with --since to the whole window up to 2000. --include-inbox adds conversations outside every campaign (HeyReach)",
    run: async (outbound, input) => {
      const by = choice(input, "by", REPLIES_BY);
      const since = instantFlag(input, "since");

      // A time window means all of it, up to a ceiling, unless --limit says otherwise.
      const windowed =
        since !== undefined && text(input, "limit") === undefined;

      const filtered = clientFiltered(
        outbound,
        "replies.since",
        text(input, "since"),
        input
      );

      const walk = outbound.replies.listAll({
        campaignId: await campaignOption(outbound, text(input, "campaign")),
        category: choice(input, "category", replyCategorySchema.options),
        include: input.flags.bodies === true ? ["body"] : undefined,
        includeInbox: input.flags["include-inbox"] === true || undefined,
        ...walkOptions(
          input,
          windowed ? WINDOW_LIMIT : 50,
          filtered.length > 0
        ),
        since,
      });

      return withNotes(
        await listedReplies(walk, input, by === "person", windowed),
        filtered
      );
    },
  },
  senders: {
    flags: ["cursor", "jsonl", "limit"],
    help: "senders [--limit N] [--cursor C] [--jsonl]",
    run: (outbound, input) =>
      listing(outbound.senders.listAll(walkOptions(input)), input, "sender"),
  },
  stats: {
    flags: ["by", "from", "jsonl", "scope", "sender", "to"],
    help: "stats [--scope workspace|campaign|sender] [--sender ID] [--from DATE] [--to DATE] [--by day|total] [--jsonl]  --scope campaign gives a row per campaign and --scope sender a row per sender, every sender read in batches where the tool allows; --sender reads one sender",
    run: async (outbound, input) => {
      const sender = text(input, "sender");
      const scope = choice(input, "scope", STATS_SCOPES);

      if (sender !== undefined && scope !== undefined && scope !== "sender") {
        throw new OutboundError(
          "Invalid",
          `--sender reads the sender scope, not --scope ${scope}`
        );
      }

      const result = await outbound.stats({
        by: choice(input, "by", BY),
        from: dayFlag(input, "from"),
        scope: sender === undefined ? scope : "sender",
        scopeId: sender,
        to: dayFlag(input, "to"),
      });

      // A row per line, so a load reads the rows as it reads any listing.
      return input.flags.jsonl === true
        ? new Answer(asJson(result.rows), coverageOf(asJson(result)), true)
        : asJson(result);
    },
  },
  tags: {
    flags: ["cursor", "jsonl", "limit"],
    help: "tags [--limit N] [--cursor C] [--jsonl]",
    run: (outbound, input) =>
      listing(outbound.tags.listAll(walkOptions(input)), input, "tag"),
  },
  thread: {
    flags: ["bodies", "jsonl"],
    help: "thread <id> [--bodies] [--jsonl]",
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
    flags: ["card", "input", "slack", "slack-text"],
    help: "tool <name> [--input JSON] [--card | --slack-text | --slack]  without --input, a tool that needs input fails with what it takes (exit 2)",
    run: async (outbound, input) => {
      const name = required(input, 0, "a tool name");

      const catalogued = await listedTools(outbound, input.flags);
      const offered = catalogued.surface.tools;
      const given = text(input, "input");

      const found = listedTool(
        catalogued.surface,
        name,
        parseInput(given) ?? {}
      );

      if (found === undefined) {
        // A tool this instance cannot serve is refused with the reason, as
        // running the insight would be, not called unknown.
        refuseLeftOut(outbound, catalogued, name);

        throw new OutboundError(
          "Invalid",
          `Unknown tool "${name}".${didYouMean(
            name,
            offered.map((each) => each.name)
          )} Run "outbound tools" to list them`
        );
      }

      const { card, forCard, tool } = found;

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

      const result = await tool.call(parseInput(given));

      // One check's own answer only for a card: JSON keeps data.<check>.
      return drawn(card, wantsCard(input) ? forCard(result) : result, input);
    },
  },
  tools: {
    flags: [],
    help: "tools",
    run: async (outbound, input) => {
      const { leftOut, surface } = await listedTools(outbound, input.flags);

      return listedWith(asJson(surface.tools.map(describeTool)), leftOut);
    },
  },
  webhooks: {
    flags: ["campaign", "cursor", "jsonl", "limit"],
    help: "webhooks [--campaign ID|NAME] [--limit N] [--cursor C] [--jsonl]",
    run: async (outbound, input) =>
      listing(
        outbound.webhooks.listAll({
          campaignId: await campaignOption(outbound, text(input, "campaign")),
          ...walkOptions(input),
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
