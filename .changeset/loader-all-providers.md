---
"outbound-sdk": minor
---

`fromEnv({ provider: "all" })`, `OUTBOUND_SDK_PROVIDER=all` and `outbound --provider all` build every provider whose key is set in the environment: one adapter alone, or several behind one combined instance. Setting another vendor's key adds that tool with no code change. `outbound-sdk/loader` also exports `configuredProviders()` and `ALL_PROVIDERS`.
