import { once } from "node:events";
import { createWriteStream } from "node:fs";
import { finished } from "node:stream/promises";
import { createGzip } from "node:zlib";

import type { RowWriter } from "outbound-sdk/exporter";

/**
 * Gzipped JSON Lines. Each row holds the export's columns and nothing else,
 * so the writer writes the row as it is.
 */
export const gzipJsonl = (file: string): RowWriter => {
  const gzip = createGzip();
  const done = finished(gzip.pipe(createWriteStream(file)));

  return {
    close: async () => {
      gzip.end();
      await done;
    },
    write: async (row) => {
      const line = JSON.stringify(row);

      // Wait when the stream is full, so a large export never sits in memory.
      if (!gzip.write(`${line}\n`)) {
        await once(gzip, "drain");
      }
    },
  };
};
