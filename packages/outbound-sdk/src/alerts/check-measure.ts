// What each metric measures in what it is given: one number (or status) per
// subject, with the counts behind it. Every input is parsed first: records
// with their own schemas, and an insight's answer with a schema of just the
// fields read here, so this folder does not depend on the insights plugin.

import { z } from "zod";

import { metricRowSchema, senderSchema } from "../internal/entities.ts";
import type { MetricRow, Sender } from "../internal/entities.ts";
import { computeRates } from "../internal/metrics.ts";
import type { OutboundRecord } from "../internal/outbound/operations.ts";
import type { CheckMetricName, CheckSource } from "./check-schema.ts";

/** The counts behind a measured value, by name. */
export type CheckNumbers = Readonly<Record<string, number | string | null>>;

/** One subject's reading of a metric. */
export interface Measurement {
  readonly subject: string;
  readonly subjectName: string | null;
  readonly value: number | string;
  readonly numbers: CheckNumbers;
  readonly day: string | null;
  readonly campaign: string | null;
  readonly sender: string | null;
  readonly person: string | null;
}

export interface Readings {
  readonly measured: readonly Measurement[];
  /** Subjects seen but not measurable: too few sends, a missing count, an unknown status. */
  readonly skipped: number;
}

/** The readings, or why the input is not what the metric reads. */
export type Measured =
  | { readonly ok: true; readonly readings: Readings }
  | { readonly ok: false; readonly reason: string };

export interface MeasureOptions {
  readonly minSent: number;
  /** The first day a daily row counts, `YYYY-MM-DD`, or `null` for every day. */
  readonly fromDay: string | null;
}

const blank = {
  campaign: null,
  day: null,
  person: null,
  sender: null,
  subjectName: null,
};

interface RowReading {
  readonly value: number | null;
  readonly numbers: CheckNumbers;
}

const rowReading = (metric: CheckMetricName, row: MetricRow): RowReading => {
  if (metric === "bounce_rate") {
    return {
      numbers: { bounced: row.bounced, sent: row.sent },
      value: computeRates(row).bounceRate.value,
    };
  }

  if (metric === "reply_rate") {
    return {
      numbers: {
        contacted: row.contacted,
        replied: row.replied,
        sent: row.sent,
      },
      value: computeRates(row).replyRate.value,
    };
  }

  return { numbers: { sent: row.sent }, value: row.sent };
};

const fromRows = (
  metric: CheckMetricName,
  rows: readonly MetricRow[],
  options: MeasureOptions
): Readings => {
  const inWindow = rows.filter(
    (row) =>
      options.fromDay === null ||
      row.date === null ||
      row.date >= options.fromDay
  );

  const rate = metric !== "sent";

  const measured = inWindow.flatMap((row): Measurement[] => {
    const { numbers, value } = rowReading(metric, row);

    if (value === null || (rate && (row.sent ?? 0) < options.minSent)) {
      return [];
    }

    return [
      {
        ...blank,
        campaign: row.scope === "campaign" ? row.scopeRef : null,
        day: row.date,
        numbers,
        sender: row.scope === "sender" ? row.scopeRef : null,
        subject: row.scopeRef,
        value,
      },
    ];
  });

  return { measured, skipped: rows.length - measured.length };
};

const fromSenders = (senders: readonly Sender[]): Readings => {
  const known = senders.filter((sender) => sender.status !== "unknown");

  return {
    measured: known.map((sender) => ({
      ...blank,
      numbers: { status: sender.status },
      sender: sender.ref,
      subject: sender.ref,
      subjectName: sender.address ?? sender.name,
      value: sender.status,
    })),
    skipped: senders.length - known.length,
  };
};

const ref = z.string();
const maybe = z.string().nullable();

const droppedAnswer = z.object({
  dropped: z.array(
    z.object({
      campaign: maybe,
      category: z.string(),
      email: maybe,
      hoursWaiting: z.number(),
      lead: maybe,
      linkedinUrl: maybe,
      name: maybe,
      receivedAt: z.string(),
      reply: ref,
      unansweredReplies: z.number(),
    })
  ),
  olderThanHours: z.number(),
});

const forecastAnswer = z.object({
  campaign: ref,
  campaignName: z.string(),
  dailyContactRate: z.number().nullable(),
  daysLeft: z.number().nullable(),
  estimate: z.literal(true),
  remaining: z.number(),
});

const suppressionAnswer = z.object({
  byCampaign: z.array(
    z.object({
      campaign: ref,
      campaignName: z.string(),
      leadsRead: z.number(),
      violations: z.number(),
    })
  ),
  violations: z.array(z.unknown()),
});

const gapsAnswer = z.object({
  campaign: ref,
  totals: z.object({ leadsRead: z.number() }),
  unknownVariables: z.array(z.string()),
  variables: z.array(
    z.object({
      gap: z.boolean(),
      leadsAffected: z.number().nullable(),
      leadsWithoutValue: z.number().nullable(),
      name: z.string(),
    })
  ),
});

const fromDropped = (data: z.infer<typeof droppedAnswer>): Readings => ({
  measured: data.dropped
    .filter((reply) => reply.category === "positive")
    .map((reply) => ({
      ...blank,
      campaign: reply.campaign,
      numbers: {
        hoursWaiting: reply.hoursWaiting,
        receivedAt: reply.receivedAt,
        unansweredReplies: reply.unansweredReplies,
      },
      person: reply.lead,
      subject: reply.reply,
      subjectName: reply.name ?? reply.email ?? reply.linkedinUrl,
      value: reply.hoursWaiting,
    })),
  skipped: 0,
});

