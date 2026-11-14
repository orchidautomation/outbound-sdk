import { outbound } from "./outbound.ts";

const { data } = await outbound.insights.channelMix({});

console.log(data.finding);

for (const channel of data.channels) {
  console.log(
    `${channel.channel}, campaigns ${channel.campaigns}: ${channel.replied} replies from ${channel.contacted} leads (${channel.replyRate.rate}), acceptance ${channel.acceptance?.rate ?? "not applicable"}`
  );
}
