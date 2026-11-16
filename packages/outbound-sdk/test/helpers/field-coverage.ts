// Holds each adapter to what it declares about its fields, both ways: a field
// it says it never fills is empty in every record its fixtures produce, and a
// field it says nothing about is filled in at least one of them.

import assert from "node:assert/strict";
import { test } from "node:test";

import { OutboundError } from "../../src/index.ts";
import type { FieldCoverage, Outbound } from "../../src/index.ts";

type RecordName = keyof FieldCoverage;

export interface CoverageSuite {
  readonly provider: string;
  readonly ids: {
    readonly campaign: string;
    readonly lead?: string;
    readonly sender?: string;
    readonly list?: string;
    readonly thread?: string;
    readonly webhook?: string;
  };
  /**
   * Fields the adapter fills that the default fixtures do not show, by record,
   * each with the reason. The check refuses an entry the fixtures do show.
   */
  readonly unsampled?:
    | Partial<Record<RecordName, Readonly<Record<string, string>>>>
    | undefined;
}

interface CoverageHarness {
  readonly outbound: Outbound;
  readonly settle: <Value>(promise: Promise<Value>) => Promise<Value>;
}

type Ids = CoverageSuite["ids"];

type Sampler = (outbound: Outbound, ids: Ids) => Promise<readonly unknown[]>;

const one = async (record: Promise<unknown>): Promise<unknown[]> => [
  await record,
];

const items = async (
  page: Promise<{ readonly items: readonly unknown[] }>
): Promise<readonly unknown[]> => (await page).items;

const rows = async (
  stats: Promise<{ readonly rows: readonly unknown[] }>
): Promise<readonly unknown[]> => (await stats).rows;

const BODY = { include: ["body"] } as const;
const WINDOW = { from: "2025-01-01", to: "2025-01-31" } as const;

// Every read that returns the record. One that needs an id the suite does
// not have is left out.
const samplers = (ids: Ids): Record<RecordName, Sampler[]> => {
  const { campaign, lead, list, sender, thread, webhook } = ids;

  return {
    blockEntry: [(outbound) => outbound.blocklist.listAll().toArray()],
    campaign: [
      (outbound) => outbound.campaigns.listAll().toArray(),
      (outbound) => one(outbound.campaigns.get(campaign)),
    ],
    campaignProgress: [
      (outbound) => one(outbound.campaign(campaign).progress()),
    ],
    campaignSettings: [
      (outbound) => one(outbound.campaign(campaign).settings()),
    ],
    lead: [
      (outbound) => outbound.leads.listAll().toArray(),
      (outbound) => outbound.campaign(campaign).leads.listAll().toArray(),
      ...(lead === undefined
        ? []
        : [(outbound: Outbound) => one(outbound.leads.get(lead))]),
      ...(list === undefined
        ? []
        : [
            (outbound: Outbound) =>
              outbound.list(list).leads.listAll().toArray(),
          ]),
    ],
    leadList: [
      (outbound) => outbound.lists.listAll().toArray(),
      ...(list === undefined
        ? []
        : [(outbound: Outbound) => one(outbound.lists.get(list))]),
    ],
    message: [
      (outbound) => outbound.messages.listAll(BODY).toArray(),
      (outbound) =>
        outbound.campaign(campaign).messages.listAll(BODY).toArray(),
      ...(lead === undefined
        ? []
        : [(outbound: Outbound) => items(outbound.lead(lead).timeline(BODY))]),
      ...(thread === undefined
        ? []
        : [
            (outbound: Outbound) =>
              items(outbound.thread(thread).messages(BODY)),
          ]),
    ],
    metricRow: [
      (outbound) => rows(outbound.stats()),
      (outbound) => rows(outbound.stats({ by: "day" })),
      (outbound) => rows(outbound.stats({ scope: "campaign" })),
      (outbound) => rows(outbound.campaign(campaign).stats()),
      (outbound) => rows(outbound.campaign(campaign).stats(WINDOW)),
      (outbound) => rows(outbound.campaign(campaign).stats({ scope: "step" })),
      ...(sender === undefined
        ? []
        : [(outbound: Outbound) => rows(outbound.sender(sender).stats())]),
    ],
    placementTest: [(outbound) => outbound.placementTests.listAll().toArray()],
    reply: [
      (outbound) => outbound.replies.listAll(BODY).toArray(),
      (outbound) => outbound.campaign(campaign).replies.listAll(BODY).toArray(),
    ],
    sender: [
      (outbound) => outbound.senders.listAll().toArray(),
      ...(sender === undefined
        ? []
        : [(outbound: Outbound) => one(outbound.senders.get(sender))]),
    ],
    senderHealth:
      sender === undefined
        ? []
        : [(outbound) => one(outbound.sender(sender).health())],
    sequence: [
      (outbound) => one(outbound.campaign(campaign).sequence()),
      (outbound) =>
        outbound.campaign(campaign).subsequences.listAll().toArray(),
    ],
    tag: [(outbound) => outbound.tags.listAll().toArray()],
    webhook: [
      (outbound) => outbound.webhooks.listAll().toArray(),
      ...(webhook === undefined
        ? []
        : [(outbound: Outbound) => one(outbound.webhooks.get(webhook))]),
    ],
    workspace: [(outbound) => outbound.workspaces.listAll().toArray()],
  };
};

