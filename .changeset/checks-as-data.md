---
"outbound-sdk": minor
---

Alert checks can be written as data (OUT-8). A check is a JSON object, `{ "metric": "bounce_rate", "op": ">", "value": 0.03, "scope": { "client": "acme" } }`, so it can be stored, shown and edited. `outbound-sdk/alerts` adds `validateCheck`, which lists every problem with what to write instead, `parseCheck`, `checkSchema` (the Zod schema, convertible to JSON Schema), `evaluateCheck`, which runs a check against stats rows, senders, or a `droppedReplies`, `pipelineForecast`, `suppressionCheck` or `personalizationGaps` answer and returns pass or fail with the numbers that broke it, and `checkRule`, which turns a check on records into an `AlertRule`. `CHECK_METRICS` lists the eight metrics and what each reads. Rule functions are unchanged.
