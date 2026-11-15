// A metered in-memory tool for the request-cap tests: every adapter read
// sends `perRead` requests through the engine, and the adapter declares one
// per read as its costs, so what `insightCost` gives can be held to what is
// sent. `perRead` above 1 makes the declared costs too low on purpose.

import { createOutbound, MemoryRateLimitStore } from "../../src/index.ts";
import type {
  Adapter,
  AdapterContext,
  OutboundPlugin,
} from "../../src/index.ts";
import { insights } from "../../src/insights/index.ts";
import { memory } from "../../src/memory/index.ts";
import type { MemoryData } from "../../src/memory/index.ts";
import { createFetch, json } from "../helpers/http.ts";
import { NOW } from "./helpers.ts";

export const PAGE = 10;
export const CAMPAIGN = "memory:agency:c1";

const LISTINGS = [
  "blocklist.list",
  "campaigns.list",
  "leads.list",
  "lists.list",
  "messages.list",
  "replies.list",
  "senders.list",
  "sequence.subsequences",
  "tags.list",
  "webhooks.list",
  "workspaces.list",
];

const LOOKUPS = [
  "campaigns.get",
  "campaigns.settings",
  "leads.get",
  "senders.get",
  "senders.health",
  "sequence.get",
  "stats",
];

const COSTS = Object.fromEntries([
  ...LISTINGS.map((action) => [action, { pageSize: PAGE, perPage: 1 }]),
  ...LOOKUPS.map((action) => [action, { perPage: 1 }]),
]);

const day = (offset: number): string =>
  new Date(NOW - offset * 86_400_000).toISOString().slice(0, 10);

const STATUSES = ["active", "paused", "completed"] as const;

/** `campaigns` campaigns of `leads` leads each, with senders, stats, replies and a block list. */
export const world = (campaigns: number, leads: number): MemoryData => {
  const ids = Array.from({ length: campaigns }, (_, index) => `c${index + 1}`);

  return {
    blocklist: [{ id: "b1", value: "blocked@acme.example" }],
    campaigns: ids.map((id, index) => ({
      id,
      name: `Campaign ${id}`,
      settings: { dailyLimit: 50, timezone: "UTC" },
      status: STATUSES[index % STATUSES.length] ?? "active",
      steps: [
        {
          variants: [
            { body: "Hi {{firstName}}", key: "a", subject: "One" },
            { body: "Hello {{company}}", key: "b", subject: "Two" },
          ],
        },
        { delayDays: 3, variants: [{ body: "Following up", subject: "" }] },
      ],
      tags: [index % 2 === 0 ? "even" : "odd"],
    })),
    leads: ids.flatMap((id) =>
      Array.from({ length: leads }, (_, index) => ({
        campaignId: id,
        email: `person${index + 1}@acme.example`,
        engagement: { replies: index % 3 === 0 ? 1 : 0 },
        id: `${id}-l${index + 1}`,
        interest: index % 3 === 0 ? "Interested" : "Contacted",
      }))
    ),
    messages: ids.flatMap((id) =>
      Array.from({ length: Math.min(leads, 4) }, (_, index) => [
        {
          campaignId: id,
          direction: "out" as const,
          id: `${id}-o${index}`,
          leadId: `${id}-l${index + 1}`,
          sentAt: `${day(6)}T09:00:00.000Z`,
          threadId: `${id}-t${index}`,
        },
        {
          campaignId: id,
          category: "positive" as const,
          direction: "in" as const,
          id: `${id}-i${index}`,
          leadId: `${id}-l${index + 1}`,
          sentAt: `${day(5)}T10:00:00.000Z`,
          threadId: `${id}-t${index}`,
        },
      ]).flat()
    ),
    senders: Array.from({ length: 12 }, (_, index) => ({
      address: `sender${index + 1}@acme.example`,
      campaignIds: ids.filter((_id, at) => at % 12 === index || index < 2),
      dailyLimit: 40,
      id: `s${index + 1}`,
      status: "active" as const,
      warmup: { enabled: true, score: 90 },
    })),
    stats: ids.flatMap((id) =>
      Array.from({ length: 21 }, (_, offset) => ({
        campaignId: id,
        counts: { bounced: 2, contacted: 30, replied: 3, sent: 40 },
        date: day(offset + 1),
        senderId: "s1",
        stepIndex: 0,
        variantKey: "a",
      }))
    ),
  };
};

const touch = async (
  ctx: AdapterContext,
  what: string,
  times: number
): Promise<void> => {
  for (let sent = 0; sent < times; sent += 1) {
    // oxlint-disable-next-line no-await-in-loop -- the requests of one read go one after another.
    await ctx.request({ method: "GET", url: `https://metered.test/${what}` });
  }
};

/** A memory tool whose every read sends one request through the engine. */
export const metered = (data: MemoryData, perRead = 1): Adapter => {
  const inner = memory({ data, pageSize: PAGE, workspaceId: "agency" });

  const reads = Object.entries(inner).flatMap(([name, value]) =>
    // oxlint-disable-next-line anti-slop/no-runtime-typeof -- picking the adapter's read functions out of its fields
    typeof value === "function" && /^(?:list|get|stats$)/u.test(name)
      ? [
          [
            name,
            async (...args: unknown[]) => {
              // SAFETY: every read takes the context as its last argument.
              await touch(args.at(-1) as AdapterContext, name, perRead);

              // SAFETY: the same read, called with the arguments it was given.
              return await (value as (...all: unknown[]) => unknown)(...args);
            },
          ],
        ]
      : []
  );

  return { ...inner, ...Object.fromEntries(reads), costs: COSTS };
};

export interface OverOptions {
  readonly perRead?: number;
  readonly plugins?: readonly OutboundPlugin[];
  readonly maxRequestsPerCall?: number;
}

/** An instance over the metered tool, with the insights plugin and a fetch that counts. */
export const over = (data: MemoryData, options: OverOptions = {}) => {
  const http = createFetch(() => json({}));

  const outbound = createOutbound({
    adapter: metered(data, options.perRead),
    fetch: http.fetch,
    maxRequestsPerCall: options.maxRequestsPerCall,
    plugins: [...(options.plugins ?? []), insights()],
    rateLimitStore: new MemoryRateLimitStore(),
    retries: 0,
    share: 1,
  });

  return { http, outbound };
};

export { NOW };

/** What a promise settled to: its value, or what it was rejected with. */
export const settled = async <Value>(
  promise: Promise<Value>
): Promise<Value | { readonly rejected: unknown }> => {
  try {
    return await promise;
  } catch (error) {
    return { rejected: error };
  }
};
