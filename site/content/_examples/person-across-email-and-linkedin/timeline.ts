import { outbound } from "./agency.ts";
import { DANA } from "./seed.ts";

// The identity plugin returns the records themselves and every message to
// and from the person, across tools, oldest first.
const person = await outbound.person(DANA);

console.log(`${person.key}: ${person.records.length} records`);

for (const message of person.timeline) {
  console.log(
    `${message.sentAt?.slice(0, 16)} ${message.channel.padEnd(8)} ${message.provider.padEnd(8)} ${message.direction === "in" ? "they replied" : "sent"}`
  );
}
