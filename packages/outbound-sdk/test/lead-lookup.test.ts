import assert from "node:assert/strict";
import { test } from "node:test";

import { combine } from "../src/combine/index.ts";
import { identity } from "../src/identity/index.ts";
import { createOutbound, OutboundError, profileSlug } from "../src/index.ts";
import type { Operation, OutboundPlugin } from "../src/index.ts";
import { memory } from "../src/memory/index.ts";
import type { MemoryData } from "../src/memory/index.ts";

const PROFILE = "https://www.linkedin.com/in/example-person-1";

const EMAIL_TOOL: MemoryData = {
  campaigns: [{ id: "c1" }, { id: "c2" }],
  leads: [
    { campaignId: "c1", email: " Person1@Example.com ", id: "l1" },
    {
      campaignId: "c2",
      email: "person1@example.com",
      id: "l2",
      linkedinUrl: `${PROFILE}/`,
    },
    { campaignId: "c1", email: "person2@example.com", id: "l3" },
  ],
};

const LINKEDIN_TOOL: MemoryData = {
  campaigns: [{ channel: "linkedin", id: "k1" }],
  leads: [
    {
      campaignId: "k1",
      id: "p1",
      linkedinUrl: "http://linkedin.com/in/Example-Person-1?trk=x",
    },
    {
      campaignId: "k1",
      id: "p2",
      linkedinUrl: "https://www.linkedin.com/in/example-person-2",
    },
  ],
};

/** Records every operation the instance runs. */
const recorder = (seen: Operation[]): OutboundPlugin => ({
  name: "recorder",
  wrap: (operation, next) => {
    seen.push(operation);

    return next(operation);
  },
});

test("a profile slug ignores scheme, host prefix, case, trailing slash and query", () => {
  assert.equal(profileSlug(`${PROFILE}/`), "example-person-1");
  assert.equal(
    profileSlug("http://linkedin.com/in/Example-Person-1?trk=x"),
    "example-person-1"
  );
  assert.equal(profileSlug("https://example.com/in/x"), null);
  assert.equal(profileSlug(null), null);
});

test("leads are found by exact email or LinkedIn profile, one record per campaign", async () => {
  const outbound = createOutbound({
    adapter: memory({ data: EMAIL_TOOL, workspaceId: "agency" }),
  });

  assert.deepEqual(
    (await outbound.leads.list({ email: " PERSON1@example.com " })).items.map(
      (lead) => lead.sourceId
    ),
    ["l1", "l2"]
  );
  assert.deepEqual(
    (await outbound.leads.list({ linkedinUrl: PROFILE })).items.map(
      (lead) => lead.sourceId
    ),
    ["l2"]
  );
  assert.deepEqual(
    (
      await outbound.campaign("c1").leads.list({ email: "person1@example.com" })
    ).items.map((lead) => lead.sourceId),
    ["l1"]
  );
  assert.deepEqual(
    (await outbound.leads.list({ email: "nobody@example.com" })).items,
    []
  );
});

test("a lookup needs leads.lookup, and does not need the list of every lead", async () => {
  const off = createOutbound({
    adapter: memory({
      capabilities: { "leads.lookup": false },
      data: EMAIL_TOOL,
    }),
  });

  await assert.rejects(
    async () => await off.leads.list({ email: "person1@example.com" }),
    (error) => OutboundError.is(error) && error.code === "Unsupported"
  );

  const noList = createOutbound({
    adapter: memory({
      capabilities: { "leads.list": false },
      data: EMAIL_TOOL,
    }),
  });

  assert.equal(
    (await noList.leads.list({ email: "person1@example.com" })).items.length,
    2
  );
  await assert.rejects(
    async () => await noList.leads.list(),
    (error) => OutboundError.is(error) && error.code === "Unsupported"
  );
});

test("person() asks each tool for the person and follows an email to a LinkedIn record, without walking every lead", async () => {
  const seen: Operation[] = [];

  const outbound = createOutbound({
    adapter: combine([
      memory({ data: EMAIL_TOOL, name: "mailtool", workspaceId: "agency" }),
      memory({ data: LINKEDIN_TOOL, name: "lntool", workspaceId: "acme" }),
    ]),
    plugins: [identity(), recorder(seen)],
  });

  const person = await outbound.person("person1@example.com", {
    timeline: false,
  });

  assert.deepEqual(person.records.map((record) => record.ref).toSorted(), [
    "lntool:acme:p1",
    "mailtool:agency:l1",
    "mailtool:agency:l2",
  ]);
  assert.deepEqual(person.keys, [
    "email:person1@example.com",
    "linkedin:example-person-1",
  ]);

  const leadReads = seen.flatMap((operation) =>
    operation.kind === "leads.list" ? [operation.query] : []
  );

  assert.ok(leadReads.length > 0);
  assert.ok(
    leadReads.every(
      (query) => query.email !== undefined || query.linkedinUrl !== undefined
    ),
    "every lead read names the person"
  );
  assert.ok(
    !seen.some((operation) => operation.kind === "campaigns.list"),
    "no campaign walk"
  );
});

test("person() still scans when a tool cannot look a person up, or when campaigns are named", async () => {
  const seen: Operation[] = [];

  const scanning = createOutbound({
    adapter: memory({
      capabilities: { "leads.lookup": false },
      data: EMAIL_TOOL,
      workspaceId: "agency",
    }),
    plugins: [identity(), recorder(seen)],
  });

  const person = await scanning.person("person1@example.com", {
    timeline: false,
  });

  assert.equal(person.records.length, 2);
  assert.ok(
    seen.some(
      (operation) =>
        operation.kind === "leads.list" && operation.query.email === undefined
    )
  );

  const scoped = createOutbound({
    adapter: memory({ data: EMAIL_TOOL, workspaceId: "agency" }),
    plugins: [identity()],
  });

  assert.deepEqual(
    (
      await scoped.person("person1@example.com", {
        campaignIds: ["c2"],
        timeline: false,
      })
    ).records.map((record) => record.sourceId),
    ["l2"]
  );
});
