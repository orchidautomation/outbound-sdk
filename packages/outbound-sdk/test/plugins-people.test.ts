import assert from "node:assert/strict";
import { test } from "node:test";

import { clients, UNASSIGNED } from "../src/clients/index.ts";
import { combine } from "../src/combine/index.ts";
import {
  emailKey,
  identity,
  linkedinKey,
  toKey,
} from "../src/identity/index.ts";
import { createOutbound, OutboundError } from "../src/index.ts";
import type { Adapter, OutboundEvent } from "../src/index.ts";
import { memory } from "../src/memory/index.ts";
import { MASK, redact } from "../src/redact/index.ts";

const TOKEN = /^redacted:[0-9a-f]{16}$/u;

const emailTool = (): Adapter =>
  memory({
    data: {
      campaigns: [
        { id: "c1", name: "Acme - founders", tags: ["acme"] },
        { id: "c2", name: "Globex - agencies", tags: ["globex"] },
        { id: "c3", name: "Internal test" },
      ],
      leads: [
        {
          campaignId: "c1",
          company: "Example Co",
          custom: { phone: "+1 555 0100" },
          email: "Person1@Example.com",
          firstName: "Alex",
          id: "l1",
          lastName: "Example",
          linkedinUrl: "https://www.linkedin.com/in/Example-Person-1/",
        },
        {
          campaignId: "c2",
          email: "person2@example.com",
          firstName: "Sam",
          id: "l2",
        },
        { campaignId: "c3", id: "l3" },
      ],
      messages: [
        {
          body: "Hi Alex",
          campaignId: "c1",
          direction: "out",
          id: "m1",
          leadId: "l1",
          senderId: "s1",
          sentAt: "2026-10-05T10:00:00.000Z",
          subject: "Quick question",
        },
        {
          body: "Call me on +1 555 0100",
          campaignId: "c1",
          category: "positive",
          direction: "in",
          id: "m2",
          leadId: "l1",
          sentAt: "2026-10-07T10:00:00.000Z",
        },
      ],
      senders: [
        { address: "outreach@example.com", id: "s1", name: "Outreach One" },
      ],
      stats: [
        {
          campaignId: "c1",
          counts: { replied: 4, sent: 100 },
          date: "2026-10-05",
        },
        {
          campaignId: "c2",
          counts: { replied: 1, sent: 50 },
          date: "2026-10-05",
        },
        {
          campaignId: "c3",
          counts: { replied: 0, sent: 10 },
          date: "2026-10-05",
        },
      ],
    },
    name: "mailtool",
    workspaceId: "agency",
  });

const linkedinTool = (): Adapter =>
  memory({
    data: {
      campaigns: [{ channel: "linkedin", id: "k1", name: "Acme LinkedIn" }],
      leads: [
        {
          campaignId: "k1",
          id: "p1",
          linkedinUrl: "https://linkedin.com/in/example-person-1?utm=x",
        },
        {
          campaignId: "k1",
          id: "p2",
          linkedinUrl: "https://www.linkedin.com/in/example-person-9",
        },
      ],
      messages: [
        {
          campaignId: "k1",
          direction: "out",
          id: "d1",
          leadId: "p1",
          sentAt: "2026-10-06T10:00:00.000Z",
        },
      ],
    },
    name: "lntool",
    workspaceId: "acme-linkedin",
  });

test("redact masks every personal field and drops the raw payload", async () => {
  const outbound = createOutbound({
    adapter: emailTool(),
    plugins: [redact()],
  });

  const [lead] = (await outbound.leads.list()).items;
  assert.match(lead?.email ?? "", TOKEN, "an address is a keyed token");
  assert.equal(lead?.firstName, MASK);
  assert.equal(lead?.lastName, MASK);
  assert.equal(lead?.company, MASK);
  assert.match(lead?.linkedinUrl ?? "", TOKEN, "so is a profile");
  assert.deepEqual(lead?.custom, { phone: MASK });
  assert.equal(lead?.raw, null);
  assert.equal(
    lead?.ref,
    "mailtool:agency:l1",
    "ids stay, so records can still be followed"
  );

  const [sender] = (await outbound.senders.list()).items;
  assert.match(sender?.address ?? "", TOKEN);
  assert.equal(sender?.name, MASK);

  const [message] = (await outbound.messages.list()).items;
  assert.equal(message?.subject, MASK);
  assert.equal(
    (await outbound.leads.list()).items[2]?.email,
    null,
    "a missing value stays null"
  );
  const serialized = JSON.stringify(await outbound.leads.list());
  assert.ok(!/person1|alex|example co|555/iu.test(serialized), serialized);
});

