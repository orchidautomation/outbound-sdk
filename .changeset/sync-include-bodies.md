---
"outbound-sdk": minor
---

`sync.run` takes `include: ["body"]` for `messages` and `replies`, passed to `listAll`, so synced records carry `bodyText` and `bodyHtml`. Instantly's extra read of a truncated body happens as in `listAll` and counts in `requests`. `include` on another collection is `Invalid` before any request. A new subpath, `outbound-sdk/text`, exports `normalizeBody`, `stripQuotedHistory` and `MessageBody`, the helpers every adapter uses to fill bodies; `normalizeBody`'s second argument now defaults to `true`.
