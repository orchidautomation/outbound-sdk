// outbound.raw judges the URL that is sent, not the path as typed, and never
// reads an endpoint whose response holds secrets.

import assert from "node:assert/strict";
import { test } from "node:test";

import { heyreach } from "../src/heyreach/index.ts";
import { createOutbound, OutboundError } from "../src/index.ts";
import type { Adapter, NativeCatalog } from "../src/index.ts";
import { instantly } from "../src/instantly/index.ts";
import { smartlead } from "../src/smartlead/index.ts";
import { createFetch, json } from "./helpers/http.ts";

const KEY = "test_key_0123456789abcdef";

const client = (adapter: Adapter<NativeCatalog>, allowWrites = false) => {
  const http = createFetch(() => json({ ok: true }));

  return {
    outbound: createOutbound({ adapter, allowWrites, fetch: http.fetch }),
    requests: http.requests,
  };
};

const code = async (action: () => unknown): Promise<string> => {
  try {
    await action();

    return "sent";
  } catch (error) {
    return OutboundError.is(error) ? error.code : String(error);
  }
};

const SECRET_READS: [string, () => Adapter<NativeCatalog>, string[]][] = [
  [
    "instantly",
    () => instantly({ apiKey: KEY }),
    [
      "/api-keys",
      "/api-keys/",
      "/API-KEYS",
      "/api-keys/abc",
      "/campaigns/../api-keys",
      "/./api-keys",
      "//api-keys",
      "/api-keys?limit=10",
      "/api-keys#x",
    ],
  ],
  [
    "smartlead",
    () => smartlead({ apiKey: KEY }),
    [
      "/client/api-key",
      "/client//api-key",
      "/client/./api-key",
      "/campaigns/../client/api-key",
      "/email-accounts/fetch-email-account-details",
      "/email-accounts/Fetch-Email-Account-Details?username=a",
      "/smart-senders/auth-secret",
      "/smart-senders/order-details",
      "/smart-senders/x/../order-details",
    ],
  ],
  [
    "heyreach",
    () => heyreach({ apiKey: KEY }),
    [
      "/li_account/GetAccountProxy/1",
      "/li_account/./GetAccountProxy/1",
      "/x/../li_account/GetAccountProxy/1",
      "/li_account//GetAccountProxy/1",
      "/LI_ACCOUNT/getaccountproxy/1",
      "/management/organizations/api-keys/workspaces/1",
      "/management/organizations/x/../api-keys/workspaces/1",
      "/management//organizations/api-keys/workspaces/1",
    ],
  ],
];

for (const [name, make, paths] of SECRET_READS) {
  test(`${name}: raw never reads an endpoint that returns secrets, however the path is spelled`, async () => {
    for (const allowWrites of [false, true]) {
      const { outbound, requests } = client(make(), allowWrites);

      for (const path of paths) {
        // oxlint-disable-next-line no-await-in-loop -- one path at a time keeps the failure readable.
        const result = await code(() => outbound.raw.get(path));

        assert.equal(
          result,
          "Unsupported",
          `${path} with allowWrites ${allowWrites}`
        );
      }

      assert.equal(requests.length, 0, "nothing was sent");
    }
  });
}

test("a path that hides a separator in percent-encoding, or uses a backslash, is refused as Invalid", async () => {
  const { outbound, requests } = client(heyreach({ apiKey: KEY }), true);

  for (const path of [
    "/li_account/GetAccountProxy%2F1",
    "/li_account%2fGetAccountProxy/1",
    "/li_account/%2e%2e/li_account/GetAccountProxy/1",
    "/li_account/%2E/GetAccountProxy/1",
    "/li_account%5CGetAccountProxy/1",
    String.raw`/li_account\GetAccountProxy/1`,
  ]) {
    // oxlint-disable-next-line no-await-in-loop -- one path at a time keeps the failure readable.
    assert.equal(await code(() => outbound.raw.get(path)), "Invalid", path);
  }

  assert.equal(requests.length, 0);
});

test("a secret that a parameter switches on is refused, and the same read without it is sent", async () => {
  const instant = client(instantly({ apiKey: KEY }));
  const dfy = "/dfy-email-account-orders/accounts";

  assert.equal(
    await code(() =>
      instant.outbound.raw.get(dfy, { query: { with_passwords: true } })
    ),
    "Unsupported"
  );
  assert.equal(
    await code(() => instant.outbound.raw.get(`${dfy}?with_passwords=1`)),
    "Unsupported",
    "also when the parameter is typed into the path"
  );
  assert.equal(await code(() => instant.outbound.raw.get(dfy)), "sent");
  assert.equal(
    await code(() =>
      instant.outbound.raw.get(dfy, { query: { with_passwords: false } })
    ),
    "sent"
  );

  const smart = client(smartlead({ apiKey: KEY }));

  assert.equal(
    await code(() =>
      smart.outbound.raw.get("/client/7", {
        query: { includeWhitelabel: "true" },
      })
    ),
    "Unsupported"
  );
  assert.equal(await code(() => smart.outbound.raw.get("/client/7")), "sent");
  assert.equal(smart.requests.length, 1);
});

test("the read-only rule is applied to the path that is sent", async () => {
  const { outbound, requests } = client(instantly({ apiKey: KEY }));

  // A write spelled so that the typed path looks like a known POST read.
  for (const path of [
    "/leads/list/../../campaigns",
    "/leads/list/../",
    "/leads//list/../x",
  ]) {
    // oxlint-disable-next-line no-await-in-loop -- one path at a time keeps the failure readable.
    const result = await code(() => outbound.raw.request("POST", path));
    assert.equal(result, "Unsupported", path);
  }

  assert.equal(requests.length, 0);

  // A known POST read is still a read when spelled with extra slashes or a dot segment.
  await outbound.raw.request("POST", "/leads/./list");
  await outbound.raw.request("POST", "//leads//list/");

  assert.deepEqual(
    requests.map((request) => new URL(request.url).pathname),
    ["/api/v2/leads/list", "/api/v2/leads/list"],
    "the normalized path is what is sent"
  );
});

test("a path cannot leave the vendor's API or its host", async () => {
  const { outbound, requests } = client(instantly({ apiKey: KEY }));

  for (const path of ["/../../v1/campaigns", "/../admin", "../../x"]) {
    // oxlint-disable-next-line no-await-in-loop -- one path at a time keeps the failure readable.
    assert.equal(await code(() => outbound.raw.get(path)), "Unsupported", path);
  }

  assert.equal(requests.length, 0);
  await outbound.raw.get("//evil.example/campaigns");
  await outbound.raw.get("https://evil.example/campaigns");

  assert.deepEqual(
    requests.map((request) => new URL(request.url).host),
    ["api.instantly.ai", "api.instantly.ai"],
    "a host in the path is only a path"
  );
});
