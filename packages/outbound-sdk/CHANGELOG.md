# outbound-sdk

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
