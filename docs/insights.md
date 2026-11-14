# Insights

`outbound-sdk/insights` answers the questions operators ask, computed from the normalized reads. Each insight is one typed method, one agent tool and one CLI command. It calls no AI model, stores nothing and never writes to a vendor: every number is a count, a rate or a textbook test you can check by hand.

```ts
import { createOutbound } from "outbound-sdk";
import { combine } from "outbound-sdk/combine";
import { heyreach } from "outbound-sdk/heyreach";
import { insights } from "outbound-sdk/insights";
import { instantly } from "outbound-sdk/instantly";

const outbound = createOutbound({
  adapter: combine([instantly(), heyreach()]),
  plugins: [insights()],
});

const person = await outbound.insights.personSummary({
  person: "jane@example.com",
});

person.data.campaigns; // each campaign, messages sent, replies, steps replied to
person.data.totals.byChannel; // email and LinkedIn side by side
person.meta; // { requests, complete, evidence, notes }
```

## What every answer carries

- **`meta.requests`:** how many vendor requests the insight made. Every read has a cap you can set (`max_campaigns`, `max_leads`, ...), with defaults that keep a call to tens of requests.
- **`meta.complete`:** `false` when a cap stopped a read early. The note says which cap.
- **`meta.evidence`:** `exact` only when every read behind the answer was exact.
- **`meta.notes`:** what to know before trusting the numbers, for example a part that was skipped because the adapter cannot read it.

A count a vendor does not report is `null`, and so is a rate built on it. Rates that rest on a sample come with a 95% Wilson interval, and comparisons say whether the difference is more than chance (a two-proportion test). Thresholds are inputs with defaults.

An insight that needs a capability the adapter lacks is refused as `Unsupported` before any request, and is left out of the tool list.

## The insights

### People and accounts

| Method | Answers | Needs |
| --- | --- | --- |
| `personSummary` | One person across campaigns and channels: messages sent, replies, steps replied to, interest | `leads.lookup`, `leads.timeline` |
| `accountSummary` | Everyone at one company domain, across campaigns and tools | leads by list or by campaign |
| `leadCollisions` | People in two or more campaigns at once, inside a tool or across tools | `leads.byCampaign` |
| `suppressionCheck` | Leads in campaigns although they are on the block list | `blocklist`, `leads.byCampaign` |
| `droppedReplies` | Replies nobody answered, longest waiting first | `replies.list` |
| `hotLeads` | Who to call first, scored from interest, replies, clicks, opens and recency | leads with engagement counts |
| `personalizationGaps` | Leads that will get broken copy because a merge variable has no value | `sequence`, `leads.byCampaign` |

### Copy and sequence

| Method | Answers | Needs |
| --- | --- | --- |
| `stepFunnel` | Where replies come from, step by step | `sequence`, `stats.byStep` |
| `variantTest` | Whether an A/B leader is ahead by more than chance | `stats.byStep` |
| `copyAudit` | Problems in the copy: length, links, spam words, broken variables | `sequence` |
| `copyReuse` | How the same copy performs in different campaigns | `sequence`, `stats.byStep` |
| `replyTiming` | How fast people reply, and on which days and hours | `messages.list` |

### Senders and deliverability

| Method | Answers | Needs |
| --- | --- | --- |
| `domainHealth` | DNS, sign-in, block list and warmup spam rate per sending domain | `senders.list`, `senders.health` |
| `senderCapacity` | What senders can send against what campaigns ask and what went out | `senders.list` |
| `bounceWatch` | Campaigns and senders over a bounce threshold | `stats.campaign` |
| `warmupReadiness` | Senders that are not ready to send, with reasons | `senders.list` |
| `senderLoad` | Senders on too many campaigns, and idle ones | `senders.list`, `senders.byCampaign` |
| `settingsAudit` | Risky schedules, tracking and stop rules | `campaigns.settings` |

### Campaign operations and reporting

| Method | Answers | Needs |
| --- | --- | --- |
| `campaignDiagnosis` | Why one campaign is underperforming, most serious finding first | `stats.campaign` |
| `pipelineForecast` | Leads left, days of sending left, and the replies to expect | `leads.byCampaign`, `stats.campaign` |
| `anomalies` | Days whose sends, replies or bounces broke from trend | `stats.byDay` |
| `periodComparison` | This period against the one before | `stats.campaign` |
| `campaignRanking` | Campaigns ranked fairly at different volumes | `stats.campaign` |
| `channelMix` | Email against LinkedIn | `stats.campaign` |
| `tagRollup` | Results grouped by campaign tag | `stats.campaign` |
| `clientReport` | One report for a client or workspace, with action items | `stats.campaign` |

The tool and CLI name of each is the same words in snake case: `personSummary` is `person_summary`.

## Which adapter serves which

Run against one live workspace each on 2026-11-14: Instantly served all 26; HeyReach served 22, and refused `stepFunnel`, `variantTest`, `copyReuse` (it has no per-step stats) and `settingsAudit` (its API cannot read campaign settings). Smartlead has not been run live.

Finding a person takes 1 request on Instantly, 2 by profile or about 4 by email on HeyReach, and 1 to 2 on Smartlead. An email address finds a LinkedIn record only when a tool holds both for that person: records are linked by exact identifier, never by name.

## For agents, and from the command line

```ts
import { insightTools } from "outbound-sdk/insights";
import { openaiTools } from "outbound-sdk/tools";

openaiTools(outbound, { extra: insightTools(outbound) });
```

`outbound mcp` serves the insights with the other tools. `outbound insight` lists them, and `outbound insight person_summary --input '{"person":"jane@example.com"}'` runs one.

## Things to know

- **A vendor's thread can be shorter than its sequence.** Instantly's email list does not hold every email a campaign sent, so `personSummary` counts messages sent from the lead's last step when the thread is shorter, and says so in a note.
- **"The last N days" means N complete UTC days ending yesterday**, so a half-finished today cannot read as a drop.
- **`bounceWatch` judges a sender on everything it sent in the period**, not only in the offending campaign: no vendor reports one sender within one campaign.
- **`variantTest` makes no correction for comparing three or more variants**, and its "sends still needed" assumes both rates stay as they are.
- **`hotLeads` is a ranking, not a prediction.** Its score is the sum of weighted parts that are returned with it.
