---
"outbound-sdk": minor
---

Two capabilities say who filters messages and replies by campaign, and a scoped sync reads once where the vendor cannot (OUT-212).

- `messages.byCampaign` and `replies.byCampaign` are `"server"` when the vendor filters by campaign, `"client"` when the SDK keeps one campaign's records after reading them all, and `false` when not declared. Nothing is refused. Instantly, HeyReach and EmailBison filter both on their side. Smartlead filters replies, but its activity feed takes no campaign, so its messages are `"client"`.
- `sync.run("messages", { resolved })` on Smartlead, or any scoped run of a `"client"` collection, now reads the collection once and hands each campaign its own records, instead of reading the whole feed once per campaign on the 10-per-minute activities lane. Each campaign keeps its own checkpoint under the same key as before. A combined instance still syncs campaign by campaign.
