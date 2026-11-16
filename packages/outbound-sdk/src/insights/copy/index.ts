// The copy insights. Each file in this folder defines one; this list is what
// the registry reads.

import { copyAudit } from "./copy-audit.ts";
import { copyPreview } from "./copy-preview.ts";
import { copyReuse } from "./copy-reuse.ts";
import { replyTiming } from "./reply-timing.ts";
import { stepFunnel } from "./step-funnel.ts";
import { variantTest } from "./variant-test.ts";

export const COPY_INSIGHTS = [
  stepFunnel,
  variantTest,
  copyAudit,
  copyPreview,
  copyReuse,
  replyTiming,
] as const;

export type { CheckName, Severity } from "./copy-checks.ts";

export type { CheckCount, CopyAudit, CopyFinding } from "./copy-audit.ts";

export type {
  CopyPreview,
  CopyText,
  PreviewLead,
  PreviewStep,
  PreviewVariant,
  RenderedCopy,
} from "./copy-preview.ts";

export type {
  CopyPiece,
  CopyReuse,
  CopyUse,
  ReusedCopy,
} from "./copy-reuse.ts";

export type {
  HourCount,
  ReplyTiming,
  TimeTable,
  WeekdayCount,
} from "./reply-timing.ts";

export type { FunnelStep, FunnelVariant, StepFunnel } from "./step-funnel.ts";

export type {
  TestedVariant,
  VariantStepTest,
  VariantTest,
  VariantVerdict,
} from "./variant-test.ts";
