---
"outbound-sdk": minor
---

Add `outbound-sdk/cards`: every tool and insight answer as a card. A card is a json-render spec for the chat catalog, built from the numbers the tool returned, with `toSlackMessage` to post it to Slack with no other package, `digest` for one message made of several results, and `eventCard` and `alertCard` for webhook events and alerts. `outbound tool` and `outbound insight` take `--card` and `--slack`.
