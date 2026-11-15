// Slack, with portable credentials (SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET),
// as `eve add channel/slack` wrote it, plus one renderer: after the agent's
// reply posts, the numbers behind it post underneath as outbound-sdk cards,
// drawn in Slack's own blocks, with a missing count shown as "—", not 0.

import { defineSlackRenderer, slackChannel } from "eve/channels/slack";
import { calls } from "eve/events";

import { cardMessages } from "../lib/cards";

const outboundCards = defineSlackRenderer({
  events: {
    async "content.completed"(event, ctx, next) {
      // eve posts the reply first, or uploads a long one as a snippet.
      await next();

      const turnId = event.scope?.turnId;

      if (
        event.data.phase !== "reply" ||
        event.data.kind !== "text" ||
        turnId === undefined
      ) {
        return;
      }

      try {
        const messages = await cardMessages(
          calls(ctx.view, { kind: "tool", turnId })
        );

        for (const message of messages) {
          // oxlint-disable-next-line no-await-in-loop -- cards post in call order
          await ctx.channel.thread.post(message);
        }
      } catch (error) {
        // The reply is already in the thread. A card that fails to post must
        // not make eve tell the thread the answer was lost.
        console.warn("outbound card was not posted", error);
      }
    },
  },
});

export default slackChannel({ renderers: [outboundCards] });
