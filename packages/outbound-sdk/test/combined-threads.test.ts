// A combined instance reads a conversation by the thread id another read
// handed out, by asking each member that reads threads (OUT-153). Instantly
// and HeyReach in their live shape, over the documented fixtures.

import assert from "node:assert/strict";
import { test } from "node:test";

import { combine } from "../src/combine/index.ts";
import { createOutbound, MemoryRateLimitStore } from "../src/index.ts";
import { insights } from "../src/insights/index.ts";
import { fixtureHandler } from "./helpers/adapter-suite.ts";
import { createClock } from "./helpers/clock.ts";
import { fixture } from "./helpers/fixtures.ts";
import { createFetch, json } from "./helpers/http.ts";
import { suite as heyreach } from "./heyreach/suite.ts";
import { suite as instantly } from "./instantly/suite.ts";

const EMAILS = (
  fixture("instantly", "listEmails.followUp.json") as {
    items: { thread_id: string }[];
  }
).items;

const INSTANTLY_THREAD = EMAILS[0]?.thread_id ?? "";

/** `<accountId>:<conversationId>`, as HeyReach's conversation fixtures give it. */
const HEYREACH_THREAD = "4101:2-ExampleConversationId1==";

const setup = () => {
  const clock = createClock();
  const fixtures = fixtureHandler([instantly, heyreach]);

  const http = createFetch((request, index) => {
    const url = new URL(request.url);

    if (url.pathname === "/api/v2/emails") {
      const search = url.searchParams.get("search") ?? "";

      return json({
        items: EMAILS.filter(
          (item) =>
            !search.startsWith("thread:") || item.thread_id === search.slice(7)
        ),
      });
    }

    return fixtures(request, index);
  });

  const outbound = createOutbound({
    adapter: combine([instantly.make(), heyreach.make()]),
    fetch: http.fetch,
    plugins: [insights()],
    rateLimitStore: new MemoryRateLimitStore(),
    runtime: clock.runtime,
  });

  return { clock, http, outbound };
};

test("a combined instance reads a thread of each member by the id a message carries", async () => {
  const { clock, outbound } = setup();

  const [email, linkedin] = await clock.settle(
    Promise.all([
      outbound.thread(INSTANTLY_THREAD).messages(),
      outbound.thread(HEYREACH_THREAD).messages(),
    ])
  );

  assert.ok((email?.items.length ?? 0) > 0);
  assert.ok(email?.items.every((message) => message.provider === "instantly"));
  assert.ok((linkedin?.items.length ?? 0) > 0);
  assert.ok(
    linkedin?.items.every((message) => message.provider === "heyreach")
  );
  assert.ok(
    linkedin?.items.every((message) => message.threadId === HEYREACH_THREAD)
  );
});

test("thread_context by threads on a combined instance finds an Instantly and a HeyReach conversation", async () => {
  const { clock, outbound } = setup();

  assert.equal(outbound.capabilities["messages.byThread"], true);

  const result = await clock.settle(
    outbound.insights.threadContext({
      threads: [INSTANTLY_THREAD, HEYREACH_THREAD],
    })
  );

  assert.equal(result.data.coverage.found, 2);
  assert.deepEqual(result.data.coverage.notFound, []);
  assert.deepEqual(result.data.coverage.unchecked, []);
  assert.deepEqual(
    result.data.threads.map((thread) => thread.messages[0]?.provider),
    ["instantly", "heyreach"]
  );
});
