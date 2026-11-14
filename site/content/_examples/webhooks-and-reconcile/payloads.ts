// The request bodies on this page are the vendors' documented webhook
// payloads, kept in the repository under fixtures/<provider>/ with personal
// data replaced. None of them was captured from a real delivery.
import { readFileSync } from "node:fs";

const FIXTURES = new URL("../../../../fixtures/", import.meta.url);

export const payload = (provider: string, name: string): string =>
  readFileSync(new URL(`${provider}/webhook.${name}.json`, FIXTURES), "utf-8");

export const SECRET = "whk_example_secret_0001";

/** The request a vendor would send, with the shared secret in a header. */
export const post = (body: string, secret: string = SECRET): Request =>
  new Request("https://app.example.com/hooks/outbound", {
    body,
    headers: {
      "content-type": "application/json",
      "x-webhook-secret": secret,
    },
    method: "POST",
  });
