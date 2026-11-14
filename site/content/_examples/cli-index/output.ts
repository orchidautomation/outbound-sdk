import { outbound } from "../cli-commands/cli.ts";

await outbound("tags");

await outbound("tags", "--compact");
