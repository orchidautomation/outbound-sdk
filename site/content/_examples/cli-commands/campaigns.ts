import { outbound } from "./cli.ts";

await outbound("campaigns", "--status", "paused", "--limit", "1");

await outbound("campaign", "cmp_founders");

await outbound(
  "campaign",
  "cmp_founders",
  "--stats",
  "--from",
  "2026-11-11",
  "--to",
  "2026-11-11"
);

await outbound(
  "campaign",
  "cmp_founders",
  "--stats",
  "--by",
  "day",
  "--compact"
);

await outbound("campaign", "cmp_founders", "--sequence");

await outbound("campaign", "cmp_founders", "--subsequences");

await outbound("campaign", "cmp_founders", "--settings");
