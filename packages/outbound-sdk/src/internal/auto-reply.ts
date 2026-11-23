// Fixed rules that tell an automatic reply (out-of-office, autoresponder,
// "no longer with the company") and a bounce notice (mailer-daemon,
// undeliverable) from a person writing back. Used by an adapter beside the
// vendor's own flag, and exported so a caller can run the same rules. No
// model is called: every rule is a pattern a reader can check.

import { htmlToText, looksLikeHtml, stripQuotedHistory } from "./text.ts";

/** What a received email or message says about itself. Any field may be unknown. */
export interface AutoReplyInput {
  /** The address the reply came from. `null` on LinkedIn, which has none. */
  readonly from: string | null;
  readonly subject: string | null;
  /** The body, HTML or plain text, quoted history included or not. */
  readonly body: string | null;
}

/**
 * Which auto-reply rule matched: `machine_sender` (a no-reply or
 * autoresponder address), `automatic_subject` (`Automatic reply:`, `OOO`),
 * `automatic_body` (a canned out-of-office or autoresponder phrase),
 * `left_company` (`is no longer at`, `your contact with ... has changed`),
 * or `answered_at_once` (a reply under a minute after the message it answers,
 * judged only where both are read together).
 */
export type AutoReplyReason =
  | "answered_at_once"
  | "automatic_body"
  | "automatic_subject"
  | "left_company"
  | "machine_sender";

/**
 * Which bounce rule matched: `bounce_sender` (`mailer-daemon@`,
 * `postmaster@`), `bounce_subject` (`Undeliverable:`, `Delivery Status
 * Notification`) or `bounce_body` (`could not be delivered`, `550 5.1.1`).
 */
export type BounceReason = "bounce_body" | "bounce_sender" | "bounce_subject";

export interface AutoReplyVerdict {
  /** `true` when an auto-reply rule matched. A bounce notice is not one: see `detectBounce`. */
  readonly isAuto: boolean;
  /** `true` when the reply says the person left the company or the contact changed. */
  readonly leftCompany: boolean;
  /** The first rule that matched, or `null`. */
  readonly reason: AutoReplyReason | null;
}

export interface BounceVerdict {
  /** `true` when the message is a delivery failure notice sent back by a mail server. */
  readonly bounce: boolean;
  /** The first rule that matched, or `null`. */
  readonly reason: BounceReason | null;
}

/**
 * The fixed rules' own verdict on a received message, kept beside `isAuto`
 * so it can be read even when the vendor flagged the reply. `reason` is the
 * bounce rule's when `bounce` is `true`, otherwise the auto-reply rule's.
 */
export interface ReplyRule {
  readonly autoReply: boolean;
  readonly bounce: boolean;
  readonly reason: AutoReplyReason | BounceReason | null;
}

/** Under this many milliseconds after the message it answers, no person wrote the reply. */
export const AUTO_REPLY_WITHIN_MS = 60_000;

// A mailbox no person reads: `noreply@`, `auto-responder+noreply@`.
const MACHINE_SENDER =
  /^[^@]*(?:no-?reply|do-?not-?reply|auto-?respon|auto-?reply)[^@]*@/iu;

// A mail server returning a message: `mailer-daemon@`, `postmaster@`.
const BOUNCE_SENDER = /^[^@]*(?:mailer-daemon|postmaster)[^@]*@/iu;

// Leading "Re:" and "Fwd:" a client adds before what it wrote.
const PREFIX = String.raw`^(?:(?:re|fw|fwd|aw|sv)\s*:\s*)*`;

// A subject the mail client wrote: "Automatic reply: Re: ...", "OOO Re: ...",
// "Out of Office Re: ...".
const AUTOMATIC_SUBJECT = new RegExp(
  `${PREFIX}(?:ooo\\b|out\\s+of\\s+(?:the\\s+)?office\\b|automatic\\s+reply\\b|auto(?:matic)?[-\\s]?reply\\b|autoreply\\b|auto[-\\s]?response\\b|away\\s+from\\s+(?:the\\s+)?office\\b)`,
  "iu"
);

// A subject a mail server wrote when it could not deliver.
const BOUNCE_SUBJECT = new RegExp(
  `${PREFIX}(?:undeliverable\\b|undelivered\\s+mail\\b|delivery\\s+status\\s+notification\\b|mail\\s+delivery\\s+(?:failed|failure|subsystem)\\b|delivery\\s+(?:has\\s+)?failed\\b|delivery\\s+failure\\b|returned\\s+mail\\b|failure\\s+notice\\b)`,
  "iu"
);

// "Jane Doe is no longer at Acme Re: ...".
const LEFT_SUBJECT = /\bis\s+no\s+longer\s+(?:at|with|employed)\b/iu;

