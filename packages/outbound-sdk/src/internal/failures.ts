// A member of a combined instance that could not answer a read the other
// members answered. It is reported as data beside their records, so one tool
// being down does not cost the caller what the others returned.

import { OutboundError, stoppedByCaller } from "./errors.ts";
import type { OutboundErrorCode } from "./errors.ts";

export interface MemberFailure {
  /** The tool that did not answer, for example `heyreach`. */
  readonly provider: string;
  readonly workspaceId: string;
  readonly code: OutboundErrorCode;
  /** The HTTP status behind the error, or `null` when there was none. */
  readonly status: number | null;
  readonly message: string;
}

// The tool itself is unavailable: its key was rejected, it is down or too
// slow, or it is rate limiting us. Anything else is a mistake in the call,
// which no other member's answer makes up for.
const UNAVAILABLE: ReadonlySet<OutboundErrorCode> = new Set([
  "Provider",
  "RateLimited",
  "Unauthorized",
]);

/**
 * `true` when the failure is the member being unavailable. A cap the caller
 * set (an abort signal, a deadline, a request budget) is never that: it stops
 * the whole call.
 */
export const isMemberUnavailable = (cause: unknown): cause is OutboundError =>
  OutboundError.is(cause) &&
  UNAVAILABLE.has(cause.code) &&
  !stoppedByCaller(cause);

export const toMemberFailure = (
  member: { readonly name: string; readonly workspaceId: string },
  error: OutboundError
): MemberFailure => ({
  code: error.code,
  message: error.message,
  provider: member.name,
  status: error.status ?? null,
  workspaceId: member.workspaceId,
});

/** Each member once, the first failure seen for it kept. */
export const mergeFailures = (
  ...lists: readonly (readonly MemberFailure[])[]
): MemberFailure[] => {
  const byMember = new Map<string, MemberFailure>();

  for (const failure of lists.flat()) {
    const key = `${failure.provider}:${failure.workspaceId}`;

    if (!byMember.has(key)) {
      byMember.set(key, failure);
    }
  }

  return [...byMember.values()];
};

/** One sentence for a note: which tool is missing from the answer, and why. */
export const describeFailure = (failure: MemberFailure): string =>
  `${failure.provider} (${failure.workspaceId}) did not answer: ${failure.code}${
    failure.status === null ? "" : ` (${failure.status})`
  }. Its records are missing from this answer.`;
