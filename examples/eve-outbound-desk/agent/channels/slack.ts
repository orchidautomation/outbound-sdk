// Slack, with portable credentials (SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET),
// as `eve add channel/slack` wrote it, plus two things:
//
// - It follows its own threads. A reply without a mention, in a thread the
//   agent is already part of, goes to Jev first (lib/follow-up.ts): one cheap
//   yes/no on whether the reply is meant for the agent. Only a yes starts a
//   turn. Mentions and DMs need no check; everything else is ignored.
// - After the agent's reply posts, the numbers behind it post underneath as
//   outbound-sdk cards, drawn in Slack's own blocks, with a missing count
//   shown as "—", not 0.

import {
  defaultSlackAuth,
  defineSlackRenderer,
  slackChannel,
} from "eve/channels/slack";
import { calls } from "eve/events";

import { cardMessages } from "../lib/cards";
import { isMeantForAgent } from "../lib/follow-up";
import { slackScope } from "../lib/slack-scope";

const FOLLOW_UP_GUIDANCE =
  "This reply in your thread doesn't mention you. A screening model judged it is meant for you, so answer it. If it clearly isn't, call `no_reply`.";

const EDIT_GUIDANCE =
  "Someone edited a message in your thread. Answer only if the edit changes what you should say; otherwise call `no_reply`.";

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

export default slackChannel({
  async onMessage(ctx, message) {
    // Another bot in the thread would loop.
    if (message.author?.isBot !== false) {
      return null;
    }

    const auth = defaultSlackAuth(message, ctx);

    // Addressed to the agent: no check needed.
    if (ctx.isBotMentioned() || message.raw.channel_type === "im") {
      return { auth };
    }

    // Top-level messages need a mention, and so does any thread the agent
    // isn't already part of.
    const inAgentThread =
      message.threadTs !== message.ts && (await ctx.isSubscribed());

    if (!(ctx.edit || inAgentThread)) {
      return null;
    }

    // A conversation with no client data gets nothing unmentioned.
    if (slackScope(message.channelId, message.author.userId).kind === "none") {
      return null;
    }

    if (ctx.edit) {
      return { auth, guidance: EDIT_GUIDANCE, status: "deferred" };
    }

    return (await isMeantForAgent(ctx.thread, message))
      ? { auth, guidance: FOLLOW_UP_GUIDANCE, status: "deferred" }
      : null;
  },
  renderers: [outboundCards],
});
