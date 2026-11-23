---
"outbound-sdk": minor
---

`anomalies` with `campaign: null` runs on an adapter without `stats.workspace` when it has daily stats per campaign (OUT-219). It lists every campaign, whatever its state, up to 500, reads each one's days and adds them up. `meta.evidence` is `derived`, a note says the days are campaigns added up, and `meta.requests` and the cost estimate count the listing and each campaign's read. A listing stopped at 500 makes the answer `complete: false`. With neither workspace nor campaign stats it is still `Unsupported` before any request. An insight's `needsFor` now also receives the instance's capabilities.

The `person_summary` docs say why it refuses under the `redact` plugin, and how that differs from the `person` tool's masked view (OUT-220).
