import type { OutboundPlugin } from "outbound-sdk";

/** What the plugin adds to the instance. */
export interface UsageExtension {
  readonly usage: {
    /** Operations that reached this layer, by kind. */
    readonly operations: () => Record<string, number>;
    /** Records those operations returned. */
    readonly records: () => number;
    /** HTTP requests the instance made, retries included. */
    readonly httpRequests: () => number;
  };
}

/** Counts what an instance read. It keeps the counts in this process. */
export const usage = (): OutboundPlugin<UsageExtension> => {
  const operations = new Map<string, number>();
  let records = 0;
  let httpRequests = 0;

  return {
    // `extend` returns the properties to add. The type parameter above is
    // what makes `outbound.usage` typed at the call site.
    extend: () => ({
      usage: {
        httpRequests: () => httpRequests,
        operations: () => Object.fromEntries(operations),
        records: () => records,
      },
    }),
    // Hooks observe. A hook that throws is ignored and cannot fail a read.
    hooks: {
      onRequest: () => {
        httpRequests += 1;
      },
    },
    name: "usage",
    // `wrap` sees every operation. Call `next` to continue inward, and
    // return what it returns, changed or not.
    wrap: async (operation, next) => {
      operations.set(operation.kind, (operations.get(operation.kind) ?? 0) + 1);

      const output = await next(operation);

      records += output.items.length;

      return output;
    },
  };
};
