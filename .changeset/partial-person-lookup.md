---
"outbound-sdk": patch
---

A person lookup on a combined instance (a lead listing filtered by `email` or `linkedinUrl`) now returns what the tools that answered hold when another tool fails. The page is marked `complete: false`, and the new `failures` field names each tool that did not answer with its error code and HTTP status. `listAll()` walks, `identity`'s `person()` and the `cross_channel_lead` tool report the same; `person_summary` and the other people insights set `meta.complete` to `false` and add a note naming the tool.

A rejected key, an outage, a timeout and a vendor rate limit are reported this way. The lookup still throws when every tool fails, when the call itself is wrong, and when a cap the caller set (`maxRequests`, the `budget` plugin, `signal`, `deadline`) stops it. Every other combined read still fails when one member fails.

`PageResult` and `ListAll` gain `failures`, and `Person` gains `complete` and `failures`. On a combined person lookup, `complete` can now be `false` with no `cursor`: page by `cursor`.
