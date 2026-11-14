import assert from "node:assert/strict";

import { createOutbound } from "outbound-sdk";
import { memory } from "outbound-sdk/memory";

import { seed } from "./seed.ts";
import { campaignSummary } from "./summary.ts";

const outbound = createOutbound({ adapter: memory({ data: seed }) });
const [founders, agencies, ...rest] = await campaignSummary(outbound);

// The paused campaign is left out.
assert.equal(rest.length, 0);

console.log("ok - only active campaigns are summarised");

// 6 replies of 200 sends, 2 of them positive.
assert.deepEqual(founders, {
  name: "SaaS founders",
  positiveReplies: 2,
  replyRate: 0.03,
  sent: 200,
});

console.log("ok - counts are added up over the days seeded");

// A campaign with no results has no row at all: the summary must not turn
// that into a zero.
assert.deepEqual(agencies, {
  name: "Agency owners",
  positiveReplies: 0,
  replyRate: null,
  sent: null,
});

console.log("ok - no results is null, not 0");

// Every record carries where it came from.
const leads = await outbound.leads.list();
const [lead] = leads.items;

assert.equal(lead?.ref, "memory:default:lead_1");

assert.equal(lead?.campaignRef, "memory:default:cmp_founders");

console.log("ok - refs are provider:workspace:id");
