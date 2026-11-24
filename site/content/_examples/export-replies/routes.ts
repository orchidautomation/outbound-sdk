// The Smartlead reads a reply export makes, answered from fixtures/smartlead/.
import { file } from "../_shared/fixture-fetch.ts";
import type { Route } from "../_shared/fixture-fetch.ts";

// Smartlead's master inbox is read with POST and an offset in the body; any
// offset above 0 gets the fixture's last page.
const inbox = (_url: URL, body: string): string =>
  // SAFETY: the body is the adapter's own JSON request, which has an offset.
  Number((JSON.parse(body || "{}") as { offset?: number }).offset ?? 0) > 0
    ? "listInboxReplies.page2.json"
    : "listInboxReplies.json";

export const ROUTES: readonly Route[] = [
  // The lead categories, to name each reply's category.
  {
    fixture: file("listLeadCategories.json"),
    method: "GET",
    path: /^\/api\/v1\/leads\/fetch-categories$/u,
  },
  {
    fixture: inbox,
    method: "POST",
    path: /^\/api\/v1\/master-inbox\/inbox-replies$/u,
  },
];
