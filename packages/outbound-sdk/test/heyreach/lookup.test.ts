import assert from "node:assert/strict";
import { test } from "node:test";

import { OutboundError } from "../../src/index.ts";
import { harness } from "../helpers/adapter-suite.ts";
import { fixture } from "../helpers/fixtures.ts";
import { LEAD, suite } from "./suite.ts";

const EMAIL = "person1@example.com";
const REF = `heyreach:client-a:${LEAD}`;

interface Sent {
  readonly body: string | undefined;
  readonly url: string;
}

/** Each request as its path under `/api/public` and its JSON body. */
const sent = (requests: readonly Sent[]): [string, unknown][] =>
  requests.map((request) => [
    new URL(request.url).pathname.replace("/api/public", ""),
    JSON.parse(request.body ?? "{}"),
  ]);

const isCode =
  (code: string) =>
  (error: unknown): boolean =>
    OutboundError.is(error) && error.code === code;

const NOT_FOUND = (): Response =>
  Response.json(
    { errorMessage: "There is no lead matching your search criteria" },
    { status: 404 }
  );

const profile = (changes: Record<string, unknown>): Response =>
  Response.json({
    // SAFETY: the fixture is a JSON object.
    ...(fixture("heyreach", "getLead.json") as Record<string, unknown>),
    ...changes,
  });

test("heyreach: a profile lookup reads the campaigns and the profile, and returns one record per campaign", async () => {
  const { adapter, outbound, requests, settle } = harness(suite);
  const page = await settle(outbound.leads.list({ linkedinUrl: LEAD }));

  assert.deepEqual(sent(requests), [
    [
      "/campaign/GetCampaignsForLead",
      { limit: 100, offset: 0, profileUrl: LEAD },
    ],
    ["/lead/GetLead", { profileUrl: LEAD }],
  ]);
  // By email a lookup can cost up to six more (the lists, a name search and
  // the profiles read to find the address): eight at most.
  assert.deepEqual(adapter.costs?.["leads.lookup"], {
    pageSize: 100,
    perPage: 2,
    perWalk: 6,
  });
  assert.equal(adapter.capabilities?.["leads.lookup"], true);

  assert.deepEqual(
    page.items.map((lead) => [lead.campaignRef, lead.status, lead.sourceId]),
    [
      ["heyreach:client-a:274079", "completed", LEAD],
      ["heyreach:client-a:274080", "active", LEAD],
    ]
  );

  for (const lead of page.items) {
    assert.equal(lead.ref, `heyreach:client-a:${lead.sourceId}`);
    assert.equal(lead.linkedinUrl, LEAD);
    assert.equal(lead.firstName, "Alex");
    assert.equal(lead.lastName, "Example");
    assert.equal(lead.company, "Example Co");
    assert.equal(lead.title, "Director");
    assert.equal(lead.email, EMAIL, "the profile's enriched address");
    assert.equal(
      lead.createdAt,
      null,
      "creationTime is the campaign's, not the lead's"
    );
    assert.deepEqual(lead.tags, []);
    assert.deepEqual(Object.keys(lead.raw as object), ["campaign", "lead"]);
  }
});

test("heyreach: a lookup walks the campaign pages, reading the profile once a page", async () => {
  const { outbound, requests, settle } = harness(suite);

  const all = await settle(
    outbound.leads.listAll({ linkedinUrl: LEAD }).toArray()
  );

  assert.deepEqual(
    all.map((lead) => [lead.campaignRef, lead.status]),
    [
      ["heyreach:client-a:274079", "completed"],
      ["heyreach:client-a:274080", "active"],
      ["heyreach:client-a:274081", "skipped"],
    ],
    "Excluded is a lead an exclusion rule kept out: skipped"
  );
  assert.equal(
    new Set(all.map((lead) => lead.ref)).size,
    1,
    "every record is the same lead; the campaign tells them apart"
  );
  assert.deepEqual(sent(requests).slice(2), [
    [
      "/campaign/GetCampaignsForLead",
      { limit: 100, offset: 2, profileUrl: LEAD },
    ],
    ["/lead/GetLead", { profileUrl: LEAD }],
  ]);
});

