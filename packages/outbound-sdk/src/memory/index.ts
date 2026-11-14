// The in-memory adapter: tests the core without a network and powers demos.

export { memory } from "./adapter.ts";

export type { MemoryOptions } from "./adapter.ts";

export type {
  MemoryBlockEntry,
  MemoryHealth,
  MemoryList,
  MemorySettings,
  MemoryTag,
  MemoryWebhook,
} from "./account.ts";

export type {
  MemoryCampaign,
  MemoryData,
  MemoryLead,
  MemoryMessage,
  MemorySender,
  MemoryStats,
  MemoryStep,
  MemorySubsequence,
  MemoryVariant,
} from "./data.ts";

export { demoData } from "./demo.ts";
