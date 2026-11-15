// outbound-sdk/clients: which key, workspace or campaign belongs to which
// client. A key and a client do not always match one-to-one: one key can
// cover several clients as campaigns, and one client can span several keys.
//
// By default one workspace is one client. With rules, the first rule that
// matches decides; anything matching no rule is `unassigned`, never placed
// in a client by guesswork.

export { UNASSIGNED, clients } from "./plugin.ts";

export type {
  ClientRule,
  ClientStats,
  ClientStatsOptions,
  ClientStatsRead,
  ClientsExtension,
  ClientsOptions,
} from "./plugin.ts";
