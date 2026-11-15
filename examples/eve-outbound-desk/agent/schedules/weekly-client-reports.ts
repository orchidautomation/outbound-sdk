// Monday 08:00 New York: each client with a shared channel gets its weekly
// report there, as a new thread the team and the client can reply in. The
// session runs in the client's channel, so its tools see that client only.

import { defineSchedule } from "eve/schedules";

import slack from "../channels/slack";
import { CLIENTS } from "../lib/clients";

export default defineSchedule({
  cron: "0 8 * * 1",
  timezone: "America/New_York",
  run({ to, waitUntil, appAuth }) {
    const week = new Date().toISOString().slice(0, 10);

    for (const client of CLIENTS) {
      if (client.slackChannelId === undefined) {
        continue;
      }

      waitUntil(
        to(slack, { channelId: client.slackChannelId }).send(
          `Write ${client.name}'s weekly outreach report for the last 7 days. Load the weekly-client-report skill and follow it.`,
          {
            auth: appAuth,
            // A retried run reaches the same thread instead of posting twice.
            idempotencyKey: `weekly-report:${client.id}:${week}`,
          }
        )
      );
    }
  },
});
