// The vendors' documented webhook payloads, kept in this repository under
// fixtures/<provider>/webhook.<event>.json with personal data removed.
// They are built from each vendor's documentation, not captured deliveries.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../../../../fixtures");

/** The names of one provider's documented webhook payloads. */
export const payloadNames = (provider: string): string[] =>
  readdirSync(path.join(ROOT, provider))
    .filter((name) => name.startsWith("webhook.") && name.endsWith(".json"))
    .toSorted();

/** One documented payload, as the text a vendor would post. */
export const payload = (provider: string, name: string): string =>
  readFileSync(path.join(ROOT, provider, name), "utf-8");

/** A POST request carrying `body`, as your endpoint would receive it. */
export const post = (
  body: string,
  url = "https://your.app/hooks/outbound",
  headers: Record<string, string> = {}
): Request =>
  new Request(url, {
    body,
    headers: { "content-type": "application/json", ...headers },
    method: "POST",
  });
