import assert from "node:assert/strict";
import { test } from "node:test";

import { OutboundError } from "../src/index.ts";
import type { OutboundPlugin } from "../src/index.ts";
import { redact } from "../src/redact/index.ts";
import {
  carriesSecret,
  memoryDedupeStore,
  parse,
  setupInstructions,
  timingSafeEqual,
  verify,
  webhookProviders,
} from "../src/webhooks/index.ts";
import { fixtureText } from "./helpers/fixtures.ts";

const SECRET = "whk_local_test_secret_0001";
const reply = fixtureText("instantly", "webhook.reply_received.json");

const post = (
  body: string,
  url = "https://app.example.com/hooks/outbound",
  headers: Record<string, string> = {}
) =>
  new Request(url, {
    body,
    headers: { "content-type": "application/json", ...headers },
    method: "POST",
  });

test("parses a named provider's webhook into events with the given workspace", async () => {
  const events = await parse(post(reply), {
    provider: "instantly",
    workspaceId: "client-a",
  });

  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, "reply.received");
  assert.equal(events[0]?.provider, "instantly");
  assert.equal(events[0]?.workspaceId, "client-a");
  assert.deepEqual(events[0]?.raw, JSON.parse(reply));
});

test("auto-detects the provider from the payload", async () => {
  const events = await parse(post(reply));
  assert.equal(events[0]?.provider, "instantly");
  assert.equal(events[0]?.workspaceId, "default");
  assert.deepEqual(webhookProviders().includes("instantly"), true);
});

test("a payload no parser recognises is returned as one unknown event, never dropped", async () => {
  const body = JSON.stringify({ hello: "world" });
  const [event, ...rest] = await parse(post(body));
  assert.equal(rest.length, 0);
  assert.equal(event?.type, "unknown");
  assert.equal(event?.provider, "unknown");
  assert.deepEqual(event?.raw, { hello: "world" });
  const [again] = await parse(post(body));
  assert.equal(event?.id, again?.id, "the id is stable across redelivery");

  const [text] = await parse(post("not json at all"));
  assert.equal(text?.raw, "not json at all");
});

test("an unknown provider name is rejected", async () => {
  await assert.rejects(
    parse(post(reply), { provider: "mailchimp" }),
    (error) =>
      OutboundError.is(error) &&
      error.code === "Invalid" &&
      /No webhook parser for "mailchimp"/u.test(error.message)
  );
});

test("a vendor that does not sign is authenticated by a shared secret in the URL or a header", async () => {
  const accepted = [
    post(reply, `https://app.example.com/hooks/${SECRET}`),
    post(reply, `https://app.example.com/hooks/outbound?secret=${SECRET}`),
    post(reply, `https://app.example.com/hooks/outbound?token=${SECRET}`),
    post(reply, undefined, { "x-webhook-secret": SECRET }),
    post(reply, undefined, { authorization: `Bearer ${SECRET}` }),
  ];

  for (const request of accepted) {
    const events = await parse(request, {
      provider: "instantly",
      secret: SECRET,
    });

    assert.equal(events.length, 1, request.url);
  }

  const rejected = [
    post(reply),
    post(reply, "https://app.example.com/hooks/wrong-secret"),
    post(reply, undefined, { "x-webhook-secret": `${SECRET}x` }),
    post(reply, `https://app.example.com/hooks/${SECRET.slice(0, -1)}`),
  ];

  for (const request of rejected) {
    await assert.rejects(
      parse(request, { provider: "instantly", secret: SECRET }),
      (error) =>
        OutboundError.is(error) &&
        error.code === "Unauthorized" &&
        /does not carry the shared secret/u.test(error.message)
    );
  }
});

test("verify answers true or false without consuming the request", async () => {
  const good = post(reply, `https://app.example.com/hooks/${SECRET}`);
  assert.equal(
    await verify(good, { provider: "instantly", secret: SECRET }),
    true
  );
  assert.equal(
    (await parse(good, { provider: "instantly", secret: SECRET })).length,
    1,
    "the body is still readable"
  );
  assert.equal(await verify(post(reply), { secret: SECRET }), false);
  await assert.rejects(
    verify(post(reply), { provider: "mailchimp", secret: SECRET }),
    OutboundError
  );
});

test("a dedupe store drops an event that was already handled", async () => {
  const dedupe = memoryDedupeStore();
  const first = await parse(post(reply), { dedupe, provider: "instantly" });

  const redelivered = await parse(post(reply), {
    dedupe,
    provider: "instantly",
  });

  assert.equal(first.length, 1);
  assert.deepEqual(redelivered, []);

  const other = await parse(
    post(fixtureText("instantly", "webhook.email_sent.json")),
    { dedupe }
  );

  assert.equal(other.length, 1, "a different event still gets through");
});

test("the memory dedupe store forgets its oldest ids once full", async () => {
  const store = memoryDedupeStore(2);
  assert.equal(await store.claim("a"), true);
  assert.equal(await store.claim("b"), true);
  assert.equal(await store.claim("c"), true);
  assert.equal(await store.claim("c"), false);
  assert.equal(await store.claim("a"), true, "a was forgotten when c arrived");
});

test("plugin event hooks run on every event and can drop one", async () => {
  const [redacted] = await parse(post(reply), {
    plugins: [redact()],
    provider: "instantly",
  });

  assert.equal(redacted?.data.leadEmail, "[redacted]");
  assert.equal(redacted?.data.text, "[redacted]");
  assert.equal(redacted?.raw, null);
  assert.equal(redacted?.type, "reply.received");

  const order: string[] = [];

  const tag = (name: string): OutboundPlugin => ({
    event: (event) => {
      order.push(name);

      return event;
    },
    name,
  });

  const dropper: OutboundPlugin = { event: () => null, name: "dropper" };
  assert.deepEqual(
    await parse(post(reply), {
      plugins: [tag("outer"), dropper, tag("inner")],
    }),
    []
  );
  assert.deepEqual(
    order,
    ["inner"],
    "hooks run innermost first, and stop once an event is dropped"
  );
});

test("the constant-time comparison is exact", () => {
  assert.equal(timingSafeEqual("abc", "abc"), true);
  assert.equal(timingSafeEqual("abc", "abd"), false);
  assert.equal(timingSafeEqual("abc", "abcd"), false);
  assert.equal(timingSafeEqual("", ""), true);
  // "ab" and "ba" have the same bytes in a different order.
  assert.equal(timingSafeEqual("ab", "ba"), false);
  assert.equal(carriesSecret("not a url", new Headers(), "x"), false);
});

test("setup instructions exist for each webhook provider and say the SDK registers nothing", () => {
  for (const provider of webhookProviders()) {
    assert.ok(setupInstructions(provider).length > 40, provider);
  }

  assert.throws(() => setupInstructions("mailchimp"), OutboundError);
});
