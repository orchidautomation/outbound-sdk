---
"outbound-sdk": minor
---

A sync that stops at `maxPages` saves the next page's cursor without fetching that page, so the next run no longer fetches it again. Before, each boundary page was read by both runs: every page twice at `maxPages: 1`. `listAll` takes `pages` to stop after that many pages the same way.
