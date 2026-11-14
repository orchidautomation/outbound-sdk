// Every Smartlead read that has no normalized form, by name. A native read
// returns the vendor's payload as sent. site/content/docs/coverage/smartlead.mdx lists
// every endpoint Smartlead documents and which of these reads it.
//
// Left out on purpose, because they return secrets: client API keys, a
// mailbox looked up by address (its payload carries the SMTP and IMAP
// passwords), SmartSenders orders and one-time passwords, and the whitelabel
// credentials of `GET /client/{id}` (`includeWhitelabel` is not a parameter).

import { defineNative } from "../internal/native.ts";
import type { NativeRead } from "../internal/native.ts";
import { ANALYTICS } from "./native-analytics.ts";
import { CAMPAIGN_READS } from "./native-campaigns.ts";
import { INBOX } from "./native-inbox.ts";
import { DELIVERY, SERVICES } from "./native-services.ts";

export const NATIVE = defineNative({
  ...ANALYTICS,
  ...CAMPAIGN_READS,
  ...INBOX,
  ...DELIVERY,
  ...SERVICES,
});

export type SmartleadNative = typeof NATIVE;

const escaped = (part: string): string =>
  part.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`);

// Ids on the main API are numbers; the sister services use other ids.
const pattern = (read: NativeRead): RegExp => {
  const id = read.baseUrl === undefined ? String.raw`\d+` : "[^/]+";

  const route = read.path
    .split(/\{[^}]+\}/u)
    .map(escaped)
    .join(id)
    .replace(/\/$/u, "");

  return new RegExp(`^${route}$`, "u");
};

/** The catalogued reads Smartlead serves over POST, as path patterns. */
export const NATIVE_READ_POSTS: readonly RegExp[] = Object.values<NativeRead>(
  NATIVE
)
  .filter((read) => read.method === "POST")
  .map(pattern);
