import { receive } from "./inbox.ts";

const { log, received } = await receive();

console.log(log.join("\n"));

console.log(`\n${received.length} events kept:`);

for (const { event, receivedAt } of received) {
  console.log(
    `  ${event.type} ${event.messageRef ?? "(names no message)"} at ${event.occurredAt}, received ${receivedAt}`
  );
}
