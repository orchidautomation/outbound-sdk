// What a campaign scope means for an insight run: the refusal of a campaign
// outside it, and what finding its campaigns costs.

import { OutboundError } from "../internal/errors.ts";
import type { ScopeReads } from "../internal/scope/campaigns.ts";
import { describeScope } from "../internal/scope/rule.ts";
import type { CampaignScope } from "../internal/scope/rule.ts";
import type { Price } from "./cost.ts";

/** The refusal for a campaign the scope does not cover. */
export const outsideScope = (
  reads: ScopeReads,
  scope: CampaignScope,
  id: string,
  provider: string
): OutboundError =>
  new OutboundError(
    "Invalid",
    `${reads.insight}: campaign ${id} is outside the campaign scope (${describeScope(scope)})`,
    { provider }
  );

/** The most campaigns a scope's listing is priced for. */
const LISTED_AMONG = 1000;

/** What finding a scope's campaigns costs: one read per id, or the listing. */
export const scopeCost = (
  scope: CampaignScope | null,
  price: Price
): number => {
  if (scope === null) {
    return 0;
  }

  return scope.ids === undefined
    ? price.list("campaigns.list", LISTED_AMONG)
    : scope.ids.length * price.one("campaigns.get");
};