const fromForecast = (data: z.infer<typeof forecastAnswer>): Readings =>
  data.daysLeft === null
    ? { measured: [], skipped: 1 }
    : {
        measured: [
          {
            ...blank,
            campaign: data.campaign,
            numbers: {
              dailyContactRate: data.dailyContactRate,
              daysLeft: data.daysLeft,
              remaining: data.remaining,
            },
            subject: data.campaign,
            subjectName: data.campaignName,
            value: data.daysLeft,
          },
        ],
        skipped: 0,
      };

const fromSuppression = (
  data: z.infer<typeof suppressionAnswer>
): Readings => ({
  measured: data.byCampaign.map((each) => ({
    ...blank,
    campaign: each.campaign,
    numbers: { leadsRead: each.leadsRead, violations: each.violations },
    subject: each.campaign,
    subjectName: each.campaignName,
    value: each.violations,
  })),
  skipped: 0,
});

const fromGaps = (data: z.infer<typeof gapsAnswer>): Readings => {
  const broken = data.variables.filter((each) => each.gap);

  const measured = broken.flatMap((each): Measurement[] =>
    each.leadsAffected === null
      ? []
      : [
          {
            ...blank,
            campaign: data.campaign,
            numbers: {
              leadsAffected: each.leadsAffected,
              leadsRead: data.totals.leadsRead,
              leadsWithoutValue: each.leadsWithoutValue,
            },
            subject: data.campaign,
            subjectName: each.name,
            value: each.leadsAffected,
          },
        ]
  );

  return { measured, skipped: broken.length - measured.length };
};

// What the SDK hands back is read-only all the way down.
type Frozen<Value> = Value extends readonly (infer Item)[]
  ? readonly Frozen<Item>[]
  : Value extends object
    ? { readonly [Key in keyof Value]: Frozen<Value[Key]> }
    : Value;

/** The fields of an insight's answer that a check reads. */
export type CheckAnswer = Frozen<
  | z.infer<typeof droppedAnswer>
  | z.infer<typeof forecastAnswer>
  | z.infer<typeof gapsAnswer>
  | z.infer<typeof suppressionAnswer>
>;

/**
 * What a check reads: a record or an array of them, a stats result
 * (`{ rows }`), a page (`{ items }`), or an insight's result or its `data`.
 */
export type CheckRead =
  | CheckAnswer
  | OutboundRecord
  | readonly OutboundRecord[]
  | { readonly data: CheckAnswer; readonly insight: string }
  | { readonly items: readonly OutboundRecord[] }
  | { readonly rows: readonly MetricRow[] };

/** An insight's `{ insight, data, meta }` result, to read its `data`. */
const insightResult = z.object({ data: z.unknown(), insight: z.string() });

const measureAnswer = <Data>(
  schema: z.ZodType<Data>,
  read: (data: Data) => Readings,
  input: CheckRead
): Readings | null => {
  const result = insightResult.safeParse(input);
  const parsed = schema.safeParse(result.success ? result.data.data : input);

  return parsed.success ? read(parsed.data) : null;
};

const ANSWERS = {
  droppedReplies: (input: CheckRead) =>
    measureAnswer(droppedAnswer, fromDropped, input),
  personalizationGaps: (input: CheckRead) =>
    measureAnswer(gapsAnswer, fromGaps, input),
  pipelineForecast: (input: CheckRead) =>
    measureAnswer(forecastAnswer, fromForecast, input),
  suppressionCheck: (input: CheckRead) =>
    measureAnswer(suppressionAnswer, fromSuppression, input),
};

const listed = z.union([
  z.array(z.unknown()),
  z.object({ rows: z.array(z.unknown()) }).transform((result) => result.rows),
  z.object({ items: z.array(z.unknown()) }).transform((page) => page.items),
]);

const parsedAll = <Item>(
  schema: z.ZodType<Item>,
  records: readonly unknown[]
): Item[] =>
  records.flatMap((record) => {
    const parsed = schema.safeParse(record);

    return parsed.success ? [parsed.data] : [];
  });

const fromRecords = (
  metric: CheckMetricName,
  source: "senders" | "stats",
  input: CheckRead,
  options: MeasureOptions
): Measured => {
  const list = listed.safeParse(input);
  const records = list.success ? list.data : [input];
  const rows = source === "stats" ? parsedAll(metricRowSchema, records) : [];
  const senders = source === "senders" ? parsedAll(senderSchema, records) : [];

  // Other records beside the right ones are fine: a rule sees every record.
  // Only nothing of the right kind, out of something, is a wrong input.
  if (records.length > 0 && rows.length + senders.length === 0) {
    return {
      ok: false,
      reason:
        source === "stats"
          ? `${metric} reads stats rows. Pass the rows a stats() read returned`
          : `${metric} reads senders. Pass what outbound.senders.list() returned`,
    };
  }

  return {
    ok: true,
    readings:
      source === "stats"
        ? fromRows(metric, rows, options)
        : fromSenders(senders),
  };
};

/** Reads the metric from the input. */
export const measure = (
  metric: CheckMetricName,
  source: CheckSource,
  input: CheckRead,
  options: MeasureOptions
): Measured => {
  if (source === "stats" || source === "senders") {
    return fromRecords(metric, source, input, options);
  }

  const readings = ANSWERS[source](input);

  return readings === null
    ? {
        ok: false,
        reason: `${metric} reads a ${source} answer. Pass what outbound.insights.${source}() returned`,
      }
    : { ok: true, readings };
};
