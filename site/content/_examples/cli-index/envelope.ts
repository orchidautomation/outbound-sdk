import { outbound } from "../cli-commands/cli.ts";

// A list in data.items; meta.complete says --limit cut it.
await outbound("campaigns", "--limit", "1");

// A failure is an envelope too, with ok: false.
await outbound("thread", "no-such-thread", "--compact");