// Phrases mail clients and helpdesks write, not people. First-person phrasing
// a person might use in a real answer ("I'm out next week, but yes") is not
// matched: each phrase is the canned form.
const AUTOMATIC_BODY = [
  /\bthis\s+is\s+an\s+auto(?:mated|matic)(?:ally\s+generated)?\s+(?:reply|response|message|email|notification)\b/iu,
  /\b(?:i\s+am|i'm|i\s+will\s+be)\s+(?:currently\s+)?out\s+of\s+(?:the\s+)?office\s+(?:until|from|through|and\s+will|with\s+(?:limited|no))\b/iu,
  /\b(?:i\s+am|i'm|i\s+will\s+be)\s+(?:currently\s+)?(?:on\s+(?:maternity|paternity|parental)\s+leave)\b/iu,
  /\b(?:with|have)\s+(?:limited|no)\s+access\s+to\s+(?:my\s+)?e-?mail\b/iu,
  /\bthis\s+(?:mailbox|inbox|e-?mail\s+address)\s+is\s+(?:not|no\s+longer)\s+(?:monitored|active|in\s+use)\b/iu,
  /\bfor\s+(?:technical\s+)?support,?\s+please\s+(?:contact|email|e-mail|reach\s+out\s+to)\b/iu,
  /\b(?:thank\s+you|thanks)\s+for\s+(?:your\s+)?(?:e-?mail|message)\.?\s+(?:we|our\s+team)\s+(?:have|has)\s+received\b/iu,
];

// What a mail server writes back about a message it could not deliver.
const BOUNCE_BODY = [
  /\b(?:your\s+)?message\s+(?:could\s+not|couldn't|wasn't|was\s+not)\s+(?:be\s+)?delivered\b/iu,
  /\bdelivery\s+(?:to\s+the\s+following\s+recipients?\s+)?(?:has\s+)?failed\b/iu,
  /\baddress\s+not\s+found\b/iu,
  // An SMTP permanent failure with its enhanced code: "550 5.1.1", "550-5.7.1".
  /\b5\d\d[\s-]#?5\.\d\.\d{1,3}\b/u,
  /\brecipient\s+address\s+rejected\b/iu,
  /\bthe\s+email\s+account\s+that\s+you\s+tried\s+to\s+reach\s+does\s+not\s+exist\b/iu,
];

// The canned notice a company's mailbox sends once the person is gone.
const LEFT_NOTICE =
  /\byour\s+contact\s+(?:with|at)\s+.{1,80}?\s+has\s+changed\b/iu;

// The third-person form, which a colleague answering for them may write too:
// it says the person left without saying no person wrote it. "I'm no longer
// at Acme, but..." is the person answering and is not matched.
const LEFT_BODY = [
  LEFT_NOTICE,
  /\b(?:is|are)\s+no\s+longer\s+(?:with|at|employed\s+(?:by|at|with))\b/iu,
  /\bhas\s+(?:left|departed)\s+(?:the\s+company|the\s+organi[sz]ation|our\s+(?:company|organi[sz]ation|team))\b/iu,
];

/** The body as plain text with quoted history removed, so our own copy is not read as theirs. */
const ownText = (body: string | null): string => {
  if (body === null) {
    return "";
  }

  return stripQuotedHistory(looksLikeHtml(body) ? htmlToText(body) : body);
};

/**
 * Reads a received email or message by the fixed auto-reply rules: an
 * out-of-office, an autoresponder, or a notice that the person left.
 *
 * ```ts
 * detectAutoReply({ from: null, subject: "Automatic reply: Hello", body: null });
 * // { isAuto: true, leftCompany: false, reason: "automatic_subject" }
 * ```
 */
export const detectAutoReply = (input: AutoReplyInput): AutoReplyVerdict => {
  const subject = input.subject ?? "";
  const body = ownText(input.body);

  const leftCompany =
    LEFT_SUBJECT.test(subject) || LEFT_BODY.some((rule) => rule.test(body));

  const checks: readonly (readonly [AutoReplyReason, boolean])[] = [
    ["left_company", LEFT_SUBJECT.test(subject) || LEFT_NOTICE.test(body)],
    ["machine_sender", MACHINE_SENDER.test(input.from ?? "")],
    ["automatic_subject", AUTOMATIC_SUBJECT.test(subject)],
    ["automatic_body", AUTOMATIC_BODY.some((rule) => rule.test(body))],
  ];

  const reason = checks.find(([, matched]) => matched)?.[0] ?? null;

  return { isAuto: reason !== null, leftCompany, reason };
};

/**
 * Reads a received email by the fixed bounce rules: a delivery failure
 * notice a mail server sent back.
 *
 * ```ts
 * detectBounce({ from: "mailer-daemon@example.com", subject: null, body: null });
 * // { bounce: true, reason: "bounce_sender" }
 * ```
 */
export const detectBounce = (input: AutoReplyInput): BounceVerdict => {
  const checks: readonly (readonly [BounceReason, boolean])[] = [
    ["bounce_sender", BOUNCE_SENDER.test(input.from ?? "")],
    ["bounce_subject", BOUNCE_SUBJECT.test(input.subject ?? "")],
    ["bounce_body", BOUNCE_BODY.some((rule) => rule.test(ownText(input.body)))],
  ];

  const reason = checks.find(([, matched]) => matched)?.[0] ?? null;

  return { bounce: reason !== null, reason };
};

/** Both rules on one message, as an adapter keeps them in `rule`, with `leftCompany` beside. */
export const readReply = (
  input: AutoReplyInput
): { readonly rule: ReplyRule; readonly leftCompany: boolean } => {
  const auto = detectAutoReply(input);
  const bounce = detectBounce(input);

  return {
    leftCompany: auto.leftCompany,
    rule: {
      autoReply: auto.isAuto,
      bounce: bounce.bounce,
      reason: bounce.reason ?? auto.reason,
    },
  };
};

/** `true` when either rule says no person wrote the message. A bounce counts as automatic. */
export const ruleSaysAuto = (rule: ReplyRule): boolean =>
  rule.autoReply || rule.bounce;

/** `true` when a reply came so soon after the message it answers that no person wrote it. */
export const answeredAtOnce = (
  sentAt: string | null,
  repliedAt: string | null
): boolean => {
  if (sentAt === null || repliedAt === null) {
    return false;
  }

  const gap = Date.parse(repliedAt) - Date.parse(sentAt);

  return Number.isFinite(gap) && gap >= 0 && gap < AUTO_REPLY_WITHIN_MS;
};
