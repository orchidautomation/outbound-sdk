import process from "node:process";

import { outbound } from "../cli-commands/cli.ts";

await outbound("campaign", "no-such-campaign", "--compact");

await outbound("campaign", "--compact");

await outbound("campaigns", "--limit", "0", "--compact");

// A flag that takes a fixed word names the words it takes.
await outbound("campaigns", "--status", "live", "--compact");

await outbound("stats", "--by", "week", "--compact");

await outbound("tool", "sender_health", "--input", "{oops", "--compact");

await outbound("native", "inboxUnreadCount", "--compact");

await outbound("send", "--compact");

await outbound("campaigns", "--provider", "mailchimp", "--compact");

// With no provider chosen and no vendor key set, a command that needs an
// adapter says what to set. With keys set, it reads every vendor that has one.
for (const name of [
  "OUTBOUND_SDK_PROVIDER",
  "INSTANTLY_API_KEY",
  "SMARTLEAD_API_KEY",
  "HEYREACH_API_KEY",
]) {
  Reflect.deleteProperty(process.env, name);
}

console.log(
  "$ unset OUTBOUND_SDK_PROVIDER INSTANTLY_API_KEY SMARTLEAD_API_KEY HEYREACH_API_KEY"
);

await outbound("campaigns", "--compact");

// `providers` and `help` need no adapter, so they still work.
await outbound("providers", "--compact");
