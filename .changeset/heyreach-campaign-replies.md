---
"outbound-sdk": minor
---

HeyReach replies are campaign replies. HeyReach's inbox listing returns the sender's whole LinkedIn inbox, so personal messages, recruiters and inbound pitches used to count as replies, and 14 of 16 "dropped replies" in one live workspace were in no campaign.

- **Behavior change on HeyReach:** a message's `campaignRef` is now the campaign its conversation belongs to, and `null` only for a conversation in no campaign. `replies.list` and `outbound replies` return campaign replies only. Pass `includeInbox: true` (`--include-inbox`) to get the whole inbox as before. `messages.list` still returns every conversation.
- A new capability, `replies.inbox`, says a vendor's inbox also holds conversations outside every campaign. It is `true` on HeyReach and `false` elsewhere.
- `dropped_replies` and `reply_timing` set those conversations aside and count them in `totals.notInCampaign` and `counts.notInCampaign`. Both take `include_inbox` to keep them.

HeyReach edge cases:

- A day's `contacted` is `null` on HeyReach. HeyReach reports 0 on every day and counts unique leads contacted only over the whole range, so adding up the days undercounted. The range's total is unchanged.
- HeyReach stats take `from` alone and read up to the end of today (UTC), with a note. They used to refuse it.
- `anomalies` takes `min_count` (default 3). A day is judged only when its count or its baseline mean reaches it, so one LinkedIn reply on a quiet day is no longer flagged.
- `outbound tool <name>` for a tool this instance leaves out, such as `winning_steps` on HeyReach, now fails with `Unsupported` and names the missing capability. It used to say `Unknown tool`.
