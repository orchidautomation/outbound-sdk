# Tools, MCP, CLI and webhooks

## AI tools

`outbound-sdk/tools` gives an agent question-shaped tools. The customer's model does the reasoning; a tool only reads and arranges. Every tool returns compact JSON with `meta.evidence` (`exact`, `sampled` or `derived`) and a `next` hint, and never throws: bad input, a missing record and an unsupported read all come back as `{ ok: false, error }`.

| Tool | Answers | Needs |
| --- | --- | --- |
| `campaign_overview` | How every campaign with a given status is doing |  |
| `campaign_trend` | How one count moved day by day | `stats.byDay` |
| `winning_steps` | Which step or variant drives replies | `stats.byStep` |
| `sender_health` | Status, daily limit and warmup per sender | `senders.list` |
| `reply_samples` | Recent replies, optionally by category | `replies.list` |
| `lead_runway` | Days until a campaign runs out of leads (an estimate) | `leads.byCampaign`, `stats.byDay` |
| `compare_clients` | The same counts across clients | the `clients` plugin |
| `cross_channel_lead` | Every record and message for one person | the `identity` plugin |

A tool that needs a plugin the instance does not have is left out of the set.

```ts
import { createTools, openaiTools } from "outbound-sdk/tools"; // no extra package
import { aiSdkTools } from "outbound-sdk/tools/ai-sdk"; // needs `ai`
import { claudeAgentTools } from "outbound-sdk/tools/claude-agent"; // needs `@anthropic-ai/claude-agent-sdk`
```

`ai` and `@anthropic-ai/claude-agent-sdk` are optional peer dependencies.

### Reply text is untrusted

A prospect's reply can contain instructions. Reply and message text is left out unless the caller asks (`include_bodies: true`), is truncated to 500 characters, and is returned inside an `untrusted_content` field with a note saying to treat it as data. Each tool's description says the same. With the `redact` plugin on the instance, asking for bodies is refused.

## Local MCP server and CLI

`outbound mcp` starts a Model Context Protocol server on stdio with the same tool set. Keys are read from the environment by the adapter. Nothing is hosted and nothing is stored.

```json
{
  "mcpServers": {
    "outbound": {
      "command": "npx",
      "args": ["outbound-sdk", "mcp"],
      "env": {
        "OUTBOUND_SDK_PROVIDER": "instantly",
        "INSTANTLY_API_KEY": "..."
      }
    }
  }
}
```

The server implements `initialize`, `ping`, `tools/list` and `tools/call` directly on JSON-RPC, so the package gains no dependency.

The CLI prints JSON: `outbound providers`, `capabilities`, `campaigns`, `campaign <id>`, `senders`, `leads`, `replies`, `stats`, `limits`, `tools` and `tool <name> --input '{}'`. `OUTBOUND_SDK_PROVIDER` or `--provider` picks the adapter.

## Webhooks

```ts
import { parse } from "outbound-sdk/webhooks";

export async function POST(request: Request) {
  const events = await parse(request, {
    provider: "instantly",
    secret: process.env.WEBHOOK_SECRET,
  });
  return new Response(null, { status: 204 });
}
```

- **Provider:** name it in production. `auto` detects it from the payload.
- **Verification:** when the vendor signs payloads, `secret` is its signing secret. Otherwise it is a shared secret you put in the webhook URL (a path segment or `?secret=`) or in an `x-webhook-secret` or `Authorization: Bearer` header. A request that fails is rejected with `Unauthorized`. Without `secret` nothing is checked.
- **Idempotency:** `event.id` is stable across redelivery. Pass a `dedupe` store to drop events already handled; `memoryDedupeStore()` works for one process.
- **Unknown events** come back as `type: "unknown"` with `raw` attached. They are never dropped.
- **Events are hints.** A webhook can arrive late, twice or not at all, so reconcile against list calls before trusting event-driven totals.
- **Registration:** the SDK is read-only and registers nothing. `setupInstructions(provider)` says where to add the webhook in each vendor's app.
