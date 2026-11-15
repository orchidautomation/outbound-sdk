// Under the redact plugin an insight that matches records by email address
// or domain refuses, and is not offered as a tool, instead of returning a
// clean answer marked complete (OUT-51). A hashing redact keeps exact
// matching working.

import assert from "node:assert/strict";
import { test } from "node:test";

import { createOutbound, OutboundError } from "../../src/index.ts";
import type { OutboundPlugin } from "../../src/index.ts";
import { insights, insightTools } from "../../src/insights/index.ts";
import { demoData, memory } from "../../src/memory/index.ts";
import type { MemoryData } from "../../src/memory/index.ts";
import { redact } from "../../src/redact/index.ts";
import type { RedactOptions } from "../../src/redact/index.ts";

const demo = demoData();

// The demo block list holds competitor.example. One lead there, and one
// person in two campaigns.
const SEED: MemoryData = {
  ...demo,
  campaigns: [
    ...(demo.campaigns ?? []),
    { id: "cmp_second", name: "Second", status: "active" },
  ],
  leads: [
    ...(demo.leads ?? []),
    {
      campaignId: "cmp_founders",
      email: "boss@competitor.example",
      firstName: "Bo",
      id: "lead_x",
      status: "active",
    },
    {
      campaignId: "cmp_second",
      email: "person1@example.com",
      firstName: "Alex",
      id: "lead_y",
      status: "active",
    },
  ],
};

/** Counts what reaches the adapter, inside redact. */
const counter = () => {
  const seen: string[] = [];

  const plugin: OutboundPlugin = {
    name: "counter",
    wrap: (operation, next) => {
      seen.push(operation.kind);

      return next(operation);
    },
  };

  return { plugin, seen };
};

const build = (options?: RedactOptions) => {
  const reads = counter();

  const adapter = memory({ data: SEED });

  const outbound =
    options === undefined
      ? createOutbound({ adapter, plugins: [reads.plugin, insights()] })
      : createOutbound({
          adapter,
          plugins: [redact(options), reads.plugin, insights()],
        });

  return { outbound, seen: reads.seen };
};

const refusedByRedact = (error: unknown): boolean =>
  OutboundError.is(error) &&
  error.code === "Unsupported" &&
  /redact plugin masks email addresses/u.test(error.message);

test("without redact the email-matching insights find the people and the violation", async () => {
  const { outbound } = build();

  const account = await outbound.insights.accountSummary({
    domain: "example.com",
  });

  const suppression = await outbound.insights.suppressionCheck({});
  const collisions = await outbound.insights.leadCollisions({});

  assert.equal(account.data.totals.people, 3);
  assert.equal(suppression.data.totals.violations, 1);
  assert.equal(collisions.data.totals.collisions, 1);
});

test("with redact masking emails they refuse before any read, naming the redact plugin", async () => {
  const { outbound, seen } = build({});

  await assert.rejects(
    outbound.insights.accountSummary({ domain: "example.com" }),
    refusedByRedact
  );
  await assert.rejects(outbound.insights.suppressionCheck({}), refusedByRedact);
  await assert.rejects(outbound.insights.leadCollisions({}), refusedByRedact);
  await assert.rejects(
    outbound.insights.personSummary({ person: "person1@example.com" }),
    (error) =>
      OutboundError.is(error) &&
      error.code === "Unsupported" &&
      /person_summary is not available while the redact plugin masks email addresses and LinkedIn profiles/u.test(
        error.message
      )
  );
  assert.deepEqual(seen, []);
});

test("insightTools leaves out what redact keeps from working, and no hint names a left-out tool", async () => {
  const names = (options?: RedactOptions) =>
    insightTools(build(options).outbound).map((tool) => tool.name);

  const people = [
    "person_summary",
    "account_summary",
    "lead_collisions",
    "suppression_check",
  ];

  assert.deepEqual(
    names().filter((name) => people.includes(name)),
    people
  );
  assert.deepEqual(
    names({}).filter((name) => people.includes(name)),
    []
  );
  // With only emails masked a person is still looked up by LinkedIn profile.
  assert.deepEqual(
    names({ fields: ["email"] }).filter((name) => people.includes(name)),
    ["person_summary"]
  );
  // A hash still matches an exact address; a domain is gone.
  assert.deepEqual(
    names({ strategy: "hash" }).filter((name) => people.includes(name)),
    ["person_summary", "lead_collisions", "suppression_check"]
  );

  const tools = insightTools(build({}).outbound);
  const offered = new Set(tools.map((tool) => tool.name));
  const hidden = people.filter((name) => !offered.has(name));

  for (const name of ["hot_leads", "dropped_replies"]) {
    const tool = tools.find((each) => each.name === name);
    assert.ok(tool !== undefined, name);

    // oxlint-disable-next-line no-await-in-loop -- one tool at a time keeps the failing one in the message.
    const result = await tool.call({});

    assert.equal(result.ok, true, name);
    assert.ok(result.next.length > 0, name);
    assert.ok(
      hidden.every((each) => !result.next.includes(each)),
      `${name}: ${result.next}`
    );
  }
});

