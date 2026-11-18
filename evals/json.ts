// Reading tool output without trusting its shape.

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The value at `path`, or `undefined` where any step is missing. */
export const at = (
  value: unknown,
  ...path: readonly (string | number)[]
): unknown => {
  let current = value;

  for (const step of path) {
    if (typeof step === "number") {
      current = Array.isArray(current) ? current[step] : undefined;
    } else {
      current = isRecord(current) ? current[step] : undefined;
    }
  }

  return current;
};

export const list = (value: unknown): readonly unknown[] =>
  Array.isArray(value) ? value : [];

export const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

export const text = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

export const bool = (value: unknown): boolean | null =>
  typeof value === "boolean" ? value : null;

/** Parses JSON, or returns `undefined` for text that is not JSON. */
export const parsed = (line: string): unknown => {
  try {
    return JSON.parse(line);
  } catch {
    return undefined;
  }
};
