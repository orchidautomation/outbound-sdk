// outbound-sdk/redact: masks personal data in results before they reach a
// caller, an agent or a report. List it first so it is the outermost plugin.
//
// It fails closed: a record it does not recognise is refused, never passed
// through unprotected. The vendor's raw payload is always dropped, because it
// holds everything the normalized fields were taken from.
//
// Ids and refs: some vendors use an email address or a LinkedIn profile URL
// as a record's id (a mailbox on Instantly, a lead on HeyReach), so that part
// of `ref`, `sourceId`, every `*Ref` field and every person key is replaced
// by a token. An address or a profile is how records are counted and joined,
// so it never becomes one shared `[redacted]`, which would merge everyone
// into one person (OUT-122). The token is a keyed hash, under the caller's
// `key` or `OUTBOUND_REDACT_KEY`, or under `mask` with neither a key made
// for this plugin, and never shown. The `email` and `linkedinUrl` fields get
// the same token as the id: two people keep two refs and a reply still joins
// its lead, and the token cannot be traced back to the address or profile
// without the key. Under `hash` every masked value becomes such a token, so a
// record keeps its ref from one run to the next; with no key it is a plain
// digest anyone can recompute, which is deprecated and says so. What
// remains: an id the vendor made up (a number, a UUID) is not personal data
// and stays, and so does a bare profile slug with no URL around it, which
// cannot be told apart from one.

import type { Lead, OutboundEvent } from "../internal/entities.ts";
import { OutboundError } from "../internal/errors.ts";
import type { Json, JsonObject } from "../internal/json.ts";
import { isJsonArray, isJsonObject, isString } from "../internal/json.ts";
import type { ListAll } from "../internal/outbound/api.ts";
import type {
  Operation,
  OperationOutput,
  OutboundRecord,
} from "../internal/outbound/operations.ts";
import type { OutboundPlugin } from "../internal/outbound/plugins.ts";
import { makeRef, parseRef } from "../internal/ref.ts";
import { stableId } from "../internal/sha256.ts";
import { profileSlug } from "../internal/url.ts";
import {
  checkedKey,
  KEYLESS_NOTES,
  keyedToken,
  knownTokens,
  TOKEN,
  warnUnkeyedHash,
} from "./tokens.ts";
import type { Identifier, Known } from "./tokens.ts";

export { KNOWN_TOKENS, MIN_KEY_LENGTH, REDACT_KEY_ENV } from "./tokens.ts";

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
   * `mask` replaces a value with `[redacted]`, and an address or a profile
   * with a keyed token, so people can still be counted and joined. `hash`
   * replaces every value with a token under the key. `hash` with no key is
   * deprecated: its tokens can be computed from a guessed address, so it
   * warns once on stderr and adds a note to every answer.
   */
  readonly strategy?: "hash" | "mask" | undefined;
  /**
   * A secret, at least `MIN_KEY_LENGTH` (32) characters, that keys the
   * tokens. Defaults to `OUTBOUND_REDACT_KEY`, as in the CLI and
   * `outbound mcp`. With it the same person gets the same token in every
   * instance and process given the same key, under `mask` and `hash` alike,
   * so redacted data can be joined across runs. Without it `mask` makes a
   * random key for each plugin, and `hash` is unkeyed. Anyone holding the
   * key can test a guessed address against a token, and a new key gives
   * every person a new token.
   */
  readonly key?: string | undefined;
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
     * token under `hash`, so a caller can find a known address among
     * hashed records without the records holding it; `[redacted]` under
     * `mask`, whose tokens for addresses and profiles are keyed and never
     * given out.
     */
    readonly hash: (value: string) => string;
    /**
     * What a token this redact wrote for an address or a profile stands for,
     * `email` or `linkedin`, or `null` when it wrote no such token. The
     * value itself is never given out: a call that names the token, in a ref
     * or a field, reaches the vendor with the value in its place, and its
     * answer comes back masked.
     */
    readonly resolves: (token: string) => Identifier | null;
    /**
     * The leads behind the address tokens given, in one campaign or all,
     * read with the addresses in their place and returned masked. A token
     * this redact did not write for an address is left out.
     */
    readonly leadsByToken: (
      tokens: readonly string[],
      campaign: string | null
    ) => ListAll<Lead>;
  };
}

type Replace = (value: string | null) => string | null;

const replacer = (
  strategy: "hash" | "mask",
  secret: string | undefined
): Replace => {
  const hashed =
    secret === undefined
      ? (value: string) => `redacted:${stableId(value).slice(0, 16)}`
      : keyedToken(secret);

  return (value) => {
    if (value === null) {
      return null;
    }

    return strategy === "mask" ? MASK : hashed(value);
  };
};