test("redact refuses message bodies instead of returning them masked", async () => {
  const outbound = createOutbound({
    adapter: emailTool(),
    plugins: [redact()],
  });

  assert.equal(outbound.capabilities["messages.body"], false);
  await assert.rejects(
    async () => await outbound.messages.list({ include: ["body"] }),
    (error) =>
      OutboundError.is(error) &&
      /the redact plugin turned it off/u.test(error.message)
  );
});

test("redact can keep some fields and hash the rest into stable tokens", async () => {
  const outbound = createOutbound({
    adapter: emailTool(),
    plugins: [redact({ fields: ["email"], strategy: "hash" })],
  });

  const [first] = (await outbound.leads.list()).items;
  const [again] = (await outbound.leads.list()).items;
  assert.match(first?.email ?? "", /^redacted:[0-9a-f]{16}$/u);
  assert.equal(
    first?.email,
    again?.email,
    "the same address always hashes the same"
  );
  assert.equal(first?.firstName, "Alex", "names were not asked to be masked");
  assert.equal(first?.raw, null, "raw is always dropped");
  const bodies = await outbound.messages.list({ include: ["body"] });
  assert.equal(
    bodies.items[0]?.bodyText,
    "Hi Alex",
    "bodies are allowed when they are not being masked"
  );
});

test("redact leaves counts and campaign structure alone", async () => {
  const outbound = createOutbound({
    adapter: emailTool(),
    plugins: [redact()],
  });

  assert.equal((await outbound.stats()).rows[0]?.sent, 160);
  assert.equal((await outbound.campaigns.get("c1")).name, "Acme - founders");
  assert.equal((await outbound.campaign("c1").sequence()).steps.length, 0);
  assert.equal((await outbound.workspaces.list()).items[0]?.name, "agency");
});

test("redact masks webhook event data and fails closed on an unknown record", async () => {
  const plugin = redact();

  const event: OutboundEvent = {
    campaignRef: null,
    data: {
      leadEmail: "person1@example.com",
      nested: { email: "person1@example.com" },
      stepIndex: 0,
      text: "hello",
    },
    id: "e1",
    leadRef: null,
    messageRef: null,
    occurredAt: null,
    provider: "mailtool",
    raw: { lead_email: "person1@example.com" },
    schemaVersion: 1,
    senderRef: null,
    type: "reply.received",
    workspaceId: "agency",
  };

  const redacted = plugin.event?.(event);
  assert.match(String(redacted?.data.leadEmail), TOKEN);
  assert.deepEqual(redacted?.data, {
    leadEmail: redacted?.data.leadEmail,
    nested: MASK,
    stepIndex: 0,
    text: MASK,
  });
  assert.equal(redacted?.raw, null);

  const stranger = createOutbound({
    adapter: emailTool(),
    plugins: [
      redact(),
      {
        name: "stranger",
        wrap: () =>
          Promise.resolve({
            evidence: "exact" as const,
            items: [{ ref: "x" } as never],
          }),
      },
    ],
  });

  await assert.rejects(
    async () => await stranger.leads.list(),
    (error) =>
      OutboundError.is(error) &&
      error.code === "Unsupported" &&
      /does not recognise this record/u.test(error.message)
  );
});

test("person keys come from exact identifiers only", () => {
  assert.equal(emailKey("  Person1@Example.com "), "email:person1@example.com");
  assert.equal(emailKey("not an email"), null);
  assert.equal(emailKey(null), null);
  assert.equal(
    linkedinKey("https://www.linkedin.com/in/Example-Person-1/?utm=x"),
    "linkedin:example-person-1"
  );
  assert.equal(linkedinKey("https://example.com/in/someone"), null);
  assert.equal(toKey("EMAIL:Person1@example.com"), "email:person1@example.com");
  assert.equal(
    toKey("linkedin.com/in/example-person-1"),
    "linkedin:example-person-1"
  );
  assert.equal(toKey("Alex Example"), null, "a name is never a key");
});

