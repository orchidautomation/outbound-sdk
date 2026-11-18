---
"outbound-sdk": minor
---

Link one person across tools honestly (OUT-157, OUT-159).

- `person()` and `cross_channel_lead` keep each message once. A vendor that uses one lead id in every campaign (Smartlead) no longer repeats a person's timeline once per campaign, and each ref's timeline is read once. `cross_channel_lead` timeline entries name their `campaign` and `is_auto`, and a note says how its counts differ from `person_summary`'s.
- `person()` returns `links`: per tool, the identifier types it fills and whether it holds the person (`linked`, `absent` or `undetermined`). A tool that fills none of the person's identifier types is `undetermined`, never absent; `cross_channel_lead` and `person_summary` mark that answer incomplete and name the tool.
- New `outbound.identifiers()` on the identity plugin (no request) and `leadIdentifierCoverage(leads)` from `outbound-sdk/identity` say which identifier types each tool carries and which two or more share. Empty `shared` means no one can be linked across tools.
- `leadFields` takes a list of candidate custom field names, tried in order, such as `{ linkedinUrl: ["linkedin_profile", "linkedin_url"] }`. `fromEnv` takes `leadFields` and reads `OUTBOUND_LEAD_FIELDS` (JSON), and a CLI or `outbound mcp` config file can export `leadFields`.
