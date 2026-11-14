import type { Outbound } from "outbound-sdk";
import type { ExporterExtension, ExportResult } from "outbound-sdk/exporter";

export const LEAD_COLUMNS = [
  "ref",
  "campaignRef",
  "email",
  "firstName",
  "lastName",
  "company",
  "status",
];

/** Every lead on the instance, one row each, to a `.csv` or `.jsonl` file. */
export const exportLeads = (
  outbound: Outbound & ExporterExtension,
  file: string
): Promise<ExportResult> =>
  outbound.export(outbound.leads.listAll(), {
    columns: LEAD_COLUMNS,
    to: file,
  });

/** Every reply, with every field the record has except `raw`. */
export const exportReplies = (
  outbound: Outbound & ExporterExtension,
  file: string
): Promise<ExportResult> =>
  outbound.export(outbound.replies.listAll(), { to: file });
