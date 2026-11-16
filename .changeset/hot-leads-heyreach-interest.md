---
"outbound-sdk": patch
---

`hot_leads` on HeyReach no longer ranks every replied lead at a flat 10 (OUT-125). A campaign's leads carry no auto-tag, so a lead with no label now takes the interest class the vendor keeps on the lead from its replies (`categorySource: "lead"`), and an Interested tag earns the interest points. With the reply counts and recency from the replies read in the window, the most recent Interested reply ranks first. When replies were read, the note now says only that open and click counts are missing, instead of claiming the vendor reports no reply data.
