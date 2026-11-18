// A campaign's skipped leads on Instantly (OUT-175). The per-campaign report
// has no skipped count; the leads not contacted (POST /leads/list with filter
// FILTER_VAL_NOT_CONTACTED) are listed and those with status -3, documented
// as Skipped, are counted. Seen live (OUT-175): that listing held the skipped
// leads and the active leads not yet started.

import assert from "node:assert/strict";
import { test } from "node:test";

import { harness } from "../helpers/adapter-suite.ts";
import type { RecordedRequest } from "../helpers/http.ts";
import { CAMPAIGN, suite } from "./suite.ts";

const isLeads = (request: RecordedRequest): boolean =>
  new URL(request.url).pathname === "/api/v2/leads/list";

const bodyOf = (request: RecordedRequest): Record<string, unknown> =>
  JSON.parse(request.body ?? "{}") as Record<string, unknown>;

const lead = (index: number, status: number) => ({
  campaign: CAMPAIGN,
  email: `person${index}@example.com`,
  id: `lead-${index}`,
  status,
});

/** A full page of 100 leads, `skipped` of them with status -3. */
const fullPage = (from: number, skipped: number) =>
  Array.from({ length: 100 }, (_, offset) =>
    lead(from + offset, offset < skipped ? -3 : 1)
  );

test("instantly: progress counts the skipped leads across every page of leads not contacted", async () => {
  // Two full pages, then a short one: 40 + 25 + 2 skipped.
  const pages = [
    fullPage(0, 40),
    fullPage(100, 25),
    [lead(200, -3), lead(201, -3), lead(202, 1)],
  ];

  const { outbound, requests, settle } = harness(suite, (request) => {
    if (!isLeads(request)) {
      return;
    }

    const cursors = [undefined, "lead-99", "lead-199"];

    const items =
      pages[
        cursors.indexOf(bodyOf(request).starting_after as string | undefined)
      ] ?? [];

    return Response.json({
      items,
      next_starting_after: items.at(-1)?.id,
    });
  });

  const progress = await settle(outbound.campaign(CAMPAIGN).progress());

  assert.equal(progress.skipped, 67);
  assert.deepEqual(progress.meta.notes, []);

  const leadReads = requests.filter(isLeads).map(bodyOf);

  assert.deepEqual(
    leadReads,
    [
      {
        campaign: CAMPAIGN,
        filter: "FILTER_VAL_NOT_CONTACTED",
        limit: 100,
      },
      {
        campaign: CAMPAIGN,
        filter: "FILTER_VAL_NOT_CONTACTED",
        limit: 100,
        starting_after: "lead-99",
      },
      {
        campaign: CAMPAIGN,
        filter: "FILTER_VAL_NOT_CONTACTED",
        limit: 100,
        starting_after: "lead-199",
      },
    ],
    "a short page ends the listing, though it carries a cursor"
  );
});

test("instantly: a campaign with no lead left uncontacted has 0 skipped, which the vendor said", async () => {
  const { outbound, settle } = harness(suite, (request) =>
    isLeads(request) ? Response.json({ items: [] }) : undefined
  );

  const progress = await settle(outbound.campaign(CAMPAIGN).progress());

  assert.equal(progress.skipped, 0);
});

test("instantly: a listing longer than the cap leaves skipped null with a note, never a low count", async () => {
  let page = 0;

  const { outbound, requests, settle } = harness(suite, (request) => {
    if (!isLeads(request)) {
      return;
    }

    // Every page full, and one skipped lead on each.
    const items = fullPage(page * 100, 1);
    page += 1;

    return Response.json({ items, next_starting_after: items.at(-1)?.id });
  });

  const progress = await settle(outbound.campaign(CAMPAIGN).progress());

  assert.equal(progress.skipped, null, "50 is only a minimum");
  assert.equal(requests.filter(isLeads).length, 50, "50 pages at most");
  assert.equal(progress.meta.requests, 51, "the report and 50 pages");

  const [note] = progress.meta.notes;
  assert.match(note ?? "", /skipped is null/u);
  assert.match(note ?? "", /more than 5,000 leads/u);
  assert.match(note ?? "", /at least 50 leads/u);
});
