// outbound-sdk: one small, typed, read-only API over outbound sending tools.
// This file is a thin facade. The implementation is in internal/.

export { createOutbound } from "./internal/outbound/create.ts";

export type { ExtensionsOf, OutboundWith } from "./internal/outbound/create.ts";

export { Outbound } from "./internal/outbound/outbound.ts";

export type { OutboundOptions } from "./internal/outbound/outbound.ts";

export type {
  BulkOptions,
  BulkResult,
  CampaignFilters,
  CampaignHandle,
  Collection,
  Estimate,
  EstimateQuery,
  Include,
  LeadFilters,
  LeadHandle,
  ListAll,
  ListHandle,
  ListAllOptions,
  ListOptions,
  MessageFilters,
  NativeClient,
  NativeParams,
  NativeReads,
  NativeResult,
  OutboundApi,
  PageResult,
  RawClient,
  RawRequestOptions,
  ReadCollection,
  ReplyFilters,
  ResultMeta,
  SenderFilters,
  SenderHandle,
  StatsOptions,
  StatsResult,
  ThreadHandle,
  TopLevelStatsOptions,
  WebhookFilters,
  WithMeta,
} from "./internal/outbound/api.ts";

export type {
  Operation,
  OperationKind,
  OperationOutput,
  OutboundRecord,
} from "./internal/outbound/operations.ts";

export type {
  NextOperation,
  OperationInfo,
  OutboundPlugin,
} from "./internal/outbound/plugins.ts";

export { makeErrorMapper, OutboundError } from "./internal/errors.ts";

export type {
  ErrorMapper,
  ErrorMapperOptions,
  HttpFailure,
  OutboundErrorCode,
  OutboundErrorOptions,
  PartialWalk,
  RequestLimit,
} from "./internal/errors.ts";

// oxlint-disable-next-line oxc/no-barrel-file -- this file is the package's one public entry by design, and records.ts names every export it adds.
export * from "./internal/records.ts";

export { defineNative } from "./internal/native.ts";

export type {
  NativeCatalog,
  NativeParam,
  NativeParamsOf,
  NativeRead,
  NoNative,
} from "./internal/native.ts";

export {
  CAPABILITY_KEYS,
  intersectCapabilities,
  NO_CAPABILITIES,
  resolveCapabilities,
} from "./internal/capabilities.ts";

export type {
  Capabilities,
  CapabilityDeclaration,
  CapabilityKey,
  FilterGrade,
  StatGrade,
} from "./internal/capabilities.ts";

export type {
  Adapter,
  AdapterContext,
  CampaignQuery,
  EventFormat,
  HttpMethod,
  LeadQuery,
  Maturity,
  MessageQuery,
  OperationCost,
  Page,
  PageQuery,
  RawDescriptor,
  ReplyQuery,
  RequestSpec,
  SenderQuery,
  StatsQuery,
  TimeRange,
  VendorResponse,
  WebhookRequest,
} from "./internal/adapter.ts";

export { MemoryRateLimitStore } from "./internal/engine/rate-store.ts";

export type { RateLimitStore } from "./internal/engine/rate-store.ts";

export type {
  LimitsSnapshot,
  OperationOptions,
} from "./internal/engine/engine.ts";

export type { BudgetWindowUsage } from "./internal/engine/budget.ts";

export { fullJitterBackoff } from "./internal/engine/retry.ts";

export type { RetriesOption, RetryPolicy } from "./internal/engine/retry.ts";

export type { Runtime } from "./internal/engine/runtime.ts";

export { DEFAULT_SHARE } from "./internal/limits.ts";

export type {
  LimitDeclaration,
  RateLimitHeaders,
  RateWindow,
} from "./internal/limits.ts";

export type {
  ActionEvent,
  ErrorEvent,
  OutboundHooks,
  RequestEvent,
  RetryEvent,
  ThrottleEvent,
} from "./internal/hooks.ts";

export {
  computeRates,
  emptyCounts,
  METRIC_DEFINITIONS,
  sumCounts,
} from "./internal/metrics.ts";

export type {
  MetricCounts,
  MetricDefinition,
  MetricName,
  Rate,
} from "./internal/metrics.ts";

export { makeRef, parseRef } from "./internal/ref.ts";

export { profileSlug } from "./internal/url.ts";

export type { RefParts } from "./internal/ref.ts";

export { REDACTED_EMAIL, REDACTED_KEY, redactText } from "./internal/redact.ts";

export { sha256Hex, stableId } from "./internal/sha256.ts";

export type { Json, JsonObject } from "./internal/json.ts";
