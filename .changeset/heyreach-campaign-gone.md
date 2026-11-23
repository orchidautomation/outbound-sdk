---
"outbound-sdk": patch
---

HeyReach: a campaign HeyReach lists but can no longer open no longer fails every reply and message listing (OUT-206). HeyReach answers 400 "The campaign you are trying to open does not exist." for a conversation filter naming such a campaign, alone or with others. The adapter now leaves that campaign out of its walk over the workspace's campaigns, and out of the filter that sets apart the inbox's own conversations. Any other 400 still fails the call.
