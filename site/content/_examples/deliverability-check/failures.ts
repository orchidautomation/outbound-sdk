import { createOutbound, OutboundError } from "outbound-sdk";
import { alerts, senderNotActive } from "outbound-sdk/alerts";
import { insights } from "outbound-sdk/insights";
import { memory } from "outbound-sdk/memory";

import { seed } from "./seed.ts";

// 1. A notifier that throws. The read it was reporting on still succeeds,
//    and nobody is told: catch and log inside your notifier.
const broken = createOutbound({
  adapter: memory({ data: seed, workspaceId: "acme" }),
  plugins: [
    alerts({
      notify: () => {
        throw new Error("Slack is down");
      },
      rules: [senderNotActive()],
    }),
  ],
});

const senders = await broken.senders.listAll().toArray();

console.log("notifier threw:", senders.length, "senders still read");

const outbound = createOutbound({
  adapter: memory({ data: seed, workspaceId: "acme" }),
  plugins: [insights()],
});

// 2. More senders than the cap. The answer covers the senders read.
const capped = await outbound.insights.domainHealth({ max_senders: 2 });

console.log("capped:", capped.meta.complete, capped.meta.notes);

// 3. A domain the vendor reports nothing about is `unknown`, not `low`.
const silent = createOutbound({
  adapter: memory({
    data: { senders: [{ address: "eve@new.example.com", id: "snd_eve" }] },
  }),
  plugins: [insights()],
});

const unreported = await silent.insights.domainHealth({});
const [domain] = unreported.data.domains;

console.log("nothing reported:", domain?.risk, domain?.notReported);

// 4. An adapter without stats per sender. The campaigns are still checked;
//    the senders behind them are not, and a note says so.
const noSenderStats = createOutbound({
  adapter: memory({ capabilities: { "stats.bySender": false }, data: seed }),
  plugins: [insights()],
});

const watch = await noSenderStats.insights.bounceWatch({});

console.log(
  "no sender stats:",
  watch.data.over.map((campaign) => campaign.senders),
  watch.meta.notes
);

// 5. An adapter that cannot read sender health refuses domainHealth.
const noHealth = createOutbound({
  adapter: memory({ capabilities: { "senders.health": false }, data: seed }),
  plugins: [insights()],
});

try {
  await noHealth.insights.domainHealth({});
} catch (error) {
  if (OutboundError.is(error)) {
    console.log("no health:", error.code, "-", error.message);
  }
}
