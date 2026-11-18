---
"outbound-sdk": patch
---

`campaign_diagnosis` counts lead runout from active leads only, as `client_report` does (OUT-174).

- When sends fell or stopped, it now reads only the campaign's active leads where the tool lists them alone (`leads.byStatus`), through the same read `client_report` and `lead_runway` use. A campaign with thousands of finished leads is no longer cut off at `max_leads` before its active ones are counted, so a campaign that ran out of leads is reported as `out_of_leads` instead of `no_recent_sends` or `falling_sends`.
- An empty listing of active leads means none is left to start, so it reports `out_of_leads`, as `client_report` does.
- When `max_leads` still stops the read, `notChecked` says that lead runout was not checked and how to raise the cap. So does an adapter that cannot list a campaign's leads.
