// What hot_leads reads before it scores: the replies within the window, the
// leads labelled positive, the leads behind those replies, and, where the
// vendor cannot filter by interest or the caller asks, the lead list itself.

import type {
  Lead,
  LeadEngagement,
  Reply,
  ReplyCategory,
} from "../../internal/entities.ts";
import { OutboundError } from "../../internal/errors.ts";
import { emailAddress } from "../../internal/json.ts";
import { parseRef } from "../../internal/ref.ts";
import { confirmCampaign } from "../campaign.ts";
import { maskingOf } from "../define.ts";
import type { InsightContext } from "../define.ts";
import { ADDRESSES_MASKED, addressesMasked, refsOf } from "./auto-replies.ts";

const DAY = 86_400_000;

/** The most addresses one lookup of many asks for. */
const LOOKUP_BATCH = 100;

/** Reply categories that do not make a lead worth calling. */
const NOT_ENGAGED: ReadonlySet<ReplyCategory> = new Set<ReplyCategory>([
  "bounce",
  "ooo",
  "unsubscribe",
]);

/** What the reads take from the input. */
export interface ReadInput {
  readonly campaign: string | null;
  readonly include_engagement_only: boolean;
  readonly limit: number;
  readonly max_leads: number;
  readonly max_replies: number;
  readonly recency_days: number;
}

export interface Candidates {
  /** Every lead read, each once. */
  readonly leads: readonly Lead[];
  /** The replies read within `recency_days`, `null` when none could be read. */
  readonly replies: readonly Reply[] | null;
  /** Leads read because they replied within `recency_days`. */
  readonly fromReplies: number;
  /** Leads that replied within `recency_days` and could not be read, probably deleted. */
  readonly unreadable: number;
  /** `true` when `max_leads` stopped a lead listing with more leads left. */
  readonly moreLeadsExist: boolean;
}

/** The replies within `recency_days`, newest first, read to the window's start or `max_replies`. */
const windowReplies = async (
  context: InsightContext,
  values: ReadInput
): Promise<Reply[] | null> => {
  const { outbound } = context;

  if (!outbound.capabilities["replies.list"]) {
    context.note(
      "This tool cannot list replies, so leads were ranked from the lead records alone."
    );

    return null;
  }

  // Under `mask` every address in a ref reads the same, so a reply names no one.
  if (addressesMasked(context) && maskingOf(outbound)?.strategy === "mask") {
    context.partial(
      `${ADDRESSES_MASKED} replies were not matched to leads: the leads that replied within recency_days were not looked for, and automatic replies were not told from people.`
    );

    return null;
  }

  const since = context.now - values.recency_days * DAY;

  const range =
    outbound.capabilities["replies.since"] === false
      ? {}
      : { since: new Date(since).toISOString() };

  const read = await context.all(
    values.campaign === null
      ? outbound.replies.listAll({ max: values.max_replies, ...range })
      : outbound
          .campaign(values.campaign)
          .replies.listAll({ max: values.max_replies, ...range }),
    {
      input: "max_replies",
      max: values.max_replies,
      what: "replies within recency_days",
    }
  );

  return read
    .filter(
      (reply) => reply.sentAt !== null && Date.parse(reply.sentAt) >= since
    )
    .toSorted((left, right) =>
      (right.sentAt ?? "").localeCompare(left.sentAt ?? "")
    );
};

/** The leads the vendor labels positive, by its own filter. */
const positiveLeads = async (
  context: InsightContext,
  { campaign, max_leads: max }: ReadInput
) => {
  const { outbound } = context;

  const walk =
    campaign === null
      ? outbound.leads.listAll({ interest: "positive", max })
      : outbound
          .campaign(campaign)
          .leads.listAll({ interest: "positive", max });

  const leads = await context.all(walk, {
    input: "max_leads",
    max,
    what: "leads labelled positive",
  });

  return { capped: walk.truncated, leads };
};

/** The lead list in the vendor's order, up to `max_leads`. */
const listedLeads = async (
  context: InsightContext,
  { campaign, max_leads: max }: ReadInput
) => {
  const { outbound } = context;

  if (campaign === null && !outbound.capabilities["leads.list"]) {
    throw new OutboundError(
      "Unsupported",
      `hot_leads needs a campaign here: the ${outbound.provider} adapter cannot list every lead (leads.list)`,
      { provider: outbound.provider }
    );
  }

  const walk =
    campaign === null
      ? outbound.leads.listAll({ max })
      : outbound.campaign(campaign).leads.listAll({ max });

  const leads = await context.all(walk, {
    input: "max_leads",
    max,
    what: campaign === null ? "leads" : "leads of a campaign",
  });

  return { capped: walk.truncated, leads };
};

