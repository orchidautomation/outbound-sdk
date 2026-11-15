---
"outbound-sdk": minor
---

- `demoData()` counts its dates back from now, with two weeks of stats, so `clientReport` and `droppedReplies` find data on any day. `demoData({ now })` fixes the moment.
- `hotLeads` reads the leads behind recent replies when `max_leads` cuts the listing short, and says so in `totals.moreLeadsExist` and `totals.fromReplies`. A lead labelled out-of-office earns no reply or recency points (`totals.autoReplied`).
- `droppedReplies` returns each person's `name`, `email` and `linkedinUrl` and the `campaignName`.
- Insight sentences show at most one decimal and rates as percentages. The number fields are unchanged.
- New types: `OutboundWith<typeof plugins>`, `InsightInputs` (each field's default and range in its JSDoc), `ProviderId` and `DemoDataOptions`. New guard: `isProviderId()` from `outbound-sdk/providers`.
- `createOutbound` no longer infers its plugins from the type the result is assigned to, so an instance built without a plugin cannot be typed as one with it.
