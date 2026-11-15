import assert from "node:assert/strict";
import { test } from "node:test";

import { combine } from "../../src/combine/index.ts";
import { createOutbound, OutboundError } from "../../src/index.ts";
import { insights } from "../../src/insights/index.ts";
import { memory } from "../../src/memory/index.ts";
import type { MemoryData } from "../../src/memory/index.ts";
import { NOW, single } from "./helpers.ts";

const MAIL: MemoryData = {
  campaigns: [{ id: "c1" }, { id: "c2" }],
  leads: [
    {
      campaignId: "c1",
      company: "Acme",
      email: "Ann@Acme.example",
      engagement: {
        clicks: 2,
        lastContactedAt: "2026-11-01T09:00:00.000Z",
        lastRepliedAt: "2026-11-03T10:00:00.000Z",
        opens: 7,
        replies: 1,
      },
      firstName: "Ann",
      id: "l1",
      interest: "Interested",
      lastName: "Example",
      status: "replied",
      title: "CEO",
    },
    {
      campaignId: "c2",
      email: "ann@acme.example",
      engagement: {
        clicks: 1,
        lastRepliedAt: "2026-11-09T10:00:00.000Z",
        opens: 4,
        replies: 3,
      },
      id: "l2",
      interest: "Not Interested",
    },
    {
      campaignId: "c1",
      email: "bob@acme.example",
      engagement: { opens: 5 },
      firstName: "Bob",
      id: "l3",
      interest: "Out of Office",
    },
    // Replied by status only: no time, no counts.
    { campaignId: "c1", email: "cy@acme.example", id: "l4", status: "replied" },
    { campaignId: "c2", email: "dee@acme.example", id: "l5" },
    // A subdomain and a look-alike are other companies.
    { campaignId: "c1", email: "eve@mail.acme.example", id: "l6" },
    { campaignId: "c1", email: "fay@notacme.example", id: "l7" },
    {
      campaignId: "c1",
      id: "l8",
      linkedinUrl: "https://www.linkedin.com/in/example-person-8",
    },
  ],
};

const LINKEDIN: MemoryData = {
  campaigns: [{ channel: "linkedin", id: "k1" }],
  leads: [
    {
      campaignId: "k1",
      email: "ann@acme.example",
      engagement: { replies: 2 },
      id: "p1",
      title: "Chief Executive",
    },
  ],
};

test("account_summary lists everyone at the domain with their campaigns, counts and the latest reply", async () => {
  const result = await single(MAIL).insights.accountSummary(
    { domain: "bob@ACME.example" },
    { now: NOW }
  );

  const { data } = result;
  assert.equal(result.insight, "account_summary");
  assert.equal(data.domain, "acme.example");
  // Latest reply first, then the reply with no time, then by email.
  assert.deepEqual(
    data.people.map((person) => [
      person.email,
      person.name,
      person.title,
      person.company,
      person.replied,
      person.interested,
      person.opens,
      person.clicks,
      person.replies,
      person.lastRepliedAt,
    ]),
    [
      [
        "ann@acme.example",
        "Ann Example",
        "CEO",
        "Acme",
        true,
        true,
        // 7 + 4 opens, 2 + 1 clicks, 1 + 3 replies over her two records.
        11,
        3,
        4,
        "2026-11-09T10:00:00.000Z",
      ],
      ["cy@acme.example", null, null, null, true, null, null, null, null, null],
      // A label that is not a positive one is a known "no".
      [
        "bob@acme.example",
        "Bob",
        null,
        null,
        false,
        false,
        5,
        null,
        null,
        null,
      ],
      [
        "dee@acme.example",
        null,
        null,
        null,
        false,
        null,
        null,
        null,
        null,
        null,
      ],
    ]
  );

  const [ann] = data.people;
  assert.deepEqual(ann?.campaigns, ["memory:agency:c1", "memory:agency:c2"]);
  assert.deepEqual(ann?.records[1], {
    autoReplied: false,
    campaign: "memory:agency:c2",
    clicks: 1,
    interest: "Not Interested",
    lastContactedAt: null,
    lastRepliedAt: "2026-11-09T10:00:00.000Z",
    lead: "memory:agency:l2",
    opens: 4,
    provider: "memory",
    replies: 3,
    status: "active",
  });
  assert.equal(ann?.records[0]?.lastContactedAt, "2026-11-01T09:00:00.000Z");
  assert.deepEqual(data.totals, {
    campaigns: 2,
    interested: 1,
    leadsRead: 8,
    leadsWithoutEmail: 1,
    moreLeadsExist: false,
    people: 4,
    // Ann has two records, the other three one each.
    records: 5,
    replied: 2,
  });
  assert.deepEqual(data.lastReply, {
    at: "2026-11-09T10:00:00.000Z",
    campaign: "memory:agency:c2",
    email: "ann@acme.example",
    lead: "memory:agency:l2",
    name: "Ann Example",
  });
  assert.equal(result.meta.complete, true);
  assert.deepEqual(result.meta.notes, []);
});

