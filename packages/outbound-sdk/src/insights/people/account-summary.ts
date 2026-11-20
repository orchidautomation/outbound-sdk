// account_summary: everyone at one company, by exact email domain.

import { z } from "zod";

import type { Lead } from "../../internal/entities.ts";
import { OutboundError } from "../../internal/errors.ts";
import { count, plural } from "../../internal/numbers.ts";
import type { Capped } from "../capped.ts";
import { defineInsight } from "../define.ts";
import type { InsightContext } from "../define.ts";
import { total } from "../stats.ts";
import {
  domainOf,
  hasHumanReply,
  isAutoReplied,
  isPositive,
  nameOf,
  noteEngagement,
  positiveLabelsField,
  readCappedFlag,
} from "./read.ts";

const input = z.object({
  allow_free_domains: z
    .boolean()
    .default(false)
    .describe(
      "Set to true to accept an email provider domain such as gmail.com, which is not one company"
    ),
  domain: z
    .string()
    .min(3)
    .describe(
      "The company's domain (acme.com) or an email at it. Matched by email domain, so a LinkedIn-only lead is not found."
    ),
  max_campaigns: z
    .number()
    .int()
    .min(1)
    .max(200)
    .default(20)
    .describe(
      "The most campaigns to read leads from when the tool cannot list every lead at once"
    ),
  max_leads: z
    .number()
    .int()
    .min(1)
    .max(20_000)
    .default(1000)
    .describe(
      "The most leads to read in all. A vendor request returns about 50 to 100 leads."
    ),
  positive_labels: positiveLabelsField,
});

type Input = z.infer<typeof input>;

const FREE_DOMAINS = new Set([
  "aol.com",
  "gmail.com",
  "gmx.com",
  "googlemail.com",
  "hotmail.com",
  "icloud.com",
  "live.com",
  "mail.com",
  "me.com",
  "msn.com",
  "outlook.com",
  "proton.me",
  "protonmail.com",
  "yahoo.com",
  "yandex.com",
  "zoho.com",
]);

const DOMAIN = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/u;

export interface AccountRecord {
  readonly lead: string;
  readonly campaign: string | null;
  readonly provider: string;
  readonly status: string;
  /** The vendor's own label, for example `Interested`. */
  readonly interest: string | null;
  readonly opens: number | null;
  readonly clicks: number | null;
  readonly replies: number | null;
  readonly lastContactedAt: string | null;
  readonly lastRepliedAt: string | null;
  /**
   * `true` when the vendor labels the record out-of-office or bounced: its
   * replies were automatic, so they do not count as the person replying.
   */
  readonly autoReplied: boolean;
}

export interface AccountPerson {
  readonly email: string;
  readonly name: string | null;
  readonly title: string | null;
  readonly company: string | null;
  /** The campaigns the person is in, as refs. */
  readonly campaigns: readonly string[];
  /** `true` when a record shows a reply that was not automatic. */
  readonly replied: boolean;
  /** `true` when one of their labels is a positive one. `null` when they carry no label. */
  readonly interested: boolean | null;
  /** Added up over their records. `null` when the vendor reports none. */
  readonly opens: number | null;
  readonly clicks: number | null;
  /** Replies on records that are not `autoReplied`. */
  readonly replies: number | null;
  /** The last reply on a record that is not `autoReplied`. */
  readonly lastRepliedAt: string | null;
  /** One entry per campaign the person is in. */
  readonly records: readonly AccountRecord[];
}

export interface AccountSummary {
  readonly domain: string;
  /**
   * `search` when the tool found the domain's leads itself (`leads.byDomain`),
   * `scan` when leads were read in order and matched here, up to `max_leads`.
   */
  readonly foundBy: "scan" | "search";
  /**
   * One sentence on who was found. When a scan stopped with leads unread, it
   * says that nobody matching does not mean nobody at the company is there.
   */
  readonly finding: string;
  /** Sorted by most recent reply, then people who replied at an unknown time, then the rest by email. */
  readonly people: readonly AccountPerson[];
  readonly totals: {
    readonly people: number;
    readonly records: number;
    readonly campaigns: number;
    readonly replied: number;
    readonly interested: number;
    /** Leads looked at to find them. */
    readonly leadsRead: number;
    /**
     * Leads with no email address, which a domain cannot match. A search by
     * domain never returns them, so it is then 0.
     */
    readonly leadsWithoutEmail: number;
    /**
     * `true` when `max_leads` or `max_campaigns` stopped the read with more
     * leads left, so people at the company may be missing.
     */
    readonly moreLeadsExist: boolean;
  };
  /** The most recent reply with a known time. `null` when no reply has one. */
  readonly lastReply: {
    readonly email: string;
    readonly name: string | null;
    readonly lead: string;
    readonly campaign: string | null;
    readonly at: string;
  } | null;
}

