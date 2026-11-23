---
"outbound-sdk": minor
---

Filter campaign listings by name and tag (OUT-199). `campaigns.list` and `campaigns.listAll` take `name` (campaigns whose name contains the text, ignoring case) and `tag` (campaigns that carry the tag, ignoring case). Two new capabilities say who filters: `campaigns.byName` and `campaigns.byTag`, each `server`, `client` or `false`.

- Instantly filters both on its side: `search` for the name, and `tag_ids` after looking the tag up by name.
- HeyReach filters the name with `keyword`. Its campaigns carry no tags, so `tag` throws `Unsupported` before any request.
- EmailBison filters the tag with `tag_ids[]`; the name is matched after the listing.
- Smartlead returns every campaign in one listing, which is then filtered.
- Instantly campaign listings no longer drop tags: a page of 100 campaigns whose tag assignments filled a page lost the rest (5 of 110 campaigns live), because Instantly's next page of assignments came back empty. Such a page is now read again in halves.
- The wrapper checks every campaign against both filters whatever the vendor did, so a looser vendor search never widens the answer. An empty `name` or `tag` is refused with `Invalid`.
