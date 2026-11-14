---
"outbound-sdk": minor
---

Draw cards in Slack with its newer blocks. `toSlackBlocks` and `toSlackMessage` now default to a `rich` style: numbers as a bordered grid of tiles, a short list of leads or replies as cards side by side, data table cells that sort as numbers, and a primary button. `style: "plain"` writes what Chat SDK's Slack adapter writes, as before. `alertCard` shows a rate as a percentage, and the bounce section of a digest no longer repeats its headline.
