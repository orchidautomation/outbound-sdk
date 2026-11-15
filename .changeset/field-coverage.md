---
"outbound-sdk": minor
---

Say which fields each adapter fills, and normalize more of what the three vendors report.

- `outbound.fields` grades every field of every record: `exact` from the vendor, `derived` by the adapter, or `false` when the adapter never fills it, so a `null` can be told apart from a field the vendor does not have. `outbound capabilities` prints the fields that are not `exact`.
- New fields: `clickedTotal` on stats rows (`clicked` is unique clicks), `interestCategory`, `phone`, `website`, `location` and `companyLinkedinUrl` on leads, `unread` on replies, `mailProvider` and `tags` on senders.
- New reads: `outbound.stats({ scope: "campaign" })` with no `scopeId` returns a row per campaign from one request (`stats.allCampaigns`), `outbound.sender(id).campaigns` lists the campaigns a sender is attached to (`campaigns.bySender`), and `replies.list({ unread })` filters by read state (`replies.unread`).
- HeyReach lists every lead by walking its campaigns, and its replies take the category of their lead's newest auto-tag. A reply whose category is the lead's label carries `categorySource: "lead"`, on HeyReach and on Smartlead, which reported `vendor` before.
- Smartlead stats: out-of-office replies as `repliedAuto` on a dated campaign total, positive replies per day, and a step's one click count as `clickedTotal` where it was `clicked`.
- `leadFields` on each adapter names the custom field that holds a lead's title, company, phone, website, location or LinkedIn profile, for a vendor with no field of its own. Nothing is guessed without it.
- A campaign, list, tag or workspace the vendor gave no name is named by its id; `name` is never an empty string.
- A webhook subscription carries `eventTypes`: the SDK's event types its vendor event names become.
- `outbound.lists.get(id)`, `outbound.list(id).get()` and `outbound.webhooks.get(id)` read one list or one webhook (`lists.get`, `webhooks.get`). On Instantly a list read by id has its `size`.
- An event's `data` has a checked shape for the keys every vendor shares, as part of `outboundEventSchema`; a vendor's extras still ride along.
- A block entry the vendor gave no value is skipped, and `value` is never empty.
- `stats.allCampaigns` is `full` or `partial`: `full` when each per-campaign row has every count the read of one campaign has. `campaign_ranking`, `channel_mix` and `tag_rollup` read every campaign's totals in one request on a `full` vendor.
- A lead carries `progress` (where it is in its sequence) and `replied`, `bounced` and `unsubscribed` (what came back) as separate fields. `status` is the headline made from them the same way on every vendor, so a lead that replied reads `replied` on Instantly and Smartlead as it already did on HeyReach.
- `redact` masks a lead's `phone` (a new `"phone"` field), and its `website` and `companyLinkedinUrl` with `company`.
