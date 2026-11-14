import { outbound } from "./cli.ts";

await outbound("stats", "--from", "2026-10-01", "--to", "2026-10-31");

await outbound("stats", "--by", "day", "--compact");

await outbound("tags");

await outbound("blocklist");

await outbound("webhooks");

await outbound("limits");
