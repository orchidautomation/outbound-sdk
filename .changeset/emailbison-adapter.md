---
"outbound-sdk": minor
---

New adapter: `outbound-sdk/emailbison` reads EmailBison (OUT-11). It is `unverified`: written from EmailBison's public API reference and tested offline only, never run against a live account. It reads campaigns, settings, sequences, senders and their health, leads, lead lists, sent emails, a lead's timeline, threads, replies, workspace, campaign, step, sender and daily stats, the block list, tags, webhooks and workspaces, and has a native catalog of 32 more reads. Pass `baseUrl` (or set `EMAILBISON_BASE_URL`) to the URL you log in to EmailBison with. `outbound-sdk/webhooks` parses EmailBison webhooks; verify them with a secret in the URL.
