import { outbound } from "./cli.ts";

await outbound("replies", "--category", "positive", "--limit", "1");

await outbound("replies", "--by", "person");

await outbound(
  "replies",
  "--campaign",
  "cmp_founders",
  "--since",
  "2026-11-12T00:00:00Z",
  "--bodies",
  "--compact"
);

await outbound("thread", "thr_1", "--bodies");
