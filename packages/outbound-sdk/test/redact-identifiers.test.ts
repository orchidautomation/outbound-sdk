// What redact does to the identifiers that are not a field of their own:
// person keys, and ids and refs that a vendor built from an address or a
// profile URL. Also the raw client, which returns what redact cannot mask.

import assert from "node:assert/strict";
import { test } from "node:test";

import { identity } from "../src/identity/index.ts";
import { createOutbound, OutboundError } from "../src/index.ts";
import type { Adapter, OutboundEvent, OutboundPlugin } from "../src/index.ts";
import { memory } from "../src/memory/index.ts";
import { MASK, redact } from "../src/redact/index.ts";
import { createFetch, json, testAdapter } from "./helpers/http.ts";

const PROFILE = "https://www.linkedin.com/in/Example-Person-1/";

// A tool that, like Instantly and HeyReach, uses the mailbox address as the
// sender's id and the profile URL as a lead's id.
const tool = (): Adapter =>
  memory({
    data: {
      campaigns: [{ id: "c1", name: "Founders" }],
      leads: [
        {
          campaignId: "c1",
          email: "Person1@Example.com",
          firstName: "Alex",
          id: "l1",
          linkedinUrl: PROFILE,
        },
        { campaignId: "c1", id: PROFILE, linkedinUrl: PROFILE },
      ],
      messages: [
        {
          campaignId: "c1",
          direction: "out",
          id: "m1",
          leadId: "l1",
          senderId: "Outreach@Example.com",
          sentAt: "2026-10-05T10:00:00.000Z",
        },
      ],
      senders: [
        { address: "outreach@example.com", id: "Outreach@Example.com" },
      ],
    },
    name: "mailtool",
    workspaceId: "agency",
  });

type Keyed = Readonly<Record<string, unknown>>;

test("redact masks the person keys identity adds, and hashes them to match the field", async () => {
  const masked = createOutbound({
    adapter: tool(),
    plugins: [redact(), identity()],
  });

  const [lead] = (await masked.leads.list()).items as readonly Keyed[];
  assert.equal(lead?.personKey, `email:${MASK}`);
  assert.deepEqual(lead?.personKeys, [`email:${MASK}`, `linkedin:${MASK}`]);
  assert.ok(
    !/person1|example-person/iu.test(JSON.stringify(await masked.leads.list())),
    "no address or slug is left anywhere in the listing"
  );

  const hashed = createOutbound({
    adapter: tool(),
    plugins: [redact({ strategy: "hash" }), identity()],
  });

  const [first] = (await hashed.leads.list()).items as readonly Keyed[];
  assert.equal(first?.personKey, `email:${String(first?.email)}`);
  assert.match(String(first?.personKey), /^email:redacted:[0-9a-f]{16}$/u);

  const kept = createOutbound({
    adapter: tool(),
    plugins: [redact({ fields: ["name"] }), identity()],
  });

  const [open] = (await kept.leads.list()).items as readonly Keyed[];
  assert.equal(open?.personKey, "email:person1@example.com");
  assert.equal(open?.firstName, MASK);
});

test("person() refuses under a redact that masks identifiers, and works when it does not", async () => {
  for (const plugins of [
    [redact(), identity()] as const,
    [identity(), redact({ fields: ["linkedin"], strategy: "hash" })] as const,
  ]) {
    const outbound = createOutbound({ adapter: tool(), plugins });

    await assert.rejects(
      async () => await outbound.person("person1@example.com"),
      (error) =>
        OutboundError.is(error) &&
        error.code === "Unsupported" &&
        /the redact plugin masks .*linkedin/u.test(error.message),
      "never a silent found: false"
    );
  }

  const names = createOutbound({
    adapter: tool(),
    plugins: [redact({ fields: ["name"] }), identity()],
  });

  const person = await names.person("person1@example.com", {
    timeline: false,
  });

  assert.equal(person.found, true);
  assert.equal(person.records.length, 2, "the profile linked a second record");
  assert.deepEqual(names.redacted, { fields: ["name"], strategy: "mask" });
});

