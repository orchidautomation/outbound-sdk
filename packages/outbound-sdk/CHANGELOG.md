# outbound-sdk

## 0.19.0

### Breaking changes

- **The MCP and `outbound tool` names that 0.16.0 merged no longer answer (OUT-198).** A `tools/call` or `outbound tool` with an old name, such as `campaign_overview` or `dropped_replies`, is an unknown tool; call the listed tool with its `view` or `checks`, as listed below. `RENAMED_TOOLS` is no longer exported from `outbound-sdk/cli`.
- **`replies.list({ includeInbox: true })` is `Unsupported` where `replies.inbox` is `false` (OUT-197).** Instantly, Smartlead and EmailBison now refuse it, `outbound replies --include-inbox` included, before any request. Leave it out on those tools.

### Minor Changes

- ca6e15e: `replies.list({ includeInbox: true })` is refused as `Unsupported` before any request on an adapter whose `replies.inbox` capability is `false` (OUT-197). Instantly, Smartlead and EmailBison sent the read anyway and ignored the flag. **Breaking** for a caller that passed `includeInbox: true` there, `outbound replies --include-inbox` included: leave it out on those tools.

  - A combined instance now has `replies.inbox` when any member has it, as `messages.byThread` does, and asks only those members for replies outside every campaign. `unanswered_replies` asks for them only where the tool has them.
  - The shared adapter suite now checks every narrowing capability (`leads.byDomain`, `leads.byInterest`, `leads.byStatus`, `leads.lookup`, `leads.lookupMany`, `messages.byHand`, `messages.latestOfConversation`, `replies.inbox`, `senders.healthList`, `stats.bySenders`) on every adapter that declares it false. `replies.inbox` was the only one that let a request through.
- ea4317b: Insight answers say more truthfully what they rest on (OUT-196).

  - `InsightMeta.stale` is `true` when any read behind the answer was an older answer the failover plugin served because the vendor was down, as `ResultMeta.stale` says on that read. A listing walk's `meta.stale` now stays `true` once any of its pages was stale, not only when the last one was.
  - `leadCollisions` and `suppressionCheck` give `totals.collisions` and `totals.violations` of `null`, not 0, when no campaign is in the statuses asked for while others exist (`campaignsRead: 0`, `meta.complete: false`). Their `finding` then says that nothing was checked and how to check the others. A missing count is `null`, never 0.
  - The type docs no longer read as if `lead_runway` were an insight. It is an AI tool (`outbound-sdk/tools`, `outbound mcp`), so `listInsights()` does not list it; `pipelineForecast` and `clientReport` give the same runway state and days.
- 812ae1b: **Breaking for MCP clients and `outbound tool`: the tool names that 0.16.0 merged no longer answer (OUT-198).** 0.18.0 said they would answer until 0.19.0.

  - A `tools/call` or `outbound tool` with an old name is now an unknown tool. Call the listed tool instead: `campaign_overview`, `campaign_ranking` and `campaign_trend` are `campaigns` with `view` `list`, `ranking` or `trend`; `deliverability_check`, `warmup_readiness`, `domain_health` and `bounce_watch` are `sender_health` with `checks` `deliverability`, `warmup`, `domains` or `bounces`; `sender_load` is `sender_capacity` with view `load`; `pipeline_forecast` is `lead_runway` with view `forecast`; `suppression_check` and `lead_collisions` are `list_hygiene` with checks `suppression` or `collisions`; `copy_audit`, `variant_test`, `personalization_gaps` and `copy_reuse` are `copy_review` with checks `audit`, `variants`, `personalization` or `reuse`; `winning_steps` is `step_funnel` with view `winners`; `person_summary`, `cross_channel_lead` and `account_summary` are `person` with view `summary`, `timeline` or `account`; `dropped_replies` is `unanswered_replies`.
  - `RENAMED_TOOLS` is no longer exported from `outbound-sdk/cli`. `initialize` now says, once, which listed tool answers each of those names (such as `bounce_watch is sender_health with checks ["bounces"]`), so an agent that knows a CLI insight name is not stuck, but a call by that name is refused.
  - `--tools` still takes one of those names, to offer the listed tool with only that view or check. The SDK's own tools (`createTools`), the insights and `outbound insight` keep their names.
- fd5a795: Read bounces and HeyReach auto-replies with fixed rules, and keep the rules' own verdict beside the vendor's flag (OUT-195).

  - Messages and replies carry `rule: { autoReply, bounce, reason }`, the fixed rules' verdict, on every adapter that reads received mail. It is kept even when the vendor's flag decides `isAuto`, so a reply the vendor calls a person but a rule calls an out-of-office can be found.
  - New bounce rules: a `mailer-daemon@` or `postmaster@` sender, an `Undeliverable:` or `Delivery Status Notification` subject, and a body such as "could not be delivered" or an SMTP code like `550 5.1.1`. A bounce still sets `isAuto`.
  - HeyReach messages and replies now get `isAuto`, `isAutoSource: "rule"` and `leftCompany` from the fixed rules. HeyReach flags no message as automatic, and its Generic auto-tag mixes an out-of-office with neutral answers.
  - `detectAutoReply`, `detectBounce` and `AUTO_REPLY_WITHIN_MS` are exported, so a caller can run the same rules on its own text.
