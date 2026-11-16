---
"outbound-sdk": minor
---

`hot_leads` starts from the signal instead of walking the lead list (OUT-113). It reads every reply within `recency_days` (new `max_replies` input, default 1,000, a safety ceiling) and, where the adapter can filter by interest, the leads it labels positive, then looks up the leads behind those replies, many addresses per request where the adapter can. On a workspace with about 150 replies in 14 days that is 11 requests and a complete answer, where the old default stopped at 500 leads with four notes. The lead list is walked only where the adapter cannot filter by interest, or with the new `include_engagement_only: true` for open- and click-only leads. A reply in the window fills a lead's reply count and last reply time when its record reports less, so HeyReach and Smartlead leads get recency. A positive label now fades after `recency_days`, to nothing at the new `max_age_days` (default 90), and a lead whose last reply is older ranks after every fresher one. New totals: `repliesRead`, `unreadable` (replied leads that could not be read, instead of a note) and `stale`.

Two new capabilities back it: `leads.byInterest` (the `interest: "positive"` lead filter) and `leads.lookupMany` (the `emails` lead filter). Instantly declares both.
