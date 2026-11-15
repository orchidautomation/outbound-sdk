---
"outbound-sdk": minor
---

- `suppressionCheck`, `accountSummary` and `droppedReplies` say in `data.totals` when a cap left records unread (`moreBlockEntriesExist`, `moreLeadsExist`, `moreRepliesExist`), and their cards say so. `suppressionCheck.totals.blockEntriesNotChecked` is `null` while entries are left unread.
- Under `redact()`, `accountSummary`, `suppressionCheck` and `leadCollisions` refuse with `Unsupported` naming the plugin, and `insightTools` leaves them out; `person_summary` is left out while both email and LinkedIn are masked. A tool's `next` hint no longer names a tool that is not offered. `strategy: "hash"` keeps exact matching in `suppressionCheck` and `leadCollisions`.
- `hotLeads` gives no reply or recency points to a lead labelled negative (`totals.negative`), and its reason names the label. `personSummary` and `accountSummary` mark records labelled out-of-office or bounced `autoReplied` and do not count their replies.
- `personSummary` accepts a lead ref. A missing required input reads "`<name>` is required".
- `hotLeads` and `replyTiming` throw `NotFound` for an unknown campaign.
- `droppedReplies` notes a reply that carries no lead ref.