test("identity tags every lead with its person keys", async () => {
  const outbound = createOutbound({
    adapter: emailTool(),
    plugins: [identity()],
  });

  const leads = (await outbound.leads.list()).items as readonly Record<
    string,
    unknown
  >[];

  assert.equal(leads[0]?.personKey, "email:person1@example.com");
  assert.deepEqual(leads[0]?.personKeys, [
    "email:person1@example.com",
    "linkedin:example-person-1",
  ]);
  assert.equal(leads[1]?.personKey, "email:person2@example.com");
  assert.equal(leads[2]?.personKey, null);
  assert.deepEqual(leads[2]?.personKeys, []);
});

test("person() links the same person across tools and builds one timeline", async () => {
  const outbound = createOutbound({
    adapter: combine([emailTool(), linkedinTool()]),
    plugins: [identity()],
  });

  // Looked up by the LinkedIn profile: the email record links through the profile it also carries.
  const person = await outbound.person(
    "https://www.linkedin.com/in/example-person-1"
  );

  assert.equal(person.found, true);
  assert.equal(person.key, "linkedin:example-person-1");
  assert.deepEqual(person.keys, [
    "email:person1@example.com",
    "linkedin:example-person-1",
  ]);
  assert.deepEqual(
    person.records.map((record) => record.ref),
    ["mailtool:agency:l1", "lntool:acme-linkedin:p1"],
    "two records, linked and not merged"
  );
  assert.deepEqual(
    person.timeline.map((message) => [message.channel, message.ref]),
    [
      ["email", "mailtool:agency:m1"],
      ["linkedin", "lntool:acme-linkedin:d1"],
      ["email", "mailtool:agency:m2"],
    ]
  );
});

test("person() follows a link found late in the scan back to earlier records", async () => {
  // The LinkedIn tool is scanned first here. Looked up by email, its record only
  // matches once the email record has revealed the profile.
  const outbound = createOutbound({
    adapter: combine([linkedinTool(), emailTool()]),
    plugins: [identity()],
  });

  const person = await outbound.person("person1@example.com", {
    timeline: false,
  });

  assert.deepEqual(person.records.map((record) => record.ref).toSorted(), [
    "lntool:acme-linkedin:p1",
    "mailtool:agency:l1",
  ]);
  assert.deepEqual(person.timeline, []);
});

test("person() reports an unknown link as not found, and rejects a name", async () => {
  const outbound = createOutbound({
    adapter: emailTool(),
    plugins: [identity()],
  });

  const nobody = await outbound.person("nobody@example.com");
  assert.equal(nobody.found, false);
  assert.deepEqual(nobody.records, []);
  await assert.rejects(
    async () => await outbound.person("Alex Example"),
    (error) => OutboundError.is(error) && error.code === "Invalid"
  );
});

test("person() scans campaign by campaign when there is no global lead list", async () => {
  const base = emailTool();

  const outbound = createOutbound({
    adapter: {
      ...base,
      capabilities: { ...base.capabilities, "leads.list": false },
    },
    plugins: [identity()],
  });

  assert.equal(
    (await outbound.person("person2@example.com")).records[0]?.ref,
    "mailtool:agency:l2"
  );

  const scoped = await outbound.person("person2@example.com", {
    campaignIds: ["c1"],
  });

  assert.equal(
    scoped.found,
    false,
    "the search stays inside the campaigns given"
  );
});

test("without rules, one workspace is one client", async () => {
  const outbound = createOutbound({
    adapter: combine([emailTool(), linkedinTool()]),
    plugins: [clients()],
  });

  const campaigns = (await outbound.campaigns.listAll().toArray()) as readonly {
    client?: string;
    ref: string;
  }[];

  assert.deepEqual(
    campaigns.map((campaign) => [campaign.ref, campaign.client]),
    [
      ["mailtool:agency:c1", "agency"],
      ["lntool:acme-linkedin:k1", "acme-linkedin"],
      ["mailtool:agency:c2", "agency"],
      ["mailtool:agency:c3", "agency"],
    ]
  );
  assert.deepEqual(outbound.clients.names(), []);
});

