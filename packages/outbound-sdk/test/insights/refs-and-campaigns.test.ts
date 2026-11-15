// person_summary takes the lead refs the other insights return (OUT-66), and
// every insight with a campaign input refuses a campaign that does not exist
// instead of answering for an empty one (OUT-67).

import assert from "node:assert/strict";
import { test } from "node:test";

import { createOutbound, OutboundError } from "../../src/index.ts";
import type { OutboundPlugin } from "../../src/index.ts";
import { INSIGHTS, insights } from "../../src/insights/index.ts";
import { demoData, memory } from "../../src/memory/index.ts";
import { redact } from "../../src/redact/index.ts";
import { agency, EMAIL_TOOL, NOW, single } from "./helpers.ts";

test("person_summary takes a lead ref from hot_leads, at the cost of one lead read", async () => {
  const outbound = single(EMAIL_TOOL);
  const hot = await outbound.insights.hotLeads({}, { now: NOW });
  const [lead] = hot.data.leads;

  assert.equal(lead?.lead, "memory:agency:l1");

  const byRef = await outbound.insights.personSummary({
    person: lead?.lead ?? "",
  });

  const byEmail = await outbound.insights.personSummary({
    person: "person1@example.com",
  });

  assert.deepEqual(byRef.data, byEmail.data);
  assert.equal(byRef.data.found, true);
  // The memory adapter counts no requests; the lead read is one operation.
  assert.equal(byRef.meta.requests, byEmail.meta.requests);
});

test("person_summary reads the lead once for a ref, and counts it in meta.requests", async () => {
  const seen: string[] = [];

  const counter: OutboundPlugin = {
    name: "counter",
    wrap: (operation, next) => {
      seen.push(operation.kind);

      return next(operation);
    },
  };

  const outbound = createOutbound({
    adapter: memory({ data: EMAIL_TOOL, workspaceId: "agency" }),
    plugins: [counter, insights()],
  });

  await outbound.insights.personSummary({ person: "memory:agency:l4" });

  assert.equal(seen.filter((kind) => kind === "leads.get").length, 1);
});

/** The email tool behind a redact that masks these fields. */
const under = (fields: readonly ("email" | "linkedin")[]) =>
  createOutbound({
    adapter: memory({ data: EMAIL_TOOL, workspaceId: "agency" }),
    plugins: [redact({ fields }), insights()],
  });

test("person_summary looks a lead ref up by what redact leaves, refuses it when nothing is left, and needs leads.get for one", async () => {
  // l1 has a LinkedIn profile too, which is left unmasked.
  const byProfile = await under(["email"]).insights.personSummary({
    person: "memory:agency:l1",
  });

  assert.equal(byProfile.data.found, true);
  assert.ok(
    byProfile.data.identifiers.every((key) => key.startsWith("linkedin:"))
  );

  await assert.rejects(
    under(["email", "linkedin"]).insights.personSummary({
      person: "memory:agency:l1",
    }),
    (error) =>
      OutboundError.is(error) &&
      error.code === "Unsupported" &&
      /redact plugin masks/u.test(error.message)
  );

  await assert.rejects(
    single(EMAIL_TOOL, { "leads.get": false }).insights.personSummary({
      person: "memory:agency:l1",
    }),
    (error) =>
      OutboundError.is(error) &&
      error.code === "Unsupported" &&
      /leads\.get/u.test(error.message)
  );
});

const UNKNOWN = "cmp_nope";

test("every insight with a campaign input refuses an unknown campaign with NotFound, in at most one read", async () => {
  const withCampaign = INSIGHTS.filter(
    (definition) => "campaign" in definition.inputSchema.shape
  );

  // hot_leads and reply_timing among them, which used to answer all zeros.
  assert.ok(
    ["hot_leads", "reply_timing", "step_funnel"].every((name) =>
      withCampaign.some((definition) => definition.name === name)
    )
  );

  for (const definition of withCampaign) {
    const seen: string[] = [];

    const counter: OutboundPlugin = {
      name: "counter",
      wrap: (operation, next) => {
        seen.push(operation.kind);

        return next(operation);
      },
    };

    const outbound = createOutbound({
      adapter: memory({ data: demoData() }),
      plugins: [counter, insights()],
    });

    // oxlint-disable-next-line no-await-in-loop -- one insight at a time keeps the failing one in the message.
    await assert.rejects(
      definition.execute(outbound, { campaign: UNKNOWN }),
      (error) =>
        OutboundError.is(error) &&
        error.code === "NotFound" &&
        error.message.includes(UNKNOWN),
      definition.name
    );

    // A read scoped to the campaign, then at most one to tell it apart from an empty one.
    assert.ok(seen.length <= 2, `${definition.name}: ${seen.join(", ")}`);
  }
});

test("a known campaign with nothing in it is still answered, not refused", async () => {
  const outbound = single({ campaigns: [{ id: "c1", name: "Empty" }] });

  const hot = await outbound.insights.hotLeads({
    campaign: "memory:agency:c1",
  });

  const timing = await outbound.insights.replyTiming({
    campaign: "memory:agency:c1",
  });

  assert.equal(hot.data.totals.leadsRead, 0);
  assert.equal(timing.data.counts.messagesRead, 0);
});

// The campaign an answer names: `scope` for anomalies, `campaign` otherwise.
const answered = (data: unknown): unknown =>
  typeof data === "object" && data !== null && "scope" in data
    ? data.scope
    : (data as { campaign?: unknown }).campaign;

test("an insight answers with the campaign's ref when given its bare vendor id, at no extra request", async () => {
  const demo = createOutbound({
    adapter: memory({ data: demoData({ now: NOW }) }),
    plugins: [insights()],
  });

  const ref = "memory:default:cmp_founders";

  for (const name of [
    "anomalies",
    "copy_audit",
    "personalization_gaps",
    "reply_timing",
    "step_funnel",
    "variant_test",
  ]) {
    const definition = INSIGHTS.find((each) => each.name === name);
    assert.ok(definition, name);

    // oxlint-disable-next-line no-await-in-loop -- one insight at a time keeps the failing one in the message.
    const [bare, full] = await Promise.all([
      definition.execute(demo, { campaign: "cmp_founders" }, { now: NOW }),
      definition.execute(demo, { campaign: ref }, { now: NOW }),
    ]);

    assert.equal(answered(bare.data), ref, name);
    assert.deepEqual(bare.data, full.data, name);
    assert.equal(bare.meta.requests, full.meta.requests, name);
  }
});

test("a combined instance keeps the campaign ref it was given", async () => {
  const result = await agency().insights.stepFunnel(
    { campaign: "mailtool:agency:c1" },
    { now: NOW }
  );

  assert.equal(result.data.campaign, "mailtool:agency:c1");
});
