// Merge variables in copy: finding them, and reading a lead's value for one.
// personalization_gaps and copy_preview read copy the same way.

import type { Lead } from "../internal/entities.ts";

// `{{name}}` and `{{name|fallback}}`, `{name}`, and `%name%`. A single brace
// holding a `|` is spintax, not a variable, so it never matches.
const PATTERNS = [
  /\{\{\s*(?<name>[^{}|]+?)\s*(?<fallback>\|[^{}]*)?\}\}/gu,
  /(?<!\{)\{(?<name>[A-Za-z_][\w .-]*)\}(?!\})/gu,
  /%(?<name>[A-Za-z_][\w-]*)%/gu,
];

/** A variable's name lowercased, without spaces, underscores and hyphens. */
export const keyOf = (name: string): string =>
  name.toLowerCase().replaceAll(/[\s_-]/gu, "");

type Builtin = (lead: Lead) => string | null;

const BUILTINS = new Map<string, Builtin>([
  ["company", (lead) => lead.company],
  ["companyname", (lead) => lead.company],
  ["email", (lead) => lead.email],
  ["firstname", (lead) => lead.firstName],
  ["jobtitle", (lead) => lead.title],
  ["lastname", (lead) => lead.lastName],
  ["title", (lead) => lead.title],
]);

export const isBuiltin = (key: string): boolean => BUILTINS.has(key);

// Variables a tool fills from the sending account at send time, by provider,
// as `keyOf` writes them. Instantly's are listed in its help center:
// https://help.instantly.ai/en/articles/9178224-how-to-add-a-signature
const SENDER = new Map<string, ReadonlySet<string>>([
  [
    "instantly",
    new Set([
      "accountsignature",
      "sendingaccountemail",
      "sendingaccountfirstname",
      "sendingaccountname",
    ]),
  ],
]);

/** Whether the provider fills this variable from the sending account, not the lead. */
export const isSender = (provider: string, key: string): boolean =>
  SENDER.get(provider)?.has(key) ?? false;

export interface VariableMatch {
  /** The name as the copy writes it. */
  readonly name: string;
  /** The text after the `|`, or `null` when the variable has no fallback. */
  readonly fallback: string | null;
  /** The variable exactly as it appears in the copy. */
  readonly raw: string;
  readonly index: number;
}

/** Every variable in one text, in the order the patterns find them. */
export const variablesIn = (text: string): VariableMatch[] =>
  PATTERNS.flatMap((pattern) =>
    [...text.matchAll(pattern)].map((match) => {
      const fallback = match.groups?.fallback;

      return {
        fallback: fallback === undefined ? null : fallback.slice(1).trim(),
        index: match.index,
        name: match.groups?.name ?? "",
        raw: match[0],
      };
    })
  );

const filled = (value: string | null | undefined): value is string =>
  value !== null && value !== undefined && value.trim() !== "";

/**
 * The lead's value for a variable: a built-in field, or a custom field of
 * the same name without regard to case, spaces, underscores or hyphens.
 * `null` when the lead has none or it is blank.
 */
export const valueOf = (lead: Lead, key: string): string | null => {
  const builtin = BUILTINS.get(key)?.(lead);

  if (filled(builtin)) {
    return builtin;
  }

  const custom = Object.entries(lead.custom).find(
    ([name, value]) => keyOf(name) === key && filled(value)
  );

  return custom?.[1] ?? null;
};

/** Every variable key a lead has a non-empty value for. */
export const keysWithValue = (lead: Lead): Set<string> =>
  new Set([
    ...[...BUILTINS].flatMap(([key, read]) =>
      filled(read(lead)) ? [key] : []
    ),
    ...Object.entries(lead.custom).flatMap(([key, value]) =>
      filled(value) ? [keyOf(key)] : []
    ),
  ]);

export interface Filled {
  readonly text: string;
  /** Variables left as written: no value and no fallback, as the copy writes them. */
  readonly unfilled: readonly string[];
}

/**
 * `text` with each variable replaced by the lead's value, or its fallback
 * when the lead has none. A variable with neither is left as written.
 */
export const fillVariables = (text: string, lead: Lead): Filled => {
  // Two patterns never match the same characters, but sort and skip
  // overlaps anyway so a value is never written inside another.
  const matches = variablesIn(text).toSorted(
    (left, right) => left.index - right.index
  );

  const unfilled: string[] = [];
  let out = "";
  let at = 0;

  for (const match of matches) {
    if (match.index >= at) {
      const value = valueOf(lead, keyOf(match.name)) ?? match.fallback;

      if (value === null && !unfilled.includes(match.name)) {
        unfilled.push(match.name);
      }

      out += text.slice(at, match.index) + (value ?? match.raw);
      at = match.index + match.raw.length;
    }
  }

  return { text: out + text.slice(at), unfilled };
};
