// How an input names one person: an email address, a LinkedIn profile URL or
// a lead ref another read returned. Every tool, insight and CLI command that
// takes a person reads it here, so a ref is never taken for an address.

import { OutboundError } from "./errors.ts";
import type { OutboundApi } from "./outbound/api.ts";
import { parseRef } from "./ref.ts";
import type { RefParts } from "./ref.ts";
import { profileSlug } from "./url.ts";

// One `@`, something before it, and a dot in the domain: the shape every
// vendor checks before it searches. A colon is refused, so the lead ref
// `instantly:default:jane@acme.com` is not read as an address.
const EMAIL = /^[^\s@:]+@[^\s@.:]+(?:\.[^\s@.:]+)+$/u;

// `acme.com` or `@acme.com`: a company, not a person.
const DOMAIN = /^@?[^\s@/:]+(?:\.[^\s@/:.]+)+$/u;

// A ref starts with a provider id, which is never a URL scheme.
const PROVIDER = /^[a-z][a-z0-9-]*$/u;
const SCHEMES: ReadonlySet<string> = new Set(["http", "https", "mailto"]);

/** What a person input accepts, for the messages that refuse one. */
export const PERSON_FORMS =
  "an email address, a LinkedIn profile URL or a lead ref as another tool returned it (provider:workspace:id)";

/** The text without outer spaces or a leading `mailto:`, as copied from a link. */
const bare = (identifier: string): string =>
  identifier.trim().replace(/^mailto:/iu, "");

/** The provider, workspace and vendor id of a lead ref, or `null` when the text is not one. */
export const leadRefParts = (identifier: string): RefParts | null => {
  const parts = parseRef(identifier.trim());

  return parts !== null &&
    PROVIDER.test(parts.provider) &&
    !SCHEMES.has(parts.provider)
    ? parts
    : null;
};

/** `email:<address>` or `linkedin:<slug>`, or `null` when the text is neither, a lead ref included. */
export const personKey = (identifier: string): string | null => {
  const value = bare(identifier);

  if (leadRefParts(value) !== null) {
    return null;
  }

  const slug = profileSlug(value);

  if (slug !== null) {
    return `linkedin:${slug}`;
  }

  return EMAIL.test(value) ? `email:${value.toLowerCase()}` : null;
};

/** Why the text names no person. */
export const notAPerson = (identifier: string): string => {
  const value = bare(identifier);

  if (DOMAIN.test(value)) {
    return `"${value}" is a company domain, not a person. Use account_summary for a company domain`;
  }

  return value.includes("@") && !value.includes(":")
    ? `"${value}" is not a valid email address`
    : `"${value}" is not ${PERSON_FORMS}`;
};

export interface PersonInput {
  /**
   * The identifier to look the person up by. For a lead ref, the one its
   * vendor id already is (an Instantly reply's ref holds the address, a
   * HeyReach ref the profile URL); `null` when the lead must be read for it.
   */
  readonly key: string | null;
  /** Set when the input is a lead ref. */
  readonly ref: (RefParts & { readonly text: string }) | null;
}

/** Reads a person input, or throws `Invalid` saying what is accepted. */
export const parsePerson = (
  identifier: string,
  provider: string
): PersonInput => {
  const parts = leadRefParts(identifier);

  if (parts !== null) {
    return {
      key: personKey(parts.sourceId),
      ref: { ...parts, text: identifier.trim() },
    };
  }

  const key = personKey(identifier);

  if (key === null) {
    throw new OutboundError("Invalid", notAPerson(identifier), { provider });
  }

  return { key, ref: null };
};

type Instance = Pick<OutboundApi, "provider" | "workspace" | "workspaceId">;

/** What the instance reads, for the message that refuses a ref of another tool. */
const reads = (outbound: Instance): string =>
  outbound.provider === "combined"
    ? "no tool on this combined instance is that one"
    : `this instance reads ${outbound.provider} workspace ${outbound.workspaceId}`;

/**
 * Refuses, before any request, a lead ref of a tool or workspace this
 * instance does not read. On a combined instance the ref's provider and
 * workspace name the member that reads it.
 */
export const assertRefReadable = (
  outbound: Instance,
  ref: NonNullable<PersonInput["ref"]>
): void => {
  if (
    ref.provider === outbound.provider &&
    ref.workspaceId === outbound.workspaceId
  ) {
    return;
  }

  try {
    outbound.workspace(`${ref.provider}:${ref.workspaceId}`);
  } catch (error) {
    if (OutboundError.is(error) && error.code === "NotFound") {
      throw new OutboundError(
        "Invalid",
        `"${ref.text}" is a lead ref from ${ref.provider} workspace ${ref.workspaceId}, but ${reads(outbound)}. Ask an instance that reads ${ref.provider}, for example with --provider ${ref.provider} or --provider all, or give the person's email address or LinkedIn profile URL`,
        { provider: outbound.provider }
      );
    }

    throw error;
  }
};
