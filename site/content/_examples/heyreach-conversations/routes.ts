// The HeyReach reads this page makes, answered from fixtures/heyreach/.
import type { Route } from "../_shared/fixture-fetch.ts";

interface Body {
  readonly cursor?: string;
  readonly offset?: number;
  readonly filters?: { readonly campaignIds?: readonly number[] };
}

// SAFETY: the body is the adapter's own JSON request, in HeyReach's shape.
const bodyOf = (body: string): Body => JSON.parse(body || "{}") as Body;

// Campaigns page by offset in the body: any offset above 0 is the last page.
const campaigns = (_url: URL, body: string): string =>
  (bodyOf(body).offset ?? 0) > 0
    ? "listCampaigns.page2.json"
    : "listCampaigns.json";

// Conversations page by cursor. Every documented conversation is in
// campaign 274079, so a filter to any other campaign gets none.
const conversations = (_url: URL, body: string): string => {
  const { cursor, filters } = bodyOf(body);

  if (filters?.campaignIds && !filters.campaignIds.includes(274_079)) {
    return "getConversations.empty.json";
  }

  return cursor === undefined
    ? "getConversations.json"
    : "getConversations.page2.json";
};

export const ROUTES: readonly Route[] = [
  {
    fixture: campaigns,
    method: "POST",
    path: /^\/api\/public\/campaign\/GetAll$/u,
  },
  {
    fixture: conversations,
    method: "POST",
    path: /^\/api\/public\/inbox\/GetConversationsV3$/u,
  },
];
