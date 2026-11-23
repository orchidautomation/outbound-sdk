# outbound-sdk

## 0.22.0

### Minor Changes

- 9442aba: `anomalies` with `campaign: null` runs on an adapter without `stats.workspace` when it has daily stats per campaign (OUT-219). It lists every campaign, whatever its state, up to 500, reads each one's days and adds them up. `meta.evidence` is `derived`, a note says the days are campaigns added up, and `meta.requests` and the cost estimate count the listing and each campaign's read. A listing stopped at 500 makes the answer `complete: false`. With neither workspace nor campaign stats it is still `Unsupported` before any request. An insight's `needsFor` now also receives the instance's capabilities.
  
  The `person_summary` docs say why it refuses under the `redact` plugin, and how that differs from the `person` tool's masked view (OUT-220).
- 303d9af: A new capability, `stats.byStepDay`, gates a step's stats by day: `campaign(id).stats({ scope: "step", by: "day" })` (OUT-216).
  
  - An adapter that declares it, such as the memory adapter or your own adapter over stored history, serves a row per step and day. Every vendor adapter declares it `false`, because Instantly, Smartlead and EmailBison report step counts only as totals over a range and HeyReach has no step stats, so the read is `Unsupported` before any request, now from the capability check instead of from inside the adapter.
  - `step_funnel` takes `by_day`, which adds `days`: each day's sends and replies per step, for one more request. It is refused before any request where the adapter lacks `stats.byStepDay`. Without `by_day`, `days` is `null`.
  - **Type change:** `StepFunnel` has a new required field, `days` (`FunnelDay[] | null`). Code that builds a `StepFunnel` by hand, such as a test fixture or a card, must add `days: null`.
  - The Smartlead and EmailBison pages say that neither vendor has a daily read that keeps campaigns apart, so daily stats for every campaign cost one request per campaign (OUT-217).

### Patch Changes

- 980b54d: The memory adapter applies every filter it is declared with (OUT-218). Declared through `capabilities`, `leads.byInterest` keeps only positive leads, `leads.lookupMany` only the listed addresses, `messages.byHand` only outbound messages seeded `byHand: true` (a new `MemoryMessage` field), and `messages.latestOfConversation` only the latest message of each conversation that holds a reply. Before, they were ignored, so an insight such as `hot_leads` over memory data saw records a vendor that filters would have left out. A contract test runs every filter capability against the memory adapter.

## 0.21.1

### Patch Changes

- e36e266: HeyReach webhook events name their message, and the webhooks docs show how to authenticate a vendor that does not sign.

  - A HeyReach message event's `messageRef` is now the ref that sync and `messages.list` give the same message, so `reconcile.events` pairs them instead of counting them `uncheckable`. HeyReach messages have no id, so both sides hash the conversation, the send time, the side and the text, from `conversation_id` and `recent_messages`. An event without those fields keeps `messageRef: null`.
  - The verification page shows a generated secret in the URL path compared with `timingSafeEqual`, for vendors that do not sign, and how that differs from Smartlead's `whsec_` signature.

## 0.21.0

### Minor Changes

- b2871a2: Two capabilities say who filters messages and replies by campaign, and a scoped sync reads once where the vendor cannot (OUT-212).

  - `messages.byCampaign` and `replies.byCampaign` are `"server"` when the vendor filters by campaign, `"client"` when the SDK keeps one campaign's records after reading them all, and `false` when not declared. Nothing is refused. Instantly, HeyReach and EmailBison filter both on their side. Smartlead filters replies, but its activity feed takes no campaign, so its messages are `"client"`.
  - `sync.run("messages", { resolved })` on Smartlead, or any scoped run of a `"client"` collection, now reads the collection once and hands each campaign its own records, instead of reading the whole feed once per campaign on the 10-per-minute activities lane. Each campaign keeps its own checkpoint under the same key as before. A combined instance still syncs campaign by campaign.
- 6ae1d38: `sync.run` and `resolveScope` take `statuses`, which narrows a campaign scope to campaigns in those statuses (OUT-211).

  - `sync.run("leads", { statuses: ["active"], onPage })`, then a run of the other statuses, back-fills active campaigns first and reads no campaign twice. Each campaign keeps the same ref-keyed checkpoint as any scoped run.
  - It works alone or with `campaign_ids`, `tag` and `campaign_name`, and is matched here over the campaign listing. An empty list, an unknown status, or `statuses` with `campaignId` or `resolved` is `Invalid` before any request. `ResolveScopeInput` is exported.

### Patch Changes

- 0854c66: The sync docs now state what SendLens and other callers can rely on (OUT-213, OUT-214).

  - `campaign_name: "*"` is the supported way to mean every campaign, in `sync.run` and `resolveScope`.
  - A scoped or `resolved` sync syncs campaigns in the order of `resolved.campaigns`, so a caller can reorder them, such as active campaigns first.
  - `sync.run` accepts a `resolved` when its `campaigns` is an array and `meta.provider` and `meta.workspaceId` are the instance's. Nothing else is checked. This is unchanged and now pinned by tests.
  - The npm package now includes CHANGELOG.md.

## 0.20.0

### Minor Changes

- 5638cc6: `sync.run` says what of the inbox any run leaves out, names each checkpoint's campaign, and takes a scope found once (OUT-207, OUT-208, OUT-209).

  - Every `SyncResult` has `inboxLeftOut`. An unscoped sync of `replies` on a tool whose inbox holds replies tied to no campaign, such as HeyReach, reads them as `replies.list` does, without `includeInbox`, so it now notes that they were left out and gives `inboxLeftOut: null`, an unknown count, as a scoped run already did. A run with `campaignId` says the same of replies and messages. An unscoped `messages` sync reads the inbox's conversations, so it leaves out `0`. `scope.inboxLeftOut` keeps the same value.
  - A checkpoint of one campaign carries `campaignRef`, the campaign's ref (`provider:workspace:id`, a bare `campaignId` qualified), and `onPage` gets a second argument, `{ campaignRef }`, so a caller can keep one sync row per campaign. Keys are unchanged.
  - `sync.run(collection, { resolved: await resolveScope(outbound, scope), onPage })` syncs those campaigns without finding them again, so syncing several collections of one scope lists its campaigns once. Its `requests` leave out what finding them cost. A `resolved` of another provider or workspace, or one given with `campaignId` or a scope, is `Invalid` before any request. `SyncPage` is exported from `outbound-sdk/sync`.

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