interface Masks {
  readonly has: (field: RedactField) => boolean;
  readonly replace: Replace;
  readonly known: Known;
  /** What an address or a profile in an id becomes: one token per person. */
  readonly token: (
    kind: Identifier,
    value: string,
    original?: string
  ) => string;
  /** What an `email` or `linkedinUrl` field becomes. */
  readonly identifier: (
    field: Identifier,
    value: string | null
  ) => string | null;
}

const maskIdentifier = (
  masks: Masks,
  field: Identifier,
  value: string | null
): string | null => (masks.has(field) ? masks.identifier(field, value) : value);

const masksFor = (
  fields: ReadonlySet<RedactField>,
  strategy: "hash" | "mask",
  secret: string | undefined
): Masks => {
  const replace = replacer(strategy, secret);
  const has = (field: RedactField): boolean => fields.has(field);
  const known = knownTokens();

  if (strategy === "hash") {
    return {
      has,
      identifier: (field, value) =>
        value === null
          ? null
          : known.remember(replace(value) ?? MASK, field, value),
      known,
      replace,
      token: (kind, value, original = value) =>
        known.remember(replace(value) ?? MASK, kind, original),
    };
  }

  const keyed = keyedToken(secret);

  const token = (kind: Identifier, value: string, original = value): string =>
    known.remember(keyed(value), kind, original);

  // Normalized as in an id, so the field and the ref get the same token.
  return {
    has,
    identifier: (field, value) =>
      value === null
        ? null
        : token(
            field,
            field === "email"
              ? value.toLowerCase()
              : (profileSlug(value) ?? value),
            value
          ),
    known,
    replace,
    token,
  };
};

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
    return masks.token("linkedin", slug, id);
  }

  return masks.has("email")
    ? id.replaceAll(EMAIL_IN_ID, (address) =>
        masks.token("email", address.toLowerCase(), address)
      )
    : id;
};

const maskRef = (masks: Masks, ref: string): string => {
  const parts = parseRef(ref);

  return parts === null
    ? maskId(masks, ref)
    : makeRef(parts.provider, parts.workspaceId, maskId(masks, parts.sourceId));
};

const KEY_FIELDS: readonly Identifier[] = ["email", "linkedin"];

// The identity plugin's `email:` and `linkedin:` keys keep their prefix.
const maskKey = (masks: Masks, key: string): string => {
  const field = KEY_FIELDS.find((name) => key.startsWith(`${name}:`));

  return field === undefined || !masks.has(field)
    ? key
    : `${field}:${masks.token(field, key.slice(field.length + 1))}`;
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

const BLOCK_FIELDS = new Map<string, Identifier>([
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
    const message = {
      ...record,
      bodyHtml: maskIf(masks, "body", record.bodyHtml),
      bodyText: maskIf(masks, "body", record.bodyText),
      raw: null,
      subject: maskIf(masks, "subject", record.subject),
    };

    if (record.leadEmail !== undefined) {
      message.leadEmail = maskIdentifier(masks, "email", record.leadEmail);
    }

    return message;
  }

  if ("custom" in record) {
    return {
      ...record,
      company: maskIf(masks, "company", record.company),
      // The company's LinkedIn page and its website name the company too.
      companyLinkedinUrl: maskIf(masks, "company", record.companyLinkedinUrl),
      custom: maskCustom(masks, record.custom),
      email: maskIdentifier(masks, "email", record.email),
      firstName: maskIf(masks, "name", record.firstName),
      lastName: maskIf(masks, "name", record.lastName),
      linkedinUrl: maskIdentifier(masks, "linkedin", record.linkedinUrl),
      phone: maskIf(masks, "phone", record.phone),
      raw: null,
      website: maskIf(masks, "company", record.website),
    };
  }

  if ("value" in record) {
    // A block list entry names a person only when it is an address or a profile.
    const blocked = BLOCK_FIELDS.get(record.kind);

    return {
      ...record,
      raw: null,
      value:
        blocked === undefined
          ? record.value
          : (maskIdentifier(masks, blocked, record.value) ?? MASK),
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
      address: maskIdentifier(masks, "email", record.address),
      linkedinUrl: maskIdentifier(masks, "linkedin", record.linkedinUrl),
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

const maskEventField = (
  masks: Masks,
  field: RedactField,
  value: string
): string | null =>
  field === "email" || field === "linkedin"
    ? maskIdentifier(masks, field, value)
    : maskIf(masks, field, value);

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
      result[key] = isString(value)
        ? maskEventField(masks, field, value)
        : null;
    }
  }

  return result;
};

// A vendor's error can quote what it was asked for, so a call sent with a
// value in place of a token fails with the token put back and no cause.
const remasked = (known: Known, error: OutboundError): OutboundError =>
  new OutboundError(error.code, known.remask(error.message), {
    aborted: error.aborted,
    limit: error.limit,
    permanent: error.permanent,
    provider: error.provider,
    retryAfterMs: error.retryAfterMs,
    status: error.status,
    timedOut: error.timedOut,
  });

/**
 * A query with the value of each token this redact wrote, in every string
 * and list of strings: a lead's id in `leadId`, a thread id, addresses.
 * `undefined` when it held none.
 */
type OperationQuery = Extract<Operation, { readonly query: unknown }>["query"];

const unmaskedQuery = (
  known: Known,
  query: OperationQuery
): Fields | undefined => {
  if (JSON.stringify(query).match(TOKEN) === null) {
    return undefined;
  }

  // SAFETY: a query holds strings, numbers, booleans, lists of strings and a cursor.
  const fields = query as Fields;

  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key,
      maskEach(value, (text) => known.unmask(text)),
    ])
  );
};