/** The ref each engaged reply names, newest first, with the campaign of its newest reply. */
const repliedRefs = (
  replies: readonly Reply[],
  campaign: string | null
): Map<string, string | null> => {
  const refs = new Map<string, string | null>();

  for (const reply of replies) {
    if (
      reply.leadRef !== null &&
      reply.isAuto !== true &&
      !NOT_ENGAGED.has(reply.category) &&
      (campaign === null || reply.campaignRef === campaign) &&
      !refs.has(reply.leadRef)
    ) {
      refs.set(reply.leadRef, reply.campaignRef);
    }
  }

  return refs;
};

/**
 * One record per address: the one in the campaign of the person's newest
 * reply, else the first. A lookup returns one record per campaign.
 */
const byAddress = (
  found: readonly Lead[],
  campaigns: ReadonlyMap<string, string | null>
): Lead[] => {
  const chosen = new Map<string, Lead>();

  for (const lead of found) {
    const address = lead.email;

    if (address !== null) {
      const ref = refsOf(lead).find((each) => campaigns.has(each));
      const wanted = ref === undefined ? undefined : campaigns.get(ref);
      const kept = chosen.get(address);

      if (
        kept === undefined ||
        (kept.campaignRef !== wanted && lead.campaignRef === wanted)
      ) {
        chosen.set(address, lead);
      }
    }
  }

  return [...chosen.values()];
};

/** The address a ref names its lead by, or `null` for any other id. */
const address = (ref: string): string | null =>
  emailAddress(parseRef(ref)?.sourceId);

/** Reads the leads named by address in batches. */
const lookUp = async (
  context: InsightContext,
  addresses: readonly string[],
  campaign: string | null
): Promise<Lead[]> => {
  const found: Lead[] = [];

  for (let at = 0; at < addresses.length; at += LOOKUP_BATCH) {
    const emails = addresses.slice(at, at + LOOKUP_BATCH);

    // oxlint-disable-next-line no-await-in-loop -- one batch at a time keeps the rate budget even.
    const page = await context.all(
      campaign === null
        ? context.outbound.leads.listAll({ emails })
        : context.outbound.campaign(campaign).leads.listAll({ emails })
    );

    found.push(...page);
  }

  return found;
};

/**
 * The leads behind replies within the window that no listing read. A reply
 * that names its lead by address is looked up with many others at once where
 * the tool can (`leads.lookupMany`); any other is read by ref, the newest
 * `limit` of them.
 */
const repliedLeads = async (
  context: InsightContext,
  values: ReadInput,
  replies: readonly Reply[],
  listed: readonly Lead[]
): Promise<{ leads: Lead[]; unreadable: number }> => {
  const { outbound } = context;
  const known = new Set(listed.flatMap((lead) => refsOf(lead)));

  const wanted = new Map(
    [...repliedRefs(replies, values.campaign)].filter(
      ([ref]) => !known.has(ref)
    )
  );

  if (wanted.size === 0) {
    return { leads: [], unreadable: 0 };
  }

  if (addressesMasked(context)) {
    context.partial(
      `${ADDRESSES_MASKED} leads that replied within recency_days and were not otherwise listed were not looked for.`
    );

    return { leads: [], unreadable: 0 };
  }

  const many = outbound.capabilities["leads.lookupMany"] === true;

  const addresses = many
    ? [...wanted.keys()].flatMap((ref) => address(ref) ?? [])
    : [];

  const byRef = [...wanted.keys()].filter(
    (ref) => !many || address(ref) === null
  );

  if (!outbound.capabilities["leads.get"] && byRef.length > 0) {
    context.partial(
      "This tool cannot read one lead, so leads that replied and were not listed were not scored."
    );
  }

  const read = outbound.capabilities["leads.get"]
    ? byRef.slice(0, values.limit)
    : [];

  if (byRef.length > read.length && read.length > 0) {
    context.partial(
      `Read the ${read.length} leads that replied most recently and were not listed (limit); ${byRef.length - read.length} more were not scored.`
    );
  }

  const found = byAddress(
    await lookUp(context, addresses, values.campaign),
    wanted
  );

  const one =
    read.length === 0
      ? { errors: [], results: [] }
      : await outbound.leads.getMany(read);

  const [costliest] = one.results.toSorted(
    (left, right) => right.value.meta.requests - left.value.meta.requests
  );

  if (costliest !== undefined) {
    context.one(costliest.value);
  }

  return {
    leads: [...found, ...one.results.map(({ value }) => value)],
    unreadable: addresses.length - found.length + one.errors.length,
  };
};

