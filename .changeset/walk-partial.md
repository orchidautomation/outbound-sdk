---
"outbound-sdk": minor
---

- A `listAll().toArray()` that a cap or a failure stops part way still rejects, but the error now keeps what was fetched (OUT-78). `error.partial.items` holds the records, `error.partial.cursor` resumes the walk with `listAll({ cursor })` without skipping or repeating a record, and `error.partial.requests` counts the requests spent. `for await` is unchanged. New type: `PartialWalk`.
