# Cards

`outbound-sdk/cards` turns every tool and insight answer into a card: a headline, a few numbers, a table and a chart, ready to post in Slack or draw in an app.

A card is built from the numbers the tool returned. No model writes it, so a number on a card is the number that was read, and a count the vendor does not report is a dash, never a zero.

```ts
import { cardFor, toSlackMessage } from "outbound-sdk/cards";
import { createTools } from "outbound-sdk/tools";

const [overview] = createTools(outbound, { only: ["campaign_overview"] });
const card = cardFor(overview.name, await overview.call({}));

await fetch(process.env.SLACK_WEBHOOK_URL, {
  body: JSON.stringify(toSlackMessage(card)),
  headers: { "content-type": "application/json" },
  method: "POST",
});
```

The package adds no dependency. `cardFor` never throws: a failed result becomes a card that says what failed, and a tool of your own with no card gets one that lists its plain values.

## The card format

A card is a [json-render](https://json-render.dev) spec for the chat catalog (`@json-render/chat`): a flat map of elements under a root `Card`, using `Text`, `Fields`, `Table`, `Chart`, `Divider` and `Actions`. One spec goes to four places:

| Where | How |
| --- | --- |
| Slack, with no package | `toSlackMessage(card)` or `toSlackBlocks(card)` |
| Slack, Teams, Discord and Google Chat through [Chat SDK](https://chat-sdk.dev) | `thread.post(toCard(card))`, with `toCard` from `@json-render/chat` |
| A web app | any json-render renderer with a registry for those components |
| An agent that composes its own layout | give it the catalog, and the tool results as data |

`toSlackBlocks` writes the same blocks Chat SDK's Slack adapter writes for the same card. The test suite holds every card to both: the json-render chat catalog must accept the spec inside Slack's limits, and the two block lists must be equal.

## What each card shows

Every tool in [tools-and-webhooks.md](tools-and-webhooks.md) and every insight in [insights.md](insights.md) has a card; `CARD_NAMES` lists them. Each one has the same parts, in the same order:

- **A finding.** The one sentence to read if nothing else is read, such as "🔴 3 of 12 senders need attention." A check that had nothing to read says so; it does not show green.
- **Numbers.** Up to twenty, as label and value.
- **A list or a table.** Cut to eight rows, with a line saying how many more there are. `maxRows` changes the cut.
- **A chart**, where the answer has a series or a split: reply rate by campaign, replies by weekday, a count per day.
- **The source.** The evidence level, the provider and the number of vendor requests, then the insight's notes. A read a cap stopped early is marked incomplete.

```ts
cardFor("hot_leads", result, {
  links: [{ label: "Open in Instantly", url: campaignUrl }],
  maxRows: 5,
});
```

The SDK is read-only, so a card has link buttons and nothing that writes.

## One message for the morning

`digest` puts several results in one message, each cut to its finding, its first two numbers and its first three lines. It shows nine sections at most, so the message fits what Slack accepts.

```ts
import { digest, toSlackMessage } from "outbound-sdk/cards";
import { insightTools } from "outbound-sdk/insights";

const tools = insightTools(outbound, {
  only: ["dropped_replies", "bounce_watch", "hot_leads"],
});

const sections = await Promise.all(
  tools.map(async (tool) => ({ name: tool.name, result: await tool.call({}) }))
);

const message = toSlackMessage(
  digest({
    sections,
    subtitle: "Friday 14 November",
    title: "Outbound this morning",
  })
);
```

## Events and alerts

`eventCard(event)` draws one webhook event from `outbound-sdk/webhooks`, for a channel that should hear about each reply or bounce as it happens. `alertCard(alert)` draws one alert from the alerts plugin's `notify`.

```ts
import { eventCard, toSlackMessage } from "outbound-sdk/cards";
import { parse } from "outbound-sdk/webhooks";

export async function POST(request: Request) {
  const events = await parse(request, { provider: "instantly", secret });

  for (const event of events.filter((one) => one.type === "reply.received")) {
    await postToSlack(toSlackMessage(eventCard(event)));
  }

  return new Response(null, { status: 204 });
}
```

## Text from prospects

A reply can contain `<!channel>`, a link or an instruction. Every string a card takes from a vendor or a prospect is made inert first: angle brackets become look-alikes, a markdown link loses its join, a code fence is broken and `@channel`, `@here` and `@everyone` are split. `safe` is exported for text you add yourself.

Message text is shown only when it was asked for (`include_bodies` on the tool, `includeText` on `eventCard`), as a quote, cut short, with a note that it is data. The raw response of `vendor_read` is never drawn.

## From the command line

`--card` prints a tool's or an insight's card, and `--slack` prints it as a Slack message:

```sh
outbound insight bounce_watch --slack --compact \
  | curl -X POST -H 'content-type: application/json' -d @- "$SLACK_WEBHOOK_URL"
```
