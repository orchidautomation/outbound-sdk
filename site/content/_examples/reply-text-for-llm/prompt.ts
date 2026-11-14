import type { Outbound } from "outbound-sdk";
import { DEFAULT_BODY_CHARS, UNTRUSTED_NOTE } from "outbound-sdk/tools";

/**
 * Recent replies as JSON to place in a prompt, for code that builds its own
 * prompt and does not go through a tool. The text is marked the same way the
 * tools mark it. Marking is a convention: it does not stop a model from
 * following what the text says.
 */
export const repliesForPrompt = async (
  outbound: Outbound,
  max: number
): Promise<string> => {
  const replies = await outbound.replies
    .listAll({ include: ["body"], max })
    .toArray();

  return JSON.stringify(
    replies.map((reply) => ({
      category: reply.category,
      lead: reply.leadRef,
      received_at: reply.sentAt,
      text:
        reply.bodyText === null
          ? null
          : {
              note: UNTRUSTED_NOTE,
              truncated: reply.bodyText.length > DEFAULT_BODY_CHARS,
              untrusted_content: reply.bodyText.slice(0, DEFAULT_BODY_CHARS),
            },
    })),
    null,
    2
  );
};
