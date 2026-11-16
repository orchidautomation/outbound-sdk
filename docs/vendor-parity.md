# Vendor UI parity cases

A fixture built from a vendor's documentation proves the adapter reads the field it was told to read. It cannot prove that field is the number a user sees. Instantly's `contacted_count` passed every test while the dashboard's "Sequence started" was `new_leads_contacted_count` (OUT-86). A parity case closes that gap: a raw response from a real account, saved next to the numbers the vendor's own dashboard showed for the same campaign and range, and a test that the SDK's row matches the dashboard.

What each count reads, per adapter, is in `docs/metric-glossary.md`.

## Format

One JSON file per case, at `fixtures/parity/<provider>/<case>.json`. Name the case after what it is and when it was captured, never after a customer: `four-step-campaign-2026-11-15.json`.

| Key | Holds |
| --- | --- |
| `provider` | The adapter, matching the folder name |
| `capturedAt` | The capture date, `YYYY-MM-DD` |
| `source` | Where the case came from (an issue key) and the dashboard's date range |
| `endpoint` | `METHOD /path` of the request the raw response answered, as the adapter sends it (`GET /api/v2/campaigns/analytics`) |
| `raw` | The vendor's response body, exactly as returned apart from redaction. Trim fields the case does not need; never add or change one |
| `ui` | The dashboard's numbers, keyed by label in camelCase (`sequenceStarted` for "Sequence started"). A count is a number; a state the dashboard shows instead of a number is a word, such as `"disabled"` for a rate whose tracking is off |

`packages/outbound-sdk/test/parity.test.ts` replays `raw` through the adapter, as the response to `endpoint`, and checks every `ui` label against the SDK row. Each provider there declares, for every label, either the SDK field that must show the same number or why the SDK has none (`unmapped`). A label in a case with no declaration fails the test, so a new dashboard number forces a decision. A provider folder with no declaration fails too.

Parity cases sit outside `fixtures/<provider>/`, so the vendor-drift agent, which may edit only that folder, cannot change what the dashboard showed.

## Capturing a case

1. Pick one campaign with a few hundred leads and numbers that differ from each other. Where a count differs between people and messages (leads started against emails sent), that difference is what the case pins down.
2. Open the campaign's analytics in the vendor's dashboard and note the date range it shows. Copy every number on the page into `ui`, and the label text into the PR description.
3. Request the same range from the endpoint the adapter reads, with the CLI so the request is the adapter's own: `outbound native <operation> --input '{...}' --provider <provider>`. Save the body.
4. Redact it before it touches the repository:
   - replace campaign, lead and workspace ids with the placeholder ids in `packages/outbound-sdk/test/<provider>/suite.ts`;
   - drop names (campaign, company, person), email addresses, domains, subject lines and message text, or replace them with the fakes in `docs/new-adapter.md` step 2;
   - keep every count unchanged; a parity case whose numbers were edited proves nothing.
5. Write the file, add the provider's declaration to `parity.test.ts` if it is new, and run `npm run fixtures` (rejects real-looking emails, LinkedIn profiles and credentials) and `npm test`.
6. If the test fails, the case has found a mapping bug. Open an issue with the failing line; do not change the case to match the SDK.
