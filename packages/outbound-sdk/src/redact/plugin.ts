// outbound-sdk/redact: masks personal data in results before they reach a
// caller, an agent or a report. List it first so it is the outermost plugin.
//
// It fails closed: a record it does not recognise is refused, never passed
// through unprotected. The vendor's raw payload is always dropped, because it
// holds everything the normalized fields were taken from.
//
// Ids and refs: some vendors use an email address or a LinkedIn profile URL
// as a record's id (a mailbox on Instantly, a lead on HeyReach), so that part
// of `ref`, `sourceId` and every `*Ref` field is masked like the field itself.
// Under `hash` the same id always gives the same token, so a record keeps its
// ref from one call to the next. What remains: an id the vendor made up (a
// number, a UUID) is not personal data and stays, and so does a bare profile
// slug with no URL around it, which cannot be told apart from one.

import type { OutboundEvent } from "../internal/entities.ts";
import { OutboundError } from "../internal/errors.ts";
import type { Json, JsonObject } from "../internal/json.ts";
import { isJsonArray, isJsonObject, isString } from "../internal/json.ts";
import type {
  OperationOutput,
  OutboundRecord,
} from "../internal/outbound/operations.ts";
import type { OutboundPlugin } from "../internal/outbound/plugins.ts";
import { makeRef, parseRef } from "../internal/ref.ts";
import { stableId } from "../internal/sha256.ts";
import { profileSlug } from "../internal/url.ts";

export type RedactField =
  | "body"
  | "company"
  | "custom"
  | "email"
  | "linkedin"
  | "name"
  | "phone"
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
  "phone",
  "subject",
];

export const MASK = "[redacted]";

/** What `redact` adds to the instance, so other plugins and tools can see what is masked. */
export interface RedactExtension {
  readonly redacted: {
    readonly fields: readonly RedactField[];
    readonly strategy: "hash" | "mask";
    /**
     * What this redact writes in place of `value` in a masked field: the
     * stable token under `hash`, so a caller can find a known address among
     * hashed records without the records holding it; `[redacted]` under
     * `mask`.
     */
    readonly hash: (value: string) => string;
  };
}

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

const EMAIL_IN_ID = /[^\s@:/]+@[^\s@:/]+\.[^\s@:/]+/gu;

// A profile URL is replaced whole, by its slug's token; an address is replaced
// where it stands. Both are lowercased first, so one person gives one token.
const maskId = (masks: Masks, id: string): string => {
  const slug = masks.has("linkedin") ? profileSlug(id) : null;

  if (slug !== null) {
    return masks.replace(slug) ?? MASK;
  }

  return masks.has("email")
    ? id.replaceAll(
        EMAIL_IN_ID,
        (address) => masks.replace(address.toLowerCase()) ?? MASK
      )
    : id;
};

const maskRef = (masks: Masks, ref: string): string => {
  const parts = parseRef(ref);

  return parts === null
    ? maskId(masks, ref)
    : makeRef(parts.provider, parts.workspaceId, maskId(masks, parts.sourceId));
};

const KEY_FIELDS: readonly RedactField[] = ["email", "linkedin"];

// The identity plugin's `email:` and `linkedin:` keys keep their prefix.
const maskKey = (masks: Masks, key: string): string => {
  const field = KEY_FIELDS.find((name) => key.startsWith(`${name}:`));

  return field === undefined || !masks.has(field)
    ? key
    : `${field}:${masks.replace(key.slice(field.length + 1)) ?? MASK}`;
};

const maskEach = (
  value: Json | undefined,
  mask: (text: string) => string
): Json | undefined => {
  if (isString(value)) {
    return mask(value);
  }

  return isJsonArray(value)
    ? value.map((item) => (isString(item) ? mask(item) : item))
    : value;
};

type Fields = Readonly<Record<string, Json | undefined>>;

/** Masks the ids, the refs and the person keys a record or an event carries. */
const maskIdentifiers = <Item extends Fields>(
  masks: Masks,
  item: Item
): Item => {
  const changed: Record<string, Json | undefined> = {};

  for (const [key, value] of Object.entries(item)) {
    if (key === "sourceId") {
      changed[key] = maskEach(value, (id) => maskId(masks, id));
    } else if (key === "ref" || key.endsWith("Ref") || key.endsWith("Refs")) {
      changed[key] = maskEach(value, (ref) => maskRef(masks, ref));
    } else if (key === "personKey" || key === "personKeys") {
      changed[key] = maskEach(value, (personKey) => maskKey(masks, personKey));
    }
  }

  // SAFETY: only strings were replaced, each by a string, so the shape is the same.
  return { ...item, ...changed } as Item;
};

const BLOCK_FIELDS = new Map<string, RedactField>([
  ["email", "email"],
  ["linkedin", "linkedin"],
]);

// Records are told apart by a field only that kind has.
const redactFields = (masks: Masks, record: OutboundRecord): OutboundRecord => {
  if ("scope" in record) {
    // Metric rows hold counts only, and a ref to what was counted.
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
      // The company's LinkedIn page and its website name the company too.
      companyLinkedinUrl: maskIf(masks, "company", record.companyLinkedinUrl),
      custom: maskCustom(masks, record.custom),
      email: maskIf(masks, "email", record.email),
      firstName: maskIf(masks, "name", record.firstName),
      lastName: maskIf(masks, "name", record.lastName),
      linkedinUrl: maskIf(masks, "linkedin", record.linkedinUrl),
      phone: maskIf(masks, "phone", record.phone),
      raw: null,
      website: maskIf(masks, "company", record.website),
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
    "inProgress" in record ||
    "nextRunAt" in record ||
    "schedule" in record ||
    "dns" in record ||
    "size" in record ||
    "url" in record ||
    "description" in record
  ) {
    // Sequences hold template text; progress, settings, health, lists,
    // webhooks and tags hold no person.
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

const redactRecord = (masks: Masks, record: OutboundRecord): OutboundRecord =>
  maskIdentifiers(masks, redactFields(masks, record));

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
export const redact = (
  options: RedactOptions = {}
): OutboundPlugin<RedactExtension> => {
  const fields = new Set(options.fields ?? ALL_FIELDS);
  const strategy = options.strategy ?? "mask";

  const masks: Masks = {
    has: (field) => fields.has(field),
    replace: replacer(strategy),
  };

  return {
    // Asking for bodies while they are being removed is a contradiction, so
    // the capability is turned off and the request is refused up front.
    // A native read returns the vendor's payload untouched, so it is turned off.
    capabilities: (capabilities) =>
      fields.has("body")
        ? { ...capabilities, "messages.body": false, native: false }
        : { ...capabilities, native: false },
    event: (event): OutboundEvent =>
      maskIdentifiers(masks, {
        ...event,
        data: redactEventData(masks, event.data),
        raw: null,
      }),
    extend: () => ({
      redacted: {
        fields: [...fields].toSorted(),
        hash: (value) => masks.replace(value) ?? MASK,
        strategy,
      },
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
