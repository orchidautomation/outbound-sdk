---
"outbound-sdk": minor
---

Read bounces and HeyReach auto-replies with fixed rules, and keep the rules' own verdict beside the vendor's flag (OUT-195).

- Messages and replies carry `rule: { autoReply, bounce, reason }`, the fixed rules' verdict, on every adapter that reads received mail. It is kept even when the vendor's flag decides `isAuto`, so a reply the vendor calls a person but a rule calls an out-of-office can be found.
- New bounce rules: a `mailer-daemon@` or `postmaster@` sender, an `Undeliverable:` or `Delivery Status Notification` subject, and a body such as "could not be delivered" or an SMTP code like `550 5.1.1`. A bounce still sets `isAuto`.
- HeyReach messages and replies now get `isAuto`, `isAutoSource: "rule"` and `leftCompany` from the fixed rules. HeyReach flags no message as automatic, and its Generic auto-tag mixes an out-of-office with neutral answers.
- `detectAutoReply`, `detectBounce` and `AUTO_REPLY_WITHIN_MS` are exported, so a caller can run the same rules on its own text.