/** The domain in `acme.com`, `jane@acme.com` or `https://www.acme.com/about`. */
const parseDomain = (text: string, provider: string): string => {
  const value = text.trim().toLowerCase();

  const host = value.includes("@")
    ? (value.split("@").at(-1) ?? "")
    : (value
        .replace(/^[a-z]+:\/\//u, "")
        .replace(/^www\./u, "")
        .split(/[/?#]/u)[0] ?? "");

  if (!DOMAIN.test(host)) {
    throw new OutboundError(
      "Invalid",
      `"${text}" is not a domain or an email address`,
      { provider }
    );
  }

  return host;
};

const readLeads = async (
  context: InsightContext,
  domain: string,
  { max_campaigns: maxCampaigns, max_leads: maxLeads }: Input
): Promise<Capped<Lead> & { readonly foundBy: AccountSummary["foundBy"] }> => {
  const { outbound } = context;

  // The tool finds the domain's leads itself, so the answer does not depend
  // on where in the workspace they are.
  if (outbound.capabilities["leads.byDomain"]) {
    const found = await readCappedFlag(
      context,
      (cap) => outbound.leads.listAll({ domain, max: cap }),
      maxLeads,
      "leads at the domain",
      "max_leads"
    );

    return { ...found, foundBy: "search" };
  }

  return {
    ...(await scanLeads(context, maxCampaigns, maxLeads)),
    foundBy: "scan",
  };
};

/** Every lead in order, up to the caps, for a tool that cannot search by domain. */
const scanLeads = async (
  context: InsightContext,
  maxCampaigns: number,
  maxLeads: number
): Promise<Capped<Lead>> => {
  const { outbound } = context;

  if (outbound.capabilities["leads.list"]) {
    return await readCappedFlag(
      context,
      (cap) => outbound.leads.listAll({ max: cap }),
      maxLeads,
      "leads",
      "max_leads"
    );
  }

  if (!outbound.capabilities["leads.byCampaign"]) {
    throw new OutboundError(
      "Unsupported",
      `account_summary is not available: the ${outbound.provider} adapter supports none of leads.byDomain, leads.list and leads.byCampaign`,
      { provider: outbound.provider }
    );
  }

  const campaigns = await readCappedFlag(
    context,
    (cap) => outbound.campaigns.listAll({ max: cap }),
    maxCampaigns,
    "campaigns",
    "max_campaigns"
  );

  const leads: Lead[] = [];
  let { capped } = campaigns;

  for (const campaign of campaigns.items) {
    if (leads.length >= maxLeads) {
      context.partial(
        `Stopped at ${plural(maxLeads, "lead")} (max_leads); more campaigns remain.`
      );
      capped = true;
      break;
    }

    // oxlint-disable-next-line no-await-in-loop -- each campaign reads only the leads left under max_leads.
    const found = await readCappedFlag(
      context,
      (cap) => outbound.campaign(campaign.ref).leads.listAll({ max: cap }),
      maxLeads - leads.length,
      "leads of a campaign",
      "max_leads"
    );

    leads.push(...found.items);
    capped ||= found.capped;
  }

  return { capped, items: leads };
};

const toRecord = (lead: Lead): AccountRecord => ({
  campaign: lead.campaignRef,
  clicks: lead.engagement?.clicks ?? null,
  interest: lead.interest,
  lastContactedAt: lead.engagement?.lastContactedAt ?? null,
  lastRepliedAt: lead.engagement?.lastRepliedAt ?? null,
  lead: lead.ref,
  opens: lead.engagement?.opens ?? null,
  provider: lead.provider,
  replies: lead.engagement?.replies ?? null,
  autoReplied: isAutoReplied(lead),
  status: lead.status,
});

const latest = (times: readonly (string | null)[]): string | null =>
  times
    .flatMap((time) => (time === null ? [] : [time]))
    .toSorted()
    .at(-1) ?? null;

const toPerson = (
  email: string,
  leads: readonly Lead[],
  labels: readonly string[]
): AccountPerson => {
  const records = leads.map(toRecord);
  const human = records.filter((record) => !record.autoReplied);
  const verdicts = leads.map((lead) => isPositive(lead.interest, labels));

  const pick = <Value>(read: (lead: Lead) => Value | null): Value | null =>
    leads.map(read).find((value) => value !== null) ?? null;

  return {
    campaigns: [
      ...new Set(
        records.flatMap((record) =>
          record.campaign === null ? [] : [record.campaign]
        )
      ),
    ],
    clicks: total(records.map((record) => record.clicks)),
    company: pick((lead) => lead.company),
    email,
    interested: verdicts.includes(true)
      ? true
      : (verdicts.find((verdict) => verdict !== null) ?? null),
    lastRepliedAt: latest(human.map((record) => record.lastRepliedAt)),
    name: pick(nameOf),
    opens: total(records.map((record) => record.opens)),
    records,
    replied: leads.some(hasHumanReply),
    replies: total(human.map((record) => record.replies)),
    title: pick((lead) => lead.title),
  };
};

const findingOf = (
  domain: string,
  people: readonly AccountPerson[],
  read: {
    readonly capped: boolean;
    readonly foundBy: AccountSummary["foundBy"];
    readonly leadsRead: number;
  }
): string => {
  const replied = people.filter((person) => person.replied).length;
  const found = `${plural(people.length, "person", "people")} at ${domain}; ${count(replied)} replied`;

  if (!read.capped) {
    if (people.length > 0) {
      return `${found}.`;
    }

    return read.foundBy === "search"
      ? `No lead at ${domain} was found.`
      : `Checked all ${plural(read.leadsRead, "lead")}; none is at ${domain}.`;
  }

  const checked =
    read.foundBy === "search"
      ? `Read ${plural(read.leadsRead, "lead")} at ${domain} (max_leads) and more exist`
      : `Checked the first ${plural(read.leadsRead, "lead")} and more exist`;

  return people.length === 0
    ? `${checked}; none matched. This does not mean nobody at ${domain} is in a campaign.`
    : `${found} in the leads read. ${checked}, so others at ${domain} may be missing.`;
};

/** Most recent reply first, then replies at an unknown time, then by email. */
const byLastReply = (left: AccountPerson, right: AccountPerson): number =>
  (right.lastRepliedAt ?? "").localeCompare(left.lastRepliedAt ?? "") ||
  Number(right.replied) - Number(left.replied) ||
  left.email.localeCompare(right.email);

const lastReplyOf = (
  people: readonly AccountPerson[]
): AccountSummary["lastReply"] => {
  const [person] = people;
  const at = person?.lastRepliedAt ?? null;
  const record = person?.records.find((each) => each.lastRepliedAt === at);

  return person === undefined || record === undefined || at === null
    ? null
    : {
        at,
        campaign: record.campaign,
        email: person.email,
        lead: record.lead,
        name: person.name,
      };
};

export const accountSummary = defineInsight({
  description:
    "Everyone at one company across campaigns and tools, from its domain or an email address at it: each person with their name, title, campaigns, status, interest label and open, click and reply counts, plus totals and who replied most recently. The finding says when part of the company may be unread. Costs one request per page of leads read, up to max_leads.",
  inputSchema: input,
  key: "accountSummary",
  // Every address is masked, so no lead's domain can be read. A hash keeps
  // exact matching but not the domain.
  maskedOut: ({ fields, strategy }) => {
    if (!fields.includes("email")) {
      return null;
    }

    return strategy === "hash"
      ? 'email addresses, whose domain it matches people by (under strategy "hash" too: a hashed address keeps no domain)'
      : "email addresses, whose domain it matches people by";
  },
  cost: (values, price) =>
    price.capabilities["leads.list"] === false &&
    !price.capabilities["leads.byDomain"]
      ? price.list("campaigns.list", values.max_campaigns) +
        price.upTo(values.max_campaigns - 1) * price.list("leads.list", 1) +
        price.upTo(1) * price.list("leads.list", values.max_leads)
      : price.list("leads.list", values.max_leads),
  scales: "max_leads",
  name: "account_summary",
  needs: [],
  next: "Use person_summary with one person's email address or lead ref for their full history, message by message.",
  run: async (context, values) => {
    const domain = parseDomain(values.domain, context.outbound.provider);

    if (FREE_DOMAINS.has(domain) && !values.allow_free_domains) {
      throw new OutboundError(
        "Invalid",
        `${domain} is an email provider, not one company. Pass allow_free_domains: true to read it anyway.`,
        { provider: context.outbound.provider }
      );
    }

    const read = await readLeads(context, domain, values);
    const leads = read.items;

    noteEngagement(context, leads, "those are null");
    const byEmail = new Map<string, Lead[]>();

    for (const lead of leads) {
      if (lead.email !== null && domainOf(lead.email) === domain) {
        byEmail.set(lead.email, [...(byEmail.get(lead.email) ?? []), lead]);
      }
    }

    const people = [...byEmail]
      .map(([email, records]) =>
        toPerson(email, records, values.positive_labels)
      )
      .toSorted(byLastReply);

    const summary: AccountSummary = {
      domain,
      finding: findingOf(domain, people, {
        capped: read.capped,
        foundBy: read.foundBy,
        leadsRead: leads.length,
      }),
      foundBy: read.foundBy,
      lastReply: lastReplyOf(people),
      people,
      totals: {
        campaigns: new Set(people.flatMap((person) => person.campaigns)).size,
        interested: people.filter((person) => person.interested === true)
          .length,
        leadsRead: leads.length,
        leadsWithoutEmail: leads.filter((lead) => lead.email === null).length,
        moreLeadsExist: read.capped,
        people: people.length,
        records: people.reduce((sum, each) => sum + each.records.length, 0),
        replied: people.filter((person) => person.replied).length,
      },
    };

    return summary;
  },
});
