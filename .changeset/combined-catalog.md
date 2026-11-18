---
"outbound-sdk": minor
---

`--provider all` and redact now offer every tool one of their tools can serve, and the CLI's catalogs agree (OUT-152, OUT-153).

- A combined instance reads a conversation by thread id: `outbound.thread(id)`, the `threadId` filter and `thread_context` by `threads` ask each member that reads threads, and `messages.byThread` is on when any member has it.
- `insightTools` and `createTools` take `members` (from the new `membersOf(outbound)`). With it a tool that takes a `campaign` is offered when one member can serve it, and refuses another member's campaign before any request; an insight that reads every campaign is offered when exactly one member can, and answers for that member with `meta.complete: false` and a note. The CLI and `outbound mcp` pass it, so `step_funnel`, `variant_test`, `copy_reuse`, `settings_audit`, `winning_steps` and `campaign_setup` are back on `--provider all`.
- `person_summary` stays offered under redact. With both identifiers masked it looks up a lead ref by the tokens redact wrote, and answers masked; a bare address or profile URL is refused with what to give instead.
- `outbound tools`, `outbound insight` and `outbound mcp` read one catalog. The list commands name each tool they leave out, with the reason, in `meta.notes`; `outbound insight` lists only what the instance offers. `--tools` refuses a left-out tool with its reason, and `outbound mcp` names the tools another setting would offer.
- A `next` inside an insight's answer, such as a finding's, no longer names a tool that is not on offer, and an `Unsupported` insight call's `next` says what to change instead of "Try another tool".