test("heyreach: a profile URL in another form is sent in one form and still matches the stored one", async () => {
  const stored = "http://linkedin.com/in/Example-Person-1/?trk=stored";

  const { outbound, requests, settle } = harness(suite, (request) =>
    request.url.endsWith("/lead/GetLead")
      ? profile({ profileUrl: stored })
      : undefined
  );

  const page = await settle(
    outbound.leads.list({
      linkedinUrl: " HTTPS://LinkedIn.com/in/Example-Person-1/?utm_source=x ",
    })
  );

  assert.deepEqual(
    sent(requests).map(
      ([, body]) => (body as { profileUrl: string }).profileUrl
    ),
    [LEAD, LEAD],
    "HeyReach matches a slug by exact case, so it is sent lowercased"
  );
  assert.equal(page.items.length, 2);
  assert.equal(page.items[0]?.linkedinUrl, stored);
  assert.equal(page.items[0]?.sourceId, stored);
});

test("heyreach: a profile HeyReach answers with that is not the one asked for is dropped", async () => {
  const { outbound, settle } = harness(suite, (request) =>
    request.url.endsWith("/lead/GetLead")
      ? profile({ profileUrl: "https://www.linkedin.com/in/example-person-2" })
      : undefined
  );

  const page = await settle(outbound.leads.list({ linkedinUrl: LEAD }));
  assert.deepEqual(page.items, []);
});

test("heyreach: an email lookup finds the profile through a saved list and returns one record per campaign", async () => {
  const { outbound, requests, settle } = harness(suite);

  const all = await settle(
    outbound.leads.listAll({ email: " Person1@Example.com " }).toArray()
  );

  assert.deepEqual(sent(requests), [
    ["/campaign/GetCampaignsForLead", { email: EMAIL, limit: 100, offset: 0 }],
    ["/list/GetListsForLead", { email: EMAIL, limit: 1, offset: 0 }],
    [
      "/list/GetLeadsFromList",
      { keyword: "Alex Example", limit: 5, listId: 3457, offset: 0 },
    ],
    [
      "/lead/GetLead",
      { profileUrl: "https://www.linkedin.com/in/example-person-11" },
    ],
    // The second page already knows the profile.
    ["/campaign/GetCampaignsForLead", { email: EMAIL, limit: 100, offset: 2 }],
    ["/lead/GetLead", { profileUrl: LEAD }],
  ]);
  assert.deepEqual(
    all.map((lead) => [lead.campaignRef, lead.email, lead.linkedinUrl]),
    [
      ["heyreach:client-a:274079", EMAIL, LEAD],
      ["heyreach:client-a:274080", EMAIL, LEAD],
      ["heyreach:client-a:274081", EMAIL, LEAD],
    ]
  );
});

test("heyreach: an email lookup reads the profiles of the same name until one carries the address", async () => {
  const second = "https://www.linkedin.com/in/example-person-12";

  const { outbound, requests, settle } = harness(suite, (request) => {
    if (!request.url.endsWith("/lead/GetLead")) {
      return;
    }

    return request.body?.includes("example-person-12")
      ? profile({
          customEmailAddress: "Person9@Example.com",
          emailAddress: "other@example.com",
          emailEnrichments: [],
          enrichedEmailAddress: null,
          profileUrl: second,
        })
      : profile({ emailEnrichments: [], enrichedEmailAddress: null });
  });

  const page = await settle(
    outbound.leads.list({ email: "person9@example.com" })
  );

  assert.deepEqual(
    sent(requests)
      .slice(3)
      .map(([, body]) => body),
    [
      { profileUrl: "https://www.linkedin.com/in/example-person-11" },
      { profileUrl: second },
    ]
  );
  assert.equal(page.items.length, 2);
  assert.equal(page.items[0]?.linkedinUrl, second);
  assert.equal(
    page.items[0]?.email,
    "person9@example.com",
    "the address asked for, which the profile holds as its custom address"
  );
});

test("heyreach: an email no profile carries, or that is in no saved list, gives an empty page", async () => {
  const unmatched = harness(suite, (request) =>
    request.url.endsWith("/lead/GetLead")
      ? profile({ emailEnrichments: [], enrichedEmailAddress: null })
      : undefined
  );

  const none = await unmatched.settle(
    unmatched.outbound.leads.list({ email: EMAIL })
  );

  assert.deepEqual(none.items, []);
  assert.equal(unmatched.requests.length, 5, "both rows are read");

  const unlisted = harness(suite, (request) =>
    request.url.endsWith("/list/GetListsForLead") ? NOT_FOUND() : undefined
  );

  const page = await unlisted.settle(
    unlisted.outbound.leads.list({ email: EMAIL })
  );

  assert.deepEqual(page.items, []);
  assert.equal(unlisted.requests.length, 2);
});

