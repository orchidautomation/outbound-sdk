// What the sender list alone shows is wrong with a sender. It costs no request
// beyond the list, so deliverability_check and campaign_diagnosis run it on
// every sender of a campaign, up to SCREENED_AT_MOST, before anything else.

import type { Sender } from "./entities.ts";

/** Every sender up to this many is screened from the sender list. Past it, the screen is partial. */
export const SCREENED_AT_MOST = 500;

const BROKEN_STATUSES = new Set<Sender["status"]>(["disconnected", "error"]);

/** The vendor reports the sender disconnected or failing. */
export const brokenStatus = (sender: Sender): boolean =>
  BROKEN_STATUSES.has(sender.status);

/** The vendor reports a warmup score of exactly 0. An unreported score is not 0. */
export const warmupAtZero = (sender: Sender): boolean =>
  sender.warmup?.score === 0;

/** The problems the sender list shows, in plain words. Empty when it shows none. */
export const listProblemsOf = (sender: Sender): string[] => [
  ...(brokenStatus(sender) ? [`status is ${sender.status}`] : []),
  ...(warmupAtZero(sender) ? ["warmup score is 0"] : []),
];
