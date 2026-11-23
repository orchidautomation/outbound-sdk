// Which records come from a tool whose inbox also holds conversations in no
// campaign (`replies.inbox`), such as a LinkedIn account's own messages.

import type { OutboundApi } from "../internal/outbound/api.ts";

interface FromTool {
  readonly provider: string;
  readonly workspaceId: string;
}

/**
 * Whether the tool a record came from has conversations in no campaign. On a
 * combined instance each tool answers for its own records.
 */
export const inboxOf = (
  outbound: OutboundApi
): ((record: FromTool) => boolean) => {
  const known = new Map<string, boolean>();

  return (record) => {
    if (outbound.provider !== "combined") {
      return outbound.capabilities["replies.inbox"];
    }

    const key = `${record.provider}:${record.workspaceId}`;
    let separates = known.get(key);

    if (separates === undefined) {
      try {
        separates = outbound.workspace(key).capabilities["replies.inbox"];
      } catch {
        // Not a member of a combined instance: its tool is this one.
        separates = false;
      }

      known.set(key, separates);
    }

    return separates;
  };
};
