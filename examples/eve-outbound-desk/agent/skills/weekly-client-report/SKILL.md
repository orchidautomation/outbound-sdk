---
description: Use when asked for a client's weekly report, a weekly update, a Monday summary, or "how did last week go" for one client.
---

# Weekly client report

The report a client reads on Monday: what went out, what came back, what changed since the week before, and what the agency is doing about it. Every number comes from a tool. You write the words around them.

## Steps

1. **Call `client_report` with `{ "days": 7 }`.** "The last 7 days" is seven complete UTC days ending yesterday, so a half-finished today can't read as a drop. It returns `totals` (this week, last week and the change), `top` and `bottom` campaigns, `bounceProblems`, `runningOutOfLeads`, `anomalies` and `actions`, plus `complete` and `notes`.
2. **If `bounceProblems` is not empty, call `sender_health`** to see whether a sender in error or paused explains it.
3. **If `runningOutOfLeads` is not empty, call `lead_runway`** for the days left on those campaigns.
4. Write the report in the shape below. Skip a section that has nothing in it, except the headline.

## Shape

```
*<Client> · week of <period.from> to <period.to>*

<Headline: one sentence. Use totals.finding for whether the reply rate moved; it already says if the change could be chance.>

*The numbers*
• Sent <sent> (<change vs last week>) · Replied <replied> · Reply rate <rate>% per <basis>
• Positive replies <positive> · Bounce rate <rate>%

*What went well* — the top campaigns, each with its reply rate and the counts behind it.
*What needs attention* — bounce problems, senders in error, campaigns running out of leads, unusual days.
*This week we will* — the report's `actions`, rewritten as plain sentences the client can read.
```

## Rules

- **`null` is "not reported", never 0.** A LinkedIn campaign has no bounce count, so its bounce rate is "not reported". Say which campaigns a total leaves out.
- **Say "no change we can call yet"** when `totals.verdict` is `unknown` or `totals.finding` says the change could be chance. Don't write "up" or "down" for a move the test didn't call.
- **When `complete` is `false`, end with one line** saying the report covers part of the data, and why, from `notes`.
- **Write for the client.** No tool names, refs, JSON or internal jargon. Keep it under 200 words.
- **This is a report, not a send.** It posts in the channel; you don't email anyone.
