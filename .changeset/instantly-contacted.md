---
"outbound-sdk": patch
---

**Correctness fix that changes reported numbers:** Instantly's `contacted` is now the unique leads whose sequence started, Instantly's "Sequence started" (OUT-86). Campaign, workspace and every-campaign totals read `new_leads_contacted_count` instead of `contacted_count`, which counts lead-step contacts: 1,404 against 430 on one live four-step campaign, and 5.7 times too many on a larger one. Daily rows, and a mailbox total summed from them, read `new_leads_contacted` instead of `contacted`, which is everyone emailed that day. `contacted` falls, so `replyRate`, `positiveReplyRate` and `unsubscribeRate`, and every insight built on them, rise to their real values. A step row still reads `contacted` where Instantly sends it: the leads that step reached.
