// Made-up data for `npm run demo`: an agency with four clients, one per
// sending tool, and 60 days of results that end yesterday. Every name and
// address is invented, and the numbers come from a seeded generator, so two
// runs on the same day load the same rows.
//
// The stories the report should surface:
// - Acme "Ecommerce ops" bounces jump in the last two weeks; one of its
//   senders is in error with a low warmup score.
// - Globex "Agency owners" replies roughly double in the last three weeks.
// - Initech is LinkedIn: no bounce count at all, so its bounce rate is
//   "not reported", never 0%.
// - Umbrella "CFO outreach" sends the most and books almost nothing.

import type { MemoryData, MemoryStats } from "outbound-sdk/memory";

const DAY = 86_400_000;
const DAYS = 60;
const MODULUS = 2_147_483_647;

type Lead = NonNullable<MemoryData["leads"]>[number];

type Message = NonNullable<MemoryData["messages"]>[number];

type Sender = NonNullable<MemoryData["senders"]>[number];

export interface DemoWorkspace {
  /** The provider name the records carry, as if read from that tool. */
  readonly provider: "emailbison" | "heyreach" | "instantly" | "smartlead";
  readonly workspaceId: string;
  readonly data: MemoryData;
}

// Park-Miller: small, the same everywhere, and needs no bit operations.
const random = (seed: number): (() => number) => {
  let state = (seed % (MODULUS - 1)) + 1;

  return () => {
    state = (state * 48_271) % MODULUS;

    return (state - 1) / (MODULUS - 1);
  };
};

const hash = (text: string): number => {
  let sum = 7;

  for (const char of text) {
    sum = (sum * 31 + (char.codePointAt(0) ?? 0)) % MODULUS;
  }

  return sum;
};

interface CampaignPlan {
  readonly id: string;
  readonly name: string;
  readonly channel?: "email" | "linkedin";
  /** Sends on a weekday at full pace. */
  readonly perDay: number;
  /** `null` for a tool that reports no open count. */
  readonly openRate: number | null;
  readonly replyRate: number;
  /** Share of replies that are positive. */
  readonly positiveShare: number;
  /** `null` for a tool that reports no bounce count. */
  readonly bounceRate: number | null;
  /** Multiplies a rate over the last `days` days. */
  readonly shift?: {
    readonly days: number;
    readonly metric: "bounceRate" | "replyRate";
    readonly factor: number;
    /** The sender the extra bounces land on. */
    readonly senderId?: string;
  };
  readonly senderIds: readonly string[];
}

const isoDay = (today: number, daysAgo: number): string =>
  new Date(today - daysAgo * DAY).toISOString().slice(0, 10);

const binomial = (next: () => number, count: number, rate: number): number => {
  // A normal approximation is plenty for made-up data.
  const mean = count * rate;
  const spread = Math.sqrt(Math.max(mean * (1 - rate), 0));
  const noise = (next() + next() + next() - 1.5) * 2 * spread;

  return Math.max(0, Math.min(count, Math.round(mean + noise)));
};

const sum = (values: readonly number[]): number => {
  let total = 0;

  for (const value of values) {
    total += value;
  }

  return total;
};

/** Splits a whole into parts by weight, keeping the total exact. */
const split = (value: number, weights: readonly number[]): number[] => {
  const total = sum(weights);
  const parts = weights.map((weight) => Math.floor((value * weight) / total));
  parts[0] = (parts[0] ?? 0) + value - sum(parts);

  return parts;
};

interface DayCounts {
  readonly sent: number;
  readonly bounced: number | null;
  readonly opened: number | null;
  readonly replied: number;
  readonly positive: number;
}

type Counts = {
  -readonly [Key in keyof MemoryStats["counts"]]: MemoryStats["counts"][Key];
};

