---
"outbound-sdk": minor
---

The redact plugin now remembers, in memory for its own lifetime, the address or profile behind each token it writes, at most the newest 10,000. A call that names one of its tokens reaches the vendor with the value in its place, and the answer comes back masked; a vendor error quotes the token, never the value. `outbound.redacted` gains `resolves(token)`, which says what a token stands for without giving the value, and `leadsByToken(tokens, campaign)`. With these, `hot_leads` under redact reads the lead behind each reply and ranks the same leads it does without redact (OUT-113, after OUT-122).
