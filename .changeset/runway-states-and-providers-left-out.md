---
"outbound-sdk": minor
---

One runway calculation for `clientReport`, `pipelineForecast`, `campaignDiagnosis` and the `lead_runway` tool (OUT-147). Each campaign's runway now has a state: `draining`, `stalled` (leads left to start but none started in the window, or no daily count of leads started), `out_of_leads` or `unknown`. `daysLeft` and `runway_days` are `null` when the pace is `null` or 0, instead of 0 for a campaign with nothing left to start. `clientReport.runningOutOfLeads` entries carry `state` and `inSequence`, and their `remaining` now counts only leads not yet started. Stalled campaigns are listed apart in `stalled`, and the action items put every campaign that needs leads in one `add_leads` item and every stalled one in one `check_stalled` item, after the other items. `lead_runway` reads only the active leads where the tool lists them alone, up to 5,000 by default, as `clientReport` does, and adds `state`. `pipelineForecast` adds `runwayState`.

On a combined instance, `periodComparison`, `clientReport` and `campaignRanking` name each tool with no campaign in `statuses` in `toolsLeftOut`, with its own workspace totals for the period, and a note says when such a tool had sends or replies (OUT-155). `clientReport` takes `provider` (one tool of a combined instance) and `tag` (one client's campaigns). The `campaign_overview` tool notes when its status filter left the list empty.

`periodComparison` adds `totalBasis` and `workspaceBasis`, and `clientReport` adds `totalsBasis`: what each total covers (the campaigns read, or every campaign in the workspace), and that `replied` and `positive` count leads with automatic replies left out. A note says why the campaigns' total and the workspace totals give different reply counts (OUT-158).
