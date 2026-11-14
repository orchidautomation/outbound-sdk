# Security

## Reporting a vulnerability

Report it privately through GitHub: open the repository's **Security** tab and choose **Report a vulnerability**. Do not open a public issue for it.

Include the version, the adapter or plugin involved, what you did and what happened. Never include a real API key or a real person's data; a redacted request and response is enough.

## Supported versions

Only the latest published version of `outbound-sdk` receives fixes.

## What the package promises

- It only reads. No method sends, pauses, edits or deletes anything in a vendor tool; `outbound.raw` refuses writes unless `allowWrites: true` is passed, and refuses reads that return secrets even then.
- It removes API keys and email addresses from every error message and from the `cause` an error keeps.
- It sends requests only to each vendor's documented API host, unless you pass your own `baseUrl` to the adapter.

A way around any of these is a vulnerability.

## Releases

Each release is published from `.github/workflows/publish.yml` with npm trusted publishing and provenance, so `npm audit signatures` verifies where a version was built.
