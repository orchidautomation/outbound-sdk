---
"outbound-sdk": patch
---

Check most unanswered replies within the MCP time budget on Instantly (OUT-179).

- A combined instance (`--provider all`) listing replies newest first no longer reads a waiting tool's page again for each page of another tool within one walk. On Instantly with HeyReach, that re-read the second page of replies until Instantly's emails lane was spent, so `unanswered_replies` checked 0 of 18 conversations live. It now holds that page for the rest of the call (`AdapterContext.remember`), and nothing outlives the call.
- New capability `messages.latestOfConversation` and messages filter `latestOfConversation: true`: only the latest message of each conversation that holds a reply, sent or received. Instantly serves it with `latest_of_thread`; the other adapters do not.
- `droppedReplies` (MCP `unanswered_replies`) uses that listing to settle every answered conversation without reading it, on each tool of a combined instance that has it, and reads the rest in full, longest waiting first. When the time budget or a request cap stops those reads, a conversation whose latest listed message is the person's reply is still counted as dropped, with `checkedBy: "latest"`, its `hoursWaiting` counted from that reply and a note to read it with `thread_context`.
- An Instantly read of one conversation, or of the latest emails, ends at a page that is not full, so it no longer spends a request on the empty page Instantly answers after a last page.
- The old MCP tool names from 0.16.0 now answer until 0.18.0, one release longer than announced: their note in `meta.notes` says "kept until 0.18.0". Nothing is removed in 0.17.0.
