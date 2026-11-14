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