test("heyreach: a lookup can be narrowed to one campaign", async () => {
  const { outbound, requests, settle } = harness(suite);

  const first = await settle(
    outbound.campaign("274080").leads.list({ linkedinUrl: LEAD })
  );

  assert.deepEqual(
    first.items.map((lead) => lead.campaignRef),
    ["heyreach:client-a:274080"]
  );
  assert.equal(requests.length, 2, "no campaign's leads are walked");

  const later = await settle(
    outbound.leads.listAll({ campaignId: "274081", email: EMAIL }).toArray()
  );

  assert.deepEqual(
    later.map((lead) => lead.sourceId),
    [LEAD],
    "found on the second page of campaigns"
  );

  const absent = await settle(
    outbound.leads.listAll({ campaignId: "999", linkedinUrl: LEAD }).toArray()
  );

  assert.deepEqual(absent, []);
});

test("heyreach: a person HeyReach does not know gives an empty page, not an error", async () => {
  const { outbound, requests, settle } = harness(suite, NOT_FOUND);
  const byProfile = await settle(outbound.leads.list({ linkedinUrl: LEAD }));
  assert.deepEqual(byProfile.items, []);
  assert.equal(byProfile.cursor, undefined);
  assert.equal(requests.length, 2);

  const byEmail = await settle(outbound.leads.list({ email: EMAIL }));
  assert.deepEqual(byEmail.items, []);
  assert.equal(requests.length, 3, "an unknown address costs one request");

  const notProfile = await settle(
    outbound.leads.list({ linkedinUrl: "https://example.com/in-no-profile" })
  );

  assert.deepEqual(notProfile.items, []);
  assert.equal(requests.length, 3, "nothing is sent for a URL with no profile");
});

test("heyreach: any other failure of a lookup is still an error", async () => {
  const { outbound, settle } = harness(suite, (request) =>
    request.url.endsWith("/lead/GetLead")
      ? Response.json({ errorMessage: "Bad request" }, { status: 400 })
      : undefined
  );

  await assert.rejects(
    async () => await settle(outbound.leads.list({ linkedinUrl: LEAD })),
    isCode("Invalid")
  );
});

test("heyreach: a known person in no campaign is returned once, with no campaign", async () => {
  for (const answer of [
    NOT_FOUND,
    () =>
      Response.json({ items: [], leadFullName: "Alex Example", totalCount: 0 }),
  ]) {
    const { outbound, settle } = harness(suite, (request) =>
      request.url.endsWith("/campaign/GetCampaignsForLead")
        ? answer()
        : undefined
    );

    // oxlint-disable-next-line no-await-in-loop -- two small cases, one after the other.
    const page = await settle(outbound.leads.list({ linkedinUrl: LEAD }));

    assert.equal(page.items.length, 1);
    assert.equal(page.items[0]?.campaignRef, null);
    assert.equal(page.items[0]?.ref, REF);
    assert.equal(page.items[0]?.status, "unknown");
    assert.equal(page.items[0]?.email, EMAIL);

    // oxlint-disable-next-line no-await-in-loop -- as above.
    const inCampaign = await settle(
      outbound.campaign("274079").leads.list({ linkedinUrl: LEAD })
    );

    assert.deepEqual(inCampaign.items, []);
  }
});

test("heyreach: a lookup inside a saved list or a date range is refused before any request", async () => {
  const { outbound, requests, settle } = harness(suite);

  await assert.rejects(
    async () =>
      await settle(outbound.list("3457").leads.list({ linkedinUrl: LEAD })),
    (error) =>
      isCode("Unsupported")(error) &&
      /inside one saved list/u.test((error as Error).message)
  );
  await assert.rejects(
    async () =>
      await settle(
        outbound.leads.list({ email: EMAIL, since: "2026-01-01T00:00:00Z" })
      ),
    (error) =>
      isCode("Unsupported")(error) &&
      /bounded by date/u.test((error as Error).message)
  );
  assert.equal(requests.length, 0);
});