/** `null`, `""`, `unknown`, `[]`, `{}`, or an object of nothing but those. */
const isEmpty = (value: unknown): boolean => {
  if (value === null || value === undefined) {
    return true;
  }

  if (value === "" || value === "unknown") {
    return true;
  }

  if (Array.isArray(value)) {
    return value.length === 0;
  }

  return typeof value === "object" && Object.values(value).every(isEmpty);
};

// A read the adapter does not support produces no sample; any other failure
// is a failure of the test.
const sample = async (
  make: () => CoverageHarness,
  ids: Ids,
  sampler: Sampler
): Promise<readonly unknown[]> => {
  const { outbound, settle } = make();

  try {
    return await settle(sampler(outbound, ids));
  } catch (error) {
    if (OutboundError.is(error) && error.code === "Unsupported") {
      return [];
    }

    throw error;
  }
};

const valueOf = (record: unknown, field: string): unknown =>
  typeof record === "object" && record !== null
    ? (record as Record<string, unknown>)[field]
    : undefined;

type Grades = FieldCoverage[RecordName];

// What is wrong with one field, given the records the fixtures produced.
const fieldProblems = (
  name: string,
  grade: Grades[string],
  filled: boolean,
  excuse: string | undefined
): string[] => {
  const problems: string[] = [];

  if (grade === false && filled) {
    problems.push(`${name}: declared false, but it is filled`);
  }

  if (grade !== false && !filled && excuse === undefined) {
    problems.push(
      `${name}: never filled by the fixtures; declare it false, or list it under unsampled with the reason`
    );
  }

  if (excuse !== undefined && grade === false) {
    problems.push(`${name}: listed under unsampled, but it is declared false`);
  }

  if (excuse !== undefined && filled) {
    problems.push(`${name}: listed under unsampled, but it is filled`);
  }

  return problems;
};

// What is wrong with one record: whether it is returned at all, then each
// of its fields.
const recordProblems = (
  record: RecordName,
  grades: Grades,
  records: readonly unknown[],
  excused: Readonly<Record<string, string>>
): string[] => {
  const never = Object.values(grades).every((grade) => grade === false);

  if (never && records.length > 0) {
    return [`${record}: declared as never returned, but a read returned one`];
  }

  if (!never && records.length === 0) {
    return [
      `${record}: no read returned one; declare it false or give the suite the id it needs`,
    ];
  }

  return Object.entries(grades).flatMap(([field, grade]) =>
    fieldProblems(
      `${record}.${field}`,
      grade,
      records.some((each) => !isEmpty(valueOf(each, field))),
      excused[field]
    )
  );
};

/** Registers the field-coverage test for one adapter. */
export const fieldCoverageTests = (
  suite: CoverageSuite,
  make: () => CoverageHarness
): void => {
  test(`${suite.provider}: every record matches the fields the adapter declares`, async () => {
    const coverage = make().outbound.fields;

    const problems = await Promise.all(
      Object.entries(samplers(suite.ids)).map(async ([name, readers]) => {
        // SAFETY: the samplers are keyed by RecordName.
        const record = name as RecordName;

        const records = await Promise.all(
          readers.map((reader) => sample(make, suite.ids, reader))
        );

        return recordProblems(
          record,
          coverage[record],
          records.flat(),
          suite.unsampled?.[record] ?? {}
        );
      })
    );

    assert.deepEqual(problems.flat(), []);
  });
};