test("a hashing redact keeps exact matching working, and says what it cannot match", async () => {
  const { outbound } = build({ strategy: "hash" });

  // The block list holds a domain, which a hashed address no longer shows.
  const suppression = await outbound.insights.suppressionCheck({});

  assert.equal(suppression.data.totals.violations, 0);
  assert.equal(suppression.meta.complete, false);
  assert.match(
    suppression.meta.notes.join(" "),
    /domain entries .*could not be matched/u
  );

  // The same person under one address in two campaigns is still found.
  const collisions = await outbound.insights.leadCollisions({});

  assert.equal(collisions.data.totals.collisions, 1);
  assert.match(
    collisions.meta.notes.join(" "),
    /matched by email address only/u
  );

  await assert.rejects(
    outbound.insights.accountSummary({ domain: "example.com" }),
    refusedByRedact
  );
});

test("a hashing redact still finds an address on the block list", async () => {
  const outbound = createOutbound({
    adapter: memory({
      data: {
        blocklist: [{ id: "b1", value: "person1@example.com" }],
        campaigns: [{ id: "c1", name: "Q4" }],
        leads: [{ campaignId: "c1", email: "person1@example.com", id: "l1" }],
      },
    }),
    plugins: [redact({ fields: ["email"], strategy: "hash" }), insights()],
  });

  const result = await outbound.insights.suppressionCheck({});

  assert.equal(result.data.totals.violations, 1);
  assert.equal(result.data.violations[0]?.matchedBy, "email");
});

test("person_summary takes a lead ref while the identifier it is looked up by is left unmasked", async () => {
  // lead_1 has an email address and no LinkedIn profile: with only LinkedIn
  // masked it is looked up by its address, in both campaigns.
  const byRef = await build({
    fields: ["linkedin"],
  }).outbound.insights.personSummary({ person: "memory:default:lead_1" });

  assert.equal(byRef.data.found, true);
  assert.deepEqual(byRef.data.identifiers, ["email:person1@example.com"]);
  assert.equal(byRef.data.totals.campaigns, 2);

  // With its address masked nothing is left to look it up by.
  await assert.rejects(
    build({ fields: ["email"] }).outbound.insights.personSummary({
      person: "memory:default:lead_1",
    }),
    (error) =>
      OutboundError.is(error) &&
      error.code === "Unsupported" &&
      /redact plugin masks email addresses/u.test(error.message) &&
      /no LinkedIn profile/u.test(error.message)
  );
});

test("a hashing redact keeps person_summary working by hashing the address given, and account_summary says a hash keeps no domain", async () => {
  const { outbound } = build({ strategy: "hash" });

  assert.ok(
    insightTools(outbound).some((tool) => tool.name === "person_summary")
  );

  const person = await outbound.insights.personSummary({
    person: "person1@example.com",
  });

  assert.equal(person.data.found, true);
  assert.equal(person.data.totals.campaigns, 2);
  // The address is shown as redact shows it on the records.
  const lead = await outbound.leads.get("lead_1");

  assert.match(lead.email ?? "", /^redacted:[0-9a-f]{16}$/u);
  assert.deepEqual(person.data.identifiers, [`email:${lead.email}`]);

  const nobody = await outbound.insights.personSummary({
    person: "nobody@example.com",
  });

  assert.equal(nobody.data.found, false);

  // A lead ref's identifiers are hashed on the record, so there is nothing to look up.
  await assert.rejects(
    outbound.insights.personSummary({ person: "memory:default:lead_1" }),
    (error) =>
      OutboundError.is(error) &&
      error.code === "Unsupported" &&
      /email address or LinkedIn profile URL instead/u.test(error.message)
  );

  await assert.rejects(
    outbound.insights.accountSummary({ domain: "example.com" }),
    (error) =>
      OutboundError.is(error) &&
      error.code === "Unsupported" &&
      /a hashed address keeps no domain/u.test(error.message)
  );
});
