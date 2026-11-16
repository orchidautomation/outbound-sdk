---
"outbound-sdk": minor
---

`dropped_replies` reads every reply in its `since` window by default (up to 2,000) instead of stopping at 50, so a dropped reply past the 50th is no longer missed (OUT-115). `max_replies` now defaults to `null` and stays an optional upper bound. On Instantly one listing of the emails sent by hand in the window settles every answered conversation, and only the ones that may be dropped are read in full, so a 14-day window is a few requests instead of one per conversation. With nothing dropped, the card now says how many conversations it could not check, instead of calling the answer clean.

New `messages.byHand` capability and `byHand: true` filter on `messages.list` and `messages.listAll`: only the messages a person sent by hand, not the ones a campaign sent. Instantly declares it (`email_type=manual`); the other adapters do not.

`outbound replies --since` reads the whole window, up to 2,000 replies, unless `--limit` is given; without `--since` the default stays 50 (OUT-117).
