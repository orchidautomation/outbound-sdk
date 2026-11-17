---
"outbound-sdk": minor
---

Default runs on a mid-size workspace come back complete, and a combined instance names a tool it checked nothing in (OUT-109, OUT-121).

- **A tool with nothing to check is named.** On an instance over several tools, when one tool has no campaign in the states an insight reads while another has some, a note names it and counts its others, such as `heyreach:default has no campaign active, so it was not checked (8 campaigns: 8 completed). Pass statuses to check them.` The answer stays complete for the tools that have campaigns.
- **`channelMix` reads active, paused and completed campaigns, up to 150, by default** (was active only, up to 50), since a channel's finished campaigns hold most of its evidence. With one channel found, its finding names the states read instead of saying only that channel exists.
- **`hotLeads` reads up to 2,000 leads labelled positive by default** (was 500).
- **`clientReport` names the campaigns whose leads left were not fully counted** at `max_leads_per_campaign`, which `runningOutOfLeads` leaves out.
