---
"outbound-sdk": minor
---

`person_summary`, `cross_channel_lead`, `outbound.person()` and `outbound person` accept a lead ref exactly as another tool returned it, an email address or a LinkedIn profile URL (OUT-138). An Instantly reply's `leadRef` (`instantly:<workspace>:<address>`) was taken for an address and sent to Instantly, which answered 400; a ref is now recognised first, and one whose id is already the address or profile is looked up by it with no extra request. The tool and insight take typed `lead_ref`, `email` and `linkedin_url` fields beside `person`; exactly one is given, and a value of the wrong kind, or a ref from a tool or workspace the instance does not read, is `Invalid` before any request. On a combined instance the ref's provider picks the tool it is read from. `person` is no longer marked required in the tools' JSON Schema, since any one of the four fields names the person.
