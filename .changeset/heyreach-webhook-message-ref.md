---
"outbound-sdk": patch
---

HeyReach webhook events name their message, and the webhooks docs show how to authenticate a vendor that does not sign.

- A HeyReach message event's `messageRef` is now the ref that sync and `messages.list` give the same message, so `reconcile.events` pairs them instead of counting them `uncheckable`. HeyReach messages have no id, so both sides hash the conversation, the send time, the side and the text, from `conversation_id` and `recent_messages`. An event without those fields keeps `messageRef: null`.
- The verification page shows a generated secret in the URL path compared with `timingSafeEqual`, for vendors that do not sign, and how that differs from Smartlead's `whsec_` signature.
