---
"outbound-sdk": minor
---

Insights finish on their default input on a mid-size workspace, and say when they checked nothing (OUT-112, OUT-118, OUT-127).

- **Senders priced as Instantly reads them.** On Instantly, listing one campaign's senders re-reads the campaign and pages through every mailbox of the workspace, 2 requests a page. `senderCapacity`, `senderLoad`, `bounceWatch`, `settingsAudit` and `campaignDiagnosis` now price that, so their default cap no longer stops them part way. On 303 mailboxes and 24 active campaigns, `senderCapacity` takes about 230 requests.
- **Default caps leave room.** The default request cap is the most an input can cost, a quarter more for retries and 20 on top (was 4). A stop at the default cap never advises lowering an input by one.
- **Defaults sized to a workspace.** `senderCapacity` and `senderLoad` read up to 50 campaigns and 1,000 senders (were 25 and 200), and `warmupReadiness` up to 1,000 senders (was 100). `campaignRanking`, `periodComparison`, `channelMix`, `tagRollup` and `clientReport` read up to 50 campaigns (was 25) and only active ones by default; pass `statuses: ["active", "paused", "completed"]` for the old reach. `clientReport` reads one stats request fewer per active campaign.
- **Nothing to check is not all clear.** When no campaign is in the states an insight reads, its answer has `meta.complete: false` and a note counting the campaigns in other states, such as `No campaign is active, so nothing was checked (18 campaigns: 8 completed, 10 draft). Pass statuses to check the others.` `suppressionCheck` is incomplete while any block entry could not be checked.
