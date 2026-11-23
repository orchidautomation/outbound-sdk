---
"outbound-sdk": patch
---

A scoped insight keeps `evidence: "exact"` again when its tag or name was matched on our side (OUT-205). Where the vendor cannot filter its campaign listing, the listing is read whole and the scope's fixed rule picks the campaigns, so `clientReport({ days: 7, tag: "client-a" })` on `memory` with `demoData()` answers `exact`, as in 0.17.0, not `derived`. The note still says the listing was filtered here. A read that is derived for its own reason still makes the answer `derived`.
