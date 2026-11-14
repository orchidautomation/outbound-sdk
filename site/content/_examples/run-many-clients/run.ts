import { outbound } from "./instance.ts";

// Every member's campaigns in one listing. The ref says whose each one is.
console.log("Every campaign:");

for await (const campaign of outbound.campaigns.listAll()) {
  console.log(`  ${campaign.ref}  ${campaign.name}`);
}

// One client. The label is on two adapters, so the scope covers both tools.
const acme = outbound.workspace("acme");
const names = await acme.campaigns.listAll().toArray();

console.log(`\nacme (${acme.provider}): ${names.length} campaigns`);

// A label on one adapter scopes to that adapter, and a bare id works there.
const globex = outbound.workspace("globex");
const campaign = await globex.campaigns.get("cmp_1");

console.log(`globex (${globex.provider}): cmp_1 is "${campaign.name}"`);

// Plugins come along: the scoped instance still has `clients`.
for (const row of await acme.clients.stats()) {
  console.log(
    `acme via clients.stats(): ${row.campaigns} campaigns, sent ${row.counts.sent}, connections sent ${row.counts.connectionsSent}`
  );
}

// Workspace stats: one row per member, side by side. Nothing is added up.
console.log("\nWorkspace stats:");

const workspaceStats = await outbound.stats();

for (const row of workspaceStats.rows) {
  console.log(
    `  ${row.provider}:${row.workspaceId}  sent ${row.sent}, connections sent ${row.connectionsSent}`
  );
}

// The same numbers per client, added up from each client's campaigns.
console.log("\nPer client:");

for (const row of await outbound.clients.stats()) {
  console.log(
    `  ${row.client}: ${row.campaigns} campaigns, sent ${row.counts.sent}, replied ${row.counts.replied}`
  );
}
