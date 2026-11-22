// Splits Blume's llms-full.txt into one file per section of the docs, so an
// agent can fetch the part it needs instead of the whole corpus (1.7 MB and
// growing). Blume 2.2.7 writes only the single file, so the split is made
// from that file after the build: the sections never say anything the full
// corpus does not.
//
// A section is a heading in llms.txt ("Docs", "Adapters", "Guides" ...) and
// holds the pages llms.txt lists under it. A section larger than maxBytes is
// cut into numbered parts at page boundaries.

/** Pages in llms-full.txt start with `# <title>` then `Source: <url>`. */
const PAGE_START = /\n\n---\n\n(?=# [^\n]*\nSource: )/u;
const SOURCE = /^Source: (?<url>\S+)$/mu;

/** The corpus header (title and summary) and its pages, each with its URL. */
export const parseFull = (text) => {
  const [first = "", ...rest] = text.trimEnd().split(PAGE_START);
  const start = first.search(/^# [^\n]*\nSource: /mu);

  if (start === -1) {
    throw new Error("llms-full.txt has no page with a Source line.");
  }

  const header = first.slice(0, start).trimEnd();

  const pages = [first.slice(start), ...rest].map((body) => {
    const url = body.match(SOURCE)?.groups.url;

    if (!url) {
      throw new Error(
        `A page in llms-full.txt has no Source line: ${body.slice(0, 80)}`
      );
    }

    return { body, url };
  });

  return { header, pages };
};

/**
 * The sections of llms.txt that list pages, in order: each heading's title
 * and the page URLs listed under it. The generated "Agent skills" and
 * "Agent resources" sections link no docs pages and are left out.
 */
export const parseIndex = (text) => {
  const sections = [];
  let current = null;

  for (const line of text.split("\n")) {
    const heading = line.match(/^#{2,3} (?<title>.+)$/u)?.groups.title;

    if (heading) {
      current = { title: heading, urls: [] };
      sections.push(current);
      continue;
    }

    const url = line.match(/^- \[[^\]]*\]\((?<url>[^)]+)\)/u)?.groups.url;

    if (current && url) {
      current.urls.push(url);
    }
  }

  return sections.filter(
    ({ title, urls }) =>
      urls.length > 0 && !["Agent skills", "Agent resources"].includes(title)
  );
};

export const slug = (title) =>
  title
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-|-$/gu, "");

/** Pages cut into runs no larger than maxBytes, never splitting a page. */
const chunk = (pages, maxBytes) => {
  const chunks = [[]];
  let size = 0;

  for (const page of pages) {
    const bytes = Buffer.byteLength(page.body);

    if (size > 0 && size + bytes > maxBytes) {
      chunks.push([]);
      size = 0;
    }

    chunks.at(-1).push(page);
    size += bytes;
  }

  return chunks;
};

/**
 * One file per section (or per part of a large section). Every page of the
 * corpus lands in exactly one file; a page llms.txt does not list, or lists
 * twice, is an error rather than a page silently dropped or repeated.
 */
export const splitSections = ({
  full,
  index,
  origin,
  maxBytes = 256 * 1024,
}) => {
  const { header, pages } = parseFull(full);
  const sections = parseIndex(index);
  const sectionOf = new Map();

  for (const section of sections) {
    for (const url of section.urls) {
      if (sectionOf.has(url)) {
        throw new Error(`llms.txt lists ${url} in two sections.`);
      }

      sectionOf.set(url, section.title);
    }
  }

  const unlisted = pages.filter(({ url }) => !sectionOf.has(url));

  if (unlisted.length > 0) {
    throw new Error(
      `llms.txt lists no section for ${unlisted.map(({ url }) => url).join(", ")}.`
    );
  }

  const title = header.match(/^# (?<title>.+)$/mu)?.groups.title ?? "Docs";

  return sections.flatMap((section) => {
    const own = pages.filter(({ url }) => sectionOf.get(url) === section.title);

    if (own.length === 0) {
      return [];
    }

    const parts = chunk(own, maxBytes);

    return parts.map((part, i) => {
      const name =
        parts.length === 1
          ? `${slug(section.title)}.txt`
          : `${slug(section.title)}-${i + 1}.txt`;

      const label =
        parts.length === 1
          ? `${section.title} section`
          : `${section.title} section, part ${i + 1} of ${parts.length}`;

      const text = [
        `# ${title}: ${label}`,
        "",
        `> The full Markdown of ${part.length} page(s) from the ${section.title} section. Every page in one file: ${origin}/llms-full.txt. The index: ${origin}/llms.txt.`,
        "",
        part.map(({ body }) => body.trimEnd()).join("\n\n---\n\n"),
        "",
      ].join("\n");

      return { label, name, pages: part.map(({ url }) => url), text };
    });
  });
};

/**
 * llms.txt with a link to each section file, right after its llms-full.txt
 * line in "Agent resources". Throws when that line is missing, so a change in
 * Blume's output cannot drop the links unnoticed.
 */
export const linkSections = ({ index, files, origin }) => {
  // Links from an earlier run are replaced, not repeated.
  const lines = index
    .split("\n")
    .filter((line) => !line.startsWith("- [llms-full/"));

  const anchor = lines.find((line) =>
    line.startsWith(`- [llms-full.txt](${origin}/llms-full.txt)`)
  );

  if (!anchor) {
    throw new Error(
      "llms.txt has no llms-full.txt line to link the sections after."
    );
  }

  const links = files.map(
    ({ label, name, text }) =>
      `- [llms-full/${name}](${origin}/llms-full/${name}): The full Markdown of the ${label}, ${Math.ceil(Buffer.byteLength(text) / 1024)} KB.`
  );

  return lines
    .flatMap((line) => (line === anchor ? [line, ...links] : [line]))
    .join("\n");
};