const toCounts = (
  plan: CampaignPlan,
  day: DayCounts
): MemoryStats["counts"] => {
  const counts: Counts = {
    contacted: Math.round(day.sent * 0.6),
    delivered: day.sent - (day.bounced ?? 0),
    positive: day.positive,
    replied: day.replied,
    sent: day.sent,
  };

  if (day.bounced !== null) {
    counts.bounced = day.bounced;
  }

  if (day.opened !== null) {
    counts.opened = day.opened;
  }

  if (plan.channel === "linkedin") {
    counts.connectionsSent = day.sent;
    counts.connectionsAccepted = Math.round(day.sent * 0.31);
  }

  return counts;
};

const splitDay = (
  day: DayCounts,
  weights: readonly number[],
  bounceWeights: readonly number[]
): DayCounts[] => {
  const sent = split(day.sent, weights);

  const bounced =
    day.bounced === null ? null : split(day.bounced, bounceWeights);

  const opened = day.opened === null ? null : split(day.opened, weights);
  const replied = split(day.replied, weights);
  const positive = split(day.positive, weights);

  return weights.map((_, index) => ({
    bounced: bounced?.[index] ?? null,
    opened: opened?.[index] ?? null,
    positive: positive[index] ?? 0,
    replied: replied[index] ?? 0,
    sent: sent[index] ?? 0,
  }));
};

const dailyStats = (today: number, plan: CampaignPlan): MemoryStats[] => {
  const next = random(hash(plan.id));
  const rows: MemoryStats[] = [];

  for (let daysAgo = DAYS; daysAgo >= 1; daysAgo -= 1) {
    const date = isoDay(today, daysAgo);
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    const weekend = weekday === 0 || weekday === 6;
    const pace = weekend ? 0.08 : 0.85 + next() * 0.3;
    const sent = Math.round(plan.perDay * pace);

    const factor = (metric: "bounceRate" | "replyRate"): number =>
      plan.shift?.metric === metric && daysAgo <= plan.shift.days
        ? plan.shift.factor
        : 1;

    const bounced =
      plan.bounceRate === null
        ? null
        : binomial(next, sent, plan.bounceRate * factor("bounceRate"));

    const delivered = sent - (bounced ?? 0);

    const replied = binomial(
      next,
      delivered,
      plan.replyRate * factor("replyRate")
    );

    const day: DayCounts = {
      bounced,
      opened:
        plan.openRate === null
          ? null
          : binomial(next, delivered, plan.openRate),
      positive: binomial(next, replied, plan.positiveShare),
      replied,
      sent,
    };

    // The campaign row, and one row per sender that sums to it, the way a
    // vendor reports both.
    rows.push({ campaignId: plan.id, counts: toCounts(plan, day), date });

    const weights = plan.senderIds.map(() => 0.5 + next());

    const culprit = factor("bounceRate") > 1 ? plan.shift?.senderId : undefined;

    const bounceWeights = weights.map((weight, index) =>
      plan.senderIds[index] === culprit ? weight * 12 : weight
    );

    for (const [index, part] of splitDay(
      day,
      weights,
      bounceWeights
    ).entries()) {
      rows.push({
        campaignId: plan.id,
        counts: toCounts(plan, part),
        date,
        senderId: plan.senderIds[index],
      });
    }
  }

  return rows;
};

const OTHER = ["negative", "neutral", "ooo", "unsubscribe"] as const;

const replyCategory = (
  next: () => number,
  plan: CampaignPlan
): NonNullable<Message["category"]> => {
  if (next() < plan.positiveShare) {
    return "positive";
  }

  return OTHER[Math.floor(next() * OTHER.length)] ?? "neutral";
};

const leadStatus = (next: () => number, replied: boolean): Lead["status"] => {
  if (replied) {
    return "replied";
  }

  return next() < 0.55 ? "completed" : "active";
};

interface People {
  readonly leads: Lead[];
  readonly messages: Message[];
}

