import { timingSafeEqual } from "outbound-sdk/webhooks";

// Generated once, kept with your other secrets, and registered with the
// vendor as part of the webhook URL.
const bytes = crypto.getRandomValues(new Uint8Array(32));
const secret = Buffer.from(bytes).toString("base64url");
const registered = `https://your.app/hooks/heyreach/${secret}`;

/** Whether a delivery came to the URL that holds the secret. */
const authentic = (url: string): boolean => {
  const segment = new URL(url).pathname.split("/").at(-1) ?? "";

  return timingSafeEqual(segment, secret);
};

console.log("secret length:", secret.length);

console.log("registered URL:", authentic(registered));

console.log("guessed URL:", authentic("https://your.app/hooks/heyreach/guess"));

console.log("no secret:", authentic("https://your.app/hooks/heyreach/"));
