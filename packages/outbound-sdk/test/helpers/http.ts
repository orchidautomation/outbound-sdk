// A fake `fetch` and a small HTTP adapter written against the public adapter
// contract. Together they exercise the request engine through
// `createOutbound`, the same way a real adapter does.

import { makeErrorMapper, makeRef, SCHEMA_VERSION } from "../../src/index.ts";
import type {
  Adapter,
  AdapterContext,
  Campaign,
  CapabilityDeclaration,
  LimitDeclaration,
  RequestSpec,
} from "../../src/index.ts";

export interface RecordedRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string | undefined;
}

/** `"hang"` never answers until the request is aborted. */
export type Reply = Response | "hang" | Error;

export type Handler = (
  request: RecordedRequest,
  index: number
) => Reply | Promise<Reply>;

export const json = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {}
): Response => Response.json(body, { headers, status });

export interface FakeFetch {
  readonly fetch: typeof fetch;
  readonly requests: RecordedRequest[];
}

const hang = (signal: AbortSignal | null | undefined): Promise<Response> =>
  new Promise((_resolve, reject) => {
    const abort = (): void => {
      reject(new DOMException("The operation was aborted", "AbortError"));
    };

    // Like the real fetch: an already-aborted signal rejects straight away.
    if (signal?.aborted) {
      abort();
    }

    signal?.addEventListener("abort", abort);
  });

export const createFetch = (handler: Handler): FakeFetch => {
  const requests: RecordedRequest[] = [];

  return {
    fetch: async (input, init) => {
      const request: RecordedRequest = {
        body: typeof init?.body === "string" ? init.body : undefined,
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
        method: init?.method ?? "GET",
        url: String(input),
      };

      requests.push(request);
      const reply = await handler(request, requests.length - 1);

      if (reply === "hang") {
        return await hang(init?.signal);
      }

      if (reply instanceof Error) {
        throw reply;
      }

      return reply;
    },
    requests,
  };
};

/** Answers with each reply in turn, repeating the last one. */
export const sequence =
  (...replies: Reply[]): Handler =>
  (_request, index) => {
    const reply = replies[Math.min(index, replies.length - 1)];

    if (reply === undefined) {
      throw new Error("sequence() needs at least one reply");
    }

    return reply instanceof Response ? reply.clone() : reply;
  };

export const API = "https://api.vendor.test";
export const KEY = "sk_test_secret_key_123456";

export interface TestAdapterOptions {
  readonly limits?: LimitDeclaration;
  readonly workspaceId?: string;
  readonly capabilities?: CapabilityDeclaration;
  readonly lane?: string;
  readonly key?: string;
}

const toCampaign = (
  workspaceId: string,
  raw: { id: string; name?: string }
): Campaign => ({
  channel: "email",
  createdAt: null,
  name: raw.name ?? raw.id,
  provider: "testvendor",
  raw,
  ref: makeRef("testvendor", workspaceId, raw.id),
  schemaVersion: SCHEMA_VERSION,
  sourceId: raw.id,
  status: "active",
  tags: [],
  workspaceId,
});

/**
 * A vendor with two endpoints: `GET /campaigns?offset=N` returning
 * `{ items, next }`, and `GET /campaigns/:id`.
 */
export const testAdapter = (options: TestAdapterOptions = {}): Adapter => {
  const workspaceId = options.workspaceId ?? "default";
  const key = options.key ?? KEY;

  const authorize = (spec: RequestSpec): RequestSpec => ({
    ...spec,
    headers: { ...spec.headers, authorization: `Bearer ${key}` },
    // The key also rides in the query, to prove URLs are redacted.
    url: `${spec.url}${spec.url.includes("?") ? "&" : "?"}api_key=${key}`,
  });

  const get = (ctx: AdapterContext, path: string) =>
    ctx.request(
      authorize({ lane: options.lane, method: "GET", url: `${API}${path}` })
    );

  return {
    capabilities: options.capabilities,
    getCampaign: async (id, ctx) => {
      const response = await get(ctx, `/campaigns/${id}`);

      return toCampaign(
        workspaceId,
        response.body as { id: string; name?: string }
      );
    },
    limits: options.limits ?? {
      source: "test",
      windows: [{ perMs: 1000, requests: 1000 }],
    },
    listCampaigns: async (query, ctx) => {
      const offset = typeof query.next === "number" ? query.next : 0;
      const response = await get(ctx, `/campaigns?offset=${offset}`);

      const body = response.body as {
        items: { id: string; name?: string }[];
        next?: number;
      };

      return {
        items: body.items.map((item) => toCampaign(workspaceId, item)),
        next: body.next,
      };
    },
    mapError: makeErrorMapper("testvendor", { secrets: [key] }),
    maturity: "unverified",
    name: "testvendor",
    raw: {
      authorize,
      baseUrl: API,
      isRead: (method, path) => method === "GET" || path === "/search",
    },
    secrets: [key],
    workspaceId,
  };
};