const peopleFor = (
  today: number,
  next: () => number,
  plan: CampaignPlan
): People => {
  const leads: Lead[] = [];
  const messages: Message[] = [];
  const count = Math.round(plan.perDay * 2.5);

  for (let index = 0; index < count; index += 1) {
    const id = `lead_${plan.id}_${index}`;
    const replied = next() < plan.replyRate * 4;
    const daysAgo = 1 + Math.floor(next() * (DAYS - 1));
    const hour = String(9 + Math.floor(next() * 8)).padStart(2, "0");

    leads.push({
      campaignId: plan.id,
      company: `Company ${index % 37}`,
      createdAt: `${isoDay(today, DAYS)}T08:00:00.000Z`,
      email: `lead${index}@${plan.id.replace("cmp_", "")}.example`,
      firstName: `Lead${index}`,
      id,
      status: leadStatus(next, replied),
    });

    if (replied) {
      const category = replyCategory(next, plan);

      messages.push({
        campaignId: plan.id,
        category,
        direction: "in",
        id: `msg_${id}`,
        isAuto: category === "ooo",
        leadId: id,
        senderId: plan.senderIds[index % plan.senderIds.length],
        sentAt: `${isoDay(today, daysAgo)}T${hour}:15:00.000Z`,
        subject: "Re: Quick question",
        threadId: `thr_${id}`,
        unread: next() < 0.2,
      });
    }
  }

  return { leads, messages };
};

const workspace = (
  today: number,
  provider: DemoWorkspace["provider"],
  workspaceId: string,
  plans: readonly CampaignPlan[],
  senders: readonly Sender[]
): DemoWorkspace => {
  const next = random(hash(workspaceId));
  const people = plans.map((plan) => peopleFor(today, next, plan));

  return {
    data: {
      campaigns: plans.map((plan) => ({
        channel: plan.channel ?? "email",
        createdAt: `${isoDay(today, DAYS + 2)}T09:00:00.000Z`,
        id: plan.id,
        name: plan.name,
        status: "active",
        tags: [workspaceId],
      })),
      leads: people.flatMap((group) => group.leads),
      messages: people.flatMap((group) => group.messages),
      senders,
      stats: plans.flatMap((plan) => dailyStats(today, plan)),
    },
    provider,
    workspaceId,
  };
};

const mailbox = (
  id: string,
  address: string,
  score: number,
  status: "active" | "error" = "active"
): Sender => ({
  address,
  dailyLimit: 40,
  id,
  name: address.split("@")[0] ?? id,
  status,
  warmup: { enabled: true, score },
});

const linkedin = (id: string, name: string, slug: string): Sender => ({
  dailyLimit: 25,
  id,
  linkedinUrl: `https://www.linkedin.com/in/${slug}`,
  name,
  status: "active",
});

interface Client {
  readonly provider: DemoWorkspace["provider"];
  readonly workspaceId: string;
  readonly plans: readonly CampaignPlan[];
  readonly senders: readonly Sender[];
}

