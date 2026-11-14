// The account-level reads: settings, health, lists, block list, tags,
// subsequences and webhook subscriptions.

import type { PageQuery, SubsequenceQuery, WebhookQuery } from "../adapter.ts";
import {
  idFor,
  optionalId,
  output,
  single,
  unsupported,
} from "./operation-shared.ts";
import type { DispatchTarget, OperationOutput } from "./operation-shared.ts";

export type AccountOperation =
  | { readonly kind: "blocklist.list"; readonly query: PageQuery }
  | { readonly kind: "campaigns.settings"; readonly id: string }
  | { readonly kind: "lists.get"; readonly id: string }
  | { readonly kind: "lists.list"; readonly query: PageQuery }
  | { readonly kind: "senders.health"; readonly id: string }
  | { readonly kind: "sequence.subsequences"; readonly query: SubsequenceQuery }
  | { readonly kind: "tags.list"; readonly query: PageQuery }
  | { readonly kind: "webhooks.get"; readonly id: string }
  | { readonly kind: "webhooks.list"; readonly query: WebhookQuery };

const ACCOUNT_KINDS: ReadonlySet<string> = new Set<AccountOperation["kind"]>([
  "blocklist.list",
  "campaigns.settings",
  "lists.get",
  "lists.list",
  "senders.health",
  "sequence.subsequences",
  "tags.list",
  "webhooks.get",
  "webhooks.list",
]);

export const isAccountOperation = <Other extends { readonly kind: string }>(
  operation: AccountOperation | Other
): operation is AccountOperation => ACCOUNT_KINDS.has(operation.kind);

const lookup = async (
  target: DispatchTarget,
  operation: Extract<AccountOperation, { readonly id: string }>
): Promise<OperationOutput> => {
  const { adapter, ctx } = target;
  const id = idFor(adapter, operation.id);

  // The adapter method behind each lookup.
  const read = {
    "campaigns.settings": adapter.getCampaignSettings,
    "lists.get": adapter.getList,
    "senders.health": adapter.getSenderHealth,
    "webhooks.get": adapter.getWebhook,
  }[operation.kind];

  if (read === undefined) {
    throw unsupported(adapter, operation.kind);
  }

  return single(await read(id, ctx));
};

const scopedList = async (
  target: DispatchTarget,
  operation: Extract<
    AccountOperation,
    { readonly kind: "sequence.subsequences" | "webhooks.list" }
  >
): Promise<OperationOutput> => {
  const { adapter, ctx } = target;

  if (operation.kind === "sequence.subsequences") {
    if (adapter.listSubsequences === undefined) {
      throw unsupported(adapter, operation.kind);
    }

    return output(
      await adapter.listSubsequences(
        {
          ...operation.query,
          campaignId: idFor(adapter, operation.query.campaignId),
        },
        ctx
      )
    );
  }

  if (adapter.listWebhooks === undefined) {
    throw unsupported(adapter, operation.kind);
  }

  return output(
    await adapter.listWebhooks(
      {
        ...operation.query,
        campaignId: optionalId(adapter, operation.query.campaignId),
      },
      ctx
    )
  );
};

/** Hands one account-level operation to the adapter. */
export const dispatchAccount = async (
  target: DispatchTarget,
  operation: AccountOperation
): Promise<OperationOutput> => {
  const { adapter, ctx } = target;

  switch (operation.kind) {
    case "campaigns.settings":
    case "lists.get":
    case "senders.health":
    case "webhooks.get": {
      return await lookup(target, operation);
    }

    case "sequence.subsequences":
    case "webhooks.list": {
      return await scopedList(target, operation);
    }

    case "blocklist.list": {
      if (adapter.listBlocklist === undefined) {
        throw unsupported(adapter, operation.kind);
      }

      return output(await adapter.listBlocklist(operation.query, ctx));
    }

    case "lists.list": {
      if (adapter.listLists === undefined) {
        throw unsupported(adapter, operation.kind);
      }

      return output(await adapter.listLists(operation.query, ctx));
    }

    case "tags.list": {
      if (adapter.listTags === undefined) {
        throw unsupported(adapter, operation.kind);
      }

      return output(await adapter.listTags(operation.query, ctx));
    }

    default: {
      const unreachable: never = operation;

      return unreachable;
    }
  }
};
