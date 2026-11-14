// Which fields of each record an adapter fills. A capability says whether a
// read exists; this says what the read can tell you. Without it a `null`
// cannot be told apart: the vendor has no such field, or this record has no
// value. An adapter declares only the exceptions, so a field it says nothing
// about is one the vendor reports.

import type { z } from "zod";

import {
  blockEntrySchema,
  campaignSettingsSchema,
  leadListSchema,
  senderHealthSchema,
  tagSchema,
  webhookSubscriptionSchema,
} from "./entities-account.ts";
import {
  campaignSchema,
  leadSchema,
  messageSchema,
  metricRowSchema,
  replySchema,
  senderSchema,
  sequenceSchema,
  workspaceSchema,
} from "./entities.ts";

/** Every record the SDK returns, by the name the coverage uses for it. */
export const RECORD_SCHEMAS = {
  blockEntry: blockEntrySchema,
  campaign: campaignSchema,
  campaignSettings: campaignSettingsSchema,
  lead: leadSchema,
  leadList: leadListSchema,
  message: messageSchema,
  metricRow: metricRowSchema,
  reply: replySchema,
  sender: senderSchema,
  senderHealth: senderHealthSchema,
  sequence: sequenceSchema,
  tag: tagSchema,
  webhook: webhookSubscriptionSchema,
  workspace: workspaceSchema,
} as const;

export type RecordName = keyof typeof RECORD_SCHEMAS;

/**
 * `exact`: the vendor reports the field and the adapter reads it. `derived`:
 * the adapter computes it, or takes it from a neighbouring record. `false`:
 * this adapter never fills it, so it is always empty (`null`, `[]`, `{}` or
 * `unknown`).
 */
export type FieldGrade = "derived" | "exact" | false;

// What says whose record it is and what it is a row of. Always filled.
const IDENTITY = new Set([
  "provider",
  "raw",
  "ref",
  "schemaVersion",
  "sourceId",
  "workspaceId",
]);

type Identity =
  | "provider"
  | "raw"
  | "ref"
  | "schemaVersion"
  | "sourceId"
  | "workspaceId";

type FieldOf<Name extends RecordName> = Exclude<
  keyof z.infer<(typeof RECORD_SCHEMAS)[Name]>,
  Identity
>;

/**
 * What an adapter declares: for each record, the fields it derives or never
 * fills, or `false` for a record it never returns.
 */
export type FieldDeclaration = {
  readonly [Name in RecordName]?:
    | false
    | { readonly [Field in FieldOf<Name>]?: "derived" | false };
};

/** Every field of every record, with its grade. */
export type FieldCoverage = {
  readonly [Name in RecordName]: Readonly<Record<string, FieldGrade>>;
};

// SAFETY: Object.keys of an object with RecordName keys is its RecordName keys.
export const RECORD_NAMES = Object.keys(RECORD_SCHEMAS) as RecordName[];

/** The fields of a record that an adapter maps, in the schema's order. */
export const fieldsOf = (name: RecordName): string[] =>
  Object.keys(RECORD_SCHEMAS[name].shape).filter(
    (field) => !IDENTITY.has(field)
  );

const gradesOf = (
  name: RecordName,
  declared: FieldDeclaration[RecordName]
): Record<string, FieldGrade> => {
  const stated: Readonly<Record<string, "derived" | false | undefined>> =
    declared === false || declared === undefined ? {} : declared;

  return Object.fromEntries(
    fieldsOf(name).map((field) => [
      field,
      declared === false ? false : (stated[field] ?? "exact"),
    ])
  );
};

/** The full coverage behind a declaration. Saying nothing means `exact`. */
export const resolveFields = (declared: FieldDeclaration = {}): FieldCoverage =>
  // SAFETY: every RecordName is mapped, so the entries are a FieldCoverage.
  Object.fromEntries(
    RECORD_NAMES.map((name) => [name, gradesOf(name, declared[name])])
  ) as FieldCoverage;

const best = (grades: readonly FieldGrade[]): FieldGrade => {
  if (grades.includes("exact")) {
    return "exact";
  }

  return grades.includes("derived") ? "derived" : false;
};

/**
 * The coverage of several adapters read as one: a field is filled when any
 * of them fills it, and `exact` when any of them reads it from its vendor.
 */
export const mergeFields = (
  coverages: readonly FieldCoverage[]
): FieldCoverage =>
  // SAFETY: every RecordName is mapped, so the entries are a FieldCoverage.
  Object.fromEntries(
    RECORD_NAMES.map((name) => [
      name,
      Object.fromEntries(
        fieldsOf(name).map((field) => [
          field,
          best(coverages.map((coverage) => coverage[name][field] ?? false)),
        ])
      ),
    ])
  ) as FieldCoverage;