test("rules map tags, names and whole workspaces to clients; the rest is unassigned", async () => {
  const outbound = createOutbound({
    adapter: combine([emailTool(), linkedinTool()]),
    plugins: [
      clients({
        rules: [
          { campaignTag: "acme", client: "Acme" },
          { client: "Acme", workspaceId: "acme-linkedin" },
          { campaignName: /^Globex/u, client: "Globex" },
        ],
      }),
    ],
  });

  const campaigns = (await outbound.campaigns.listAll().toArray()) as readonly {
    client?: string;
    ref: string;
  }[];

  assert.deepEqual(
    campaigns.map((campaign) => [campaign.ref, campaign.client]),
    [
      ["mailtool:agency:c1", "Acme"],
      ["lntool:acme-linkedin:k1", "Acme"],
      ["mailtool:agency:c2", "Globex"],
      ["mailtool:agency:c3", UNASSIGNED],
    ]
  );
  assert.deepEqual(outbound.clients.names(), ["Acme", "Globex"]);
});

test("a rule takes a bare campaign id or a ref, and a g or y regex matches every campaign", async () => {
  const outbound = createOutbound({
    adapter: emailTool(),
    plugins: [
      clients({
        rules: [
          { campaignIds: ["c1"], client: "Acme" },
          { campaignIds: ["mailtool:agency:c2"], client: "Globex" },
          { campaignName: /t/giuy, client: "Anything" },
        ],
      }),
    ],
  });

  const campaigns = (await outbound.campaigns.listAll().toArray()) as readonly {
    client?: string;
    ref: string;
  }[];

  assert.deepEqual(
    campaigns.map((campaign) => campaign.client),
    ["Acme", "Globex", "Anything"],
    "a y regex matches as it would without the flag, not only at lastIndex"
  );

  const global = createOutbound({
    adapter: emailTool(),
    plugins: [clients({ rules: [{ campaignName: /e/gu, client: "E" }] })],
  });

  const named = (await global.campaigns.listAll().toArray()) as readonly {
    client?: string;
  }[];

  assert.deepEqual(
    named.map((campaign) => campaign.client),
    ["E", "E", "E"]
  );
});

test("a lead is assigned through its campaign, fetched once when a rule needs the tag", async () => {
  let campaignLookups = 0;
  const base = emailTool();

  const outbound = createOutbound({
    adapter: {
      ...base,
      getCampaign: (id, ctx) => {
        campaignLookups += 1;

        return base.getCampaign(id, ctx);
      },
    },
    plugins: [
      clients({
        rules: [
          { campaignTag: "acme", client: "Acme" },
          { campaignIds: ["mailtool:agency:c2"], client: "Globex" },
        ],
      }),
    ],
  });

  const leads = (await outbound.leads.list()).items as readonly {
    client?: string;
    ref: string;
  }[];

  assert.deepEqual(
    leads.map((lead) => [lead.ref, lead.client]),
    [
      ["mailtool:agency:l1", "Acme"],
      ["mailtool:agency:l2", "Globex"],
      ["mailtool:agency:l3", UNASSIGNED],
    ]
  );
  await outbound.leads.list();
  assert.equal(
    campaignLookups,
    3,
    "each campaign is looked up once, then remembered"
  );

  const messages = (await outbound.messages.list()).items as readonly {
    client?: string;
  }[];

  assert.deepEqual(
    [...new Set(messages.map((message) => message.client))],
    ["Acme"]
  );

  const senders = (await outbound.senders.list()).items as readonly {
    client?: string;
  }[];

  assert.equal(
    senders[0]?.client,
    UNASSIGNED,
    "a mailbox has no campaign, so a tag rule cannot place it"
  );
});

test("clients.stats adds up each client's campaigns", async () => {
  const outbound = createOutbound({
    adapter: emailTool(),
    plugins: [
      clients({
        rules: [
          { campaignTag: "acme", client: "Acme" },
          { campaignTag: "globex", client: "Globex" },
        ],
      }),
    ],
  });

  const stats = await outbound.clients.stats();
  assert.deepEqual(
    stats.map((entry) => [
      entry.client,
      entry.campaigns,
      entry.counts.sent,
      entry.counts.replied,
      entry.counts.opened,
    ]),
    [
      ["Acme", 1, 100, 4, null],
      ["Globex", 1, 50, 1, null],
      [UNASSIGNED, 1, 10, 0, null],
    ]
  );
});
