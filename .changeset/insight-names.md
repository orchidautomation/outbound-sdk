---
"outbound-sdk": minor
---

Insight names are consistent before 1.0 (OUT-74). The rule is on the insights page under "Names". Nothing is removed in this release: old names keep working until 0.5.0.

- Renamed inputs: `bounceWatch` `threshold` is `max_bounce_rate`, `domainHealth` `spam_rate_threshold` is `max_spam_rate`, `campaignDiagnosis` `recent_days` is `days`, and `clientReport` `top` is `limit` (the `top` list in the answer keeps its name). An old name gives the same answer with a note in `meta.notes`, the tool parameters mark it `deprecated: true` and the generated input types mark it `@deprecated`. Passing an old name and its new name together is `Invalid`.
- Every campaign row the ops insights, `bounceWatch` and `senderLoad` return has `campaignName`; `name` is deprecated. `campaign` in `stepFunnel`, `variantTest`, `personalizationGaps`, `replyTiming` and `copyAudit`, and `anomalies`' `scope`, is the campaign's ref even when the input was a bare vendor id, at no extra request.
- A rate is `{ count, of, rate, low, high }` everywhere: added to `bounceWatch`'s counts (`interval` deprecated), `clientReport`'s `bounceProblems`, `variantTest`'s variants (`trials` and `interval` deprecated) and `domainHealth`'s `warmup` (`spamRate` and `interval` deprecated). `stepFunnel` and `copyReuse` rows add `rates.replyRate` with `basis` (`replyRate`, `replyRateInterval` and `replyRateBasis` deprecated). `bounceWatch` adds `maxBounceRate` (`threshold` deprecated). Cards read the new fields and still draw a stored result that has only the old ones.
- Every `from`/`to` input takes `null` for no bound and refuses a day that does not exist, such as `2026-02-30`; `bounceWatch` used to refuse `null`.
- Behaviour change: `bounceWatch` takes `statuses` and reads only active campaigns by default, where it read every campaign. It never makes more requests than before. To read every campaign, pass `statuses: ["active", "paused", "completed", "draft", "archived", "unknown"]`.
- Behaviour change: `campaignDiagnosis` judges rates from 50 sends (`min_sent`), as the other ops insights do, where it needed 100. `clientReport`'s `next` says to run `campaign_diagnosis` with `from` and `to` set to the report's `period`.
