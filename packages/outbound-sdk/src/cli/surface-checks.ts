// How a merged tool's checks come back as one answer, and how a check that
// the checks before it left too little names the call's shared cap (OUT-168).

import { OutboundError } from "../internal/errors.ts";
import { toJson } from "../internal/json.ts";
import type { ToolResult } from "../tools/index.ts";
import { failure, weakest } from "../tools/shared.ts";

/** The requests one result spent. */
export const requestsOf = (result: ToolResult): number =>
  result.meta?.requests ?? 0;

/** Several checks' answers as one, each under its own key. */
export const combined = (
  results: readonly (readonly [string, ToolResult])[]
): ToolResult => {
  const answered = results.flatMap(([key, result]) =>
    result.ok ? [[key, result] as const] : []
  );

  const requests = results.reduce(
    (sum, [, result]) => sum + requestsOf(result),
    0
  );

  const [firstAnswer] = answered;

  if (firstAnswer === undefined) {
    const [
      [, first] = ["", failure(new OutboundError("Invalid", "no check ran"))],
    ] = results;

    return first.ok ? first : { ...first, meta: { ...first.meta, requests } };
  }

  const failed = results.flatMap(([key, result]) =>
    result.ok ? [] : [`${key} failed: ${result.error.message}`]
  );

  return {
    data: Object.fromEntries(
      results.map(([key, result]) => [
        key,
        result.ok
          ? result.data
          : toJson({ error: result.error, next: result.next }),
      ])
    ),
    meta: {
      complete:
        failed.length === 0 &&
        answered.every(([, result]) => result.meta.complete),
      computedAt: answered
        .map(([, result]) => result.meta.computedAt ?? "")
        .toSorted()
        .at(-1),
      evidence: weakest(answered.map(([, result]) => result.meta.evidence)),
      notes: [
        ...failed,
        ...answered.flatMap(([key, result]) =>
          result.meta.notes.map((note) => `${key}: ${note}`)
        ),
      ],
      provider: firstAnswer[1].meta.provider,
      requests,
      today: firstAnswer[1].meta.today,
    },
    next: [...new Set(answered.map(([, result]) => result.next))].join(" "),
    ok: true,
  };
};

// A check stopped by what the checks before it left names the call's cap.
export const sharedCapStop = (
  result: ToolResult,
  key: string,
  cap: number,
  set: number | undefined
): ToolResult => {
  if (
    result.ok ||
    result.error.code !== "RateLimited" ||
    result.error.limit !== "call"
  ) {
    return result;
  }

  const setting =
    set === undefined
      ? "the default cap of a tool call"
      : "maxRequestsPerToolCall";

  return {
    ...result,
    error: {
      ...result.error,
      message: `${key} stopped at the call's cap of ${cap} requests, which its checks share (${setting}).`,
    },
    next: `Run checks ["${key}"] alone, or fewer checks in one call.`,
  };
};
