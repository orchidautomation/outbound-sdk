import process from "node:process";

import { outbound } from "../cli-commands/cli.ts";

await outbound("campaign", "no-such-campaign");

await outbound("campaign");

await outbound("campaigns", "--limit", "0");

// A flag that takes a fixed word names the words it takes.
await outbound("campaigns", "--status", "live");

await outbound("stats", "--by", "week");

await outbound("tool", "sender_health", "--input", "{oops");

await outbound("native", "inboxUnreadCount");

await outbound("send");

await outbound("campaigns", "--provider", "mailchimp");

// With no provider chosen, a command that needs an adapter says what to set.
delete process.env.OUTBOUND_SDK_PROVIDER;

console.log("$ unset OUTBOUND_SDK_PROVIDER");

await outbound("campaigns");

// `providers` and `help` need no adapter, so they still work.
await outbound("providers", "--compact");
