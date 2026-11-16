// Reads docs/metric-glossary.md and reports where it disagrees with the code.

const UNIT = /^(?:people|messages|events)(?: \(unverified\))?$/u;
const NOT_REPORTED = "not reported";

export interface GlossaryAdapter {
  /** The `## Heading` of its section. */
  readonly heading: string;
  /** Every source file of the adapter, joined. */
  readonly source: string;
}

const cells = (line: string): string[] =>
  line
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());

/** The table rows under one `## heading`, header and divider dropped. */
const section = (markdown: string, heading: string): string[][] | null => {
  const lines = markdown.split("\n");
  const start = lines.indexOf(`## ${heading}`);

  if (start === -1) {
    return null;
  }

  const end = lines.findIndex(
    (line, index) => index > start && line.startsWith("## ")
  );

  return lines
    .slice(start + 1, end === -1 ? undefined : end)
    .filter((line) => line.startsWith("|"))
    .slice(2)
    .map(cells);
};

const backticked = (cell: string): string[] =>
  [...cell.matchAll(/`(?<name>[^`]+)`/gu)].flatMap((match) =>
    (match.groups?.name ?? "").split(".")
  );

/**
 * One line per problem: a missing section, a count listed twice or not at
 * all, a unit outside the vocabulary, or a vendor field the adapter's source
 * never mentions.
 */
export const checkGlossary = (
  markdown: string,
  counts: readonly string[],
  adapters: readonly GlossaryAdapter[]
): string[] =>
  adapters.flatMap(({ heading, source }) => {
    const rows = section(markdown, heading);

    if (rows === null) {
      return [`${heading}: no section`];
    }

    const problems: string[] = [];
    const listed = rows.map(([field = ""]) => field.replaceAll("`", ""));

    for (const count of counts) {
      const times = listed.filter((field) => field === count).length;

      if (times !== 1) {
        problems.push(`${heading}: \`${count}\` is listed ${times} times`);
      }
    }

    for (const field of listed.filter((name) => !counts.includes(name))) {
      problems.push(`${heading}: \`${field}\` is not a MetricRow count`);
    }

    for (const [field = "", vendor = "", , unit = ""] of rows) {
      const reported = vendor !== NOT_REPORTED;

      if (reported ? !UNIT.test(unit) : unit !== "—") {
        problems.push(`${heading}: ${field} has unit "${unit}"`);
      }

      for (const name of backticked(vendor)) {
        if (!new RegExp(`\\b${name}\\b`, "u").test(source)) {
          problems.push(
            `${heading}: ${field} names \`${name}\`, which the adapter never reads`
          );
        }
      }
    }

    return problems;
  });
