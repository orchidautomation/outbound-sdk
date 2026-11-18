import assert from "node:assert/strict";
import { test } from "node:test";

import { harness } from "../helpers/adapter-suite.ts";
import { fixture } from "../helpers/fixtures.ts";
import type { RecordedRequest } from "../helpers/http.ts";
import { LEAD, LIST, suite, THREAD } from "./suite.ts";

const pathOf = (request: RecordedRequest): string =>
  `${request.method} ${new URL(request.url).pathname}`;

const items = (file: string): Record<string, unknown>[] =>
  (fixture("instantly", file) as { items: Record<string, unknown>[] }).items;

test("instantly: a lead carries its engagement counts and times", async () => {
  const { outbound, requests, settle } = harness(suite);
  const lead = await settle(outbound.leads.get(LEAD));

  assert.deepEqual(lead.engagement, {
    clicks: 2,
    lastContactedAt: "2026-11-10T09:00:00.000Z",
    lastOpenedAt: "2026-11-11T10:30:00.000Z",
    lastRepliedAt: "2026-11-12T11:45:00.000Z",
    opens: 4,
    replies: 1,
    repliedStepIndex: 3,
    stepIndex: 4,
  });
  assert.equal(lead.interest, "Meeting Booked", "lt_interest_status 2");
  assert.deepEqual(lead.tags, [], "Instantly does not tag leads");
  assert.deepEqual(
    requests.map(pathOf),
    [`GET /api/v2/leads/${LEAD}`],
    "a built-in interest status needs no label lookup"
  );
});

test("instantly: every built-in interest status has its documented name", async () => {
  const names = [
    [0, "Out of Office"],
    [1, "Interested"],
    [2, "Meeting Booked"],
    [3, "Meeting Completed"],
    [4, "Won"],
    [-1, "Not Interested"],
    [-2, "Wrong Person"],
    [-3, "Lost"],
    [-4, "No Show"],
  ] as const;

  for (const [status, name] of names) {
    const { outbound, settle } = harness(suite, () =>
      Response.json({ id: LEAD, lt_interest_status: status })
    );

    const lead = await settle(outbound.leads.get(LEAD));
    assert.equal(lead.interest, name, `status ${status}`);
  }
});

test("instantly: a custom interest status is named from the workspace's lead labels", async () => {
  const { outbound, requests, settle } = harness(suite);
  const page = await settle(outbound.leads.list());

  assert.deepEqual(
    page.items.map((lead) => lead.interest),
    ["Meeting Booked", "Hot Lead"],
    "status 7 is the custom label Hot Lead"
  );
  assert.deepEqual(requests.map(pathOf), [
    "POST /api/v2/leads/list",
    "GET /api/v2/lead-labels",
  ]);
  assert.equal(
    new URL(requests[1]?.url ?? "").searchParams.get("limit"),
    "100"
  );
  assert.deepEqual(page.items[1]?.engagement, {
    clicks: 7,
    lastContactedAt: "2026-11-10T09:00:00.000Z",
    lastOpenedAt: "2026-11-11T10:30:00.000Z",
    lastRepliedAt: "2026-11-12T11:45:00.000Z",
    opens: 5,
    replies: 2,
    repliedStepIndex: 1,
    stepIndex: null,
  });
});

test("instantly: a custom status with no matching label stays null, and one lead looks it up too", async () => {
  const { outbound, requests, settle } = harness(suite, (request) =>
    new URL(request.url).pathname === `/api/v2/leads/${LEAD}`
      ? Response.json({ id: LEAD, lt_interest_status: 99 })
      : undefined
  );

  const lead = await settle(outbound.leads.get(LEAD));
  assert.equal(lead.interest, null);
  assert.deepEqual(requests.map(pathOf), [
    `GET /api/v2/leads/${LEAD}`,
    "GET /api/v2/lead-labels",
  ]);
  assert.equal(lead.engagement, null, "no counts in the payload, no zeros");
});

test("instantly: a lead with no interest status has no interest", async () => {
  const { outbound, settle } = harness(suite);
  const leads = await settle(outbound.leads.listAll().toArray());
  assert.equal(leads[2]?.interest, null);
  assert.equal(leads[2]?.engagement?.opens, 6);
});

test("instantly: a list's leads are asked for by list_id", async () => {
  const { outbound, requests, settle } = harness(suite);
  const page = await settle(outbound.list(LIST).leads.list({ limit: 5 }));
  assert.equal(requests[0]?.method, "POST");
  assert.deepEqual(JSON.parse(requests[0]?.body ?? "{}"), {
    limit: 5,
    list_id: LIST,
  });
  assert.equal(page.items.length, 2);
});

