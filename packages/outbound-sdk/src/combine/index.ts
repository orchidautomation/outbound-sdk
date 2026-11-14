// outbound-sdk/combine: several adapters or keys behind one instance.
//
// The combined instance promises only what every member can do, and every
// record keeps its own provider and workspace, so data from two tools or two
// clients can never be confused. It reads every tool live and keeps nothing:
// each call pays each vendor's rate limit, on that vendor's own budget.

export { combine } from "./adapter.ts";

export { COMBINED } from "./route.ts";
