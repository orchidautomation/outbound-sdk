# outbound-desk: an eve agent on outbound-sdk

An [eve](https://eve.dev) agent for an outbound agency. It lives in Slack and answers the questions an agency gets all day — how are Acme's campaigns doing, why did bounces jump, who replied and is still waiting, which variant is winning — from each client's Instantly, Smartlead or HeyReach account, through [outbound-sdk](https://outbound-sdk.dev). Every Monday it posts each client's weekly report in the channel the agency shares with that client, and every weekday morning it tells the team what needs a person today.

It only reads. outbound-sdk has no method that sends, pauses, edits or deletes anything, so neither does the agent.

> This example is written as if `outbound-sdk` is on npm. Until it is, install the 0.1.0 tarball from its [GitHub release](https://github.com/orchidautomation/outbound-sdk/releases/tag/v0.1.0) in place of the `^0.1.0` dependency.

```text
agent/
├── agent.ts                         model and a per-thread spend limit
├── instructions.md                  who it is, and how to report numbers honestly
├── instructions/client-scope.ts     tells the model which client a channel belongs to
├── lib/
│   ├── clients.ts                   the client roster, the team's channels and teammates
│   ├── roster.ts                    refuses a roster that puts two clients in one channel
│   ├── outbound.ts                  one outbound-sdk instance for the whole agency
│   ├── scope.ts                     what a conversation may see; fails closed
│   ├── cards.ts                     the numbers behind a reply, as outbound-sdk cards
│   └── demo.ts                      made-up data for trying it without a key
├── tools/
│   ├── outbound.ts                  every outbound-sdk tool and insight, as eve tools
│   └── no_reply.ts                  lets a quiet morning post nothing
├── skills/weekly-client-report/     the Monday report, step by step
├── channels/
│   ├── slack.ts                     Slack mentions, DMs and threads, with the cards renderer
│   └── eve.ts                       the HTTP API and the dev TUI
└── schedules/
    ├── weekly-client-reports.ts     Monday 08:00 New York, one thread per client
    └── morning-check.ts             weekdays 09:00 New York, to the team's channel
evals/                               four checks, run on the demo data
```

## Try it without a vendor key

You need Node 26 (24 works for local development) and a model: an [AI Gateway](https://vercel.com/docs/ai-gateway) key, or run `/login` in the TUI to use one you have.

```sh
npm install
npm run demo
```

`npm run demo` is `eve dev` with `OUTBOUND_SDK_PROVIDER=memory`, so every read comes from `agent/lib/demo.ts` instead of a vendor: three weeks of results for two clients that end yesterday. Ask it:

- _How did Acme do last week?_ — the Agency owners campaign doubled its replies; Ecommerce ops started bouncing.
- _Write Acme's weekly report._ — loads the skill and calls `client_report`.
- _Any interested prospect we haven't answered?_ — one positive reply has waited about three days.
- _What's Globex's bounce rate?_ — Globex is on LinkedIn, which reports no bounce count, so the answer is "not reported", not 0%.
- _Pause Ecommerce ops._ — it can't, and says what it found instead.

## Connect real accounts

1. **List your clients** in `agent/lib/clients.ts`: an `id` (your label), the vendor, the name of the environment variable holding the key, and the Slack channel you share with that client.
2. **Set the keys** in `.env.local` (see `.env.example`). The SDK only reads, so use a read-only key where the vendor offers one.
3. Run `npm run dev`.

Each client gets its own adapter, and `combine()` joins them into one instance, so one rate budget and one five-minute cache cover every read. `maxRequests: 150` stops any single tool call from spending more than 150 vendor requests: past that it fails with `RateLimited` instead of using up the client's quota.

## Slack

The channel was added with `eve add channel/slack`, using portable credentials:

1. Create a Slack app. Add the bot scopes `app_mentions:read`, `chat:write`, `channels:history`, `groups:history`, `im:history`, `mpim:history`, `files:read` and `files:write`.
2. Install it, then set `SLACK_BOT_TOKEN` and `SLACK_SIGNING_SECRET`.
3. Under **Event Subscriptions** and **Interactivity**, set the request URL to `https://<your-deployment>/eve/v1/slack`, and subscribe to `app_mention`, `message.channels`, `message.groups`, `message.im` and `message.mpim`.
4. Invite the app to each client's shared channel and to the team's channels. Set `OUTBOUND_OPS_CHANNEL_ID` to the one the morning check posts in, `OUTBOUND_INTERNAL_CHANNEL_IDS` to any other team channels, and `OUTBOUND_TEAM_USER_IDS` to the teammates who may DM the agent.

To let Vercel hold the token and verify requests instead, run `eve add channel/slack` again and choose **Vercel Connect**.

### Who sees what

`agent/lib/scope.ts` decides, before every model call, what the conversation may read. It fails closed: a Slack conversation gets data only when the configuration says whose it is.

| Conversation | Sees |
| --- | --- |
| A client's shared channel (`slackChannelId` in `clients.ts`) | That client only. The tools are built on `outbound.workspace(clientId)`, so they cannot read another client whatever anyone asks |
| A channel in `OUTBOUND_OPS_CHANNEL_ID` or `OUTBOUND_INTERNAL_CHANNEL_IDS` | Every client |
| A DM from a user in `OUTBOUND_TEAM_USER_IDS` | Every client |
| The eve HTTP API and the dev TUI | Every client. Their callers are authenticated in `channels/eve.ts` |
| Anything else: an unlisted channel, a DM from anyone else, a group DM | Nothing. The agent has no outbound tools there and says the channel isn't set up |

DMs need the teammate list because Slack identifies a Slack Connect guest by the agency's own workspace, so a DM alone can't tell a client's user from a teammate.

The roster is checked when the agent loads, so `eve build` fails on a roster that gives one channel to two clients or two channels to one client. A client on two sending tools is two entries with the same `id` and channel.

### Cards under every answer

After a reply posts, a renderer in `channels/slack.ts` posts the numbers behind it as outbound-sdk cards (`cardFor` and `toSlackMessage` from `outbound-sdk/cards`): a header, the finding with a 🔴/🟡/🟢 light, a grid of number tiles, a table that sorts as numbers, a chart where there is a series, and a footer with the vendor and request count. A count the vendor didn't report shows as `—`. Slack draws one table per message, so each tool gets its own card; past three, the rest share one digest. The thread status names the work as it runs, such as _Bounce watch for Acme_.

## How it uses outbound-sdk

The whole integration is `agent/tools/outbound.ts`:

```ts
const tools = createTools(scoped, { extra: insightTools(scoped) });

return Object.fromEntries(
  tools.map((tool) => [
    tool.name,
    defineTool({
      description: tool.description,
      inputSchema: z.looseObject(tool.fields),
      execute: (input) => tool.call(input as JsonObject),
    }),
  ])
);
```

- **`createTools`** gives up to 12 question-shaped tools (`campaign_overview`, `sender_health`, `deliverability_check`, `reply_samples`…), and **`insightTools`** adds up to 26 insights (`client_report`, `bounce_watch`, `dropped_replies`, `variant_test`…). A tool the adapter cannot serve is left out, so the model is never offered one that cannot work.
- **`tool.call` never throws.** A failure comes back as `{ ok: false, error, next }` for the model to read and fix, and a key the tool does not take is refused with the list of keys it does take, never silently dropped. That is why the schema is loose: the SDK, not Zod, turns the stray key away, with the better message.
- **The file is a `defineDynamic`,** because the tool set depends on the conversation's channel. It builds no network request, so it is cheap to run before every model call.

## Schedules

| Schedule | When | What |
| --- | --- | --- |
| `weekly-client-reports` | Mondays 08:00 New York | A new thread in each client's shared channel with last week's report. The session runs in that channel, so it sees that client only. |
| `morning-check` | Weekdays 09:00 New York | Unanswered positive replies, bounce rates over 3%, senders in error and campaigns running out of leads, across every client, to the team's channel. Nothing is posted on a quiet morning. |

Both pass an `idempotencyKey` per day or week, so a retried run reaches the same thread instead of posting twice. `eve dev` doesn't run schedules on their own; fire one by hand:

```sh
curl -X POST http://localhost:2000/eve/v1/dev/schedules/weekly-client-reports
```

## Evals

```sh
npm run eval
```

Four evals run against a real model on the demo data: a missing count is reported as missing, not zero; a request to pause a campaign is refused; the weekly report follows the skill and flags the bounce spike; and the unanswered positive reply is found. They need a model key, not a vendor key.

## Deploy

```sh
eve deploy
```

Set the same environment variables on the deployment. On Vercel each schedule becomes a Vercel schedule.

## Things to know

- **A combined instance can only do what every member can.** With Instantly and HeyReach clients side by side, the agency-wide view gives up what HeyReach cannot read, such as reply categories. In a client's own channel the tools see that client's vendor in full.
- **Smartlead is unverified.** Its adapter has never been run against a live account; the agent says so when it quotes Smartlead numbers. See [what is verified](https://outbound-sdk.dev/docs/status).
- **Prospect data goes to your model provider.** Tool results can include lead emails and, when asked for, reply text. To mask them, add `redact()` from `outbound-sdk/redact` to the plugins in `agent/lib/outbound.ts`; tools that need the masked fields are then left out or refuse.
- **For the full answering rules,** copy the SDK's [`outbound-sdk-answering`](https://github.com/orchidautomation/outbound-sdk/tree/main/skills/outbound-sdk-answering) skill into `agent/skills/`. `instructions.md` carries the rules that matter on every turn.
