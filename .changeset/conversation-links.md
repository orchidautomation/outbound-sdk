---
"outbound-sdk": minor
---

Messages and replies carry `url`, a link that opens the conversation in the vendor's app, and the `reply_samples` tool returns it on each reply. Instantly links to the thread in its Unibox (`https://app.instantly.ai/app/unibox?thread_search=thread:<thread_id>&selected_wks=<organization_id>`), the same link Instantly sends as `unibox_url` on reply webhooks. HeyReach, Smartlead and EmailBison document no link to one conversation, so `url` is `null` there, `outbound.fields` grades it `false` and each adapter's caveats say why. A link is never guessed. Adapters that predate the field may leave it out.
