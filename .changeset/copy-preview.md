---
"outbound-sdk": minor
---

New insight: `copyPreview` (`copy_preview` as a tool) shows a campaign's copy as written and as one real lead receives it (OUT-83). Each step and variant has its `template` subject and body exactly as stored, the `rendered` subject and body with the lead's values put into each `{{variable}}`, `{variable}` and `%variable%`, the rendered body as plain text, and the variables left as written. It reads copy that is all or partly templated, such as `{{subject1}}` and `{{content1}}` filled from custom fields. Pass `lead` to choose the lead, or leave it out to use the lead with the most variables filled. It finds and fills variables the same way `personalizationGaps` checks them.
