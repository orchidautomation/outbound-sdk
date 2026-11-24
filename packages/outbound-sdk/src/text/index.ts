// outbound-sdk/text: the body helpers every adapter uses, for code that
// keeps vendor payloads of its own and wants the same bodyText.

export { normalizeBody, stripQuotedHistory } from "../internal/text.ts";

export type { MessageBody } from "../internal/text.ts";