test("account_summary takes a bare domain or a URL, and positive_labels decides who is interested", async () => {
  const outbound = single(MAIL);

  const fromUrl = await outbound.insights.accountSummary({
    domain: "https://www.acme.example/about?x=1",
    positive_labels: ["out of office"],
  });

  assert.equal(fromUrl.data.domain, "acme.example");
  assert.deepEqual(
    fromUrl.data.people.map((person) => [person.email, person.interested]),
    [
      ["ann@acme.example", false],
      ["cy@acme.example", null],
      ["bob@acme.example", true],
      ["dee@acme.example", null],
    ]
  );
  assert.equal(fromUrl.data.totals.interested, 1);

  const sub = await outbound.insights.accountSummary({
    domain: "mail.acme.example",
  });

  assert.deepEqual(
    sub.data.people.map((person) => person.email),
    ["eve@mail.acme.example"]
  );
});

test("account_summary answers with nobody when the domain matches no lead or there are no leads", async () => {
  const nobody = await single(MAIL).insights.accountSummary({
    domain: "other.example",
  });

  assert.deepEqual(nobody.data.people, []);
  assert.equal(nobody.data.lastReply, null);
  assert.equal(nobody.data.totals.people, 0);
  assert.equal(nobody.data.totals.leadsRead, 8);

  const empty = await single({}).insights.accountSummary({
    domain: "acme.example",
  });

  assert.deepEqual(empty.data.totals, {
    campaigns: 0,
    interested: 0,
    leadsRead: 0,
    leadsWithoutEmail: 0,
    moreLeadsExist: false,
    people: 0,
    records: 0,
    replied: 0,
  });
  assert.equal(empty.meta.complete, true);
});

test("account_summary refuses text that is no domain, and an email provider unless allowed", async () => {
  const outbound = single({
    campaigns: [{ id: "c1" }],
    leads: [{ campaignId: "c1", email: "person1@gmail.com", id: "l1" }],
  });

  await assert.rejects(
    async () => await outbound.insights.accountSummary({ domain: "acme" }),
    (error) =>
      OutboundError.is(error) &&
      error.code === "Invalid" &&
      /not a domain or an email address/u.test(error.message)
  );
  await assert.rejects(
    async () =>
      await outbound.insights.accountSummary({ domain: "x@gmail.com" }),
    (error) =>
      OutboundError.is(error) &&
      error.code === "Invalid" &&
      /gmail\.com is an email provider/u.test(error.message)
  );

  const allowed = await outbound.insights.accountSummary({
    allow_free_domains: true,
    domain: "gmail.com",
  });

  assert.equal(allowed.data.totals.people, 1);
});

test("account_summary says the answer is partial when max_leads stops the read", async () => {
  const capped = await single(MAIL).insights.accountSummary({
    domain: "acme.example",
    max_leads: 2,
  });

  // Only Ann's two records were read.
  assert.equal(capped.data.totals.leadsRead, 2);
  assert.equal(capped.data.totals.people, 1);
  assert.equal(capped.meta.complete, false);
  assert.deepEqual(capped.meta.notes, [
    "Stopped at 2 leads (max_leads); more exist.",
  ]);

  const exact = await single(MAIL).insights.accountSummary({
    domain: "acme.example",
    max_leads: 8,
  });

  assert.equal(
    exact.meta.complete,
    true,
    "a cap equal to the data hides nothing"
  );
});

