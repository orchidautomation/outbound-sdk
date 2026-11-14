// Replaces personal data in a record with numbered placeholders. The same
// value always gets the same placeholder, so records still join after
// scrubbing. The vendor's raw payload is dropped.

import type {
  BlockEntry,
  CampaignSettings,
  LeadList,
  SenderHealth,
  Tag,
  WebhookSubscription,
} from "../internal/entities-account.ts";
import type { Sequence } from "../internal/entities.ts";
import type { OutboundRecord } from "../internal/outbound/operations.ts";
import { makeRef, parseRef } from "../internal/ref.ts";

export interface Scrubber {
  readonly record: (record: OutboundRecord) => OutboundRecord;
}

type Kind =
  | "campaign"
  | "company"
  | "email"
  | "linkedin"
  | "person"
  | "value"
  | "workspace";

const FORMAT: Readonly<Record<Kind, (index: number) => string>> = {
  campaign: (index) => `Campaign ${index}`,
  company: (index) => `Company ${index}`,
  email: (index) => `person${index}@example.com`,
  linkedin: (index) => `https://www.linkedin.com/in/example-person-${index}`,
  person: (index) => `Person ${index}`,
  value: (index) => `value-${index}`,
  workspace: (index) => `Workspace ${index}`,
};

type Identified = OutboundRecord & {
  readonly ref: string;
  readonly sourceId: string;
};

interface Tools {
  readonly placeholder: (kind: Kind, value: string | null) => string | null;
  readonly scrubRef: (ref: string | null) => string | null;
  readonly base: <Item extends Identified>(
    item: Item
  ) => Item & { raw: null; ref: string; sourceId: string };
}

// The account-level records, told apart by a field only that kind has.
type AccountRecord =
  | BlockEntry
  | CampaignSettings
  | LeadList
  | SenderHealth
  | Sequence
  | Tag
  | WebhookSubscription;

const isAccountRecord = (record: OutboundRecord): record is AccountRecord =>
  "steps" in record ||
  "description" in record ||
  "schedule" in record ||
  "dns" in record ||
  "value" in record ||
  "size" in record ||
  "url" in record;

const accountRecord = (
  { base, placeholder, scrubRef }: Tools,
  record: AccountRecord
): OutboundRecord => {
  if ("steps" in record || "description" in record) {
    return base(record);
  }

  if ("schedule" in record) {
    return {
      ...base(record),
      campaignRef: scrubRef(record.campaignRef) ?? record.campaignRef,
    };
  }

  if ("dns" in record) {
    return {
      ...base(record),
      domain: record.domain === null ? null : "example.com",
      senderRef: scrubRef(record.senderRef) ?? record.senderRef,
    };
  }

  if ("value" in record) {
    return {
      ...base(record),
      value: placeholder("value", record.value) ?? record.value,
    };
  }

  if ("size" in record) {
    return {
      ...base(record),
      name: placeholder("value", record.name) ?? record.name,
    };
  }

  return {
    ...base(record),
    campaignRef: scrubRef(record.campaignRef),
    name: placeholder("value", record.name),
    url: "https://example.com/webhook",
  };
};

export const createScrubber = (): Scrubber => {
  const seen = new Map<string, string>();
  const counters = new Map<Kind, number>();

  const placeholder = (kind: Kind, value: string | null): string | null => {
    if (value === null) {
      return null;
    }

    const key = `${kind}:${value.toLowerCase()}`;
    const known = seen.get(key);

    if (known !== undefined) {
      return known;
    }

    const index = (counters.get(kind) ?? 0) + 1;
    counters.set(kind, index);
    const made = FORMAT[kind](index);
    seen.set(key, made);

    return made;
  };

  // Some vendors use an email address as the id, so refs can carry one.
  const scrubId = (id: string): string =>
    id.includes("@") ? (placeholder("email", id) ?? id) : id;

  const scrubRef = (ref: string | null): string | null => {
    const parts = ref === null ? null : parseRef(ref);

    return parts === null
      ? ref
      : makeRef(parts.provider, parts.workspaceId, scrubId(parts.sourceId));
  };

  const base = <Item extends Identified>(item: Item) => ({
    ...item,
    raw: null,
    ref: scrubRef(item.ref) ?? item.ref,
    sourceId: scrubId(item.sourceId),
  });

  return {
    record: (record) => {
      if ("scope" in record) {
        return {
          ...record,
          scopeRef: scrubRef(record.scopeRef) ?? record.scopeRef,
        };
      }

      if ("direction" in record) {
        return {
          ...base(record),
          bodyHtml: null,
          bodyText: record.bodyText === null ? null : "[body]",
          leadRef: scrubRef(record.leadRef),
          senderRef: scrubRef(record.senderRef),
          subject: record.subject === null ? null : "[subject]",
        };
      }

      if ("custom" in record) {
        return {
          ...base(record),
          company: placeholder("company", record.company),
          custom: Object.fromEntries(
            Object.entries(record.custom).map(([key, value]) => [
              key,
              placeholder("value", value) ?? "",
            ])
          ),
          email: placeholder("email", record.email),
          firstName: record.firstName === null ? null : "Person",
          lastName:
            placeholder("person", record.lastName)?.replace("Person ", "") ??
            null,
          linkedinUrl: placeholder("linkedin", record.linkedinUrl),
        };
      }

      if (isAccountRecord(record)) {
        return accountRecord({ base, placeholder, scrubRef }, record);
      }

      if ("kind" in record) {
        return {
          ...base(record),
          address: placeholder("email", record.address),
          linkedinUrl: placeholder("linkedin", record.linkedinUrl),
          name: placeholder("person", record.name),
        };
      }

      if ("tags" in record) {
        return {
          ...base(record),
          name: placeholder("campaign", record.name) ?? record.name,
        };
      }

      return {
        ...base(record),
        name: placeholder("workspace", record.name) ?? record.name,
      };
    },
  };
};
