// Field coverage: what `outbound.fields` says for one adapter and for several
// read as one.

import assert from "node:assert/strict";
import { test } from "node:test";

import { combine } from "../src/combine/index.ts";
import { heyreach } from "../src/heyreach/index.ts";
import { createOutbound, resolveFields } from "../src/index.ts";
import { instantly } from "../src/instantly/index.ts";
import { memory } from "../src/memory/index.ts";

const offline: typeof fetch = () =>
  Promise.reject(new Error("no request is expected"));

test("fields: an adapter that declares nothing reports every field as exact", () => {
  const coverage = resolveFields();

  assert.equal(coverage.lead.email, "exact");
  assert.equal(coverage.metricRow.delivered, "exact");
  assert.equal(
    "ref" in coverage.lead,
    false,
    "identity fields are always filled and are not graded"
  );

  const outbound = createOutbound({ adapter: memory({}), fetch: offline });
  assert.deepEqual(outbound.fields, coverage);
});

test("fields: a declaration grades one field, or a whole record", () => {
  const coverage = resolveFields({
    lead: { phone: false, website: "derived" },
    tag: false,
  });

  assert.equal(coverage.lead.phone, false);
  assert.equal(coverage.lead.website, "derived");
  assert.equal(coverage.lead.email, "exact", "undeclared fields stay exact");
  assert.ok(Object.keys(coverage.tag).length > 0);
  assert.ok(
    Object.values(coverage.tag).every((grade) => grade === false),
    "a record the adapter never returns has no filled field"
  );
});

test("fields: an instance reports its adapter's coverage", () => {
  const email = createOutbound({
    adapter: instantly({ apiKey: "inst_test_key_0123456789abcdef" }),
    fetch: offline,
  });

  assert.equal(email.fields.lead.linkedinUrl, false);
  assert.equal(email.fields.lead.phone, "exact");
  assert.equal(email.fields.senderHealth.blacklisted, false);

  const linkedin = createOutbound({
    adapter: heyreach({ apiKey: "hr_test_key_0123456789abcdef" }),
    fetch: offline,
  });

  assert.equal(linkedin.fields.lead.linkedinUrl, "exact");
  assert.equal(linkedin.fields.lead.phone, false);
  assert.equal(linkedin.fields.reply.category, "derived");
});

test("fields: a combined instance fills a field when any member does", () => {
  const outbound = createOutbound({
    adapter: combine([
      instantly({ apiKey: "inst_test_key_0123456789abcdef" }),
      heyreach({ apiKey: "hr_test_key_0123456789abcdef" }),
    ]),
    fetch: offline,
  });

  assert.equal(
    outbound.fields.lead.linkedinUrl,
    "exact",
    "HeyReach reports it, Instantly does not"
  );
  assert.equal(outbound.fields.lead.phone, "exact", "the other way round");
  assert.equal(
    outbound.fields.senderHealth.blacklisted,
    false,
    "neither member fills it"
  );
  assert.equal(
    outbound.fields.metricRow.delivered,
    false,
    "neither member reports a delivered count"
  );
});
