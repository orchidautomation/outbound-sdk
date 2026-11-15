import { outbound } from "./cli.ts";

await outbound("senders", "--limit", "1");

await outbound("health", "mbx_1");

await outbound("leads", "--campaign", "cmp_founders", "--limit", "1");

await outbound("leads", "--list", "lst_founders", "--compact");

await outbound("lists");

// `leads` takes no --since: refused, not ignored.
await outbound("leads", "--since", "2030-01-01");
