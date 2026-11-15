---
"outbound-sdk": patch
---

Reads that do not depend on each other now run side by side. A person lookup on a combined instance (a lead listing filtered by `email` or `linkedinUrl`) asks every tool at once, and `person_summary`, `identity`'s `person()` and the insights that read per campaign or per sender keep a few reads in flight instead of one. Answers, their order and their request counts are unchanged; every request still fits its vendor's rate budget.

A `budget({ per: "run" })` cap now counts each request as it is sent, so calls running at the same time can no longer go past it together.
