// Fixed rules that tell an automatic reply (out-of-office, autoresponder,
// "no longer with the company") from a person writing back. Used by an
// adapter when the vendor does not flag the reply itself. No model is called:
// every rule is a pattern a reader can check.

import { htmlToText, looksLikeHtml, stripQuotedHistory } from "./text.ts";

/** What a received email says about itself. Any field may be unknown. */
export interface AutoReplyInput {
  /** The address the reply came from. */
  readonly from: string | null;
  readonly subject: string | null;
  /** The body, HTML or plain text, quoted history included or not. */
  readonly body: string | null;
}

export interface AutoReplyVerdict {
  /** `true` when a rule matched. */
  readonly isAuto: boolean;
  /** `true` when the reply says the person left the company or the contact changed. */
  readonly leftCompany: boolean;
}

/** Under this many milliseconds after the message it answers, no person wrote the reply. */
export const AUTO_REPLY_WITHIN_MS = 60_000;

// A mailbox no person reads: `noreply@`, `auto-responder+noreply@`,
// `mailer-daemon@`.
const MACHINE_SENDER =
  /^[^@]*(?:no-?reply|do-?not-?reply|auto-?respon|auto-?reply|mailer-daemon|postmaster)[^@]*@/iu;

// A subject the mail client wrote: "Automatic reply: Re: ...", "OOO Re: ...",
// "Out of Office Re: ...". Leading "Re:" and "Fwd:" are skipped.
const AUTOMATIC_SUBJECT =
  /^(?:(?:re|fw|fwd|aw|sv)\s*:\s*)*(?:ooo\b|out\s+of\s+(?:the\s+)?office\b|automatic\s+reply\b|auto(?:matic)?[-\s]?reply\b|autoreply\b|auto[-\s]?response\b|away\s+from\s+(?:the\s+)?office\b|undeliverable\b|delivery\s+status\s+notification\b)/iu;

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

/** Reads a received email by the fixed rules above. */
export const detectAutoReply = (input: AutoReplyInput): AutoReplyVerdict => {
  const subject = input.subject ?? "";
  const body = ownText(input.body);

  const leftCompany =
    LEFT_SUBJECT.test(subject) || LEFT_BODY.some((rule) => rule.test(body));

  const isAuto =
    LEFT_SUBJECT.test(subject) ||
    LEFT_NOTICE.test(body) ||
    MACHINE_SENDER.test(input.from ?? "") ||
    AUTOMATIC_SUBJECT.test(subject) ||
    AUTOMATIC_BODY.some((rule) => rule.test(body));

  return { isAuto, leftCompany };
};

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
