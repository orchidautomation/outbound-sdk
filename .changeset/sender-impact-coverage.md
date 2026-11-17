---
"outbound-sdk": minor
---

Sender checks now say what a failing sender breaks and how much they covered (OUT-142).

- `sender_health` checks every sender in the list (up to 500, was 100 to 200), so a disconnected mailbox past the first page is counted. Each disconnected or failing sender carries `impact`: the active campaigns it sends for, its sends over the last 14 days, the day it last sent, and its last successful sign-in. A value the vendor does not report is `null`, with the reason in `impact.unknown`.
- `deliverability_check` reports `coverage`: senders checked, senders not checked, and why (`cap`, `unsupported`, `error`), and each row says whether it was checked. A new `max_checked` input sets how many senders are checked in full; `limit` now sets how many are listed. Failing senders carry the same `impact`.
- New `outbound.senderHealth` collection and `senders.healthList` capability: every sender's health a page at a time. Instantly supports it, at three requests per 100 mailboxes instead of three per mailbox, so `deliverability_check` and `domain_health` check every Instantly mailbox by default.
