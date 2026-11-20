// Input fields several insights take, written once so each means the same
// thing wherever it appears. The naming rule is in the insights docs, under
// "Names".

import { z } from "zod";

import type { CampaignStatus } from "../internal/entities.ts";
import { campaignStatusSchema } from "../internal/vocabulary.ts";

/** `from` and `to`: an inclusive range of UTC days, where `null` is no bound. */
export const rangeFields = {
  from: z.iso
    .date()
    .nullable()
    .default(null)
    .describe("First day counted, YYYY-MM-DD. null for the whole history."),
  to: z.iso
    .date()
    .nullable()
    .default(null)
    .describe("Last day counted, YYYY-MM-DD. null for up to today."),
};

/** `statuses`: only campaigns in one of these states are read. */
export const statusesInput = (
  fallback: readonly [CampaignStatus, ...CampaignStatus[]]
) =>
  z
    .array(campaignStatusSchema)
    .min(1)
    .default([...fallback])
    .describe("Only campaigns in these states are read");
