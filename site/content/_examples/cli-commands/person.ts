import { outbound } from "./cli.ts";

// One person, by email or LinkedIn URL: every campaign they are in, in every
// tool the CLI reads. The demo data is one tool; with several keys set, the
// same command asks each of them.
await outbound("person", "person1@example.com", "--compact");

await outbound("person", "nobody@example.com", "--compact");

// Masked emails cannot be matched, so with redact on the lookup refuses
// instead of reporting a known person as not found.
await outbound("person", "person1@example.com", "--redact");

await outbound("person");
