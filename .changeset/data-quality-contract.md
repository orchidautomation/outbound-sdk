---
"outbound-sdk": minor
---

Numbers tell apart zero, missing, unchecked and stale, and every rate carries its denominator (OUT-141). The contract is written down once, in "What every number carries" on the insights page.

- `channelMix` and `tagRollup` divide every campaign's replies by one basis, named in the new `replyRateBasis`. A campaign with replies but no lead contacted in the range (on Instantly, a range with only follow-ups) used to be divided by its sends while the others were divided by leads, so one `of` added leads and sends together. Now every campaign is divided by messages sent when that happens, and by leads contacted otherwise.
- `periodComparison` and `clientReport` add `rates` to each comparison: each period's rates as `{ count, of, rate, low, high }`. A total's plain `replyRate` and `bounceRate` count only the campaigns that report both sides, so the counts beside them were not what they were divided by.
- `droppedReplies` sets `meta.complete: false`, with a note, whenever a conversation could not be checked, so `dropped: 0` with conversations unchecked no longer reads as a clean answer.
- `deliverability_check` rows add `warmup_spam` and `warmup_inbox`, the counts the warmup spam rate divides.
- `campaign_overview` passes on the stats read's notes and `complete`, returns the `period` it read, and says when a campaign's `metrics` is `null` because the vendor reported no stats for it.
- Every tool result carries `meta.computedAt`, the time its numbers are as of, as an insight's answer already did.