test("redact masks an address or a profile URL inside an id and every ref", async () => {
  const outbound = createOutbound({ adapter: tool(), plugins: [redact()] });
  const [sender] = (await outbound.senders.list()).items;
  assert.equal(sender?.sourceId, MASK);
  assert.equal(sender?.ref, `mailtool:agency:${MASK}`);

  const [message] = (await outbound.messages.list()).items;
  assert.equal(message?.senderRef, `mailtool:agency:${MASK}`);
  assert.equal(
    message?.leadRef,
    "mailtool:agency:l1",
    "an id the vendor made up is not personal data and stays"
  );
  assert.equal(message?.ref, "mailtool:agency:m1");

  const leads = (await outbound.leads.list()).items;
  assert.equal(leads[0]?.ref, "mailtool:agency:l1");
  assert.equal(leads[1]?.sourceId, MASK);
  assert.equal(leads[1]?.ref, `mailtool:agency:${MASK}`);
  assert.equal(leads[1]?.campaignRef, "mailtool:agency:c1");

  const everything = JSON.stringify([
    await outbound.senders.list(),
    await outbound.messages.list(),
    leads,
  ]);

  assert.ok(!/outreach@|example-person/iu.test(everything), everything);
});

test("a hashed ref is stable, and the same wherever the record is pointed at", async () => {
  const outbound = createOutbound({
    adapter: tool(),
    plugins: [redact({ strategy: "hash" })],
  });

  const [sender] = (await outbound.senders.list()).items;
  const [again] = (await outbound.senders.list()).items;
  const [message] = (await outbound.messages.list()).items;
  assert.match(sender?.ref ?? "", /^mailtool:agency:redacted:[0-9a-f]{16}$/u);
  assert.equal(sender?.ref, again?.ref, "the same record keeps its ref");
  assert.equal(message?.senderRef, sender?.ref, "a ref still joins");
  assert.equal(
    sender?.sourceId,
    sender?.address,
    "the id's token is the address field's token"
  );

  const [, lead] = (await outbound.leads.list()).items;
  assert.match(lead?.ref ?? "", /^mailtool:agency:redacted:[0-9a-f]{16}$/u);
});

test("ids are masked only for the fields redact was asked to mask, in events too", async () => {
  const names = createOutbound({
    adapter: tool(),
    plugins: [redact({ fields: ["name"] })],
  });

  assert.equal(
    (await names.senders.list()).items[0]?.ref,
    "mailtool:agency:Outreach@Example.com"
  );
  assert.equal((await names.leads.list()).items[1]?.sourceId, PROFILE);

  const event: OutboundEvent = {
    campaignRef: "mailtool:agency:c1",
    data: {},
    id: "e1",
    leadRef: `mailtool:agency:${PROFILE}`,
    messageRef: null,
    occurredAt: null,
    provider: "mailtool",
    raw: null,
    schemaVersion: 1,
    senderRef: "outreach@example.com",
    type: "reply.received",
    workspaceId: "agency",
  };

  const redacted = redact().event?.(event);
  assert.equal(redacted?.leadRef, `mailtool:agency:${MASK}`);
  assert.equal(redacted?.senderRef, MASK, "a bare id is masked as it stands");
  assert.equal(redacted?.campaignRef, "mailtool:agency:c1");
  assert.equal(redacted?.messageRef, null);
});

test("raw is refused once a plugin has turned native off, and names the plugin", async () => {
  const http = createFetch(() => json({ items: [] }));

  const outbound = createOutbound({
    adapter: testAdapter(),
    fetch: http.fetch,
    plugins: [redact()],
  });

  for (const send of [
    () => outbound.raw.get("/campaigns"),
    () => outbound.raw.request("POST", "/search", { body: {} }),
  ]) {
    await assert.rejects(
      async () => await send(),
      (error) =>
        OutboundError.is(error) &&
        error.code === "Unsupported" &&
        /raw is not available: the redact plugin turned/u.test(error.message)
    );
  }

  assert.equal(http.requests.length, 0, "nothing was sent");

  // A plugin that narrows something else leaves raw alone.
  const narrow: OutboundPlugin = {
    capabilities: (capabilities) => ({ ...capabilities, sequence: false }),
    name: "narrow",
  };

  const other = createOutbound({
    adapter: testAdapter(),
    fetch: http.fetch,
    plugins: [narrow],
  });

  assert.deepEqual(await other.raw.get("/campaigns"), { items: [] });
});
