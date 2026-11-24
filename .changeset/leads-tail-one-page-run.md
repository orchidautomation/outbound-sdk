---
"outbound-sdk": patch
---

A sync of Instantly leads keeps where the walk ended when the walk spanned several runs and its last run read one page. Before, that checkpoint kept no end, so the next run walked every lead again.
