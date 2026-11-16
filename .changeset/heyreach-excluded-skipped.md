---
"outbound-sdk": minor
---

HeyReach lead status `Excluded` (a lead an exclusion filter or exclusion list kept out) now maps to `skipped` instead of `unknown` (OUT-106). `PendingOrExcludedToBeCalculated` and `Failed` stay `unknown`.

`CampaignProgress` gains an optional `skipped` count: HeyReach fills it from `progressStats.totalUsersExcluded`, the memory adapter counts its skipped leads, and Instantly and Smartlead return `null`. Progress built or stored without the key is still valid.

Smartlead is unchanged: a `BLOCKED` lead is still `bounced`, because its documentation gives no lead field that tells a block-listed lead that was never sent to apart from a bounce. The caveat says so.
