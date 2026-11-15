import assert from "node:assert/strict";
import { test } from "node:test";

import { emailbison, NATIVE } from "../../src/emailbison/index.ts";
import {
  createOutbound,
  MemoryRateLimitStore,
  OutboundError,
} from "../../src/index.ts";
import type { Json, NativeParam, NativeRead } from "../../src/index.ts";
import { parse, webhookProviders } from "../../src/webhooks/index.ts";
import { fixtureText } from "../helpers/fixtures.ts";
import { createFetch, json } from "../helpers/http.ts";
import { KEY, ORIGIN, suite } from "./suite.ts";

const ANSWER = { data: [{ id: 1 }] };

const client = () => {
  const http = createFetch(() => json(ANSWER));

  return {
    outbound: createOutbound({
      adapter: emailbison({ apiKey: KEY, workspaceId: "client-a" }),
      fetch: http.fetch,
      rateLimitStore: new MemoryRateLimitStore(),
      share: 1,
    }),
    requests: http.requests,
  };
};

const entries: [string, NativeRead][] = Object.entries(NATIVE);

const SAMPLES: Readonly<Record<NativeParam["type"], Json>> = {
  boolean: true,
  json: { ids: [1, 2] },
  list: [3, 4],
  number: 7,
  string: "a b/c",
};

const sample = (read: NativeRead): Record<string, Json> =>
  Object.fromEntries(
    Object.entries(read.params ?? {}).map(([name, param]) => [
      name,
      SAMPLES[param.type],
    ])
  );

test("emailbison: every native read is a GET on EmailBison's own host, described, with its reference anchor", () => {
  assert.equal(entries.length, 32);

  for (const [name, read] of entries) {
    assert.match(name, /^[a-z][A-Za-z0-9]+$/u, `${name} is camelCase`);
    assert.equal(
      read.method,
      "GET",
      `${name}: the one POST read is normalized`
    );
    assert.ok(read.path.startsWith("/api/"), `${name} path`);
    assert.equal(read.baseUrl, undefined, `${name} has no other host`);
    assert.ok(read.description.length > 15, `${name} says what it answers`);
    assert.equal(
      read.docs,
      `https://dedi.emailbison.com/api/reference#tag/${read.docs?.split("#tag/")[1]?.split("/")[0]}/get${read.path}`,
      `${name} docs`
    );

    for (const [param, spec] of Object.entries(read.params ?? {})) {
      assert.ok(spec.description.length > 5, `${name}.${param} is described`);
      assert.equal(
        spec.in === "path",
        read.path.includes(`{${param}}`),
        `${name}.${param} is in the path exactly when it is a path parameter`
      );
      assert.notEqual(spec.in, "body", `${name}.${param}: a GET has no body`);
    }
  }
});

test("emailbison: every native read builds the documented request and returns EmailBison's answer", async () => {
  for (const [name, read] of entries) {
    const { outbound, requests } = client();
    // oxlint-disable-next-line no-await-in-loop -- one read at a time keeps a failure readable.
    const result = await outbound.native.read(name, sample(read));
    assert.deepEqual(result.data, ANSWER, name);
    assert.equal(requests.length, 1, `${name} is one request`);
    const [request] = requests;
    const url = new URL(request?.url ?? "");
    let expected = read.path;

    for (const [param, spec] of Object.entries(read.params ?? {})) {
      if (spec.in === "path") {
        expected = expected.replace(`{${param}}`, encodeURIComponent("a b/c"));
      } else if (spec.type === "list") {
        assert.deepEqual(
          url.searchParams.getAll(param),
          ["3", "4"],
          `${name}.${param}`
        );
      }
    }

    assert.equal(request?.method, "GET", name);
    assert.equal(url.origin + url.pathname, ORIGIN + expected, name);
    assert.equal(request?.headers.authorization, `Bearer ${KEY}`, name);
  }
});

test("emailbison: the reads that return secrets are not in the catalog, and raw refuses them", async () => {
  const paths = entries.map(([, read]) => read.path);
  assert.ok(!paths.some((route) => route.includes("oauth-access-token")));
  assert.ok(
    !paths.some((route) =>
      /^\/api\/workspaces(?:\/v1\.1)?(?:\/\{team_id\})?$/u.test(route)
    )
  );

  const { outbound, requests } = client();

  for (const route of [
    "/api/sender-emails/12/oauth-access-token",
    "/api/workspaces",
    "/api/workspaces/3",
    "/api/workspaces/v1.1",
    "/api/workspaces/v1.1/3/",
  ]) {
    // oxlint-disable-next-line no-await-in-loop -- one refusal at a time keeps a failure readable.
    await assert.rejects(
      async () => await outbound.raw.request("GET", route),
      (error) => OutboundError.is(error) && error.code === "Unsupported",
      route
    );
  }

  assert.equal(requests.length, 0);
  await outbound.raw.request("GET", "/api/workspaces/v1.1/stats");
  await outbound.raw.request(
    "GET",
    "/api/workspaces/v1.1/master-inbox-settings"
  );
  assert.equal(
    requests.length,
    2,
    "the workspace stats and settings hold no secret"
  );
});

