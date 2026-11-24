---
"outbound-sdk": minor
---

A scoped `sync.run` of replies or messages on a vendor that filters them by campaign and by date, such as Instantly, reads the workspace once from the earliest campaign's `since` once every campaign of the scope has finished a run, instead of one request per campaign, and keeps the scope's records here. The walk is held to one page fewer than the campaigns; past that the run goes on campaign by campaign, with a note.
