import { carriesSecret, timingSafeEqual } from "outbound-sdk/webhooks";

const SECRET = "example-shared-secret";

// The check `parse` runs for a vendor that does not sign, on its own.
console.log(
  carriesSecret(`https://your.app/hooks/${SECRET}`, new Headers(), SECRET),
  carriesSecret(
    "https://your.app/hooks/outbound",
    new Headers({ "x-webhook-secret": SECRET }),
    SECRET
  ),
  carriesSecret("https://your.app/hooks/outbound", new Headers(), SECRET)
);

// A comparison that takes the same time whether or not the strings match.
console.log(
  timingSafeEqual("abc", "abc"),
  timingSafeEqual("abc", "abd"),
  timingSafeEqual("abc", "abcd")
);
