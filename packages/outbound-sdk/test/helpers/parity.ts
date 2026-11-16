// Vendor UI parity cases: a raw API response saved next to the numbers the
// vendor's own dashboard showed for the same campaign and range. The format
// and how to capture a case are in docs/vendor-parity.md.

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import type { MetricRow } from "../../src/index.ts";

export const PARITY_ROOT = path.resolve(
  import.meta.dirname,
  "../../../../fixtures/parity"
);

/** A dashboard shows a count, or a word such as "disabled". */
export type UiValue = number | string;

export interface ParityCase {
  readonly provider: string;
  readonly capturedAt: string;
  readonly source: string;
  /** `METHOD /path` the raw response came from. */
  readonly endpoint: string;
  readonly raw: unknown;
  readonly ui: Readonly<Record<string, UiValue>>;
}

/**
 * How a dashboard label is read off an SDK row, or why the SDK has no field
 * for it. Every label a case records must be declared one way or the other.
 */
export type UiReading =
  | ((row: MetricRow) => UiValue | null)
  | { readonly unmapped: string };

export type UiMapping = Readonly<Record<string, UiReading>>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown, key: string, where: string): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${where}: "${key}" must be a non-empty string`);
  }

  return value;
};

/** Checks one parsed case file and returns it typed. */
export const parseCase = (value: unknown, where: string): ParityCase => {
  if (!isRecord(value)) {
    throw new Error(`${where}: a parity case is a JSON object`);
  }

  const capturedAt = text(value.capturedAt, "capturedAt", where);

  if (!/^\d{4}-\d{2}-\d{2}$/u.test(capturedAt)) {
    throw new Error(`${where}: "capturedAt" must be a YYYY-MM-DD date`);
  }

  const endpoint = text(value.endpoint, "endpoint", where);

  if (!/^(?:GET|POST) \/\S+$/u.test(endpoint)) {
    throw new Error(`${where}: "endpoint" must look like "GET /path"`);
  }

  if (value.raw === undefined) {
    throw new Error(`${where}: "raw" holds the vendor's response`);
  }

  const { ui } = value;

  if (!isRecord(ui) || Object.keys(ui).length === 0) {
    throw new Error(`${where}: "ui" holds the dashboard's numbers`);
  }

  for (const [label, shown] of Object.entries(ui)) {
    if (typeof shown !== "number" && typeof shown !== "string") {
      throw new TypeError(`${where}: ui "${label}" must be a number or a word`);
    }
  }

  return {
    capturedAt,
    endpoint,
    provider: text(value.provider, "provider", where),
    raw: value.raw,
    source: text(value.source, "source", where),
    ui: ui as Record<string, UiValue>,
  };
};

/** The providers that have a folder of cases. */
export const parityProviders = (): string[] =>
  readdirSync(PARITY_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .toSorted();

/** Every case of one provider, by file name. */
export const parityCases = (
  provider: string
): { readonly file: string; readonly parity: ParityCase }[] =>
  readdirSync(path.join(PARITY_ROOT, provider))
    .filter((file) => file.endsWith(".json"))
    .toSorted()
    .map((file) => {
      const where = `fixtures/parity/${provider}/${file}`;

      const parity = parseCase(
        JSON.parse(
          readFileSync(path.join(PARITY_ROOT, provider, file), "utf-8")
        ),
        where
      );

      if (parity.provider !== provider) {
        throw new Error(`${where}: "provider" must be "${provider}"`);
      }

      return { file, parity };
    });

/**
 * Compares what the dashboard showed with what the SDK reports. Returns one
 * line per disagreement, and one per label nobody declared a reading for.
 */
export const compareParity = (
  ui: Readonly<Record<string, UiValue>>,
  row: MetricRow,
  mapping: UiMapping
): string[] =>
  Object.entries(ui).flatMap(([label, shown]) => {
    const reading = mapping[label];

    if (reading === undefined) {
      return [
        `"${label}" has no declared SDK reading; map it or mark it unmapped`,
      ];
    }

    if (typeof reading !== "function") {
      return [];
    }

    const got = reading(row);

    return got === shown
      ? []
      : [
          `"${label}": the dashboard shows ${JSON.stringify(shown)}, the SDK gives ${JSON.stringify(got)}`,
        ];
  });
