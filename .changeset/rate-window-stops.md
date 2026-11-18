---
"outbound-sdk": patch
---

An MCP tool call that stops because the vendor's rate window is full, with time left in its budget, now says when to call again instead of "do not call again". Right after one tool used up Instantly's 20 email reads a minute, the next tool used to fail at once with `retryable: false` and advice to ask for less. It is now answered with `retryable: true`, `error.retryAfterMs` and a `next` to call again with the same input once the window frees. Every `RateLimited` tool failure also carries `error.limit` (`vendor`, `call` or `run`), so a model can tell the vendor's limit from a cap of its own, such as `--max-requests`, without reading the message.
