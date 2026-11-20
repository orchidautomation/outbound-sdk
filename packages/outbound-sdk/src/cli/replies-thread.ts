// unanswered_replies: the replies nobody has answered (the dropped_replies
// insight), with each one's conversation inline when `include` is
// "thread", so a model never has to carry refs to a second call.

import {
  isJsonArray,
  isJsonObject,
  isString,
  jsonInput,
} from "../internal/json.ts";
import type { Json, JsonObject } from "../internal/json.ts";
import type { OutboundTool, ToolResult } from "../tools/index.ts";

/** The most conversations one call reads inline, thread_context's page. */
const INLINE_THREADS = 50;

const DESCRIPTION =
  'Replies nobody has answered: each conversation whose latest message is a human inbound reply with nothing sent after it and no meeting, oldest wait first, with why it needs a follow-up from fixed rules (never the words). Automatic replies are left out unless include_auto. With include "thread" each item carries its conversation (the newest messages, who wrote last, the meeting the vendor records). finding leads with what went unchecked, and totals.dropped is then null, not 0. thread_context reads other conversations by ref.';

const leadOf = (item: Json): string | undefined => {
  const lead = isJsonObject(item) ? item["lead"] : undefined;

  return isString(lead) ? lead : undefined;
};

// The conversations of the listed items, read in one thread_context call.
const withThreads = async (
  answer: Extract<ToolResult, { ok: true }>,
  thread: OutboundTool,
  options: Parameters<OutboundTool["call"]>[1]
): Promise<ToolResult> => {
  const data = isJsonObject(answer.data) ? answer.data : {};
  const items = isJsonArray(data["dropped"]) ? data["dropped"] : [];
  const leads = [...new Set(items.flatMap((item) => leadOf(item) ?? []))];
  const read = leads.slice(0, INLINE_THREADS);

  if (read.length === 0) {
    return answer;
  }

  const spent = answer.meta.requests;
  const cap = options?.maxRequests;

  const threads = await thread.call(
    { leads: read, max_messages: 5, page_size: read.length },
    cap === undefined || cap === Infinity
      ? options
      : { maxRequests: Math.max(1, cap - spent) }
  );

  if (!threads.ok) {
    return {
      ...answer,
      meta: {
        ...answer.meta,
        complete: false,
        notes: [
          ...answer.meta.notes,
          `The conversations were not read: ${threads.error.message}`,
        ],
        requests: spent + (threads.meta?.requests ?? 0),
      },
    };
  }

  const found =
    isJsonObject(threads.data) && isJsonArray(threads.data["threads"])
      ? threads.data["threads"]
      : [];

  const byLead = new Map(
    found.flatMap((record) => {
      const lead = leadOf(record);

      return lead === undefined ? [] : [[lead, record] as const];
    })
  );

  const left = leads.length - read.length;

  return {
    ...answer,
    data: {
      ...data,
      dropped: items.map((item): Json => {
        const lead = leadOf(item);

        return isJsonObject(item)
          ? {
              ...item,
              thread:
                (lead === undefined ? undefined : byLead.get(lead)) ?? null,
            }
          : item;
      }),
      threadCoverage: isJsonObject(threads.data)
        ? (threads.data["coverage"] ?? null)
        : null,
    },
    meta: {
      ...answer.meta,
      complete: answer.meta.complete && threads.meta.complete && left === 0,
      notes: [
        ...answer.meta.notes,
        ...threads.meta.notes,
        ...(left > 0
          ? [
              `Conversations are inline for the first ${read.length} people; thread_context reads the other ${left} by their lead refs.`,
            ]
          : []),
      ],
      requests: spent + threads.meta.requests,
    },
  };
};

/** dropped_replies under its new name, with `include: "thread"` when conversations can be read. */
export const unansweredReplies = (
  dropped: OutboundTool,
  thread: OutboundTool | undefined
): OutboundTool => {
  const parameters: JsonObject = isJsonObject(dropped.parameters)
    ? dropped.parameters
    : {};

  const properties: JsonObject = isJsonObject(parameters["properties"])
    ? parameters["properties"]
    : {};

  const includeField = {
    description: "thread puts each reply's conversation in its item.",
    enum: ["thread"],
    type: "string",
  };

  const withInclude = Object.fromEntries([
    ...Object.entries(properties),
    ...(thread === undefined ? [] : [["include", includeField] as const]),
  ]);

  return {
    ...dropped,
    call: async (given, options) => {
      const input = jsonInput(given ?? {});

      if (!isJsonObject(input) || thread === undefined) {
        return await dropped.call(given, options);
      }

      const { include, ...rest } = input;
      const answer = await dropped.call(rest, options);

      return include === "thread" && answer.ok
        ? await withThreads(answer, thread, options)
        : answer;
    },
    description: DESCRIPTION,
    name: "unanswered_replies",
    parameters: { ...parameters, properties: withInclude },
  };
};