test("account_summary reads campaign by campaign when the tool cannot list every lead", async () => {
  const outbound = single(MAIL, { "leads.list": false });

  const result = await outbound.insights.accountSummary({
    domain: "acme.example",
  });

  assert.equal(result.data.totals.people, 4);
  assert.equal(result.data.totals.leadsRead, 8);
  assert.equal(result.meta.complete, true);

  const fewCampaigns = await outbound.insights.accountSummary({
    domain: "acme.example",
    max_campaigns: 1,
  });

  // c1 alone holds Ann's first record, Bob and Cy.
  assert.equal(fewCampaigns.data.totals.people, 3);
  assert.equal(fewCampaigns.meta.complete, false);
  assert.deepEqual(fewCampaigns.meta.notes, [
    "Stopped at 1 campaigns (max_campaigns); more exist.",
  ]);

  const fewLeads = await outbound.insights.accountSummary({
    domain: "acme.example",
    // c1 holds 6 leads, so the cap is reached before c2 is opened.
    max_leads: 6,
  });

  assert.equal(fewLeads.data.totals.leadsRead, 6);
  assert.equal(fewLeads.meta.complete, false);
  assert.deepEqual(fewLeads.meta.notes, [
    "Stopped at 6 leads (max_leads); more campaigns remain.",
  ]);
});

test("account_summary is refused when leads can be listed neither way, and notes missing engagement counts", async () => {
  await assert.rejects(
    async () =>
      await single(MAIL, {
        "leads.byCampaign": false,
        "leads.list": false,
      }).insights.accountSummary({ domain: "acme.example" }),
    (error) =>
      OutboundError.is(error) &&
      error.code === "Unsupported" &&
      /neither leads\.list nor leads\.byCampaign/u.test(error.message)
  );

  const noCounts = await single(
    {
      campaigns: [{ id: "c1" }],
      leads: [{ campaignId: "c1", email: "ann@acme.example", id: "l1" }],
    },
    { "leads.engagement": false }
  ).insights.accountSummary({ domain: "acme.example" });

  assert.equal(noCounts.data.people[0]?.replies, null);
  assert.equal(noCounts.data.people[0]?.opens, null);
  assert.deepEqual(noCounts.meta.notes, [
    "This tool reports no per-lead open, click or reply counts, so those are null.",
  ]);
});

test("account_summary joins one person's records across two tools", async () => {
  const outbound = createOutbound({
    adapter: combine([
      memory({ data: MAIL, name: "mailtool", workspaceId: "agency" }),
      memory({ data: LINKEDIN, name: "lntool", workspaceId: "agency" }),
    ]),
    plugins: [insights()],
  });

  const result = await outbound.insights.accountSummary({
    domain: "acme.example",
  });

  const [ann] = result.data.people;
  assert.deepEqual(ann?.campaigns, [
    "mailtool:agency:c1",
    "mailtool:agency:c2",
    "lntool:agency:k1",
  ]);
  // 1 + 3 in the email tool, 2 in the LinkedIn tool.
  assert.equal(ann?.replies, 6);
  assert.equal(ann?.title, "CEO", "the first known title is kept");
  assert.equal(result.data.totals.records, 6);
  assert.equal(result.data.totals.campaigns, 3);
  assert.equal(result.meta.provider, "combined");
  assert.deepEqual(result.meta.notes, []);
});

// The email tool beside a LinkedIn tool that declares no per-lead counts.
const two = (linkedin: MemoryData) =>
  createOutbound({
    adapter: combine([
      memory({ data: MAIL, name: "mailtool", workspaceId: "agency" }),
      // One tool without the counts turns `leads.engagement` off for the whole instance.
      memory({
        capabilities: { "leads.engagement": false },
        data: linkedin,
        name: "lntool",
        workspaceId: "agency",
      }),
    ]),
    plugins: [insights()],
  });

test("account_summary on two tools names the tool whose records lack the counts, and keeps the other tool's", async () => {
  const bare: MemoryData = {
    campaigns: [{ channel: "linkedin", id: "k1" }],
    leads: [{ campaignId: "k1", email: "ann@acme.example", id: "p1" }],
  };

  const mixed = two(bare);

  assert.equal(mixed.capabilities["leads.engagement"], false);

  const result = await mixed.insights.accountSummary({
    domain: "acme.example",
  });

  const [ann] = result.data.people;
  const counts = ann?.records.map((each) => [each.provider, each.replies]);

  // The email tool's records still carry their counts; only lntool's are null.
  assert.deepEqual(counts, [
    ["mailtool", 1],
    ["mailtool", 3],
    ["lntool", null],
  ]);
  assert.equal(ann?.replies, 4);
  assert.deepEqual(result.meta.notes, [
    "lntool reports no per-lead open, click or reply counts, so those are null for its records. Records from the other tools carry what their vendor reports.",
  ]);

  // Every tool's records carry counts: nothing is null because of a tool, so nothing is said.
  const full = await two(LINKEDIN).insights.accountSummary({
    domain: "acme.example",
  });

  assert.deepEqual(full.meta.notes, []);
});