const CLIENTS: readonly Client[] = [
  {
    provider: "instantly",
    workspaceId: "acme",
    plans: [
      {
        bounceRate: 0.012,
        id: "cmp_acme_founders",
        name: "SaaS founders",
        openRate: 0.52,
        perDay: 120,
        positiveShare: 0.42,
        replyRate: 0.031,
        senderIds: ["mbx_acme_1", "mbx_acme_2"],
      },
      {
        bounceRate: 0.015,
        id: "cmp_acme_agencies",
        name: "Agency owners",
        openRate: 0.47,
        perDay: 90,
        positiveShare: 0.35,
        replyRate: 0.024,
        senderIds: ["mbx_acme_2", "mbx_acme_3"],
      },
      {
        bounceRate: 0.018,
        id: "cmp_acme_ecom",
        name: "Ecommerce ops",
        openRate: 0.44,
        perDay: 110,
        positiveShare: 0.3,
        replyRate: 0.019,
        senderIds: ["mbx_acme_3", "mbx_acme_4"],
        shift: {
          days: 14,
          factor: 4.2,
          metric: "bounceRate",
          senderId: "mbx_acme_4",
        },
      },
    ],
    senders: [
      mailbox("mbx_acme_1", "alex@acme-mail.example", 97),
      mailbox("mbx_acme_2", "sam@acme-mail.example", 94),
      mailbox("mbx_acme_3", "jo@acme-mail.example", 91),
      mailbox("mbx_acme_4", "riley@acme-send.example", 58, "error"),
    ],
  },
  {
    provider: "smartlead",
    workspaceId: "globex",
    plans: [
      {
        bounceRate: 0.01,
        id: "cmp_globex_agencies",
        name: "Agency owners",
        openRate: null,
        perDay: 140,
        positiveShare: 0.38,
        replyRate: 0.018,
        senderIds: ["mbx_globex_1", "mbx_globex_2", "mbx_globex_3"],
        shift: { days: 21, factor: 2.1, metric: "replyRate" },
      },
      {
        bounceRate: 0.013,
        id: "cmp_globex_heads",
        name: "Heads of growth",
        openRate: null,
        perDay: 80,
        positiveShare: 0.33,
        replyRate: 0.022,
        senderIds: ["mbx_globex_2", "mbx_globex_3"],
      },
    ],
    senders: [
      mailbox("mbx_globex_1", "morgan@globex-mail.example", 95),
      mailbox("mbx_globex_2", "casey@globex-mail.example", 92),
      mailbox("mbx_globex_3", "drew@globex-mail.example", 88),
    ],
  },
  {
    provider: "heyreach",
    workspaceId: "initech",
    plans: [
      {
        bounceRate: null,
        channel: "linkedin",
        id: "cmp_initech_cto",
        name: "CTOs, Series A",
        openRate: null,
        perDay: 45,
        positiveShare: 0.4,
        replyRate: 0.085,
        senderIds: ["li_initech_1", "li_initech_2"],
      },
      {
        bounceRate: null,
        channel: "linkedin",
        id: "cmp_initech_vp",
        name: "VPs of engineering",
        openRate: null,
        perDay: 35,
        positiveShare: 0.34,
        replyRate: 0.07,
        senderIds: ["li_initech_2"],
      },
    ],
    senders: [
      linkedin("li_initech_1", "Pat (LinkedIn)", "example-one"),
      linkedin("li_initech_2", "Lee (LinkedIn)", "example-two"),
    ],
  },
  {
    provider: "emailbison",
    workspaceId: "umbrella",
    plans: [
      {
        bounceRate: 0.021,
        id: "cmp_umbrella_cfo",
        name: "CFO outreach",
        openRate: 0.38,
        perDay: 220,
        positiveShare: 0.12,
        replyRate: 0.011,
        senderIds: ["mbx_umb_1", "mbx_umb_2", "mbx_umb_3"],
      },
      {
        bounceRate: 0.016,
        id: "cmp_umbrella_ops",
        name: "RevOps leaders",
        openRate: 0.45,
        perDay: 95,
        positiveShare: 0.36,
        replyRate: 0.026,
        senderIds: ["mbx_umb_2", "mbx_umb_3"],
      },
    ],
    senders: [
      mailbox("mbx_umb_1", "taylor@umbrella-out.example", 83),
      mailbox("mbx_umb_2", "jamie@umbrella-out.example", 90),
      mailbox("mbx_umb_3", "kai@umbrella-out.example", 86),
    ],
  },
];

/** Four clients, one per tool, with 60 days of results ending yesterday. */
export const demoWorkspaces = (now: number = Date.now()): DemoWorkspace[] => {
  const today = Math.floor(now / DAY) * DAY;

  return CLIENTS.map((client) =>
    workspace(
      today,
      client.provider,
      client.workspaceId,
      client.plans,
      client.senders
    )
  );
};
