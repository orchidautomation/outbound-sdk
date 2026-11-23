---
"outbound-sdk": minor
---

A campaign scope on every insight (OUT-200). Each insight takes `campaign_ids`, `tag` and `campaign_name` (an exact name, a glob with `*` and `?`, or `/regex/`), and reads only the campaigns matching every one given, together with its own filters such as `statuses`.

- The scope is applied before any per-campaign read. Ids are read by id with no listing; a tag or a name is sent to the vendor where it filters its listing (`campaigns.byTag`, `campaigns.byName`), and matched after the listing elsewhere. `meta.notes` says how many campaigns matched and which side filtered.
- A tag where campaigns carry no tags, such as HeyReach, is refused as `Unsupported` before any request. A malformed scope is `Invalid`.
- Under a scope no other campaign's rows are read: a `campaign` outside it is refused, replies, senders and leads are read per campaign, and workspace totals are the scope's campaigns added up, each with a note.
- `client_report`'s own `tag` input is now this scope's `tag`, and `campaign_ids` and `campaign_name` narrow it too.
- `outbound insight` takes `--campaign-ids`, `--tag` and `--campaign-name`. On `outbound mcp` the three are keys of each insight's `scope`, not inputs of their own.
