// campaigns.list({ name, tag }): the vendor filters where it can, and the
// wrapper keeps only the matching campaigns either way (OUT-199).

import assert from "node:assert/strict";
import { test } from "node:test";

import { combine } from "../src/combine/index.ts";
import { createOutbound, OutboundError } from "../src/index.ts";
import { demoData, memory } from "../src/memory/index.ts";
import { suite as emailbisonSuite } from "./emailbison/suite.ts";
import { harness } from "./helpers/adapter-suite.ts";
import type { RecordedRequest } from "./helpers/http.ts";
import { suite as heyreachSuite } from "./heyreach/suite.ts";
import { suite as instantlySuite } from "./instantly/suite.ts";
import { suite as smartleadSuite } from "./smartlead/suite.ts";

const pathOf = (request: RecordedRequest | undefined): string =>
  new URL(request?.url ?? "http://x").pathname;

const paramOf = (request: RecordedRequest | undefined, name: string) =>
  new URL(request?.url ?? "http://x").searchParams.getAll(name);

test("instantly: a name goes to the vendor as search, and the wrapper keeps the names that hold it", async () => {
  const { outbound, requests, settle } = harness(instantlySuite);
  const page = await settle(outbound.campaigns.list({ name: "second" }));

  assert.deepEqual(
    page.items.map((campaign) => campaign.name),
    ["Second Campaign"],
    "the fixture answers both campaigns; My First Campaign does not hold 'second'"
  );
  assert.deepEqual(paramOf(requests[0], "search"), ["second"]);
});

test("instantly: a tag is looked up by name, then sent as tag_ids", async () => {
  const { outbound, requests, settle } = harness(instantlySuite);
  const page = await settle(outbound.campaigns.list({ tag: "important" }));

  assert.deepEqual(
    page.items.map((campaign) => campaign.name),
    ["My First Campaign"],
    "matched ignoring case; the second campaign carries no tag"
  );
  assert.equal(pathOf(requests[0]), "/api/v2/custom-tags");
  assert.deepEqual(paramOf(requests[0], "search"), ["important"]);
  assert.deepEqual(paramOf(requests[1], "tag_ids"), [
    "01a1d77f-5e57-7861-bab6-41dac7e7804a",
  ]);
});

test("instantly: a tag no tag is named lists no campaign at all", async () => {
  const { outbound, requests, settle } = harness(instantlySuite);
  const page = await settle(outbound.campaigns.list({ tag: "Nobody" }));

  assert.deepEqual(page.items, []);
  assert.deepEqual(requests.map(pathOf), ["/api/v2/custom-tags"]);
});

test("heyreach: a name goes to the vendor as keyword", async () => {
  const { outbound, requests, settle } = harness(heyreachSuite);
  const page = await settle(outbound.campaigns.list({ name: "campaign 2" }));

  assert.deepEqual(
    page.items.map((campaign) => campaign.name),
    ["Example Campaign 2"]
  );
  assert.equal(JSON.parse(requests[0]?.body ?? "{}").keyword, "campaign 2");
});

test("heyreach: a tag is refused before any request, since its campaigns carry none", async () => {
  const { outbound, requests } = harness(heyreachSuite);

  await assert.rejects(
    () => outbound.campaigns.list({ tag: "client-a" }),
    (error) =>
      OutboundError.is(error) &&
      error.code === "Unsupported" &&
      /campaigns\.byTag/u.test(error.message)
  );
  assert.equal(requests.length, 0);
});

test("smartlead: name and tag are matched after its one listing, and the answer says so", async () => {
  const { outbound, requests, settle } = harness(smartleadSuite);

  const page = await settle(
    outbound.campaigns.list({ name: "follow-up", tag: "q1" })
  );

  assert.deepEqual(
    page.items.map((campaign) => campaign.name),
    ["Example Co Follow-up"],
    "both carry Q1; only one holds follow-up"
  );
  assert.equal(page.meta.evidence, "derived");
  assert.equal(requests.length, 1);
});

test("emailbison: a tag is looked up in /api/tags and sent as tag_ids[]; a name is matched by the wrapper", async () => {
  const { outbound, requests, settle } = harness(emailbisonSuite, (request) =>
    pathOf(request) === "/api/tags"
      ? Response.json({ data: [{ id: 15, name: "VIP" }] })
      : undefined
  );

  const page = await settle(
    outbound.campaigns.list({ name: "campaign b", tag: "vip" })
  );

  assert.deepEqual(
    page.items.map((campaign) => campaign.name),
    ["Example Campaign B"]
  );
  assert.deepEqual(paramOf(requests[1], "tag_ids[]"), ["15"]);
  assert.deepEqual(paramOf(requests[1], "search"), [], "no search is sent");
});

test("memory: listAll walks every page and keeps the matches", async () => {
  const outbound = createOutbound({
    adapter: memory({ data: demoData(), pageSize: 1, workspaceId: "acme" }),
  });

  const tagged = await outbound.campaigns
    .listAll({ tag: "CLIENT-A" })
    .toArray();

  const every = await outbound.campaigns.listAll().toArray();

  assert.ok(tagged.length > 0);
  assert.ok(tagged.length < every.length, "client-b's campaigns are left out");
  assert.ok(tagged.every((campaign) => campaign.tags.includes("client-a")));
});

test("an empty name or tag is refused, so it cannot read as no filter", async () => {
  const outbound = createOutbound({
    adapter: memory({ data: demoData(), workspaceId: "acme" }),
  });

  for (const filters of [{ name: " " }, { tag: "" }]) {
    // oxlint-disable-next-line no-await-in-loop -- one refusal after another
    await assert.rejects(
      () => outbound.campaigns.list(filters),
      (error) => OutboundError.is(error) && error.code === "Invalid"
    );
  }
});

test("combined: a tag is refused when one member's campaigns carry no tags", async () => {
  const outbound = createOutbound({
    adapter: combine([instantlySuite.make(), heyreachSuite.make()]),
  });

  await assert.rejects(
    () => outbound.campaigns.list({ tag: "Important" }),
    (error) => OutboundError.is(error) && error.code === "Unsupported"
  );
});
