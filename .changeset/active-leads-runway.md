---
"outbound-sdk": minor
---

`clientReport` counts each active campaign's leads left from its active leads alone, so its default run comes back complete on a workspace with thousands of finished leads per campaign (OUT-131).

- **Leads by status.** `leads.list` and `leads.listAll` take `status: "active"`: only the leads still in the sequence. It needs the new capability `leads.byStatus`, which Instantly declares (the `filter` `FILTER_VAL_ACTIVE` of `POST /leads/list`). The SDK keeps only the leads it reads as active, whatever the vendor's filter returns. It cannot be combined with `interest`, since Instantly takes one filter at a time.
- **`clientReport` runway.** Where the campaign's tool declares `leads.byStatus`, only the active leads are read, on a combined instance too. `max_leads_per_campaign` defaults to 5,000 (was 500). On a live Instantly workspace with 24 active campaigns and about 135k leads contacted, the default run went from stopping incomplete after 273 requests to complete in 254.
