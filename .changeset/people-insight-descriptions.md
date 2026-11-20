---
"outbound-sdk": patch
---

Shorter descriptions for the people insights (OUT-168). Each insight's description is now under 600 characters, and each input's description is one short sentence. The caveats that were cut now appear as notes on the answers they apply to:

- **`dropped_replies`** says how many replies it set aside as outside every campaign (`totals.notInCampaign`) and that `include_inbox: true` checks them.
- **`lead_collisions`** says how many people it counted in `totals.pastOverlaps` without listing them while `include_past` is false.
- **`suppression_check`** says how many block-list matches it counted in `totals.alreadyStopped` because the lead's status is outside `lead_statuses`.