const NO_ENGAGEMENT: LeadEngagement = {
  clicks: null,
  lastContactedAt: null,
  lastOpenedAt: null,
  lastRepliedAt: null,
  opens: null,
  replies: null,
  repliedStepIndex: null,
  stepIndex: null,
};

/**
 * The lead with what its replies in the window say: at least that many
 * replies, and the newest of them as its last reply when its record reports
 * none or an older one. A vendor whose lead records carry no counts
 * (HeyReach) gets recency and a count this way, and its interest class
 * where the vendor keeps one on the lead and the record has none.
 */
const withReplies = (lead: Lead, replies: readonly Reply[]): Lead => {
  const refs = new Set(refsOf(lead));

  const all = replies.filter(
    (reply) => reply.leadRef !== null && refs.has(reply.leadRef)
  );

  // A category the vendor keeps on the lead, not on one reply (HeyReach's
  // auto-tag), is the lead's when its record carries no label.
  const labelled =
    lead.interest === null && lead.interestCategory === null
      ? all.find(
          (reply) =>
            reply.categorySource === "lead" && reply.category !== "unknown"
        )
      : undefined;

  const classed =
    labelled === undefined
      ? lead
      : { ...lead, interestCategory: labelled.category };

  const mine = all.filter(
    (reply) => reply.isAuto !== true && !NOT_ENGAGED.has(reply.category)
  );

  const [newest] = mine;

  if (newest === undefined) {
    return classed;
  }

  const engagement = lead.engagement ?? NO_ENGAGEMENT;
  const last = engagement.lastRepliedAt;

  return {
    ...classed,
    engagement: {
      ...engagement,
      lastRepliedAt:
        last === null || (newest.sentAt ?? "") > last ? newest.sentAt : last,
      replies: Math.max(engagement.replies ?? 0, mine.length),
    },
  };
};

const distinct = (leads: readonly Lead[]): Lead[] => [
  ...new Map(leads.map((lead) => [lead.ref, lead])).values(),
];

/**
 * Every lead hot_leads scores. Candidates come from the signal: the replies
 * within `recency_days` and the leads the vendor labels positive. The lead
 * list is walked as well where the vendor cannot filter by interest, or when
 * `include_engagement_only` asks for leads with only opens or clicks.
 */
export const readCandidates = async (
  context: InsightContext,
  values: ReadInput
): Promise<Candidates> => {
  const { outbound } = context;
  const filtered = outbound.capabilities["leads.byInterest"] === true;

  const replies = await windowReplies(context, values);

  // An unknown campaign has no replies either, which would read as nobody
  // engaged; it is told apart before any other read.
  const confirmed =
    values.campaign !== null && (replies === null || replies.length === 0);

  if (confirmed && values.campaign !== null) {
    await confirmCampaign(context, values.campaign);
  }

  const positive = filtered
    ? await positiveLeads(context, values)
    : { capped: false, leads: [] };

  const walked =
    !filtered || values.include_engagement_only
      ? await listedLeads(context, values)
      : { capped: false, leads: [] };

  const listed = distinct([...positive.leads, ...walked.leads]);

  const extra =
    replies === null
      ? { leads: [], unreadable: 0 }
      : await repliedLeads(context, values, replies, listed);

  const leads = distinct([...listed, ...extra.leads]).map((lead) =>
    replies === null ? lead : withReplies(lead, replies)
  );

  // An unknown campaign lists no leads, which would read as nobody engaged.
  if (!confirmed && values.campaign !== null && leads.length === 0) {
    await confirmCampaign(context, values.campaign);
  }

  return {
    fromReplies: leads.length - listed.length,
    leads,
    moreLeadsExist: positive.capped || walked.capped,
    replies,
    unreadable: extra.unreadable,
  };
};
