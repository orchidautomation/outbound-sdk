---
"outbound-sdk": patch
---

`deliverability_check` no longer gives a false all-clear for a campaign with more senders than `limit` (OUT-93). It now screens every sender, up to 500, from the sender list for a disconnected or failing status and a warmup score of 0, checks the first `limit` in full with those problems first, and counts `with_problems` across every screened sender. Its data adds `checked`, `screened`, `total` (`null` past 500) and `all_checked`, and `next` says when not every sender was checked in full. Its card says so too.
