---
"outbound-sdk": minor
---

`lead_collisions` and `suppression_check` now run while the redact plugin masks email addresses with its default `mask` strategy, and `outbound mcp` offers them with redaction on. They match people on the keyed tokens redact writes. Those tokens are the same for one person across every record and block list entry in a run and can't be reversed without the plugin's key. LinkedIn profiles now match too, because a masked profile's token is written from its slug. `suppression_check` still can't match domain entries while addresses are masked, and says so in a note.
