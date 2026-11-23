---
"outbound-sdk": patch
---

The memory adapter applies every filter it is declared with (OUT-218). Declared through `capabilities`, `leads.byInterest` keeps only positive leads, `leads.lookupMany` only the listed addresses, `messages.byHand` only outbound messages seeded `byHand: true` (a new `MemoryMessage` field), and `messages.latestOfConversation` only the latest message of each conversation that holds a reply. Before, they were ignored, so an insight such as `hot_leads` over memory data saw records a vendor that filters would have left out. A contract test runs every filter capability against the memory adapter.
