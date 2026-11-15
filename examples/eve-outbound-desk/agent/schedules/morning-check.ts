// Weekdays 09:00 New York: one look across every client for what a person
// should act on today, posted to the team's own channel. On a quiet morning
// the agent calls no_reply and nothing is posted.

import { defineSchedule } from "eve/schedules";

import slack from "../channels/slack";
import { OPS_CHANNEL_ID } from "../lib/clients";

const PROMPT = `Morning check across every client. Look for, in this order:
1. Positive replies nobody has answered (dropped_replies).
2. Campaigns whose bounce rate is over 3% (bounce_watch).
3. Senders that are paused, disconnected or in error (sender_health).
4. Active campaigns with under a week of leads left (lead_runway, one active campaign at a time).
Post one short message: a line per item that needs a person today, with the client, the campaign or sender, and the number behind it. Leave out anything that is fine. If nothing needs a person today, call no_reply.`;

export default defineSchedule({
  cron: "0 9 * * 1-5",
  timezone: "America/New_York",
  run({ to, waitUntil, appAuth }) {
    if (OPS_CHANNEL_ID === undefined || OPS_CHANNEL_ID === "") {
      return;
    }

    waitUntil(
      to(slack, { channelId: OPS_CHANNEL_ID }).send(PROMPT, {
        auth: appAuth,
        idempotencyKey: `morning-check:${new Date().toISOString().slice(0, 10)}`,
      })
    );
  },
});
