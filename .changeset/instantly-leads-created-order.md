---
"outbound-sdk": minor
---

A sync of leads on a tool whose lead listing is in creation order, a new capability `leads.createdOrder` that Instantly declares, goes on from where the last finished walk ended (`Checkpoint.tail`) and reads only the leads created since, instead of walking every lead each run. With nothing new that is one request. `reset` still gives a full walk, for changed and deleted leads. `ListAll` gains an optional `tail`, the last cursor the vendor gave.