test("instantly: a thread's messages are found with the documented thread search", async () => {
  const { outbound, requests, settle } = harness(suite);
  const messages = await settle(outbound.thread(THREAD).messages());
  assert.ok(messages.items.length > 0);
  const url = new URL(requests[0]?.url ?? "");
  assert.equal(url.pathname, "/api/v2/emails");
  assert.equal(url.searchParams.get("search"), `thread:${THREAD}`);
  assert.equal(messages.items[0]?.threadId, THREAD);
});

test("instantly: a body the list cut short is read whole from the email itself", async () => {
  const { outbound, requests, settle } = harness(suite);
  const page = await settle(outbound.messages.list({ include: ["body"] }));

  assert.deepEqual(requests.map(pathOf), [
    "GET /api/v2/emails",
    "GET /api/v2/emails/01a1d77f-5e65-78a7-8eb0-021174eeab65",
    // The page's lookup of its leads' ids (OUT-149).
    "POST /api/v2/leads/list",
  ]);
  assert.equal(
    page.items[0]?.bodyHtml,
    "This is a test email.<br/><br/>The whole of it.",
    "body_fallback_reason too_large: the excerpt is replaced"
  );
  assert.equal(
    page.items[0]?.bodyText,
    "This is a test email.\n\nThe whole of it."
  );
  assert.equal(
    page.items[1]?.bodyHtml,
    "This is a test email.<br/><br/>Second line.",
    "a whole body is not read again"
  );

  const [snapshot] = await outbound.limits();
  assert.equal(
    snapshot?.windows.find((window) => window.lane === "emails")?.used,
    2,
    "the single read counts against the 20-per-minute lane"
  );
});

test("instantly: without bodies, a cut-short body costs no extra request", async () => {
  const { outbound, requests, settle } = harness(suite);
  const page = await settle(outbound.messages.list());
  // Only the page and its lookup of the leads' ids (OUT-149).
  assert.deepEqual(requests.map(pathOf), [
    "GET /api/v2/emails",
    "POST /api/v2/leads/list",
  ]);
  assert.equal(page.items[0]?.bodyText, null);
});

test("instantly: a cut-short email without an id is not read on its own", async () => {
  const { outbound, requests, settle } = harness(suite, () =>
    Response.json({
      items: [
        { body: { text: "excerpt" }, body_fallback_reason: "unavailable" },
      ],
    })
  );

  await assert.rejects(
    async () =>
      await settle(outbound.messages.list({ include: ["body"], retries: 0 }))
  );
  assert.equal(requests.length, 1, "no single read without an id");
});

test("instantly: a reply with a custom status takes its category from the label", async () => {
  const { outbound, requests, settle } = harness(suite);
  const page = await settle(outbound.replies.list());

  assert.deepEqual(
    page.items.map((reply) => [reply.category, reply.categorySource]),
    [
      ["ooo", "vendor"],
      ["neutral", "vendor"],
    ],
    "i_status 8 is the custom label Wrong Timing, which is neutral"
  );
  assert.deepEqual(requests.map(pathOf), [
    "GET /api/v2/emails",
    // The page's lookup of its leads' ids (OUT-149).
    "POST /api/v2/leads/list",
    "GET /api/v2/lead-labels",
  ]);
});

test("instantly: custom labels can be positive or negative", async () => {
  const cases = [
    [7, "positive"],
    [-7, "negative"],
  ] as const;

  for (const [status, category] of cases) {
    const { outbound, settle } = harness(suite, (request) =>
      new URL(request.url).pathname === "/api/v2/emails"
        ? Response.json({
            items: items("listReplies.page2.json").map((item) => ({
              ...item,
              i_status: status,
            })),
          })
        : undefined
    );

    const page = await settle(outbound.replies.list({ category }));
    assert.equal(page.items[0]?.category, category, `i_status ${status}`);
  }
});

test("instantly: a lead label without a status number is ignored", async () => {
  const { outbound, settle } = harness(suite, (request) =>
    new URL(request.url).pathname === "/api/v2/lead-labels"
      ? Response.json({ items: [{ label: "Broken" }] })
      : undefined
  );

  const page = await settle(outbound.leads.list());
  assert.equal(page.items[1]?.interest, null);
});
