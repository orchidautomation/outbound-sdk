// The EmailBison reads this guide makes, answered from fixtures/emailbison/.
import { file } from "../_shared/fixture-fetch.ts";
import type { Route } from "../_shared/fixture-fetch.ts";

export const ROUTES: readonly Route[] = [
  {
    fixture: file("getWorkspaceStats.json"),
    method: "GET",
    path: /^\/api\/workspaces\/v1\.1\/stats$/u,
  },
  {
    fixture: file("getWorkspaceDailyStats.json"),
    method: "GET",
    path: /^\/api\/workspaces\/v1\.1\/line-area-chart-stats$/u,
  },
  {
    fixture: file("getCampaign.json"),
    method: "GET",
    path: /^\/api\/campaigns\/1$/u,
  },
  {
    fixture: file("getCampaignStats.json"),
    method: "POST",
    path: /^\/api\/campaigns\/1\/stats$/u,
  },
  {
    fixture: file("getCampaignDailyStats.json"),
    method: "GET",
    path: /^\/api\/campaigns\/1\/line-area-chart-stats$/u,
  },
  {
    fixture: file("getSequenceSteps.json"),
    method: "GET",
    path: /^\/api\/campaigns\/v1\.1\/1\/sequence-steps$/u,
  },
  {
    fixture: file("getCampaignEventStats.json"),
    method: "GET",
    path: /^\/api\/campaign-events\/stats$/u,
  },
];
