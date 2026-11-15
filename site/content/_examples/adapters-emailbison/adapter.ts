import { createOutbound } from "outbound-sdk";
import { emailbison } from "outbound-sdk/emailbison";

// `apiKey` defaults to EMAILBISON_API_KEY, and `baseUrl` to
// EMAILBISON_BASE_URL: the URL you log in to EmailBison with.
const outbound = createOutbound({
  adapter: emailbison({
    apiKey: "your-api-key",
    baseUrl: "https://send.example.com",
    workspaceId: "acme",
  }),
});

// Nothing below makes a request.
console.log(outbound.provider, outbound.maturity, outbound.workspaceId);

console.log("webhook check:", outbound.capabilities["events.verify"]);

console.log("native reads:", Object.keys(outbound.native.catalog).length);

// The rate budget the SDK keeps to: the declared limit times `share` (0.5).
for (const snapshot of await outbound.limits()) {
  for (const window of snapshot.windows) {
    console.log(
      `${window.lane}: ${window.requests} per ${window.perMs / 1000}s`
    );
  }
}

// What a read costs in vendor requests, before making it.
for (const action of [
  "campaigns.list",
  "campaigns.settings",
  "senders.health",
  "leads.list",
]) {
  console.log(action, "-", outbound.estimate({ action, records: 250 }).basis);
}