/**
 * The call with the value of each token this redact wrote in place of it,
 * in its id or anywhere in its query, so a filter such as a lead timeline's
 * `leadId` reaches the vendor as the real value.
 */
const unmasked = (known: Known, operation: Operation): Operation => {
  if ("id" in operation) {
    const id = known.unmask(operation.id);

    return id === operation.id ? operation : { ...operation, id };
  }

  const query = unmaskedQuery(known, operation.query);

  // SAFETY: only strings were replaced, each by a string, so the query keeps its type.
  return query === undefined
    ? operation
    : ({ ...operation, query } as Operation);
};

/** What to do about a token no process can put back but the one that wrote it. */
export const UNKNOWN_TOKEN_REMEDY =
  "Redact keeps what each token stands for in memory, only in the process that wrote it, so it is not sent to the vendor. Run the tool that returned it again in this session. The redact key (redact's key option, or OUTBOUND_REDACT_KEY in the environment) keeps tokens the same across runs, so a token you kept matches its records again once they are read in the new session.";

/**
 * Refuses a call that still names a token once every known one is put back:
 * a token from another session or process would reach the vendor as it is.
 */
const refuseUnknownTokens = (operation: Operation, provider: string): void => {
  const [token] = JSON.stringify(operation).match(TOKEN) ?? [];

  if (token !== undefined) {
    throw new OutboundError(
      "NotFound",
      `"${token}" is a redacted token from another session or process. ${UNKNOWN_TOKEN_REMEDY}`,
      { provider }
    );
  }
};

/** Masks emails, names, companies, LinkedIn URLs, custom fields and message text. */
export const redact = (
  options: RedactOptions = {}
): OutboundPlugin<RedactExtension> => {
  const fields = new Set(options.fields ?? ALL_FIELDS);
  const strategy = options.strategy ?? "mask";

  const key = checkedKey(options.key);
  const masks = masksFor(fields, strategy, key);
  const note = key === undefined ? KEYLESS_NOTES[strategy] : undefined;

  if (strategy === "hash" && key === undefined) {
    warnUnkeyedHash();
  }

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
    extend: (outbound) => ({
      redacted: {
        fields: [...fields].toSorted(),
        hash: (value) => masks.replace(value) ?? MASK,
        leadsByToken: (tokens, campaign) => {
          const emails = tokens.flatMap((token) =>
            masks.known.kindOf(token) === "email"
              ? masks.known.unmask(token)
              : []
          );

          return campaign === null
            ? outbound.leads.listAll({ emails })
            : outbound.campaign(campaign).leads.listAll({ emails });
        },
        resolves: (token) => masks.known.kindOf(token),
        strategy,
      },
    }),
    name: "redact",
    wrap: async (operation, next, info): Promise<OperationOutput> => {
      const sent = unmasked(masks.known, operation);

      refuseUnknownTokens(sent, info.provider);

      let output: OperationOutput;

      try {
        output = await next(sent);
      } catch (error) {
        throw sent !== operation && OutboundError.is(error)
          ? remasked(masks.known, error)
          : error;
      }

      const items = output.items.map((record) => redactRecord(masks, record));

      // Said only where a token was written, which is where it matters.
      return note === undefined || JSON.stringify(items).match(TOKEN) === null
        ? { ...output, items }
        : { ...output, items, notes: [...(output.notes ?? []), note] };
    },
  };
};
