// Message bodies: HTML is kept as the vendor sent it, and a plain-text
// version is derived with quoted history removed.

const ENTITIES = new Map([
  ["amp", "&"],
  ["apos", "'"],
  ["gt", ">"],
  ["lt", "<"],
  ["nbsp", " "],
  ["quot", '"'],
]);

const decodeEntity = (match: string, body: string): string => {
  if (body.startsWith("#")) {
    const code =
      body[1]?.toLowerCase() === "x"
        ? Number.parseInt(body.slice(2), 16)
        : Number(body.slice(1));

    return Number.isInteger(code) && code > 0 && code <= 0x10_ff_ff
      ? String.fromCodePoint(code)
      : match;
  }

  return ENTITIES.get(body.toLowerCase()) ?? match;
};

export const looksLikeHtml = (value: string): boolean =>
  /<[a-z!/][^>]*>/iu.test(value);

/** Converts HTML to readable plain text. */
export const htmlToText = (html: string): string =>
  html
    .replaceAll(/<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/giu, "")
    .replaceAll(/<br\s*\/?>/giu, "\n")
    .replaceAll(/<\/(?:p|div|li|tr|h[1-6])>/giu, "\n")
    .replaceAll(/<[^>]+>/gu, "")
    .replaceAll(/&(?<body>#x?[\da-f]+|[a-z]+);/giu, (match, body: string) =>
      decodeEntity(match, body)
    )
    .replaceAll(/[ \t]+\n/gu, "\n")
    .replaceAll(/\n{3,}/gu, "\n\n")
    .trim();

// Lines that start the quoted history of a reply.
const QUOTE_MARKERS = [
  /^On .{0,200}wrote:\s*$/u,
  /^-{2,}\s*Original Message\s*-{2,}\s*$/iu,
  /^From:\s.+$/u,
  /^Sent from my \w+/u,
  /^_{10,}\s*$/u,
];

/** Removes quoted history from a plain-text reply. */
export const stripQuotedHistory = (text: string): string => {
  const lines = text.split(/\r?\n/u);

  const cut = lines.findIndex(
    (line, index) =>
      QUOTE_MARKERS.some((marker) => marker.test(line.trim())) ||
      // A run of ">" lines to the end of the message is the quoted thread.
      (line.trimStart().startsWith(">") &&
        lines
          .slice(index)
          .every(
            (rest) => rest.trim() === "" || rest.trimStart().startsWith(">")
          ))
  );

  return (cut === -1 ? lines : lines.slice(0, cut)).join("\n").trim();
};

/** A message body as records carry it. */
export interface MessageBody {
  /** The vendor's HTML as it was sent, or `null` when the body is plain text. */
  readonly bodyHtml: string | null;
  /** Plain text with quoted history removed, or `null` when nothing is left. */
  readonly bodyText: string | null;
}

/**
 * Normalizes a vendor body into kept HTML plus derived plain text, as every
 * adapter fills `bodyHtml` and `bodyText`. `includeBody: false` gives two
 * nulls, as a read without `include: ["body"]` does.
 */
export const normalizeBody = (
  body: string | null,
  includeBody = true
): MessageBody => {
  if (!includeBody || body === null || body.trim() === "") {
    return { bodyHtml: null, bodyText: null };
  }

  const isHtml = looksLikeHtml(body);
  const plain = stripQuotedHistory(isHtml ? htmlToText(body) : body);

  return {
    bodyHtml: isHtml ? body : null,
    bodyText: plain === "" ? null : plain,
  };
};
