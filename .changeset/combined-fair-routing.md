---
"outbound-sdk": minor
---

A combined instance (`--provider all`) no longer lets its first tool crowd out the others (OUT-123), and routes a campaign to the tool it belongs to (OUT-126):

- Listings of campaigns, leads, senders, messages and replies read every tool at once and merge the pages: campaigns, leads and senders one from each tool in turn, messages and replies newest first. A `--limit` or `max` now leaves each tool its share, and `replies --since` lists every tool's replies in time order. **Order change:** these listings used to return the first tool's records to their end, then the next tool's.
- Insights that read up to `max_campaigns` read each tool on its own and share the cap: a tool with fewer campaigns than an even share keeps them all, the rest split what is left, and a note says how. `channel_mix` now compares email and LinkedIn on an Instantly and HeyReach pair, and `campaign_ranking` includes the HeyReach campaigns.
- `channel_mix` no longer says "Only email campaigns were found" when `max_campaigns` left campaigns unread; it says the cap stopped the read.
- A campaign name, or a bare id, given to the CLI, a tool or an insight is looked up across every tool. One match is used; several are refused with their refs.
- An insight given one campaign runs on the tool that campaign belongs to, so that tool's capabilities apply: `step_funnel` works for an Instantly campaign beside HeyReach, and is refused naming `heyreach` for a HeyReach campaign.
