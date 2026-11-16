---
"outbound-sdk": minor
---

`copyAudit` audits copy written per lead, and `personalizationGaps` stops flagging gaps no lead has (OUT-95).

- **`copyAudit`:** a variant whose subject or body is more than 80% variables, such as `{{body_1}}` filled from a custom field, is audited as sample leads receive it, rendered as `copyPreview` renders it. New inputs `samples` (default 3) and `max_leads` (default 100). New optional answer fields: `lead` on each finding (`null` for copy as stored), `variantsWrittenPerLead`, `leadsAudited` and `variantsNotAudited`.
- **Changes reported answers:** `clean` is `false`, never `true`, when a variant written per lead could not be rendered for any sample lead, even with no finding. Read `variantsNotAudited` and the note to tell "not audited" from "has problems". `clean` stays a `boolean`; a `null` for "not audited" may come in 0.8.0.
- **`personalizationGaps`:** `gap` is `true` only when at least one lead read gets broken copy (`leadsAffected` above 0). It was `true` for any variable with a use lacking a fallback, even when every lead had a value.
- **`personalizationGaps`:** Instantly's sender variables (`{{accountSignature}}`, `{{sendingAccountName}}`, `{{sendingAccountFirstName}}`, `{{sendingAccountEmail}}`) get the new optional field `sender: true` and are left out of `unknownVariables`. Their `source` stays `unknown`; a `source: "sender"` value may come in 0.8.0.
- The `copyAudit` cost estimate includes one page of leads; with no copy written per lead it still makes 2 requests.
