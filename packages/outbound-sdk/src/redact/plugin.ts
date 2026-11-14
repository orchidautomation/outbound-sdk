// outbound-sdk/redact: masks personal data in results before they reach a
// caller, an agent or a report. List it first so it is the outermost plugin.
//
// It fails closed: a record it does not recognise is refused, never passed
// through unprotected. The vendor's raw payload is always dropped, because it
// holds everything the normalized fields were taken from.

import type { OutboundEvent } from "../internal/entities.ts";
import { OutboundError } from "../internal/errors.ts";
import type { Json, JsonObject } from "../internal/json.ts";
import { isJsonObject, isString } from "../internal/json.ts";
import type {
  OperationOutput,
  OutboundRecord,
} from "../internal/outbound/operations.ts";
import type { OutboundPlugin } from "../internal/outbound/plugins.ts";
import { stableId } from "../internal/sha256.ts";

export type RedactField =
  | "body"
  | "company"
  | "custom"
  | "email"
  | "linkedin"
  | "name"
  | "subject";

export interface RedactOptions {
  /** What to mask. Defaults to everything. */
  readonly fields?: readonly RedactField[] | undefined;
  /**
   * `mask` replaces a value with `[redacted]`. `hash` replaces it with a
   * stable token, so the same person can still be counted and joined.
   */
  readonly strategy?: "hash" | "mask" | undefined;
}

export const ALL_FIELDS: readonly RedactField[] = [
  "body",
  "company",
  "custom",
  "email",
  "linkedin",
  "name",
  "subject",
];

export const MASK = "[redacted]";

type Replace = (value: string | null) => string | null;

const replacer =
  (strategy: "hash" | "mask"): Replace =>
  (value) => {
    if (value === null) {
      return null;
    }

    return strategy === "mask"
      ? MASK
      : `redacted:${stableId(value).slice(0, 16)}`;
  };

interface Masks {
  readonly has: (field: RedactField) => boolean;
  readonly replace: Replace;
}

const maskIf = (
  masks: Masks,
  field: RedactField,
  value: string | null
): string | null => (masks.has(field) ? masks.replace(value) : value);

const maskCustom = (
  masks: Masks,
  custom: Readonly<Record<string, string>>
): Record<string, string> =>
  masks.has("custom")
    ? Object.fromEntries(
        Object.keys(custom).map((key) => [
          key,
          masks.replace(custom[key] ?? "") ?? MASK,
        ])
      )
    : { ...custom };

const BLOCK_FIELDS = new Map<string, RedactField>([
  ["email", "email"],
  ["linkedin", "linkedin"],
]);

// Records are told apart by a field only that kind has.
const redactRecord = (masks: Masks, record: OutboundRecord): OutboundRecord => {
  if ("scope" in record) {
    // Metric rows hold counts only.
    return record;
  }

  if ("direction" in record) {
    return {
      ...record,
      bodyHtml: maskIf(masks, "body", record.bodyHtml),
      bodyText: maskIf(masks, "body", record.bodyText),
      raw: null,
      subject: maskIf(masks, "subject", record.subject),
    };
  }

  if ("custom" in record) {
    return {
      ...record,
      company: maskIf(masks, "company", record.company),
      custom: maskCustom(masks, record.custom),
      email: maskIf(masks, "email", record.email),
      firstName: maskIf(masks, "name", record.firstName),
      lastName: maskIf(masks, "name", record.lastName),
      linkedinUrl: maskIf(masks, "linkedin", record.linkedinUrl),
      raw: null,
    };
  }

  if ("value" in record) {
    // A block list entry names a person only when it is an address or a profile.
    const blocked: RedactField | undefined = BLOCK_FIELDS.get(record.kind);

    return {
      ...record,
      raw: null,
      value:
        blocked === undefined
          ? record.value
          : (maskIf(masks, blocked, record.value) ?? MASK),
    };
  }

  if (
    "steps" in record ||
    "schedule" in record ||
    "dns" in record ||
    "size" in record ||
    "url" in record ||
    "description" in record
  ) {
    // Sequences hold template text; settings, health, lists, webhooks and
    // tags hold no person.
    return { ...record, raw: null };
  }

  if ("kind" in record) {
    return {
      ...record,
      address: maskIf(masks, "email", record.address),
      linkedinUrl: maskIf(masks, "linkedin", record.linkedinUrl),
      name: maskIf(masks, "name", record.name),
      raw: null,
    };
  }

  if ("tags" in record || "name" in record) {
    // Campaigns and workspaces hold no person.
    return { ...record, raw: null };
  }

  throw new OutboundError(
    "Unsupported",
    "The redact plugin does not recognise this record, so it will not pass it through"
  );
};

const EVENT_FIELDS = new Map<string, RedactField>([
  ["leadEmail", "email"],
  ["leadName", "name"],
  ["linkedinUrl", "linkedin"],
  ["subject", "subject"],
  ["text", "body"],
]);

const redactEventData = (
  masks: Masks,
  data: Readonly<Record<string, Json>>
): JsonObject => {
  const result: JsonObject = {};

  for (const [key, value] of Object.entries(data)) {
    const field = EVENT_FIELDS.get(key);

    if (field === undefined) {
      // An object could hold anything, so only plain values are kept.
      result[key] = isJsonObject(value) || Array.isArray(value) ? MASK : value;
    } else {
      result[key] = isString(value) ? maskIf(masks, field, value) : null;
    }
  }

  return result;
};

/** Masks emails, names, companies, LinkedIn URLs, custom fields and message text. */
export const redact = (options: RedactOptions = {}): OutboundPlugin => {
  const fields = new Set(options.fields ?? ALL_FIELDS);

  const masks: Masks = {
    has: (field) => fields.has(field),
    replace: replacer(options.strategy ?? "mask"),
  };

  return {
    // Asking for bodies while they are being removed is a contradiction, so
    // the capability is turned off and the request is refused up front.
    // A native read returns the vendor's payload untouched, so it is turned off.
    capabilities: (capabilities) =>
      fields.has("body")
        ? { ...capabilities, "messages.body": false, native: false }
        : { ...capabilities, native: false },
    event: (event): OutboundEvent => ({
      ...event,
      data: redactEventData(masks, event.data),
      raw: null,
    }),
    name: "redact",
    wrap: async (operation, next): Promise<OperationOutput> => {
      const output = await next(operation);

      return {
        ...output,
        items: output.items.map((record) => redactRecord(masks, record)),
      };
    },
  };
};
