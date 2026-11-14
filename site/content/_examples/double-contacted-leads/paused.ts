import { outbound } from "./agency.ts";

// By default only active campaigns are read. A paused campaign that will be
// resumed is worth checking too.
const { data } = await outbound.insights.leadCollisions({
  statuses: ["active", "paused"],
});

for (const person of data.collisions) {
  console.log(person.finding, `Still active in ${person.stillActive}.`);
}