test("emailbison: the one POST that reads is a campaign's stats; every other POST writes", () => {
  const { raw } = suite.make();
  assert.equal(raw.isRead("POST", "/api/campaigns/12/stats"), true);
  assert.equal(raw.isRead("POST", "/api/campaigns/12/stats/"), true);
  assert.equal(raw.isRead("GET", "/api/leads"), true);

  for (const route of [
    "/api/campaigns",
    "/api/campaigns/12/pause",
    "/api/leads",
    "/api/replies/4/reply",
    "/api/webhook-events/test-event",
    "/api/campaigns/12/stats/extra",
  ]) {
    assert.equal(raw.isRead("POST", route), false, route);
  }

  assert.equal(raw.isRead("PATCH", "/api/campaigns/12/pause"), false);
  assert.equal(raw.isRead("DELETE", "/api/leads/4"), false);
});

const request = (file: string) =>
  new Request("https://hooks.example.com/outbound/s3cret-value", {
    body: fixtureText("emailbison", file),
    headers: { "content-type": "application/json" },
    method: "POST",
  });

test("emailbison: a sent-email webhook names its lead, campaign, sender and message", async () => {
  const [event] = await parse(request("webhook.EMAIL_SENT.json"), {
    provider: "emailbison",
    secret: "s3cret-value",
    workspaceId: "client-a",
  });

  assert.equal(event?.type, "message.sent");
  assert.equal(event?.leadRef, "emailbison:client-a:101");
  assert.equal(event?.campaignRef, "emailbison:client-a:1");
  assert.equal(event?.senderRef, "emailbison:client-a:1");
  assert.equal(event?.messageRef, "emailbison:client-a:scheduled-4");
  assert.equal(event?.occurredAt, "2024-08-02T06:09:35.000Z");
  assert.equal(event?.data.leadEmail, "person1@example.com");
  assert.equal(event?.data.leadName, "Alex Example");
  assert.equal(event?.data.campaignName, "Example Campaign A");
  assert.equal(event?.data.subject, "Quick question");
  assert.equal(event?.data.vendorEvent, "EMAIL_SENT");
});

test("emailbison: reply webhooks carry the reply, and interest is a positive categorization", async () => {
  const options = {
    provider: "emailbison",
    secret: "s3cret-value",
    workspaceId: "client-a",
  };

  const [replied] = await parse(request("webhook.LEAD_REPLIED.json"), options);

  const [interested] = await parse(
    request("webhook.LEAD_INTERESTED.json"),
    options
  );

  const [untracked] = await parse(
    request("webhook.UNTRACKED_REPLY_RECEIVED.json"),
    options
  );

  assert.equal(replied?.messageRef, "emailbison:client-a:65200");
  assert.equal(replied?.data.text, "Yes, let's talk.");
  assert.equal(replied?.data.isAuto, false);
  assert.equal(interested?.type, "reply.categorized");
  assert.equal(interested?.data.category, "positive");
  assert.notEqual(replied?.id, interested?.id, "two events about one reply");
  assert.equal(untracked?.data.untracked, true);
  assert.equal(untracked?.campaignRef, null);
});

test("emailbison: a webhook without the URL's secret is refused", async () => {
  await assert.rejects(
    async () =>
      await parse(request("webhook.EMAIL_SENT.json"), {
        provider: "emailbison",
        secret: "another-secret",
        workspaceId: "client-a",
      }),
    (error) => OutboundError.is(error) && error.code === "Unauthorized"
  );
});

test("emailbison: auto-detection recognizes EmailBison and no other vendor's webhooks", async () => {
  assert.ok(webhookProviders().includes("emailbison"));
  const { events } = suite.make();
  assert.ok(events);

  for (const [provider, file] of [
    ["instantly", "webhook.reply_received.json"],
    ["smartlead", "webhook.EMAIL_REPLY.json"],
    ["heyreach", "webhook.voice_note_received.json"],
  ] as const) {
    const rawBody = fixtureText(provider, file);
    assert.equal(
      events.detect({
        body: JSON.parse(rawBody),
        headers: new Headers(),
        rawBody,
        url: "https://hooks.example.com/",
      }),
      false,
      provider
    );
  }

  const [event] = await parse(request("webhook.EMAIL_BOUNCED.json"), {
    provider: "auto",
    secret: "s3cret-value",
    workspaceId: "client-a",
  });

  assert.equal(event?.provider, "emailbison");
  assert.equal(event?.type, "message.bounced");
});
