// The campaign scope every insight takes: which campaigns of the workspace
// it may read, such as one client's in an agency workspace. A campaign is in
// scope when it matches every part given: its id, its tag and its name.

import { z } from "zod";

import type { Campaign } from "../internal/entities.ts";
import { OutboundError } from "../internal/errors.ts";
import { parseRef } from "../internal/ref.ts";

/** The most campaign ids one scope names. */
export const MAX_SCOPE_IDS = 500;

/** The scope's inputs, added to every insight's own. */
export const SCOPE_INPUTS = {
  campaign_ids: z
    .array(z.string().trim().min(1))
    .min(1)
    .max(MAX_SCOPE_IDS)
    .optional()
    .describe(
      "Read only these campaigns, by ref or vendor id. With tag or campaign_name, a campaign must match every one given"
    ),
  campaign_name: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe(
      "Read only the campaigns whose whole name matches, ignoring case: an exact name (Acme Q4), a glob with * and ? (Acme*), or /regex/ with flags i, m, s or u"
    ),
  tag: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe(
      "Read only the campaigns that carry this tag, ignoring case, such as one client's. Unsupported where campaigns carry no tags"
    ),
};

export const SCOPE_KEYS = Object.keys(SCOPE_INPUTS);

/** How a `campaign_name` is matched. */
export interface NameRule {
  /** The pattern as given. */
  readonly text: string;
  readonly kind: "exact" | "glob" | "regex";
  /** Whether a campaign's whole name matches. */
  readonly test: (name: string) => boolean;
  /**
   * Text every matching name contains, which a vendor that searches names
   * by "contains" can be sent so it lists fewer campaigns. `undefined` when
   * there is none, as for a regex.
   */
  readonly hint: string | undefined;
}

export interface CampaignScope {
  readonly ids: readonly string[] | undefined;
  readonly tag: string | undefined;
  readonly name: NameRule | undefined;
}

const REGEX = /^\/(?<source>.+)\/(?<flags>[imsu]*)$/su;

const GLOB = /[*?]/u;

const escaped = (text: string): string =>
  text.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");

const globRule = (text: string): NameRule => {
  const source = [...text]
    .map((char) => {
      if (char === "*") {
        return ".*";
      }

      return char === "?" ? "." : escaped(char);
    })
    .join("");

  const pattern = new RegExp(`^${source}$`, "isu");
  const literals = text.split(/[*?]+/u).map((part) => part.trim());
  const [longest] = literals.toSorted((a, b) => b.length - a.length);

  return {
    hint: longest === undefined || longest === "" ? undefined : longest,
    kind: "glob",
    test: (name) => pattern.test(name.trim()),
    text,
  };
};

/**
 * The rule for a `campaign_name`: `/source/flags` is a regular expression
 * tested against the name, anything holding `*` or `?` a glob over the whole
 * name, and anything else the exact name. Globs and exact names ignore case
 * and the spaces around a name; a regex ignores case only with its `i`.
 */
export const nameRule = (text: string, insight: string): NameRule => {
  const regex = REGEX.exec(text)?.groups;

  if (regex !== undefined) {
    let pattern: RegExp;

    try {
      pattern = new RegExp(regex["source"] ?? "", regex["flags"]);
    } catch {
      throw new OutboundError(
        "Invalid",
        `${insight}: campaign_name ${text} is not a valid regular expression`
      );
    }

    return {
      hint: undefined,
      kind: "regex",
      test: (name) => pattern.test(name),
      text,
    };
  }

  if (GLOB.test(text)) {
    return globRule(text);
  }

  const wanted = text.toLowerCase();

  return {
    hint: text,
    kind: "exact",
    test: (name) => name.trim().toLowerCase() === wanted,
    text,
  };
};

/** The campaign scope as a caller writes it, which every insight takes on top of its own input. */
export interface CampaignScopeInput {
  /** Read only these campaigns, by ref or vendor id, 1 to 500. */
  readonly campaign_ids?: string[] | undefined;
  /** Read only the campaigns whose whole name matches: an exact name, a glob, or `/regex/`. */
  readonly campaign_name?: string | undefined;
  /** Read only the campaigns that carry this tag, ignoring case. */
  readonly tag?: string | undefined;
}

/** The scope an insight's parsed input asks for, or `null` for the whole workspace. */
export const scopeOf = (
  input: CampaignScopeInput,
  insight: string
): CampaignScope | null => {
  const { campaign_ids: ids, campaign_name: name, tag } = input;

  if (ids === undefined && name === undefined && tag === undefined) {
    return null;
  }

  return {
    ids: ids === undefined ? undefined : [...new Set(ids)],
    name: name === undefined ? undefined : nameRule(name, insight),
    tag,
  };
};

/** An id and the vendor id inside it, so a ref and a bare id match each other. */
const keysOf = (value: string): string[] => {
  const ref = parseRef(value);

  return ref === null ? [value] : [value, ref.sourceId];
};

/** Whether `id`, a ref or a vendor id, is one of the scope's ids. */
export const namesId = (scope: CampaignScope, id: string): boolean => {
  if (scope.ids === undefined) {
    return true;
  }

  const wanted = new Set(scope.ids.flatMap(keysOf));

  return keysOf(id).some((key) => wanted.has(key));
};

/** Whether the campaign matches every part of the scope. */
export const admits = (scope: CampaignScope, campaign: Campaign): boolean => {
  const tag = scope.tag?.toLowerCase();

  return (
    (scope.ids === undefined ||
      namesId(scope, campaign.ref) ||
      namesId(scope, campaign.sourceId)) &&
    (tag === undefined ||
      campaign.tags.some((each) => each.toLowerCase() === tag)) &&
    (scope.name === undefined || scope.name.test(campaign.name ?? ""))
  );
};

/** The scope in words, for notes and messages: `tag client-a and name Acme*`. */
export const describeScope = (scope: CampaignScope): string =>
  [
    scope.ids === undefined
      ? undefined
      : `${scope.ids.length} campaign id${scope.ids.length === 1 ? "" : "s"}`,
    scope.tag === undefined ? undefined : `tag ${scope.tag}`,
    scope.name === undefined ? undefined : `name ${scope.name.text}`,
  ]
    .filter((part) => part !== undefined)
    .join(" and ");
