import { parse, webhookProviders } from "outbound-sdk/webhooks";

import { payload, payloadNames, post } from "./fixtures.ts";

const row = (cells: readonly string[]) =>
  [cells[0]?.padEnd(10), cells[1]?.padEnd(36), cells[2]?.padEnd(25), cells[3]]
    .join(" ")
    .trimEnd();

console.log(row(["provider", "documented payload", "type", "data.category"]));

for (const provider of webhookProviders()) {
  for (const name of payloadNames(provider)) {
    // oxlint-disable-next-line no-await-in-loop -- one payload at a time keeps the table in order.
    const events = await parse(post(payload(provider, name)), { provider });

    for (const event of events) {
      console.log(
        row([
          provider,
          name.slice("webhook.".length, -".json".length),
          event.type,
          String(event.data.category ?? ""),
        ])
      );
    }
  }
}
