---
"outbound-sdk": patch
---

HeyReach replies are back. HeyReach's conversation listing does not name a conversation's campaign, although its reference says it does, so every reply was left out as "not in a campaign" and unfiltered `replies` returned none. A listing without a campaign now reads each campaign's conversations in turn, so a message's `campaignRef` is the campaign HeyReach filed it under, and with `includeInbox` (and in `messages.list`) the conversations in no campaign follow with a `null` `campaignRef`. This costs one request per campaign, and one more per page of the inbox's own conversations. `replies`, `dropped_replies`, `reply_timing` and `hot_leads` see HeyReach's campaign replies again, on their own and with `--provider all`.

A combined instance (`--provider all`) no longer re-reads one tool's page forever when that page is not in time order. `replies --by person --provider all` with no `--since` used to run without end.
