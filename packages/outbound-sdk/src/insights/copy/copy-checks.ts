// The text checks behind copy_audit. Each takes template text and returns
// what it found, or nothing. Fixed rules only: no model reads the copy.

export type Severity = "high" | "low" | "medium";

export const CHECKS = {
  all_caps: "low",
  body_too_long: "low",
  connection_request_too_long: "high",
  exclamation_marks: "low",
  image: "medium",
  malformed_variable: "high",
  missing_subject: "high",
  spam_words: "medium",
  subject_breaks_thread: "medium",
  subject_too_long: "low",
  too_many_links: "medium",
} as const satisfies Record<string, Severity>;

export type CheckName = keyof typeof CHECKS;

export interface Problem {
  readonly check: CheckName;
  /** What is wrong, in plain words, with the number behind it. */
  readonly finding: string;
  /** The text that triggered the check. */
  readonly text: string;
}

export interface Limits {
  readonly maxSubjectChars: number;
  readonly maxBodyWords: number;
  readonly maxLinks: number;
  readonly maxCapsWords: number;
  readonly maxExclamations: number;
  readonly maxConnectionChars: number;
  readonly spamWords: readonly string[];
}

/** Words and phrases that spam filters weigh. A caller can replace the list. */
export const DEFAULT_SPAM_WORDS = [
  "100% free",
  "act now",
  "buy now",
  "cash bonus",
  "click here",
  "double your",
  "earn money",
  "free trial",
  "guarantee",
  "limited time",
  "no obligation",
  "risk-free",
  "urgent",
  "winner",
] as const;

const TAG = /<[^>]+>/gu;
const IMAGE = /<img\b[^>]*>/giu;
const VARIABLE = /\{\{[^{}]*\}\}/gu;
const LINK = /\b(?:https?:\/\/|www\.)[^\s"'<>)]+/giu;
const CAPS_WORD = /\b[A-Z]{4,}\b/gu;
const PIXEL = /(?:width|height)\s*[=:]\s*["']?[01](?:px)?\b|pixel|track/iu;
const REPLY_PREFIX = /^(?:re|fwd?)\s*:\s*/iu;

const SNIPPET = 80;

const clip = (text: string): string =>
  text.length > SNIPPET ? `${text.slice(0, SNIPPET)}…` : text;

/** The copy as a reader sees it: no tags, and each variable as one word. */
const visible = (text: string): string =>
  text.replaceAll(TAG, " ").replaceAll(VARIABLE, " variable ");

const wordsOf = (text: string): string[] =>
  visible(text)
    .split(/\s+/u)
    .filter((word) => word !== "");

const escape = (text: string): string =>
  text.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);

export const subjectTooLong = (
  subject: string,
  limits: Limits
): Problem | null =>
  subject.length > limits.maxSubjectChars
    ? {
        check: "subject_too_long",
        finding: `The subject is ${subject.length} characters; the limit is ${limits.maxSubjectChars}.`,
        text: clip(subject),
      }
    : null;

export const bodyTooLong = (body: string, limits: Limits): Problem | null => {
  const words = wordsOf(body);

  return words.length > limits.maxBodyWords
    ? {
        check: "body_too_long",
        finding: `The body is ${words.length} words; the limit is ${limits.maxBodyWords}.`,
        text: clip(words.slice(0, 12).join(" ")),
      }
    : null;
};

export const tooManyLinks = (body: string, limits: Limits): Problem | null => {
  // An image's address is not a link the reader can follow.
  const links = body.replaceAll(IMAGE, " ").match(LINK) ?? [];

  return links.length > limits.maxLinks
    ? {
        check: "too_many_links",
        finding: `The body has ${links.length} links; the limit is ${limits.maxLinks}.`,
        text: clip(links.join(" ")),
      }
    : null;
};

export const spamWords = (text: string, limits: Limits): Problem | null => {
  const plain = visible(text);

  const hits = limits.spamWords.filter(
    (word) =>
      word.trim() !== "" &&
      new RegExp(
        String.raw`(?<![\w])${escape(word.trim())}(?![\w])`,
        "iu"
      ).test(plain)
  );

  return hits.length > 0
    ? {
        check: "spam_words",
        finding: `The copy uses ${hits.length} word(s) or phrase(s) that spam filters weigh.`,
        text: hits.join(", "),
      }
    : null;
};

export const malformedVariable = (text: string): Problem | null => {
  const empty = (text.match(VARIABLE) ?? []).filter(
    (token) => token.slice(2, -2).trim() === ""
  );

  const rest = text.replaceAll(VARIABLE, "");
  const stray = /\{\{|\}\}/u.exec(rest);

  if (stray === null && empty.length === 0) {
    return null;
  }

  return {
    check: "malformed_variable",
    finding:
      stray === null
        ? "A variable has no name between its braces, so it sends as blank or as raw braces."
        : "A variable's braces are not balanced, so it sends as raw text.",
    text:
      stray === null
        ? (empty[0] ?? "")
        : clip(
            rest.slice(Math.max(0, stray.index - 20), stray.index + 30).trim()
          ),
  };
};

export const allCaps = (text: string, limits: Limits): Problem | null => {
  const words = text
    .replaceAll(TAG, " ")
    .replaceAll(VARIABLE, " ")
    .match(CAPS_WORD);

  const found = words ?? [];

  return found.length > limits.maxCapsWords
    ? {
        check: "all_caps",
        finding: `${found.length} word(s) of four or more letters are in capitals; the limit is ${limits.maxCapsWords}.`,
        text: clip(found.join(" ")),
      }
    : null;
};

export const exclamationMarks = (
  text: string,
  limits: Limits
): Problem | null => {
  const marks = visible(text).split("!").length - 1;

  return marks > limits.maxExclamations
    ? {
        check: "exclamation_marks",
        finding: `The copy has ${marks} exclamation marks; the limit is ${limits.maxExclamations}.`,
        text: "!".repeat(marks),
      }
    : null;
};

export const image = (body: string): Problem | null => {
  const [first] = body.match(IMAGE) ?? [];

  if (first === undefined) {
    return null;
  }

  return {
    check: "image",
    finding: PIXEL.test(first)
      ? "The body holds a tracking pixel, which spam filters and privacy tools flag."
      : "The body holds an image, which cold email filters weigh against.",
    text: clip(first),
  };
};

/** A subject as the thread sees it: no `Re:` and no case. */
export const threadKey = (subject: string | null): string =>
  (subject ?? "").trim().replace(REPLY_PREFIX, "").trim().toLowerCase();

export const connectionTooLong = (
  body: string,
  limits: Limits
): Problem | null =>
  body.length > limits.maxConnectionChars
    ? {
        check: "connection_request_too_long",
        finding: `The connection request is ${body.length} characters; LinkedIn cuts it at ${limits.maxConnectionChars}.`,
        text: clip(body),
      }
    : null;
