---
"outbound-sdk": minor
---

A vendor record the SDK cannot read, such as a sequence step whose delay is below zero, is now a `Provider` error with `retryable: false` (`OutboundError.permanent`), because the vendor returns the same record on every retry. A tool's `next` for it now says to try another campaign or report the field the message names, instead of "Check the input and try again." `OutboundError` takes a new `permanent` option for errors like this one.

CLI and MCP polish from the 0.7.0 stress test:

- `--limit -5` and other negative values get the CLI's own message, "Invalid: --limit must be a positive whole number". An option given no value is `Invalid` too, not a bare `Error`.
- A cap read once per campaign, such as `max_senders_per_campaign`, now puts out one note for all the campaigns it stopped in: "Stopped at 100 senders in 22 campaigns (max_senders_per_campaign); more exist." It used to put out one note per campaign. A custom insight can do the same with the new `per` field of `Cap`.
- **Breaking for scripts:** `outbound tool <name>` with no `--input` for a tool that needs input now exits 2 with `ok: false` and `error.code: "InputRequired"`, and what the tool takes in `data`. It used to print the schema with `ok: true` and exit 0, which a script could not tell from an answer.
- `campaign_overview` takes `campaign`, a ref, id or name, like its sibling tools, and then reports only that campaign.
- `outbound mcp --tools a,b` offers only the tools named. Every tool's description and inputs cost about 60 KB of a client's context in `tools/list` on a real adapter.
