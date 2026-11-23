---
"outbound-sdk": minor
---

`replies.list({ includeInbox: true })` is refused as `Unsupported` before any request on an adapter whose `replies.inbox` capability is `false` (OUT-197). Instantly, Smartlead and EmailBison sent the read anyway and ignored the flag. **Breaking** for a caller that passed `includeInbox: true` there, `outbound replies --include-inbox` included: leave it out on those tools.

- A combined instance now has `replies.inbox` when any member has it, as `messages.byThread` does, and asks only those members for replies outside every campaign. `unanswered_replies` asks for them only where the tool has them.
- The shared adapter suite now checks every narrowing capability (`leads.byDomain`, `leads.byInterest`, `leads.byStatus`, `leads.lookup`, `leads.lookupMany`, `messages.byHand`, `messages.latestOfConversation`, `replies.inbox`, `senders.healthList`, `stats.bySenders`) on every adapter that declares it false. `replies.inbox` was the only one that let a request through.