- 1124a20: A scoped `sync.run` says what of the inbox it left out (OUT-203). HeyReach inbox conversations tied to no campaign cannot be matched to a campaign scope, because a conversation does not name its campaign (checked against HeyReach's docs and live on 2026-11-23). A scoped sync of `replies` or `messages` on a tool with such an inbox now notes that they were left out, and `scope.inboxLeftOut` is `null`, an unknown count; it is `0` where the tool has no inbox or the collection has none.
- 906bb68: `sync.run` takes the campaign scope, and `resolveScope` is public (OUT-202).

  - `outbound.sync.run(collection, { tag | campaign_name | campaign_ids, onPage })` syncs only the scope's campaigns, found before any per-campaign read as every insight finds them. Each campaign keeps its own checkpoint, keyed by its ref, and `maxPages` counts pages across them. The result's `scope` says how the campaigns were found and what each synced. Senders shared by several campaigns are handed out once per run.
  - `resolveScope(outbound, scope)` from `outbound-sdk` returns the campaigns a scope covers, with `meta.tools` saying for each tool whether they were read by id, filtered by the vendor, or matched here.
  - A tag where campaigns carry no tags is `Unsupported`, and a malformed scope, an empty one for `resolveScope`, or a scope with `campaignId` `Invalid`, before any request.
  - `CampaignScopeInput`, `ResolvedScope`, `ResolvedScopeMeta`, `ScopeTool`, `ScopeFilter`, `SyncScopeResult` and `SyncCampaignResult` are exported.
  - **Moving a per-campaign sync to a scope starts those campaigns over (OUT-210).** A checkpoint is keyed by the `campaignId` as given, and a scope gives each campaign's ref (`provider:workspace:id`). A campaign you synced with its bare vendor id, as `campaignId: "12345"`, has no checkpoint under its ref, so the first scoped run walks it again from the start and `onPage` gets its records again: upsert by `ref`, as for any replayed page. A campaign you synced with its ref as `campaignId` keeps its checkpoint. Unscoped runs keep theirs.

### Patch Changes

- 56652cd: A custom insight's input type takes the campaign scope (OUT-204). `defineInsight` already added `campaign_ids`, `tag` and `campaign_name` to the schema at run time, but not to the type, so `runInsight(outbound, definition, { tag: "client-a" })` failed with TS2345 for an input schema of `z.object({})`. It type-checks now, and a scope key of the wrong type is still refused. The scope's keys are exported as `CampaignScopeInput`.
- 63c25a8: HeyReach: a campaign HeyReach lists but can no longer open no longer fails every reply and message listing (OUT-206). HeyReach answers 400 "The campaign you are trying to open does not exist." for a conversation filter naming such a campaign, alone or with others. The adapter now leaves that campaign out of its walk over the workspace's campaigns, and out of the filter that sets apart the inbox's own conversations. Any other 400 still fails the call.
- c8f4a5d: A scoped insight keeps `evidence: "exact"` again when its tag or name was matched on our side (OUT-205). Where the vendor cannot filter its campaign listing, the listing is read whole and the scope's fixed rule picks the campaigns, so `clientReport({ days: 7, tag: "client-a" })` on `memory` with `demoData()` answers `exact`, as in 0.17.0, not `derived`. The note still says the listing was filtered here. A read that is derived for its own reason still makes the answer `derived`.

## 0.18.0

### Minor Changes

- 6b840ea: Filter campaign listings by name and tag (OUT-199). `campaigns.list` and `campaigns.listAll` take `name` (campaigns whose name contains the text, ignoring case) and `tag` (campaigns that carry the tag, ignoring case). Two new capabilities say who filters: `campaigns.byName` and `campaigns.byTag`, each `server`, `client` or `false`.

  - Instantly filters both on its side: `search` for the name, and `tag_ids` after looking the tag up by name.
  - HeyReach filters the name with `keyword`. Its campaigns carry no tags, so `tag` throws `Unsupported` before any request.
  - EmailBison filters the tag with `tag_ids[]`; the name is matched after the listing.
  - Smartlead returns every campaign in one listing, which is then filtered.
  - Instantly campaign listings no longer drop tags: a page of 100 campaigns whose tag assignments filled a page lost the rest (5 of 110 campaigns live), because Instantly's next page of assignments came back empty. Such a page is now read again in halves.
  - The wrapper checks every campaign against both filters whatever the vendor did, so a looser vendor search never widens the answer. An empty `name` or `tag` is refused with `Invalid`.
- 325c86d: A campaign scope on every insight (OUT-200). Each insight takes `campaign_ids`, `tag` and `campaign_name` (an exact name, a glob with `*` and `?`, or `/regex/`), and reads only the campaigns matching every one given, together with its own filters such as `statuses`.

  - The scope is applied before any per-campaign read. Ids are read by id with no listing; a tag or a name is sent to the vendor where it filters its listing (`campaigns.byTag`, `campaigns.byName`), and matched after the listing elsewhere. `meta.notes` says how many campaigns matched and which side filtered.
  - A tag where campaigns carry no tags, such as HeyReach, is refused as `Unsupported` before any request. A malformed scope is `Invalid`.
  - Under a scope no other campaign's rows are read: a `campaign` outside it is refused, replies, senders and leads are read per campaign, and workspace totals are the scope's campaigns added up, each with a note.
  - `client_report`'s own `tag` input is now this scope's `tag`, and `campaign_ids` and `campaign_name` narrow it too.
  - `outbound insight` takes `--campaign-ids`, `--tag` and `--campaign-name`. On `outbound mcp` the three are keys of each insight's `scope`, not inputs of their own.

## 0.17.0

### Minor Changes

- dc90cb1: Say "unknown" instead of a false 0 for unanswered replies, and join one person's email and LinkedIn replies (OUT-178).

  - `droppedReplies` (MCP `unanswered_replies`, old name `dropped_replies`): `totals.dropped` is now `null` while any conversation went unchecked or more replies were left unread, and the new `totals.droppedFound` counts the dropped conversations found, a lower bound. A new `finding` sentence leads with what went unchecked. This follows `suppression_check` and `lead_collisions`. Code that read `totals.dropped` as a number must handle `null`.
  - `reply_samples` with `by: "person"` reads the listed people's leads (one request per lead, or per page of leads), so each row carries `linkedinUrl` as well as `leadEmail`, with `leads` and `tools`. On an instance reading two or more tools, rows that share an email address or LinkedIn profile are joined, so a person who replied by email in one tool and on LinkedIn in another is one row; the answer adds `linkedBy` (the identifier types two or more tools carry, from the leads read and what each vendor fills) and `linkedAcrossTools`, and a note says what joined them or that nothing could. Under redact a profile gets one token in both tools, so masked rows still join. The CLI's `replies --by person` is unchanged.

### Patch Changes

- 0512864: Check most unanswered replies within the MCP time budget on Instantly (OUT-179).

  - A combined instance (`--provider all`) listing replies newest first no longer reads a waiting tool's page again for each page of another tool within one walk. On Instantly with HeyReach, that re-read the second page of replies until Instantly's emails lane was spent, so `unanswered_replies` checked 0 of 18 conversations live. It now holds that page for the rest of the call (`AdapterContext.remember`), and nothing outlives the call.
  - New capability `messages.latestOfConversation` and messages filter `latestOfConversation: true`: only the latest message of each conversation that holds a reply, sent or received. Instantly serves it with `latest_of_thread`; the other adapters do not.
  - `droppedReplies` (MCP `unanswered_replies`) uses that listing to settle every answered conversation without reading it, on each tool of a combined instance that has it, and reads the rest in full, longest waiting first. When the time budget or a request cap stops those reads, a conversation whose latest listed message is the person's reply is still counted as dropped, with `checkedBy: "latest"`, its `hoursWaiting` counted from that reply and a note to read it with `thread_context`.
  - An Instantly read of one conversation, or of the latest emails, ends at a page that is not full, so it no longer spends a request on the empty page Instantly answers after a last page.
  - The old MCP tool names from 0.16.0 now answer until 0.18.0, one release longer than announced: their note in `meta.notes` says "kept until 0.18.0". Nothing is removed in 0.17.0.

## 0.16.0

### Breaking changes

These are minor bumps while the package is below 1.0, but code or scripts that rely on the old behaviour need a change:

- **`outbound mcp` and `createMcpServer` list merged tools** (OUT-168). 36 tools become 23: neighbours answer as one tool picked by `view` or `checks`, such as `campaigns`, `sender_health` and `person`, and `dropped_replies` is now `unanswered_replies`. Every old name still answers as it did until 0.17.0, with a note naming how to call it now; `RENAMED_TOOLS` from `outbound-sdk/cli` maps each one. A client on protocol 2025-06-18 now gets the answer in `structuredContent` and a short summary as the text.
- **The built-in tools answer in camel case** (OUT-166): `reply_rate` is `replyRate`, `runway_days` is `runwayDays` and so on, with no snake case copies. Tool inputs stay snake case. A failing sender's `impact.activeCampaigns` holds campaign refs only, and each campaign appears once in a top-level `campaigns` list.
- **`reply_samples` with `by: "person"` counts people for `limit`** (OUT-169), so the same call can read more replies, and spend more requests, than before.

### Minor Changes

- ea0ac54: Polish CLI and tool rough edges from the 0.12.0 user tests (OUT-169).

  - **`reply_samples` with `by: "person"`**: `limit` now counts people, not messages, so `limit: 20` lists 20 people when that many replied. The walk reads on until the next person's reply, up to 10 messages per person asked for, and `meta.notes` says where it stopped. This changes behaviour: the same call can now read more replies, and more requests, than before. `by: "message"` is unchanged.
  - **`variant_test`** returns a `finding` sentence on every answer. When every step has one variant it says so ("No step has two variants to compare") instead of an empty list with zero totals and nothing else.
  - **Campaign names**: after an exact name (ignoring case), a name with a word that begins with the text is preferred over one that merely contains it, so `UG` no longer matches `Mug buyers` when `UG founders` exists. The refusal for several matches still lists how many and which, and now says a ref also skips reading every campaign.
  - **Dates on the CLI**: `--from`, `--to` and `--since` each take a day (`YYYY-MM-DD`) or an ISO 8601 date and time with its offset, and refuse anything else with one message. `--from`/`--to` given a time count the UTC day it falls on. `--since` no longer accepts forms like `11/10/2026`, which `Date.parse` used to read in local time.
  - **`outbound tools | head`** and any reader that closes the pipe early: the CLI exits 0 quietly instead of printing an unhandled `EPIPE` stack.
  - **`meta.computedAt`** on an insight is when the answer was finished, not when the run started. With `now` passed (meant for tests) it stays that time.
- ea0ac54: `outbound mcp` and `createMcpServer` list fewer, smaller tools, and send each result once (OUT-168). **Breaking for MCP clients**: `tools/list` names change, and the result text is now a summary. Every old name keeps working until 0.17.0.

  - Neighbouring tools are merged into one, picked by `view` (one answer) or `checks` (several, each under `data.<check>`): `campaigns` (campaign_overview, campaign_ranking, campaign_trend), `sender_health` (sender_health, deliverability_check, warmup_readiness, domain_health, bounce_watch), `sender_capacity` (sender_capacity, sender_load), `lead_runway` (lead_runway, pipeline_forecast), `list_hygiene` (suppression_check, lead_collisions), `copy_review` (copy_audit, variant_test, personalization_gaps, copy_reuse), `step_funnel` (step_funnel, winning_steps) and `person` (person_summary, cross_channel_lead, account_summary). `dropped_replies` is now `unanswered_replies`, and `include: "thread"` puts each reply's conversation in its item. With `--provider all` and redact, `tools/list` goes from 36 tools and 84,528 bytes to 23 tools and about 55 KB, and a test keeps it under 56,000 bytes.
  - **Aliases.** A call to any old name runs the tool it was, as it was, with a note in `meta.notes` naming how to call it now. `--tools` and `outbound tool` take old and new names. `RENAMED_TOOLS` from `outbound-sdk/cli` maps each old name to its replacement. The SDK's own tools, insights and CLI insight names are unchanged.
  - **One copy of each result.** A client on protocol `2025-06-18` gets the answer in `structuredContent` and a short summary as the `content` text; an older client still gets the whole answer as text. Every tool declares the answer envelope as `outputSchema` (`OUTPUT_SCHEMA`).
  - **scope.** Every listed tool takes `scope: { provider, workspace }`, and `tag` where the tool can read one campaign tag. `initialize` names what the server reads, says once how to read `meta.complete` and `meta.notes` instead of in every description, and points bulk exports to the CLI's `--jsonl` or the SDK.
  - **person under redact** is always listed: its timeline and account views answer with the masked summary view and a note, instead of the tools being left out.
  - **Shorter descriptions.** Every tool and insight description is at most 600 characters; caveats that apply to one answer now come as notes on that answer. `createTools` and `insightTools` take `answerNote: false` to leave out the shared sentence on `meta.complete`.
- ea0ac54: **Breaking: the built-in tools answer in camel case, like insights, and every record they return names its tool and workspace (OUT-166).** Tool inputs stay snake case: snake case goes in, camel case comes out. A stored tool result from an earlier version keeps the old names, and [cards](/docs/cards) read only the new ones.

  Renamed answer fields, old to new:

  - `campaign_overview`: each campaign's `name` is `campaignName`, as in insights. In `metrics` (also in `winning_steps`): `reply_rate` → `replyRate`, `reply_rate_basis` → `replyRateBasis`, `positive_reply_rate` → `positiveReplyRate`, `bounce_rate` → `bounceRate`, `connections_sent` → `connectionsSent`, `connections_accepted` → `connectionsAccepted`.
  - `winning_steps`: `step_index` → `stepIndex`, `step_number` → `stepNumber`.
  - `reply_samples`: `unique_people` → `uniquePeople`, `unique_threads` → `uniqueThreads`; each reply's `category_source` → `categorySource`, `is_auto` → `isAuto`, `lead_email` → `leadEmail`, `received_at` → `receivedAt`; each `by: "person"` row's `first_at` → `firstAt`, `last_at` → `lastAt`, `lead_email` → `leadEmail`, `thread_ids` → `threadIds`.
  - `lead_runway`: `active_leads` → `activeLeads`, `contacted_per_day` → `contactedPerDay`, `counted_leads` → `countedLeads`, `in_sequence` → `inSequence`, `not_started` → `notStarted`, `runway_days` → `runwayDays`.
  - `compare_clients`: `reply_rate` → `replyRate`.
  - `cross_channel_lead`: each timeline message's `is_auto` → `isAuto`, `sent_at` → `sentAt`; each record's and link's `workspace` → `workspaceId`.
  - `campaign_setup`: `daily_limit` → `dailyLimit`, `daily_new_leads` → `dailyNewLeads`, `end_date` → `endDate`, `gap_minutes` → `gapMinutes`, `plain_text` → `plainText`, `start_date` → `startDate`, `stop_on_auto_reply` → `stopOnAutoReply`, `stop_on_reply` → `stopOnReply`, `track_clicks` → `trackClicks`, `track_opens` → `trackOpens`.
  - `audience_lists`: each list's `created_at` → `createdAt`.
  - `sender_health`: each sender's `daily_limit` → `dailyLimit`, `warmup_enabled` → `warmupEnabled`, `warmup_score` → `warmupScore`.
  - `deliverability_check`: `with_problems` → `withProblems`; `coverage.not_checked` → `coverage.notChecked`, `coverage.not_checked_by_reason` → `coverage.notCheckedByReason`; each sender's `not_checked` → `notChecked`, `checked_at` → `checkedAt`, `warmup_inbox` → `warmupInbox`, `warmup_score` → `warmupScore`, `warmup_spam` → `warmupSpam`, `warmup_spam_rate` → `warmupSpamRate`.
  - A failing sender's `impact` in `sender_health` and `deliverability_check`: `active_campaign_count` → `activeCampaignCount`, `active_campaigns` → `activeCampaigns`, `last_authenticated_at` → `lastAuthenticatedAt`, `last_sent_on` → `lastSentOn`, `recent_sends` → `recentSends`, and the same names as keys of `impact.unknown`.
  - Reply and message text wrapped as untrusted (`reply_samples`, `cross_channel_lead`, `vendor_read`, and `threadContext`'s `snippet`): `untrusted_content` → `untrustedContent`. The `UntrustedContent` type changes with it.

  **Breaking: a failing sender's campaigns are listed once.** `impact.activeCampaigns` now holds campaign refs only, and each campaign appears once in a new top-level `campaigns` list of `sender_health` and `deliverability_check`, with `campaign`, `campaignName`, `provider` and `workspaceId`. Senders in a shared pool used to repeat the same campaigns under every failing sender.

  **Every record says where it came from.** These rows now carry `provider` and `workspaceId` beside their ref: `campaign_overview` campaigns, `reply_samples` replies and `by: "person"` rows, `sender_health` and `deliverability_check` senders, `audience_lists` lists, `cross_channel_lead` timeline messages, and the `campaign_setup` and `lead_runway` answers. `outbound replies --by person` rows (`ReplyPerson`) carry them too: a person whose replies span two tools is one row, which names the first one's, as `leadRef` does.

  **One step id.** A step is `stepIndex` (from 0) with `stepNumber` (from 1) for display, as the naming rule says. The bare `step` on `winning_steps` rows and on insight steps, `stepFunnel`'s `topStep` and `lastStepEarningPlace`, and `personSummary`'s `lastStep` and `repliedSteps` are still there as deprecated copies; removing them is left to its own change. They were due to go in 0.8.0.

### Patch Changes

- ea0ac54: Shorter descriptions for the ops insights (OUT-168). `client_report`, `period_comparison`, `campaign_diagnosis`, `campaign_ranking`, `channel_mix`, `tag_rollup`, `anomalies` and `pipeline_forecast` each describe themselves in under 600 characters. The caveats they dropped are said in the answer where they apply: `period_comparison` and `client_report` add a note when a reply rate falls back to leads contacted, and `channel_mix` and `tag_rollup` add one when every reply rate divides by messages sent.
- ea0ac54: Shorter descriptions for the people insights (OUT-168). Each insight's description is now under 600 characters, and each input's description is one short sentence. The caveats that were cut now appear as notes on the answers they apply to:

  - **`dropped_replies`** says how many replies it set aside as outside every campaign (`totals.notInCampaign`) and that `include_inbox: true` checks them.
  - **`lead_collisions`** says how many people it counted in `totals.pastOverlaps` without listing them while `include_past` is false.
  - **`suppression_check`** says how many block-list matches it counted in `totals.alreadyStopped` because the lead's status is outside `lead_statuses`.
- 4d5f972: An MCP tool call that stops because the vendor's rate window is full, with time left in its budget, now says when to call again instead of "do not call again". Right after one tool used up Instantly's 20 email reads a minute, the next tool used to fail at once with `retryable: false` and advice to ask for less. It is now answered with `retryable: true`, `error.retryAfterMs` and a `next` to call again with the same input once the window frees. Every `RateLimited` tool failure also carries `error.limit` (`vendor`, `call` or `run`), so a model can tell the vendor's limit from a cap of its own, such as `--max-requests`, without reading the message.

## 0.15.0

### Breaking changes

These are minor bumps while the package is below 1.0, but code or scripts that rely on the old behaviour need a change:

- **`campaign_diagnosis` reports a campaign with no active leads as `out_of_leads`** (OUT-174), as `client_report` does. A campaign with no leads at all used to show as `no_recent_sends`.
- **`client_report` can come back partial on Instantly** (OUT-175) when a campaign's skipped leads cannot be counted, where it used to read as complete with only a note.

### Minor Changes

- Instantly fills `progress().skipped`, and `campaign_diagnosis` and `client_report` flag campaigns with many skipped leads (OUT-175).

  - `campaign(id).progress()` on Instantly now counts `skipped`: the leads with status -3 among those Instantly has not contacted (`POST /leads/list` with `FILTER_VAL_NOT_CONTACTED`), at most 50 pages. Past the cap it stays `null` with a note giving the minimum, never a low count.
  - `campaign_diagnosis` gains a `many_skipped_leads` finding, and `client_report` a `manySkippedLeads` section and `check_skipped_leads` actions. Both fire when skipped leads are over `max_skipped_share` (5% by default) of a campaign's leads and at least `min_skipped` (100). This usually means a block list or a duplicate rule keeps out leads meant to be sent to.
  - `client_report` is marked partial, naming the campaigns, when a campaign's skipped leads cannot be counted.

### Patch Changes

- f94de44: `campaign_diagnosis` counts lead runout from active leads only, as `client_report` does (OUT-174).

  - When sends fell or stopped, it now reads only the campaign's active leads where the tool lists them alone (`leads.byStatus`), through the same read `client_report` and `lead_runway` use. A campaign with thousands of finished leads is no longer cut off at `max_leads` before its active ones are counted, so a campaign that ran out of leads is reported as `out_of_leads` instead of `no_recent_sends` or `falling_sends`.
  - An empty listing of active leads means none is left to start, so it reports `out_of_leads`, as `client_report` does.
  - When `max_leads` still stops the read, `notChecked` says that lead runout was not checked and how to raise the cap. So does an adapter that cannot list a campaign's leads.

## 0.14.0

### Breaking changes

These are minor bumps while the package is below 1.0, but code or scripts that rely on the old behaviour need a change:

- **A listing cut off by `--limit` exits 3** (OUT-160). It used to exit 0 while more records existed. A script that treats any non-zero exit as failure should accept 3 or read `meta.complete`.
- **`--card` and `--slack` print without the envelope** (OUT-164). `--card` prints the card as text and `--slack` prints the Slack message's JSON alone, where both used to sit inside the envelope's `data`.
- **`outbound mcp` answers a tool call at a 50-second time budget** (OUT-154). A call that used to run for minutes now returns what it read with `meta.complete: false`, or `RateLimited` from a built-in tool, unless you raise it with `--time-budget <seconds>` or `timeBudgetMs`.
- **`stats({ scope: "sender" })` without an id lists every sender** (OUT-163). It used to fail with `Invalid`; where the vendor cannot list senders' stats it is `Unsupported` before any request.
- **Instantly daily stats rows carry `timezone: "UTC"`** (OUT-167), where they used to carry `null`.

### Minor Changes

- 7595c47: Make the CLI a loader, and the data path say what it costs (OUT-160, OUT-161, OUT-163, OUT-164).

  - **`--jsonl`** on every listing (`leads`, `campaigns`, `senders`, `lists`, `replies`, `tags`, `blocklist`, `webhooks`, `thread`) and on `stats` prints one record per line as each page arrives, then one `{ meta, ok }` line with `meta.records`.
  - **`--cursor`** resumes a listing from the `meta.cursor` an earlier run printed. Pages are read at `--limit`'s size, so a resumed run repeats no record; where it must, `meta.repeats` says how many.
  - **Exit code 3** when `--limit` stops a list while more records exist. This changes behaviour: such a run used to exit 0. A script that treats any non-zero exit as failure should accept 3 or read `meta.complete`.
  - **`leads --since`** keeps the leads created since a time, reading the whole window up to 2,000 by default, as `replies --since` does. Where the vendor cannot filter by date (Instantly's leads), a note says it costs a full walk.
  - **`stats({ scope: "sender" })` without an id** lists every sender and reads them in batches where the vendor allows it (`stats.bySenders`; Instantly, 200 mailboxes a request), instead of failing with `Invalid`. Elsewhere it is `Unsupported` before any request. The CLI's `stats` takes `--scope workspace|campaign|sender` and `--sender ID`.
  - **`SyncResult`** carries `requests`, `throttledMs`, `filter` (`server`, `client` or `none`) and `notes`. A run the SDK filtered after reading every record says so, with its cost.
  - **`--card`** prints the card as text, `--slack-text` as Slack mrkdwn for the composer, and `--slack` the Slack message's JSON alone, without the envelope, so it pipes to a webhook. `toText(card, { style })` in `outbound-sdk/cards` does the same in code. This changes `--card` and `--slack` output, which used to be the card or message inside the envelope's `data`.
  - A card shows every ranked action, such as `client_report`'s, before any other list, so the eight-row cut never hides one.
- 511b164: Link one person across tools honestly (OUT-157, OUT-159).

  - `person()` and `cross_channel_lead` keep each message once. A vendor that uses one lead id in every campaign (Smartlead) no longer repeats a person's timeline once per campaign, and each ref's timeline is read once. `cross_channel_lead` timeline entries name their `campaign` and `is_auto`, and a note says how its counts differ from `person_summary`'s.
  - `person()` returns `links`: per tool, the identifier types it fills, those it can be searched by, and whether it holds the person (`linked`, `absent` or `undetermined`). A tool that can be searched by none of the person's identifier types is `undetermined`, never absent; `cross_channel_lead` and `person_summary` mark that answer incomplete and name the tool.
  - New `outbound.identifiers()` on the identity plugin (no request) and `leadIdentifierCoverage(leads)` from `outbound-sdk/identity` say which identifier types each tool carries and which two or more share. Empty `shared` means no one can be linked across tools.
  - `leadFields` takes a list of candidate custom field names, tried in order, such as `{ linkedinUrl: ["linkedin_profile", "linkedin_url"] }`. `fromEnv` takes `leadFields` and reads `OUTBOUND_LEAD_FIELDS` (JSON), and a CLI or `outbound mcp` config file can export `leadFields`.
  - With no `leadFields.linkedinUrl`, a lead's custom field named like a LinkedIn profile (`linkedin`, `linkedin url`, `linkedin profile` or `linkedin profile url`, ignoring case, spaces, underscores and hyphens) fills `linkedinUrl` when its value is a linkedin.com/in/ URL, so Instantly's `linkedinUrl` grade is now `derived` instead of `false`. An explicit mapping replaces those names.
- 405ea9c: `outbound mcp` keeps a long tool call inside an agent host's timeout (OUT-154).

  - Each tool call has a time budget, 50 seconds by default, counted from when the call arrives; `--time-budget <seconds>` sets another, and `createMcpServer` takes `timeBudgetMs` (`Infinity` for none). A rate-limit wait that would pass it is not started and a read under way is stopped, so an insight answers with what it read, `meta.complete: false` and a note naming the budget and how to get the rest. A built-in tool returns `RateLimited` with the same message. This changes behavior: a call that used to run for minutes now answers at the budget unless you raise it.
  - A `tools/call` with `_meta.progressToken` gets `notifications/progress` every 5 seconds: seconds so far, the budget as `total`, and how long it has waited on rate limits.
  - The server reads messages while a tool call runs: `ping` is answered and `notifications/cancelled` stops the call, which is then not answered. Tool calls still run one at a time. `handle` and `handleLine` take an optional `notify` for progress.
  - Throttle messages name the vendor's published limit apart from the rate this process keeps to, as "Instantly's emails rate limit (20 a minute; this process reads up to 10 a minute)". `ThrottleEvent` gains `declared`, the published windows.
- 3e5264d: Stats rows add `meetingsBooked`, the vendor's count of meetings booked (OUT-162). Instantly fills it from `total_meeting_booked` on one campaign's total and the workspace total; every other row, and every other adapter, has it `null`, and `outbound.fields.metricRow.meetingsBooked` is `false` on Smartlead, HeyReach and EmailBison. `periodComparison` and `clientReport` carry it in each period's numbers and in `change`, never filled from opportunities or positive replies, with a note when it is `null` or counts only some campaigns.

  Warehouse loads get a stable schema (OUT-167). `export()` takes `record` (such as `"reply"` or `"metricRow"`) and then writes every field of that record, `null` where a vendor leaves one out, so files from different vendors share their columns. `outbound-sdk/exporter` adds `recordColumns`, `recordJsonSchema` (JSON Schema of an exported row) and `duckdbTable` (a typed `CREATE TABLE` that `COPY` loads a `.jsonl` export into), all generated from the record schemas. `fillDays(rows, { from, to, fill })` makes daily stats dense: a day the vendor returned no row for gets one with `evidence: "derived"` and counts `null`, or 0 with `fill: "zero"` for the counts the scope reports. Instantly's daily rows now carry `timezone: "UTC"` instead of `null`.

## 0.13.0

### Breaking changes

These are minor bumps while the package is below 1.0, but code or scripts that rely on the old behaviour need a change:

- **Instantly `leadRef` is the lead's own ref** (OUT-149). A message's or reply's `leadRef` used to hold the address (`instantly:<workspace>:<address>`); it is now the ref `leads.list` returns, one per campaign, and the address is in the new `leadEmail`. Join replies to leads on `lead.ref`, and read the address from `leadEmail`. Stored address-shaped refs still read.
- **`suppressionCheck` and `leadCollisions` totals can be `null`** (OUT-148). When a cap left campaigns, leads or block entries unread, `totals.violations` and `totals.collisions` are `null` instead of 0. Read `violationsFound` and `collisionsFound` for what was found, and treat `null` as unchecked, not clean.
- **`outbound mcp --tools` exits 1 for a tool the server leaves out** (OUT-152). It used to serve and answer the call with the reason; it now refuses before serving, with `Unsupported` and the reason on stderr.
- **Hashed redact tokens change when a key is set** (OUT-150). `strategy: "hash"` with `OUTBOUND_REDACT_KEY` set or a `key` given writes an HMAC under it, so re-load a store built from the old tokens once.

### Minor Changes

- a8ce663: `--provider all` and redact now offer every tool one of their tools can serve, and the CLI's catalogs agree (OUT-152, OUT-153).

  - A combined instance reads a conversation by thread id: `outbound.thread(id)`, the `threadId` filter and `thread_context` by `threads` ask each member that reads threads, and `messages.byThread` is on when any member has it.
  - `insightTools` and `createTools` take `members` (from the new `membersOf(outbound)`). With it a tool that takes a `campaign` is offered when one member can serve it, and refuses another member's campaign before any request; an insight that reads every campaign is offered when exactly one member can, and answers for that member with `meta.complete: false` and a note. The CLI and `outbound mcp` pass it, so `step_funnel`, `variant_test`, `copy_reuse`, `settings_audit`, `winning_steps` and `campaign_setup` are back on `--provider all`.
  - `person_summary` stays offered under redact. With both identifiers masked it looks up a lead ref by the tokens redact wrote, and answers masked; a bare address or profile URL is refused with what to give instead.
  - `outbound tools`, `outbound insight` and `outbound mcp` read one catalog. The list commands name each tool they leave out, with the reason, in `meta.notes`; `outbound insight` lists only what the instance offers. **Breaking:** `--tools` refuses a left-out tool with its reason and exits 1, and `outbound mcp` names the tools another setting would offer.
  - A `next` inside an insight's answer, such as a finding's, no longer names a tool that is not on offer, and an `Unsupported` insight call's `next` says what to change instead of "Try another tool".
- f210528: **Breaking:** `suppressionCheck` and `leadCollisions` read every campaign in the statuses by default (`max_campaigns` 200, `max_leads_per_campaign` 1,000, `max_block_entries` 10,000) and lead with coverage: a new `finding` sentence says what was checked, and when a cap left campaigns, leads or block entries unread, `totals.violations` and `totals.collisions` are `null` instead of a bare 0, with `violationsFound`, `collisionsFound`, `moreCampaignsExist` and `campaignsWithMoreLeads` beside them. `copyAudit` no longer marks itself incomplete for a `max_leads` cap that still gave it its samples. (OUT-148)

  Insights keep their partial answer by default when a request cap or a `budget()` stops them part way: `partialOnCap` is now opt-out (`false`), so `--max-requests` returns what was read with `complete: false` and a note instead of throwing it away. The run budget's message says it is a cap you set, not the vendor's rate limit. Reads that failed now count toward `meta.requests`. (OUT-156, OUT-151)
- 85a777c: **Breaking:** an Instantly message's or reply's `leadRef` is now the lead's own ref, the one `leads.list` returns, so replies join to leads by ref; the address moves to a new `leadEmail` field (OUT-149). A redacted token from another session or process is refused on every read, before any request (OUT-151).

  - An Instantly email names its lead by address only, so each page of emails now looks up its leads' ids with one `POST /leads/list` per 100 addresses, on the default lane, matched by the email's campaign. A page of replies or messages costs one more request than before. A lead's timeline needs no lookup, and reads the lead's own campaign.
  - A lead is one per campaign, so one person in two campaigns now has two `leadRef`s. `reply_samples` and `outbound replies` count and group people by `leadEmail` where it is present, and their records carry `lead_email` / `leadEmail`.
  - `leadRef` is `null` when no lead has the address, for example a deleted lead. `leadEmail` still names the person.
  - Migration: code that joined an Instantly reply to a lead on `lead.email` can join `reply.leadRef` to `lead.ref`; code that read the address out of `leadRef` reads `leadEmail`. Stored address-shaped refs still work in `outbound.lead(ref)`, `leads.get`, `person_summary` and `thread_context`. The other adapters leave `leadEmail` out and their `leadRef` is unchanged.
  - Under redact, `leadEmail` is masked like `email`. A call that names a token the plugin did not write, such as one kept from an earlier CLI command or MCP session, is refused as `NotFound` before any request, so it never reaches the vendor; the message says it is from another session or process and that redact's `key` (or `OUTBOUND_REDACT_KEY`) keeps tokens the same across runs.
- 74b8f05: `redact()` reads its key from `OUTBOUND_REDACT_KEY` when you pass no `key`, as the CLI and `outbound mcp` already did, so one key gives the same token for the same person in your code, the CLI and the MCP server. A `key` you pass still wins, and a key shorter than 32 characters from the variable is refused with `Invalid` naming the variable, never the key. A `redact()` in a CLI config file now reads the variable too, so the CLI no longer warns that it is ignored. (OUT-150)

  `strategy: "hash"` now takes the key and writes an HMAC-SHA-256 under it, so a hashed token can no longer be computed from a guessed address. **If you hash with `OUTBOUND_REDACT_KEY` set, every hashed token changes:** re-load a store built from the old tokens once. `hash` with no key still works as before but is deprecated: it warns once per process on stderr, and every answer that holds a token carries a note in `meta.notes`. A `mask` redact with no key notes on such answers that its tokens hold only within this instance or process. `REDACT_KEY_ENV` is exported from `outbound-sdk/redact`. (OUT-150)
- 85a777c: `droppedReplies` counts only conversations a person owes, automatic replies are counted apart wherever a category is counted, and `threadContext` says when it could not read something (OUT-146, OUT-151), and `droppedReplies` keeps what it read at a request cap (OUT-156).

  - `droppedReplies` no longer lists a conversation whose latest message, once read in full, is an automatic reply. A reply listing cannot time a reply against the send it answers, so an Instantly reply that arrived within a minute of the send used to pass as human and be counted as dropped. Its replies now count in `totals.skippedAuto`, with a note, and `totals.conversations` leaves it out. `include_auto: true` still lists it.
  - `droppedReplies` at a request cap (`maxRequests`, `--max-requests`) returns what it read with `meta.complete: false` and a note, instead of throwing `RateLimited`. The conversations the cap stopped count in `totals.unchecked`, never as answered or dropped.
  - `reply_samples` and `outbound replies` count the replies flagged automatic in a new `automatic` field, on the totals and on each `--by person` row (`null` when a reply's `isAuto` is unknown), and the CLI note says how many of the messages are automatic. A vendor can label an automatic reply positive.
  - `threadContext` sets `meta.complete: false`, with a note, whenever a conversation or a lead could not be read. It used to say `complete: true` with every conversation in `coverage.unchecked`.
  - `threadContext` refuses a redacted ref its redact plugin did not write, such as one from an earlier MCP server or CLI run, with `NotFound` before any request and a message saying to run the tool that returned it again in the same session. The token used to reach the vendor as the lead id and come back as `the read failed with Invalid`.
  - Under redact, `threadContext`'s `bodies` defaults to `none` instead of refusing its own default. Asking for `snippet` is still `Unsupported`.
- 5d2f693: One runway calculation for `clientReport`, `pipelineForecast`, `campaignDiagnosis` and the `lead_runway` tool (OUT-147). Each campaign's runway now has a state: `draining`, `stalled` (leads left to start but none started in the window, or no daily count of leads started), `out_of_leads` or `unknown`. `daysLeft` and `runway_days` are `null` when the pace is `null` or 0, instead of 0 for a campaign with nothing left to start. `clientReport.runningOutOfLeads` entries carry `state` and `inSequence`, and their `remaining` now counts only leads not yet started. Stalled campaigns are listed apart in `stalled`, and the action items put every campaign that needs leads in one `add_leads` item and every stalled one in one `check_stalled` item, after the other items. `lead_runway` reads only the active leads where the tool lists them alone, up to 5,000 by default, as `clientReport` does, and adds `state`. `pipelineForecast` adds `runwayState`.

  On a combined instance, `periodComparison`, `clientReport` and `campaignRanking` name each tool with no campaign in `statuses` in `toolsLeftOut`, with its own workspace totals for the period, and a note says when such a tool had sends or replies (OUT-155). `clientReport` takes `provider` (one tool of a combined instance) and `tag` (one client's campaigns). The `campaign_overview` tool notes when its status filter left the list empty.

  `periodComparison` adds `totalBasis` and `workspaceBasis`, and `clientReport` adds `totalsBasis`: what each total covers (the campaigns read, or every campaign in the workspace), and that `replied` and `positive` count leads with automatic replies left out. A note says why the campaigns' total and the workspace totals give different reply counts (OUT-158).

## 0.12.0

### Minor Changes

- 130c7d7: Messages and replies carry `url`, a link that opens the conversation in the vendor's app, and the `reply_samples` tool returns it on each reply. Instantly links to the thread in its Unibox (`https://app.instantly.ai/app/unibox?thread_search=thread:<thread_id>&selected_wks=<organization_id>`), the same link Instantly sends as `unibox_url` on reply webhooks. HeyReach, Smartlead and EmailBison document no link to one conversation, so `url` is `null` there, `outbound.fields` grades it `false` and each adapter's caveats say why. A link is never guessed. Adapters that predate the field may leave it out.
- e4e0497: Numbers tell apart zero, missing, unchecked and stale, and every rate carries its denominator (OUT-141). The contract is written down once, in "What every number carries" on the insights page.

  - `channelMix` and `tagRollup` divide every campaign's replies by one basis, named in the new `replyRateBasis`. A campaign with replies but no lead contacted in the range (on Instantly, a range with only follow-ups) used to be divided by its sends while the others were divided by leads, so one `of` added leads and sends together. Now every campaign is divided by messages sent when that happens, and by leads contacted otherwise.
  - `periodComparison` and `clientReport` add `rates` to each comparison: each period's rates as `{ count, of, rate, low, high }`. A total's plain `replyRate` and `bounceRate` count only the campaigns that report both sides, so the counts beside them were not what they were divided by.
  - `droppedReplies` sets `meta.complete: false`, with a note, whenever a conversation could not be checked, so `dropped: 0` with conversations unchecked no longer reads as a clean answer.
  - `deliverability_check` rows add `warmup_spam` and `warmup_inbox`, the counts the warmup spam rate divides.
  - `campaign_overview` passes on the stats read's notes and `complete`, returns the `period` it read, and says when a campaign's `metrics` is `null` because the vendor reported no stats for it.
  - Every tool result carries `meta.computedAt`, the time its numbers are as of, as an insight's answer already did.
- d5db1c2: `person_summary`, `cross_channel_lead`, `outbound.person()` and `outbound person` accept a lead ref exactly as another tool returned it, an email address or a LinkedIn profile URL (OUT-138). An Instantly reply's `leadRef` (`instantly:<workspace>:<address>`) was taken for an address and sent to Instantly, which answered 400; a ref is now recognised first, and one whose id is already the address or profile is looked up by it with no extra request. The tool and insight take typed `lead_ref`, `email` and `linkedin_url` fields beside `person`; exactly one is given, and a value of the wrong kind, or a ref from a tool or workspace the instance does not read, is `Invalid` before any request. On a combined instance the ref's provider picks the tool it is read from. `person` is no longer marked required in the tools' JSON Schema, since any one of the four fields names the person.
- 4765a79: Sender checks now say what a failing sender breaks and how much they covered (OUT-142).

  - `sender_health` checks every sender in the list (up to 500, was 100 to 200), so a disconnected mailbox past the first page is counted. Each disconnected or failing sender carries `impact`: the active campaigns it sends for, its sends over the last 14 days, the day it last sent, and its last successful sign-in. A value the vendor does not report is `null`, with the reason in `impact.unknown`.
  - `deliverability_check` reports `coverage`: senders checked, senders not checked, and why (`cap`, `unsupported`, `error`), and each row says whether it was checked. A new `max_checked` input sets how many senders are checked in full; `limit` now sets how many are listed. Failing senders carry the same `impact`.
  - New `outbound.senderHealth` collection and `senders.healthList` capability: every sender's health a page at a time. Instantly supports it, at three requests per 100 mailboxes instead of three per mailbox, so `deliverability_check` and `domain_health` check every Instantly mailbox by default.
- 8b9799d: Several senders' stats in one read (OUT-143). `outbound.stats({ scope: "sender", scopeIds })` returns a row for each sender (and each day with `by: "day"`). Each row's `scopeRef` says which sender it belongs to, and a sender the vendor has no rows for gets none. The new `stats.bySenders` capability gates it. Instantly supports it: one `GET /accounts/analytics/daily` reads up to 200 mailboxes, and the workspace's tracking settings are read once for all of them instead of once per mailbox. Other adapters refuse it with `Unsupported` before any request.

  `sender_health` and `deliverability_check` use it to read every failing sender's recent sends at once. On Instantly a failing mailbox now costs only the listing of its campaigns, so impact covers up to 200 failing senders (the cap was 10). Adapters without it still read one sender at a time and keep the cap of 10.
- 0b52b23: Reply and follow-up results now carry the thread's latest activity, so an agent reads the conversation before it calls a reply overdue (OUT-139). `dropped_replies`, `hot_leads` and `person_summary` entries gain `activity` (the latest message, who sent it and when), `meeting` (what the vendor records on the lead), `vendorSentiment` (the vendor's labels, kept apart) and `followUp`, an assessment from fixed rules with its `evidence` and what it left `unchecked`; a label alone never sets `followUp.needed`. A `dropped_replies` finding now names a later latest message and a recorded meeting. The new `thread_context` insight reads the conversations behind given lead refs or thread ids in pages, with 280-character untrusted snippets and coverage (requested, found, not found, unchecked and why, next cursor), without reading every reply of a campaign. Leads gain an optional `meeting` field (`booked`, `completed`, `no_show`, `won`), filled from Instantly's `lt_interest_status`; the other adapters record none. `hot_leads` takes `read_threads` to read each returned lead's conversation.

## 0.11.0

### Minor Changes

- 3d32def: `redact({ key })` takes an optional secret, at least 32 characters, that keys the tokens `mask` writes for email addresses and LinkedIn profiles. With it, the same person gets the same token in every instance and process given the same key, so redacted data joins across runs. The CLI and `outbound mcp` read the key from `OUTBOUND_REDACT_KEY`. A shorter key, or a key given with `strategy: "hash"`, is refused with `Invalid` when the plugin is built. The key is never put in a record, an answer or an error. With no key, nothing changes: each plugin makes a random key of its own. `MIN_KEY_LENGTH` is exported from `outbound-sdk/redact`.

## 0.10.0

### Minor Changes

- 22079e2: `lead_collisions` and `suppression_check` now run while the redact plugin masks email addresses with its default `mask` strategy, and `outbound mcp` offers them with redaction on. They match people on the keyed tokens redact writes. Those tokens are the same for one person across every record and block list entry in a run and can't be reversed without the plugin's key. LinkedIn profiles now match too, because a masked profile's token is written from its slug. `suppression_check` still can't match domain entries while addresses are masked, and says so in a note.

### Patch Changes

- 2e681e2: The redact plugin now puts the real value back for every token in a call's query, not only in its id, so a filter like a lead timeline's `leadId` no longer reaches the vendor as `redacted:…`. This fixes `dropped_replies` with redaction on over a combined instance. `dropped_replies` also counts a conversation whose read fails in `totals.unchecked`, with a note, instead of failing the whole report; a request cap still stops the run.

## 0.9.0

### Minor Changes

- 3120606: `clientReport` counts each active campaign's leads left from its active leads alone, so its default run comes back complete on a workspace with thousands of finished leads per campaign (OUT-131).

  - **Leads by status.** `leads.list` and `leads.listAll` take `status: "active"`: only the leads still in the sequence. It needs the new capability `leads.byStatus`, which Instantly declares (the `filter` `FILTER_VAL_ACTIVE` of `POST /leads/list`). The SDK keeps only the leads it reads as active, whatever the vendor's filter returns. It cannot be combined with `interest`, since Instantly takes one filter at a time.
  - **`clientReport` runway.** Where the campaign's tool declares `leads.byStatus`, only the active leads are read, on a combined instance too. `max_leads_per_campaign` defaults to 5,000 (was 500). On a live Instantly workspace with 24 active campaigns and about 135k leads contacted, the default run went from stopping incomplete after 273 requests to complete in 254.

## 0.8.0

### Minor Changes

- b2cab18: A vendor record the SDK cannot read, such as a sequence step whose delay is below zero, is now a `Provider` error with `retryable: false` (`OutboundError.permanent`), because the vendor returns the same record on every retry. A tool's `next` for it now says to try another campaign or report the field the message names, instead of "Check the input and try again." `OutboundError` takes a new `permanent` option for errors like this one.

  CLI and MCP polish from the 0.7.0 stress test:

  - `--limit -5` and other negative values get the CLI's own message, "Invalid: --limit must be a positive whole number". An option given no value is `Invalid` too, not a bare `Error`.
  - A cap read once per campaign, such as `max_senders_per_campaign`, now puts out one note for all the campaigns it stopped in: "Stopped at 100 senders in 22 campaigns (max_senders_per_campaign); more exist." It used to put out one note per campaign. A custom insight can do the same with the new `per` field of `Cap`.
  - **Breaking for scripts:** `outbound tool <name>` with no `--input` for a tool that needs input now exits 2 with `ok: false` and `error.code: "InputRequired"`, and what the tool takes in `data`. It used to print the schema with `ok: true` and exit 0, which a script could not tell from an answer.
  - `campaign_overview` takes `campaign`, a ref, id or name, like its sibling tools, and then reports only that campaign.
  - `outbound mcp --tools a,b` offers only the tools named. Every tool's description and inputs cost about 60 KB of a client's context in `tools/list` on a real adapter.
- 64d832f: A combined instance (`--provider all`) no longer lets its first tool crowd out the others (OUT-123), and routes a campaign to the tool it belongs to (OUT-126):

  - Listings of campaigns, leads, senders, messages and replies read every tool at once and merge the pages: campaigns, leads and senders one from each tool in turn, messages and replies newest first. A `--limit` or `max` now leaves each tool its share, and `replies --since` lists every tool's replies in time order. **Order change:** these listings used to return the first tool's records to their end, then the next tool's.
  - Insights that read up to `max_campaigns` read each tool on its own and share the cap: a tool with fewer campaigns than an even share keeps them all, the rest split what is left, and a note says how. `channel_mix` now compares email and LinkedIn on an Instantly and HeyReach pair, and `campaign_ranking` includes the HeyReach campaigns.
  - `channel_mix` no longer says "Only email campaigns were found" when `max_campaigns` left campaigns unread; it says the cap stopped the read.
  - A campaign name, or a bare id, given to the CLI, a tool or an insight is looked up across every tool. One match is used; several are refused with their refs.
  - An insight given one campaign runs on the tool that campaign belongs to, so that tool's capabilities apply: `step_funnel` works for an Instantly campaign beside HeyReach, and is refused naming `heyreach` for a HeyReach campaign.
- 5c01540: Default runs on a mid-size workspace come back complete, and a combined instance names a tool it checked nothing in (OUT-109, OUT-121).

  - **A tool with nothing to check is named.** On an instance over several tools, when one tool has no campaign in the states an insight reads while another has some, a note names it and counts its others, such as `heyreach:default has no campaign active, so it was not checked (8 campaigns: 8 completed). Pass statuses to check them.` The answer stays complete for the tools that have campaigns.
  - **`channelMix` reads active, paused and completed campaigns, up to 150, by default** (was active only, up to 50), since a channel's finished campaigns hold most of its evidence. With one channel found, its finding names the states read instead of saying only that channel exists.
  - **`hotLeads` reads up to 2,000 leads labelled positive by default** (was 500).
  - **`clientReport` names the campaigns whose leads left were not fully counted** at `max_leads_per_campaign`, which `runningOutOfLeads` leaves out.
- 91b9ead: HeyReach replies are campaign replies. HeyReach's inbox listing returns the sender's whole LinkedIn inbox, so personal messages, recruiters and inbound pitches used to count as replies, and 14 of 16 "dropped replies" in one live workspace were in no campaign.

  - **Behavior change on HeyReach:** a message's `campaignRef` is now the campaign its conversation belongs to, and `null` only for a conversation in no campaign. `replies.list` and `outbound replies` return campaign replies only. Pass `includeInbox: true` (`--include-inbox`) to get the whole inbox as before. `messages.list` still returns every conversation.
  - A new capability, `replies.inbox`, says a vendor's inbox also holds conversations outside every campaign. It is `true` on HeyReach and `false` elsewhere.
  - `dropped_replies` and `reply_timing` set those conversations aside and count them in `totals.notInCampaign` and `counts.notInCampaign`. Both take `include_inbox` to keep them. On a combined instance each tool's own inbox is set aside, so HeyReach's is left out while another tool's replies are kept.

  HeyReach edge cases:

  - A day's `contacted` is `null` on HeyReach. HeyReach reports 0 on every day and counts unique leads contacted only over the whole range, so adding up the days undercounted. The range's total is unchanged.
  - HeyReach stats take `from` alone and read up to the end of today (UTC), with a note. They used to refuse it.
  - `anomalies` takes `min_count` (default 3). A day is judged only when its count or its baseline mean reaches it, so one LinkedIn reply on a quiet day is no longer flagged.
  - `outbound tool <name>` for a tool this instance leaves out, such as `winning_steps` on HeyReach, now fails with `Unsupported` and names the missing capability. It used to say `Unknown tool`.
- c8bc18a: `hot_leads` starts from the signal instead of walking the lead list (OUT-113). It reads every reply within `recency_days` (new `max_replies` input, default 1,000, a safety ceiling) and, where the adapter can filter by interest, the leads it labels positive, then looks up the leads behind those replies, many addresses per request where the adapter can. On a workspace with about 150 replies in 14 days that is 11 requests and a complete answer, where the old default stopped at 500 leads with four notes. The lead list is walked only where the adapter cannot filter by interest, or with the new `include_engagement_only: true` for open- and click-only leads. A reply in the window fills a lead's reply count and last reply time when its record reports less, so HeyReach and Smartlead leads get recency. A positive label now fades after `recency_days`, to nothing at the new `max_age_days` (default 90), and a lead whose last reply is older ranks after every fresher one. New totals: `repliesRead`, `unreadable` (replied leads that could not be read, instead of a note) and `stale`.

  Two new capabilities back it: `leads.byInterest` (the `interest: "positive"` lead filter) and `leads.lookupMany` (the `emails` lead filter). Instantly declares both.
- ea1fb5e: Insights finish on their default input on a mid-size workspace, and say when they checked nothing (OUT-112, OUT-118, OUT-127).

  - **Senders priced as Instantly reads them.** On Instantly, listing one campaign's senders re-reads the campaign and pages through every mailbox of the workspace, 2 requests a page. `senderCapacity`, `senderLoad`, `bounceWatch`, `settingsAudit` and `campaignDiagnosis` now price that, so their default cap no longer stops them part way. On 303 mailboxes and 24 active campaigns, `senderCapacity` takes about 230 requests.
  - **Default caps leave room.** The default request cap is the most an input can cost, a quarter more for retries and 20 on top (was 4). A stop at the default cap never advises lowering an input by one.
  - **Defaults sized to a workspace.** `senderCapacity` and `senderLoad` read up to 50 campaigns and 1,000 senders (were 25 and 200), and `warmupReadiness` up to 1,000 senders (was 100). `campaignRanking`, `periodComparison`, `channelMix`, `tagRollup` and `clientReport` read up to 50 campaigns (was 25) and only active ones by default; pass `statuses: ["active", "paused", "completed"]` for the old reach. `clientReport` reads one stats request fewer per active campaign.
  - **Nothing to check is not all clear.** When no campaign is in the states an insight reads, its answer has `meta.complete: false` and a note counting the campaigns in other states, such as `No campaign is active, so nothing was checked (18 campaigns: 8 completed, 10 draft). Pass statuses to check the others.` `suppressionCheck` is incomplete while any block entry could not be checked.
- 8085885: An insight stopped part way by a request cap returns what it read (OUT-116).

  - **Partial answers.** `senderCapacity`, `senderLoad`, `periodComparison`, `campaignRanking`, `clientReport` and `hotLeads` no longer throw `RateLimited` when their own cap, a `budget()` or `maxRequestsPerCall` stops them mid-run. They return `meta.complete: false` with a note naming the cap, what raises it and how much was read, for example `Read 18 of 24 active campaigns; the answer covers those.` A campaign whose own reads were cut off is left out rather than counted with part of its data. Workspace-wide reads (totals, unusual days, daily sends) now run before the per-campaign reads so they survive a stop. Other insights fail as before, and so does a run whose `campaign`, given by name, could not be looked up among every campaign.
  - **Custom insights.** `defineInsight` takes `partialOnCap: true` to opt in, and the context has `each(items, read, what)` for item-by-item reads that keep what finished.
  - **Wording per surface.** The CLI and `outbound mcp` name `--max-requests` in every cap message, never `maxRequests`, `budget()` or `requestBudget.reset()`. `budget()` takes a `setting` option for that, and `insightTools` takes `capSetting`. A refusal now says "left of the run's budget" instead of "left of budget()'s run".
  - **CLI.** `--max-requests` now replaces an insight's default cap as well as capping the command, so raising it actually lets a capped insight finish.
- b7c2195: A wait on a rate limit is no longer silent. The CLI prints one line on stderr for any wait over 2 seconds, such as "Waiting 60s for Instantly's emails rate limit (10 a minute)…", and every command's `meta` now carries `throttledMs`. An `outbound mcp` tool call that waits more than 5 seconds says so in `meta.notes`. A 429 is reported as "Throttled by Instantly", most likely another process on the same workspace, instead of looking like a hang, and a 429 with no `Retry-After` now pauses the lane until one more request fits (3 s on Instantly's email lane) and counts as throttle time. `onThrottle` events gain `cause` (`budget` or `vendor`) and `windows`. A CLI `--config` file can export `rateLimitStore`, such as `redisRateLimitStore()`, so terminals and MCP servers on one key share one budget.
- 5be88df: A negative step delay from Instantly no longer fails the whole sequence read (OUT-110). Instantly returned `delay: -11` on a live campaign although its reference allows 0 to 527040; the step it applies to now has `delayDays: null`, and the read says why in `meta.notes`, for example "Step 4's delay is negative in Instantly (-11 days); left out." A negative `pre_delay` on a subsequence and a `delay_unit` outside minutes, hours and days get the same treatment. `sequence`, `step_funnel`, `copy_audit`, `copy_preview` and `campaign_diagnosis` answer again for such a campaign, and their notes carry the reason.

  The same rule covers the other values that had to be 0 or more: a negative step delay from Smartlead or EmailBison, a negative daily limit on an Instantly mailbox, and a negative daily limit, new-lead limit or gap on an Instantly campaign's settings. Each becomes `null` with a note, and the rest of the record is read.

  `ResultMeta` gains `notes: string[]`, empty when nothing was left out, and `AdapterContext` gains `note(text)` for adapters to fill it. The notes travel with the answer, so `cache` and `failover` replay them. The CLI's envelope and every insight's `meta.notes` include them.

  `copy_reuse` leaves out a campaign whose sequence or step stats the vendor cannot answer for (a `NotFound` or `Provider` error) with a note and `complete: false`, and returns the rest, instead of failing for the whole workspace. A timeout, a cap or a bad key on either read still fails the insight.
- cd14df2: `redact()` no longer merges everyone into one person. Under the default `mask` strategy an email address or a LinkedIn profile inside a `ref`, a `sourceId`, a `*Ref` field or a person key used to become one shared `[redacted]`, so on HeyReach, whose lead id is the profile URL, `outbound leads --redact` gave 1 lead of 306, `replies --by person` 1 person of 115 and `hot_leads` none; on Instantly every reply named the same lead. It is now `redacted:` and 16 hex characters of an HMAC-SHA-256 under a random key each `redact()` makes and never gives out, so the people counts match the unmasked ones, and no address or profile shows.

  The `email`, `address` and `linkedinUrl` fields, a blocked address or profile, and a webhook event's `leadEmail` and `linkedinUrl` get the same token under `mask` instead of `[redacted]`, so a reply still joins its lead. A token holds while the plugin lives (one CLI command, one `outbound mcp` session) and differs in the next. Names, companies, phones, custom fields and text are still `[redacted]`, and `strategy: "hash"` is unchanged.
- c8bc18a: The redact plugin now remembers, in memory for its own lifetime, the address or profile behind each token it writes, at most the newest 10,000. A call that names one of its tokens reaches the vendor with the value in its place, and the answer comes back masked; a vendor error quotes the token, never the value. `outbound.redacted` gains `resolves(token)`, which says what a token stands for without giving the value, and `leadsByToken(tokens, campaign)`. With these, `hot_leads` under redact reads the lead behind each reply and ranks the same leads it does without redact (OUT-113, after OUT-122).
- 5bf8450: `dropped_replies` reads every reply in its `since` window by default (up to 2,000) instead of stopping at 50, so a dropped reply past the 50th is no longer missed (OUT-115). `max_replies` now defaults to `null` and stays an optional upper bound. On Instantly one listing of the emails sent by hand in the window settles every answered conversation, and only the ones that may be dropped are read in full, so a 14-day window is a few requests instead of one per conversation. With nothing dropped, the card now says how many conversations it could not check, instead of calling the answer clean.

  New `messages.byHand` capability and `byHand: true` filter on `messages.list` and `messages.listAll`: only the messages a person sent by hand, not the ones a campaign sent. Instantly declares it (`email_type=manual`); the other adapters do not.

  `outbound replies --since` reads the whole window, up to 2,000 replies, unless `--limit` is given; without `--since` the default stays 50 (OUT-117).

### Patch Changes

- 8c54786: HeyReach replies are back. HeyReach's conversation listing does not name a conversation's campaign, although its reference says it does, so every reply was left out as "not in a campaign" and unfiltered `replies` returned none. A listing without a campaign now reads each campaign's conversations in turn, so a message's `campaignRef` is the campaign HeyReach filed it under, and with `includeInbox` (and in `messages.list`) the conversations in no campaign follow with a `null` `campaignRef`. This costs one request per campaign, and one more per page of the inbox's own conversations. `replies`, `dropped_replies`, `reply_timing` and `hot_leads` see HeyReach's campaign replies again, on their own and with `--provider all`.

  A combined instance (`--provider all`) no longer re-reads one tool's page forever when that page is not in time order. `replies --by person --provider all` with no `--since` used to run without end.
- c9f75f0: `hot_leads` on HeyReach no longer ranks every replied lead at a flat 10 (OUT-125). A campaign's leads carry no auto-tag, so a lead with no label now takes the interest class the vendor keeps on the lead from its replies (`categorySource: "lead"`), and an Interested tag earns the interest points. With the reply counts and recency from the replies read in the window, the most recent Interested reply ranks first. When replies were read, the note now says only that open and click counts are missing, instead of claiming the vendor reports no reply data.
- 901fce1: `hot_leads` no longer drops recently replied leads silently under the redact plugin, the default for `outbound mcp`. A reply can name its lead by email address (Instantly's do), and a masked or hashed address cannot be looked up at the vendor, so the search for replied leads past `max_leads` found nothing. It now skips that search and says so in `meta.notes` with `complete: false` (OUT-111).

## 0.7.1

### Patch Changes

- 0fcfb85: `outbound update` works in the minutes right after a release. npm lists a new version before it serves the download (0.7.0's tarball returned `E404` for 9 minutes), so a global update failed. It now installs the exact version npm named, and on `E404` or `ETARGET` tries again every 30 seconds for up to 15 minutes, asking the registry afresh each time. Any other npm failure now shows npm's error code and the line that says what went wrong, instead of "A complete log of this run can be found in: ...".

## 0.7.0

### Minor Changes

- e21e9c8: **Breaking:** every CLI command prints one JSON envelope, and every tool reports coverage in one place (OUT-102).

  - **CLI output.** Every command prints `{ ok, data, meta: { complete, notes, provider, requests }, next? }`. A list is in `data.items` instead of a bare array. A record is `data`, with its `meta` lifted into the envelope's `meta`. An insight's answer and a `native` read are `data`, and an insight's name is `meta.insight`. A tool's result keeps `ok`, `data` and `next`. `--card` and `--slack` put the card or the Slack message in `data`. When `--limit` cut a list, `meta.complete` is `false` and `meta.notes` holds the same note standard error gets. `meta.requests` counts the vendor requests the command sent.
  - **CLI failures.** A failure prints `{ ok: false, data: null, error: { code, message }, meta }` on standard output as well as `<code>: <message>` on standard error. `thread` with an id that has no messages, and `leads --campaign` or `--list` naming one that does not exist, now exit 1 with `NotFound`, as `campaign`, `health` and the others already did. `mcp`, `version` and `update` print no envelope.
  - **Tools.** `ToolSuccess.meta` has two new required fields, `complete` and `notes`, which every built-in tool and every insight tool fills. A tool of your own must set them. The per-tool fields that said the same thing are gone: `truncated` (`campaign_overview`, `sender_health`, `reply_samples`), `all_checked` (`sender_health`, `deliverability_check`) and `counting_stopped_at_max` (`lead_runway`). `deliverability_check`'s coverage note moved from `next` to `meta.notes`.
  - **Insight tools.** `data` is the insight's answer itself, no longer `{ complete, notes, result }`; read coverage from `meta.complete` and `meta.notes`. The answer keeps its camelCase keys.
  - **Cards** read coverage from the result's `meta`, so a tool card shows the tool's own notes in its footer.

  Migration: read a CLI list from `.data.items` and a record from `.data`; read coverage from `meta.complete` and `meta.notes` instead of `truncated`, `all_checked`, `counting_stopped_at_max` or an insight tool's `data.complete`; and read an insight tool's answer from `data` instead of `data.result`.
- d32c353: `copyAudit` audits copy written per lead, and `personalizationGaps` stops flagging gaps no lead has (OUT-95).

  - **`copyAudit`:** a variant whose subject or body is more than 80% variables, such as `{{body_1}}` filled from a custom field, is audited as sample leads receive it, rendered as `copyPreview` renders it. New inputs `samples` (default 3) and `max_leads` (default 100). New optional answer fields: `lead` on each finding (`null` for copy as stored), `variantsWrittenPerLead`, `leadsAudited` and `variantsNotAudited`.
  - **Changes reported answers:** `clean` is `false`, never `true`, when a variant written per lead could not be rendered for any sample lead, even with no finding. Read `variantsNotAudited` and the note to tell "not audited" from "has problems". `clean` stays a `boolean`; a `null` for "not audited" may come in 0.8.0.
  - **`personalizationGaps`:** `gap` is `true` only when at least one lead read gets broken copy (`leadsAffected` above 0). It was `true` for any variable with a use lacking a fallback, even when every lead had a value.
  - **`personalizationGaps`:** Instantly's sender variables (`{{accountSignature}}`, `{{sendingAccountName}}`, `{{sendingAccountFirstName}}`, `{{sendingAccountEmail}}`) get the new optional field `sender: true` and are left out of `unknownVariables`. Their `source` stays `unknown`; a `source: "sender"` value may come in 0.8.0.
  - The `copyAudit` cost estimate includes one page of leads; with no copy written per lead it still makes 2 requests.
- 063359d: HeyReach lead status `Excluded` (a lead an exclusion filter or exclusion list kept out) now maps to `skipped` instead of `unknown` (OUT-106). `PendingOrExcludedToBeCalculated` and `Failed` stay `unknown`.

  `CampaignProgress` gains an optional `skipped` count: HeyReach fills it from `progressStats.totalUsersExcluded`, the memory adapter counts its skipped leads, and Instantly and Smartlead return `null`. Progress built or stored without the key is still valid.

  Smartlead is unchanged: a `BLOCKED` lead is still `bounced`, because its documentation gives no lead field that tells a block-listed lead that was never sent to apart from a bounce. The caveat says so.
- 868f633: `MetricRow` gains four optional counts: `leads`, `completed`, `opportunities` and `opportunityValue` (OUT-90). Instantly fills them from its campaign analytics: every-campaign rows (`stats({ scope: "campaign" })`) carry all four, and one campaign's or the workspace's total carries `completed`, `opportunities` and `opportunityValue` (the overview has no lead count, so `leads` is `null` there). Every other adapter returns `null`. `schemaVersion` stays 1, and a row built without the new keys is still valid.

  `campaign_diagnosis` adds the `contacted_exceeds_leads` finding: leads contacted more than twice the campaign's leads, which means the contacted count is not unique leads. It reads the campaign's progress for the lead count where the adapter serves it, so it costs up to 8 requests instead of 7. Instantly, Smartlead and HeyReach declare that read as one request.
- a703682: Type change: `LeadStatus` and `LeadProgress` gain `"skipped"` (approved by Brandon 2026-11-16); code that switches exhaustively on them must handle it. Instantly lead status `-3` (Skipped, a lead the vendor decided not to send to) now maps to `skipped` instead of `unknown` (OUT-100). `pipeline_forecast.byStatus` gains a `skipped` count, and `pipeline_forecast` and `lead_runway` do not count a skipped lead as left to start or as of unknown status.

  `Lead` gains an optional `recipientMailProvider` (`"google"`, `"microsoft"`, `"other"` or `null`), read from Instantly's `esp_code`; every other adapter returns `null`. A lead built or stored without the key is still valid.

  `person_summary`: when the vendor's status is `replied` only because of automatic replies, `leadStatus` is where the lead is in the sequence instead, so it agrees with `replied`. The new `vendorLeadStatus` keeps the vendor's status as it came.
- 44f05bc: Every answer that names a sequence step now gives it two ways, and `step_funnel` no longer calls a step reliable on one reply (OUT-96).

  - **New fields:** `stepIndex` (counted from 0, as vendors and records count) and `stepNumber` (counted from 1, as a person counts) on the rows of `stepFunnel`, `variantTest`, `copyAudit`, `copyPreview` and `personalizationGaps`' uses. `stepFunnel` adds `topStepIndex`, `topStepNumber`, `lastStepEarningPlaceIndex` and `lastStepEarningPlaceNumber`; `personSummary`'s campaigns add `lastStepIndex`, `lastStepNumber`, `repliedStepIndexes` and `repliedStepNumbers`. The `winning_steps` tool adds `step_index`, `step_number` and `rank` (1 is the highest reply rate).
  - **Deprecation:** `step` on those rows, `stepFunnel`'s `topStep` and `lastStepEarningPlace`, `personSummary`'s `lastStep` and `repliedSteps`, and `winning_steps`' `step` keep their old meaning (counted from 0) and are deprecated. They will be removed in 0.8.0. Read the `…Index` field for the same value, or the `…Number` field to show a person.
  - **Correctness fix that changes reported answers:** a `stepFunnel` step needs at least 5 replies to earn its place. Above the bar on fewer, `earnsPlace` is `null` (it was `true`), it is not `lastStepEarningPlace`, and the finding says there are too few replies to tell. A step at or under the bar is still `false`.
  - Sentences say the step number with the sequence's length: "Step 2 (of 4) brings the most replies".
  - `winning_steps` lists counts the vendor tied to no step last, with `unattributed: true` and `rank: null`, and leaves out such a row when it has no counts.
- 6aef02d: Say that a reply is a message, not a person (OUT-88). `outbound replies` writes a line to standard error such as "40 messages from 21 people in 9 threads."; standard output is the same JSON. `outbound replies --by person` prints one row per `leadRef` with `messages`, `firstAt`, `lastAt`, `categories` and `threadIds`. The `reply_samples` tool's description says each record is one message, its result adds `unique_people` and `unique_threads`, and a new optional `by: "person"` input returns `people` rows in place of `replies`. Both counts are `null` when a reply has no lead or thread.

  `MetricRow` gains two optional counts, `repliedTotal` and `repliedAutoTotal`: reply messages, every reply counted, beside the people counted in `replied` and `repliedAuto`. Instantly fills them from `reply_count` and `reply_count_automatic` (by day and step `replies` and `replies_automatic`), so its dashboard's "Replies" is `repliedTotal + repliedAutoTotal`. Every other adapter returns `null`. `schemaVersion` stays 1.
- 463b7d3: **Correctness fix that changes reported numbers:** `lead_runway` and `pipeline_forecast` now give the same runway (OUT-94). Both divide the active leads not yet started by the new leads started per day over the complete days ending yesterday. `lead_runway` no longer falls back to emails sent when a day has no `contacted` count (its pace is then `null`), no longer counts today's partial day, and returns the unrounded figure `pipeline_forecast` gives as `daysLeft`, including `0` when every lead was read and none is left. Both add the split of active leads: `not_started` and `in_sequence` on `lead_runway`, `notStarted` and `inSequence` on `PipelineForecast`, from each lead's last step sent or last contact; both are `null` when no lead read reports either, and the runway then counts every active lead.
- 49b5feb: Exploring one campaign no longer takes trial and error (OUT-97).

  - `outbound tools` lists each tool's inputs as JSON Schema (`parameters`), the way `outbound insight` does. `outbound tool <name>` with no `--input` prints the tool's `name`, `description` and `parameters` when the tool has a required input, instead of failing on it. A tool with no required input still runs.
  - `campaign_trend` works with only `campaign`: `to` defaults to today (UTC) and `from` to 30 days before `to`. Its data adds the `from` and `to` it read.
  - `campaign_diagnosis` reports `out_of_leads` instead of `falling_sends` or `no_recent_sends` when under a day of leads is left to start at the recent pace of new leads started, the pace `lead_runway` uses. It reads the campaign's leads (new input `max_leads`, default 2,000) only when sends fell or stopped. `DiagnosisCode` adds `out_of_leads`.
  - `campaign_diagnosis` screens every sender of the campaign, up to 500 (`max_senders` now defaults to 500, was 50), so a large sender pool no longer makes the answer partial. `inactive_sender` also flags a warmup score of 0, the screen `deliverability_check` uses, and its `numbers` add `warmupZero`.
  - `tracking_off` also fires when click tracking is off, and says which tracking is off.
- 0f00a83: Report opens and clicks a campaign did not measure as `null`, not 0 (OUT-89). A correctness fix: with open tracking off and no opens in the range, `opened` and `openedTotal` were `0`, which reads as "nobody opened"; they are now `null`, as the docs already promised, and so is the open rate. Clicks follow the same rule with `clicked` and `clickedTotal`. A campaign whose tracking is off now but that recorded opens in the range keeps its numbers. A workspace, mailbox or other total over campaigns with mixed tracking reports `null` instead of a sum of the tracked campaigns only. Read `stats({ scope: "campaign" })` for a row per campaign, each judged on its own.

  `MetricRow` gains an optional `tracking: { opens, clicks }` field, each `"on"`, `"off"`, `"mixed"` or `null`, saying why a count is `null`. `schemaVersion` stays 1. Instantly and Smartlead fill it on every stats read; EmailBison on a campaign's and its steps' rows, for opens only. Reading the settings costs extra requests, listed on each adapter page: one for a campaign, and the per-campaign report plus the campaign listing for a workspace or mailbox. When a settings read fails, the counts are as before. Insights that add campaigns up (`tag_rollup`, `channel_mix`, `period_comparison`, `client_report`, `variant_test` and the others built on them) treat an unmeasured open or click count as not measured instead of adding up the rest; the public `sumCounts` is unchanged.

### Patch Changes

- 280995c: `deliverability_check` no longer gives a false all-clear for a campaign with more senders than `limit` (OUT-93). It now screens every sender, up to 500, from the sender list for a disconnected or failing status and a warmup score of 0, checks the first `limit` in full with those problems first, and counts `with_problems` across every screened sender. Its data adds `checked`, `screened` and `total` (`null` past 500), and `meta.complete` and `meta.notes` say when not every sender was checked in full (`all_checked` and the note in `next` were folded into `meta` by OUT-102 in this same release). Its card says so too.
- ae5cc30: **Correctness fix that changes reported numbers:** Instantly's `contacted` is now the unique leads whose sequence started, Instantly's "Sequence started" (OUT-86). Campaign, workspace and every-campaign totals read `new_leads_contacted_count` instead of `contacted_count`, which counts lead-step contacts: 1,404 against 430 on one live four-step campaign, and 5.7 times too many on a larger one. Daily rows, and a mailbox total summed from them, read `new_leads_contacted` instead of `contacted`, which is everyone emailed that day. `contacted` falls, so `replyRate`, `positiveReplyRate` and `unsubscribeRate`, and every insight built on them, rise to their real values. A step row still reads `contacted` where Instantly sends it: the leads that step reached.

## 0.6.0

### Minor Changes

- **Breaking:** the insight names deprecated in 0.4.0 are removed, as announced (OUT-74).

  - Old inputs are refused with `Invalid`, and the message lists the inputs the insight takes: `bounceWatch` `threshold` (use `max_bounce_rate`), `domainHealth` `spam_rate_threshold` (use `max_spam_rate`), `campaignDiagnosis` `recent_days` (use `days`) and `clientReport` `top` (use `limit`). The tool parameters and the generated input types no longer list them.
  - Old answer fields are gone: `name` beside `campaignName` in every campaign row, `interval` and `trials` beside `low`, `high` and `of` (`bounceWatch`, `variantTest`, `domainHealth`'s `warmup`), `replyRate`, `replyRateInterval` and `replyRateBasis` beside `rates.replyRate` (`stepFunnel`, `copyReuse`), `spamRate` beside `domainHealth`'s `warmup.rate`, and `bounceWatch`'s `threshold` beside `maxBounceRate`.
  - Cards read only the new fields. A result stored before 0.4.0 no longer shows what only an old field held.

  Migration: rename the four inputs, and read `campaignName`, `low`, `high`, `of`, `rates.replyRate` and `maxBounceRate` where you read the old fields.
- 5404198: **Behaviour change:** the CLI leaves each record's `raw` vendor payload out of its output; `--raw` keeps it (OUT-82). For Instantly, `outbound replies` printed the whole quoted thread inside `raw` even without `--bodies`. `native` output and the SDK API are unchanged.
- f91ce72: New insight: `copyPreview` (`copy_preview` as a tool) shows a campaign's copy as written and as one real lead receives it (OUT-83). Each step and variant has its `template` subject and body exactly as stored, the `rendered` subject and body with the lead's values put into each `{{variable}}`, `{variable}` and `%variable%`, the rendered body as plain text, and the variables left as written. It reads copy that is all or partly templated, such as `{{subject1}}` and `{{content1}}` filled from custom fields. Pass `lead` to choose the lead, or leave it out to use the lead with the most variables filled. It finds and fills variables the same way `personalizationGaps` checks them.

## 0.5.0

### Minor Changes

- The insight input and answer names deprecated in 0.4.0 keep working until 0.6.0 instead of being removed in 0.5.0, because 0.4.0 and 0.5.0 were released on the same day. Deprecation warnings now name 0.6.0.
- d20a98a: Alert checks can be written as data (OUT-8). A check is a JSON object, `{ "metric": "bounce_rate", "op": ">", "value": 0.03, "scope": { "client": "acme" } }`, so it can be stored, shown and edited. `outbound-sdk/alerts` adds `validateCheck`, which lists every problem with what to write instead, `parseCheck`, `checkSchema` (the Zod schema, convertible to JSON Schema), `evaluateCheck`, which runs a check against stats rows, senders, or a `droppedReplies`, `pipelineForecast`, `suppressionCheck` or `personalizationGaps` answer and returns pass or fail with the numbers that broke it, and `checkRule`, which turns a check on records into an `AlertRule`. `CHECK_METRICS` lists the eight metrics and what each reads. Rule functions are unchanged.
- dda979f: CLI: `outbound version` (also `--version` and `-v`) prints the installed version, and `outbound update` checks npm for a newer one. It updates a global install in place, and for a project install or npx it prints the command to run.

  The executable is now also installed as `outbound-sdk`, so `npx outbound-sdk <command>` finds it by name. The docs and skills use that form, because `outbound` on npm is an unrelated package and `npx outbound` outside a project would download it. `outbound` still works.
- fb25ffc: **Behaviour change:** insights and tool calls now have a request cap by default (OUT-77), and an insight that cannot afford its input is refused before its first request (OUT-79).

  - Each insight states its cost, worked out from the input and the adapter's declared costs as a least and a most. It runs under a cap of the most, a quarter more for retries and 4 on top, counted across every read of the run. `maxRequests` in an insight's options replaces it; `Infinity` removes it. `insightCost(outbound, name, input)` returns `{ min, max, defaultCap }`, or `null` where costs are unknown (a combined instance), which keeps the old behaviour.
  - A run whose least cost is over its cap, or over what a `budget({ per: "run" })` has left, fails with `RateLimited` (`limit: "call"`, permanent) before any request, and again after its campaign listing once the count is known. The message names the least, the most, the cap and the input to lower.
  - Each tool call gets a fresh allowance: 100 requests for a built-in tool, the insight's default up to 500 for an insight tool. Set `maxRequestsPerToolCall` on `createTools` or `insightTools`; `Infinity` removes it. A tool's `call` takes `{ maxRequests }` as a second argument. The MCP server applies the same default on top of its per-call budget reset.
  - Tool failures carry `error.retryable` and, when requests were spent, `meta.requests`. A cap stop no longer tells the model "Check the input and try again.": it says not to call again with the same input, and what to lower or ask the user to raise.
  - `OperationCost` takes `perWalk` and `perPageAtMost`, upper-bound extras used only for caps; the Smartlead, Instantly and HeyReach adapters declare them. `requestBudget.per` says whether a budget counts per call or per run. Custom insights can declare `cost` and `scales`; the context has `campaignsFound(count)`.
- 627822f: New adapter: `outbound-sdk/emailbison` reads EmailBison (OUT-11). It is `unverified`: written from EmailBison's public API reference and tested offline only, never run against a live account. It reads campaigns, settings, sequences, senders and their health, leads, lead lists, sent emails, a lead's timeline, threads, replies, workspace, campaign, step, sender and daily stats, the block list, tags, webhooks and workspaces, and has a native catalog of 32 more reads. Pass `baseUrl` (or set `EMAILBISON_BASE_URL`) to the URL you log in to EmailBison with. `outbound-sdk/webhooks` parses EmailBison webhooks; verify them with a secret in the URL.

## 0.4.0

### Minor Changes

- 236f1df: Insight names are consistent before 1.0 (OUT-74). The rule is on the insights page under "Names". Nothing is removed in this release: old names keep working until 0.5.0.

  - Renamed inputs: `bounceWatch` `threshold` is `max_bounce_rate`, `domainHealth` `spam_rate_threshold` is `max_spam_rate`, `campaignDiagnosis` `recent_days` is `days`, and `clientReport` `top` is `limit` (the `top` list in the answer keeps its name). An old name gives the same answer with a note in `meta.notes`, the tool parameters mark it `deprecated: true` and the generated input types mark it `@deprecated`. Passing an old name and its new name together is `Invalid`.
  - Every campaign row the ops insights, `bounceWatch` and `senderLoad` return has `campaignName`; `name` is deprecated. `campaign` in `stepFunnel`, `variantTest`, `personalizationGaps`, `replyTiming` and `copyAudit`, and `anomalies`' `scope`, is the campaign's ref even when the input was a bare vendor id, at no extra request.
  - A rate is `{ count, of, rate, low, high }` everywhere: added to `bounceWatch`'s counts (`interval` deprecated), `clientReport`'s `bounceProblems`, `variantTest`'s variants (`trials` and `interval` deprecated) and `domainHealth`'s `warmup` (`spamRate` and `interval` deprecated). `stepFunnel` and `copyReuse` rows add `rates.replyRate` with `basis` (`replyRate`, `replyRateInterval` and `replyRateBasis` deprecated). `bounceWatch` adds `maxBounceRate` (`threshold` deprecated). Cards read the new fields and still draw a stored result that has only the old ones.
  - Every `from`/`to` input takes `null` for no bound and refuses a day that does not exist, such as `2026-02-30`; `bounceWatch` used to refuse `null`.
  - Behaviour change: `bounceWatch` takes `statuses` and reads only active campaigns by default, where it read every campaign. It never makes more requests than before. To read every campaign, pass `statuses: ["active", "paused", "completed", "draft", "archived", "unknown"]`.
  - Behaviour change: `campaignDiagnosis` judges rates from 50 sends (`min_sent`), as the other ops insights do, where it needed 100. `clientReport`'s `next` says to run `campaign_diagnosis` with `from` and `to` set to the report's `period`.
- 397d66f: Request caps now say their scope in their name (OUT-80, decided in OUT-76).

  - `createOutbound({ maxRequestsPerCall })` is the new name for the instance cap. It caps each SDK call, not the whole run. `maxRequests` on `createOutbound` still works for now: it warns once that it is deprecated. Setting both is `Invalid`. `maxRequests` on a single call keeps its name.
  - **Breaking:** `budget({ maxRequests })` now defaults to `per: "run"`, a total across every call until `requestBudget.reset()`. To keep the old per-call behaviour, add `per: "call"`, or move the cap to `maxRequestsPerCall`, which does the same thing.

  Migration: replace `createOutbound({ maxRequests: n })` with `createOutbound({ maxRequestsPerCall: n })`, and add `per: "call"` to any `budget()` that relied on the per-call default.
- f036590: - `suppressionCheck`, `accountSummary` and `droppedReplies` say in `data.totals` when a cap left records unread (`moreBlockEntriesExist`, `moreLeadsExist`, `moreRepliesExist`), and their cards say so. `suppressionCheck.totals.blockEntriesNotChecked` is `null` while entries are left unread.
  - Under `redact()`, `accountSummary`, `suppressionCheck` and `leadCollisions` refuse with `Unsupported` naming the plugin, and `insightTools` leaves them out; `person_summary` is left out only while both email and LinkedIn are masked with `strategy: "mask"`. A lead ref is looked up by the lead's email address when that is not masked, or else by its LinkedIn profile, so `redact({ fields: ["linkedin"] })` no longer refuses one. Under `strategy: "hash"`, `person_summary` hashes the address or profile URL given and matches the hashed records, showing the identifier as the records do; `account_summary` stays refused and says a hashed address keeps no domain. `outbound.redacted.hash(value)` returns the text redact writes in place of a value. A tool's `next` hint no longer names a tool that is not offered. `strategy: "hash"` keeps exact matching in `suppressionCheck` and `leadCollisions`.
  - `hotLeads` gives a lead labelled negative (`totals.negative`) no points at all, from replies, recency, clicks or opens, so a "Not interested" lead with 3 clicks and 20 opens no longer outranks a lead that replied once. Such a lead is listed after every lead with a score above 0, while `limit` leaves room, and its reason names the label: "marked Not Interested, so it earns no points". `personSummary` and `accountSummary` mark records labelled out-of-office or bounced `autoReplied` and do not count their replies.
  - `personSummary` accepts a lead ref. A missing required input reads "`<name>` is required", in the insights and in the built-in tools (`campaign_trend`, `winning_steps`, `lead_runway`, `campaign_setup`, `cross_channel_lead`), which used to give the schema's "Invalid input: expected string, received undefined".
  - `hotLeads` and `replyTiming` throw `NotFound` for an unknown campaign.
  - `droppedReplies` notes a reply that carries no lead ref.
  - Every cap note names the input to raise: "Stopped at 25 campaigns (max_campaigns); more exist." `InsightContext.all` takes the cap as `{ max, what, input }`. `campaignRanking`, `clientReport`, `periodComparison`, `tagRollup`, `channelMix` and `copyReuse` report `campaignsRead` and `moreCampaignsExist`, and their cards say when the cap was hit.
  - `pipelineForecast` gives a campaign with no leads left `daysLeft: 0` and says to add leads; `clientReport` lists it first in `runningOutOfLeads` with the `add_leads` action.
  - `variantTest` and `copyReuse` divide every rate they compare by the same base, and do not compare variants or campaigns with no base in common. `copyReuse` names the base in `basis`, at the top and per use. `variantTest.variantStatsReported` is `null` for a date range with no step stats.
  - `copyAudit` counts `<a href="X">X</a>` as one link.
  - `replyTiming` reports `counts.unpairedShare`, marks the answer partial when over a quarter of the replies are unpaired, and notes that automatic replies are counted.
  - `tagRollup` is `Unsupported`, and left out of `insightTools`, where campaigns carry no tags. A custom insight can name such a gap with `lacks`. `memory()` takes a `fields` declaration.
  - `domainHealth` gives `blacklisted: null`, not 0, when no mailbox of a domain reports its block list status, and risk `unknown`, not `low`, when the vendor reports none of SPF, DKIM, DMARC and MX (every Smartlead domain). The card lists what is not reported per domain.
  - `warmupReadiness` notes in `meta.notes`, with `check_health` off, that DNS and warmup spam were not checked and how to turn the check on; its card says "ready on warmup alone". The default is unchanged.
  - `senderCapacity` compares sends and capacity over the same senders: with the new `split_uncounted: true`, what inactive senders and senders with no limit sent is read from their own stats (1 request each), reported as `sends.fromUncounted` and left out of `utilization`, which is `null` with a note when it cannot be told. Daily rows dated outside the window are dropped.
  - `settingsAudit`'s `limit_over_senders` holds a daily limit against the attached senders' own limits added up, and falls back to `max_daily_limit_per_sender` each, saying so, only when one reports none.
  - `bounceWatch` names the senders whose stats could not be read, reports `sendersRead`, and applies `min_sent` to senders as well as campaigns.
  - `domainHealth` and `warmupReadiness` leave out a sender whose health read answers `NotFound`, name it in a note and set `meta.complete` to `false`. Other errors still throw.
  - Every built-in tool's `meta.requests` is the number of vendor requests it made: `campaign_overview` and `deliverability_check` count their listing's pages, `compare_clients` and `cross_channel_lead` count every read behind them, and the memory adapter reports 0. `outbound.person()` returns `requests`, and the clients plugin adds `clients.read()`, which returns `stats()`'s rows with `requests`.
  - `sender_health` counts unhealthy senders over at least the first 100 senders (one vendor page), not only the `limit` it lists, and lists them first. It returns each sender's `address`, `checked`, `all_checked` and `truncated`. `campaign_overview` and `reply_samples` return `truncated: true` when more exist than `limit` let in. Their cards say what was left out. No default limit changed.
  - `cardFor` takes an insight method's result as it is, `cardFor("hot_leads", await outbound.insights.hotLeads({}))`, as well as a tool result (new types `CardInput` and `InsightResultLike`). Given anything it cannot draw it returns a card saying there is nothing to show, and never throws.
  - Sentences and cards read as written by a person: real plurals from one shared helper (no "(s)", "1 lead remains", "1 of 2 senders is ready", "Stopped at 1 campaign"), no range whose ends read the same, waits past two days in days, steps counted from 1 in sentences and cards (`step` and `stepIndex` in data still count from 0), and person keys shown as the address or profile, never `email:…`. `copyAudit` returns `campaignName`; an alert carries `subjectName` (a sender's address, or the name of a campaign the instance has read) and `alertCard` shows it and titles the rule in words. The `reply_samples` card no longer prints the lead's ref, and the `anomalies` card moves the scope out of its subtitle. Request budget errors and estimates write "2 requests", not "2 request(s)".
  - A date-only `until` (`2026-11-13`) on any collection is the end of that UTC day (`2026-11-13T23:59:59.999Z`), so `since` and `until` on the same date return that day's records. An `until` with a time is unchanged. Adapters now receive the end-of-day timestamp.
  - `getMany` returns `results` and `errors` in the order of the ids passed, reads an id passed twice once and lists its answer at each place, and refuses an id that is not a string with `Invalid` before any request (an `undefined` id used to end the read silently). `listAll({ max })` refuses a `max` that is not a positive integer (`0`, `-1`, `1.5`, `NaN`) with `Invalid`, as `limit` already was.
  - Behaviour change for JavaScript callers: `list` and `listAll` refuse an option the collection does not take, such as `leads.list({ status: "replied" })` or `leads.list({ campaign: "x" })`, with `Invalid` naming the key and the options it takes, before any request. Such a key used to be ignored, which answered a wider question than the one asked. A key set to `undefined` is still accepted.
  - `clients()` rules match a campaign by its bare vendor id as well as its ref in `campaignIds`, and a `campaignName` regex with the `g` or `y` flag matches the same campaigns as without it. `clients.stats({ from, to })` and `reconcile.deletions()` no longer pass their own options to the campaign listing.
  - Strict TypeScript: `createOutbound({ adapter, plugins: [...(flag ? [redact()] : []), insights()] })` compiles (it gave TS2322) and the instance keeps `.insights`. `createOutbound({ adapter: flag ? smartlead() : instantly() })` compiles without an annotation (the instance's `native` types the reads both share), a tool's `call` takes any input, such as a `Record<string, unknown>` or an object typed from its schema, and still checks it when it runs, and `outbound.export()` is typed to take an array or any iterable as well as a listing.
  - `periodComparison` and `clientReport` divide a period's replies and positive replies by messages sent, so a week that sent 300 follow-ups to 5 new leads no longer shows 8 replies as 160%. Both say so in `replyRateBasis: "sent"`, and their sentences read "Replies per message sent went from 3% to 4.4%". Where a period does not report messages sent, both periods are divided by leads contacted, with `replyRateBasis: "contacted"` and "Replies per lead contacted went from …", so a vendor that counts only leads contacted still gets a rate and a verdict; the two periods never use different bases. `clientReport` ranks `top` and `bottom` on the same base. Other insights' per-campaign reply rates are unchanged.
  - `campaignRanking`'s ranked campaigns carry `basis`, what `of` counts (`contacted` or `sent`), and `sent` is messages sent (`null` when not reported) rather than leads contacted for a vendor without sends. The card's column shows the count the rate divides by under that name.
  - `alerts` with `dedupe` tells a repeat by the day of the data point as well as the rule and subject (`no-sends|<ref>|2026-11-10`), so no sends on 11-10 and again on 11-11 is two alerts while a second run over 11-10 is one. A rule marked `state: true`, as `senderNotActive()` is, also keys on the value, so a sender paused and then in error alerts twice. An alert about one day's stats row carries that `day`. A custom rule without `day` or `state` keeps the `rule|subject` key.
  - Instantly, Smartlead and HeyReach read every list strictly: a 200 whose body is not the documented list (an HTML maintenance page, `{}`, `{ items: null }`, an array where an object is due, or an object where an array is) throws `Provider` with a message naming the request and what was expected, and `status: 200`, instead of returning an empty page. A documented empty list is still zero records. Instantly's lists must be `{ items }` (the bare-array fallback is gone), and its analytics reports bare arrays; Smartlead accepts its bare and `{ ok | success, data }` forms, and `{ campaigns }` for the campaign list; HeyReach's lists must be `{ items }`, and a lookup's 404 is still an empty page. Smartlead's `GET /leads/{id}/campaigns`, its lookup by email and HeyReach's `GetTags` stay lenient and fail only on a body that is not JSON.
  - CLI: a listing that stops at `--limit` while more records exist writes "Stopped at 50 leads; more exist. Pass --limit to read more." to stderr; stdout is unchanged. A flag a command does not take is refused with exit code 1 before any request (`outbound leads --since 2030-01-01` writes "Invalid: --since is not an option of leads"), where it used to be ignored. `outbound <command> --help` prints that command's options and the ones every command takes. `campaign <id>` with two or more of `--stats`, `--sequence`, `--subsequences` and `--settings` prints each answer under its name instead of only the first.
  - `outbound mcp`: a call to a tool the redact plugin left out, such as `person_summary`, is answered with a message naming redact and `--no-redact`, instead of `Unknown tool`. `createMcpServer` takes `leftOut`, the names of tools left out with the reason for each.
  - The `sender_health` card's "… and N more" counts every sender checked that it does not show, so 70 senders with 8 drawn read "… and 62 more" (it said 42, leaving out the 20 the answer did not hold), in a digest too, and its note reads "50 of the 70 senders checked are in the answer, problems first. Raise limit to list more." A card builder's table takes `total` for this.
  - A number reads the same in a sentence and on its card: cards write a rate as the sentences do, `5%` and `5.3%` (they wrote `5.0%`), and the alert messages too, from one shared formatter. Counts in sentences and notes are grouped as on cards: "Stopped at 2,000 block list entries", not "2000".
  - `demoData()`'s week before last has fewer replies than its last week (11 against 19 of 664 sends), so `clientReport` and `periodComparison` on the demo read "went from 1.7% to 2.9%" instead of the same week twice. The bounce spike four days back is still the only unusual day.
- 5449f9e: - A request cap of your own no longer looks like a vendor 429 (OUT-70). `OutboundError` has a new `limit` field on `RateLimited`: `"vendor"` for a 429, `"deadline"` for a full rate budget the deadline would not wait for, `"call"` for a per-call cap (`maxRequests` or `budget({ per: "call" })`) and `"run"` for a spent `budget({ per: "run" })`. A `"call"` or `"run"` stop is `permanent: true`, so a retry loop that follows `permanent` stops on it. `code` is still `RateLimited`. The message says what to change. New type: `RequestLimit`.
- 3ee1eec: - A `listAll().toArray()` that a cap or a failure stops part way still rejects, but the error now keeps what was fetched (OUT-78). `error.partial.items` holds the records, `error.partial.cursor` resumes the walk with `listAll({ cursor })` without skipping or repeating a record, and `error.partial.requests` counts the requests spent. `for await` is unchanged. New type: `PartialWalk`.

### Patch Changes

- fe4ea14: `demoData()` has three weeks of daily stats, split by step and variant, so every insight has an answer on it: `stepFunnel` and `variantTest` read the A/B test on step 0 of `cmp_founders`, `copyReuse` compares the follow-up both campaigns send, and `anomalies` flags a bounce spike four days before `now`. The follow-up's subject is now "Following up", and "Agency owners" has it as a second step.

## 0.3.0

### Minor Changes

- 113da3d: - `demoData()` counts its dates back from now, with two weeks of stats, so `clientReport` and `droppedReplies` find data on any day. `demoData({ now })` fixes the moment.
  - `hotLeads` reads the leads behind recent replies when `max_leads` cuts the listing short, and says so in `totals.moreLeadsExist` and `totals.fromReplies`. A lead labelled out-of-office earns no reply or recency points (`totals.autoReplied`).
  - `droppedReplies` returns each person's `name`, `email` and `linkedinUrl` and the `campaignName`.
  - Insight sentences show at most one decimal and rates as percentages. The number fields are unchanged.
  - New types: `OutboundWith<typeof plugins>`, `InsightInputs` (each field's default and range in its JSDoc), `ProviderId` and `DemoDataOptions`. New guard: `isProviderId()` from `outbound-sdk/providers`.
  - `createOutbound` no longer infers its plugins from the type the result is assigned to, so an instance built without a plugin cannot be typed as one with it.

## 0.2.1

### Patch Changes

- 6b2c396: `outbound mcp` now reports the installed package's version as `serverInfo.version` in its `initialize` answer, instead of `0.0.0`. A server built with `createMcpServer` still reports the `version` option, which defaults to `0.0.0`.

## 0.2.0

### Minor Changes

- adf0104: `fromEnv({ provider: "all" })`, `OUTBOUND_SDK_PROVIDER=all` and `outbound --provider all` build every provider whose key is set in the environment: one adapter alone, or several behind one combined instance. Setting another vendor's key adds that tool with no code change. `outbound-sdk/loader` also exports `configuredProviders()` and `ALL_PROVIDERS`.
- 68e2827: `outbound mcp` now masks personal data by default: it runs with `redact()` unless started with `--no-redact`. Every command takes `--config <file>` to load plugins from a file (`defineConfig` from `outbound-sdk/cli`), `--cache <seconds>`, `--max-requests <n>` and `--redact`. The MCP server's `instructions` name the plugins that are on, and a `budget({ per: "run" })` on the instance is reset before each tool call, so its cap is per tool call. `serveStdio(server)` serves a server you build on standard input and output.
- 97e7366: With no provider named, the CLI, `outbound mcp` and `fromEnv()` do the same as `all`: every vendor whose key is set, as one combined instance, so a person is found across Instantly and HeyReach with nothing to configure. A named provider still picks one vendor. New `outbound person <email or LinkedIn URL>`. The CLI installs the identity plugin, so `cross_channel_lead` is served and leads carry `personKey`; `outbound tools` and `outbound tool` now offer the insights, as `outbound mcp` does. `person_summary` now refuses with `Unsupported` while `redact` masks emails or LinkedIn profiles, instead of reporting a known person as not found; with redact off, the MCP server's instructions still say that personal fields are not masked.
- d304248: Say which fields each adapter fills, and normalize more of what the three vendors report.

  - `outbound.fields` grades every field of every record: `exact` from the vendor, `derived` by the adapter, or `false` when the adapter never fills it, so a `null` can be told apart from a field the vendor does not have. `outbound capabilities` prints the fields that are not `exact`.
  - New fields: `clickedTotal` on stats rows (`clicked` is unique clicks), `interestCategory`, `phone`, `website`, `location` and `companyLinkedinUrl` on leads, `unread` on replies, `mailProvider` and `tags` on senders.
  - New reads: `outbound.stats({ scope: "campaign" })` with no `scopeId` returns a row per campaign from one request (`stats.allCampaigns`), `outbound.sender(id).campaigns` lists the campaigns a sender is attached to (`campaigns.bySender`), and `replies.list({ unread })` filters by read state (`replies.unread`).
  - HeyReach lists every lead by walking its campaigns, and its replies take the category of their lead's newest auto-tag. A reply whose category is the lead's label carries `categorySource: "lead"`, on HeyReach and on Smartlead, which reported `vendor` before.
  - Smartlead stats: out-of-office replies as `repliedAuto` on a dated campaign total, positive replies per day, and a step's one click count as `clickedTotal` where it was `clicked`.
  - `leadFields` on each adapter names the custom field that holds a lead's title, company, phone, website, location or LinkedIn profile, for a vendor with no field of its own. Nothing is guessed without it.
  - A campaign, list, tag or workspace the vendor gave no name is named by its id; `name` is never an empty string.
  - A webhook subscription carries `eventTypes`: the SDK's event types its vendor event names become.
  - `outbound.lists.get(id)`, `outbound.list(id).get()` and `outbound.webhooks.get(id)` read one list or one webhook (`lists.get`, `webhooks.get`). On Instantly a list read by id has its `size`.
  - An event's `data` has a checked shape for the keys every vendor shares, as part of `outboundEventSchema`; a vendor's extras still ride along.
  - A block entry the vendor gave no value is skipped, and `value` is never empty.
  - `stats.allCampaigns` is `full` or `partial`: `full` when each per-campaign row has every count the read of one campaign has. `campaign_ranking`, `channel_mix` and `tag_rollup` read every campaign's totals in one request on a `full` vendor.
  - A lead carries `progress` (where it is in its sequence) and `replied`, `bounced` and `unsubscribed` (what came back) as separate fields. `status` is the headline made from them the same way on every vendor, so a lead that replied reads `replied` on Instantly and Smartlead as it already did on HeyReach.
  - `redact` masks a lead's `phone` (a new `"phone"` field), and its `website` and `companyLinkedinUrl` with `company`.
  - `outbound.campaign(id).progress()` returns a `CampaignProgress`: how many of the campaign's leads are waiting, in progress, finished, stopped, failed or blocked (`campaigns.progress`).
  - `outbound.placementTests.list()` lists the inbox placement tests on Instantly and Smartlead as `PlacementTest` records (`placementTests.list`). Their results stay native reads.

  Three values change from 0.1.0, though no field is removed and `schemaVersion` stays `1`: a lead that replied now has `status: "replied"` on Instantly and Smartlead, a Smartlead step's click count moves from `clicked` to `clickedTotal`, and a Smartlead reply whose category comes from its lead's label has `categorySource: "lead"` where it had `"vendor"`.

### Patch Changes

- 3bd7573: Reads that do not depend on each other now run side by side. A person lookup on a combined instance (a lead listing filtered by `email` or `linkedinUrl`) asks every tool at once, and `person_summary`, `identity`'s `person()` and the insights that read per campaign or per sender keep a few reads in flight instead of one. Answers, their order and their request counts are unchanged; every request still fits its vendor's rate budget.

  A `budget({ per: "run" })` cap now counts each request as it is sent, so calls running at the same time can no longer go past it together.

## 0.1.0

### Minor Changes

- 2c1f7a8: Draw cards in Slack with its newer blocks. `toSlackBlocks` and `toSlackMessage` now default to a `rich` style: numbers as a bordered grid of tiles, a short list of leads or replies as cards side by side, data table cells that sort as numbers, and a primary button. `style: "plain"` writes what Chat SDK's Slack adapter writes, as before. `alertCard` shows a rate as a percentage, and the bounce section of a digest no longer repeats its headline.
- b6037e5: Add `outbound-sdk/cards`: every tool and insight answer as a card. A card is a json-render spec for the chat catalog, built from the numbers the tool returned, with `toSlackMessage` to post it to Slack with no other package, `digest` for one message made of several results, and `eventCard` and `alertCard` for webhook events and alerts. `outbound tool` and `outbound insight` take `--card` and `--slack`.
- 10aedb7: First release: the core client, the request engine, adapters for Instantly, Smartlead and HeyReach with a typed native catalog of each vendor's own reads, fifteen plugins, webhooks, 26 computed insights, AI tools, the `outbound` CLI and a local MCP server. HeyReach and Instantly are `beta`; Smartlead is `unverified` until it has been checked against live credentials.
