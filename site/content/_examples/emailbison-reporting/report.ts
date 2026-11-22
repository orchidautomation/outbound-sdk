import { createOutbound, OutboundError } from "outbound-sdk";
import type { StatsResult } from "outbound-sdk";
import { emailbison } from "outbound-sdk/emailbison";

import { fixtureFetch } from "../_shared/fixture-fetch.ts";
import { ROUTES } from "./routes.ts";

// The real EmailBison adapter. Its fetch answers from documented example
// payloads, so the numbers are made up; point it at your instance with
// EMAILBISON_BASE_URL and EMAILBISON_API_KEY for real ones.
const vendor = fixtureFetch("emailbison", ROUTES);

const outbound = createOutbound({
  adapter: emailbison({ apiKey: "not-used", workspaceId: "client-a" }),
  fetch: vendor.fetch,
});

const range = { from: "2025-11-01", to: "2025-11-30" };

type Row = StatsResult["rows"][number];

const show = (label: string, row: Row | undefined) =>
  console.log(
    label,
    `sent ${row?.sent}, contacted ${row?.contacted}, opened ${row?.opened},`,
    `replied ${row?.replied}, positive ${row?.positive},`,
    `bounced ${row?.bounced}, clicked ${row?.clicked}`
  );

// The whole workspace.
const workspace = await outbound.stats(range);

show("workspace:", workspace.rows[0]);

// One campaign: its totals, a row per day, a row per sequence step.
const campaign = outbound.campaign("1");
const totals = await campaign.stats(range);

show("campaign 1:", totals.rows[0]);

const days = await campaign.stats({ ...range, by: "day" });

for (const row of days.rows) {
  show(`  ${row.date}:`, row);
}

const steps = await campaign.stats({ ...range, scope: "step" });

for (const row of steps.rows) {
  show(`  step ${row.stepIndex} ${row.variantKey ?? ""}:`, row);
}

// A row for every campaign over a range is one read EmailBison does not
// have: the SDK refuses it before any request.
try {
  await outbound.stats({ ...range, scope: "campaign" });
} catch (error) {
  if (!OutboundError.is(error)) {
    throw error;
  }

  console.log(`every campaign: ${error.code}: ${error.message}`);
}

console.log(`${vendor.requests.length} requests:`);

for (const request of vendor.requests) {
  console.log(`  ${request}`);
}
