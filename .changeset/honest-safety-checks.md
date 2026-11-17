---
"outbound-sdk": minor
---

`suppressionCheck` and `leadCollisions` read every campaign in the statuses by default (`max_campaigns` 200, `max_leads_per_campaign` 1,000, `max_block_entries` 10,000) and lead with coverage: a new `finding` sentence says what was checked, and when a cap left campaigns, leads or block entries unread, `totals.violations` and `totals.collisions` are `null` instead of a bare 0, with `violationsFound`, `collisionsFound`, `moreCampaignsExist` and `campaignsWithMoreLeads` beside them. `copyAudit` no longer marks itself incomplete for a `max_leads` cap that still gave it its samples. (OUT-148)

Insights keep their partial answer by default when a request cap or a `budget()` stops them part way: `partialOnCap` is now opt-out (`false`), so `--max-requests` returns what was read with `complete: false` and a note instead of throwing it away. The run budget's message says it is a cap you set, not the vendor's rate limit. Reads that failed now count toward `meta.requests`. (OUT-156, OUT-151)
