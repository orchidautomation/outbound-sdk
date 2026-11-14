import { createOutbound } from "outbound-sdk";
import { demoData, memory } from "outbound-sdk/memory";
import { openaiTools } from "outbound-sdk/tools";

const outbound = createOutbound({
  adapter: memory({ data: demoData(), workspaceId: "acme" }),
});

const { handle } = openaiTools(outbound);

/** A `function_call` item from a Responses API response. */
interface FunctionCall {
  readonly type: "function_call";
  readonly call_id: string;
  readonly name: string;
  readonly arguments: string;
}

/** Runs each call and builds the `function_call_output` items to send back. */
const answer = (calls: readonly FunctionCall[]) =>
  Promise.all(
    calls.map(async (call) => ({
      call_id: call.call_id,
      output: await handle(call.name, call.arguments),
      type: "function_call_output" as const,
    }))
  );

// Written by hand in the shape a model emits. No model was called.
const outputs = await answer([
  {
    arguments: '{"limit":1}',
    call_id: "call_1",
    name: "sender_health",
    type: "function_call",
  },
]);

console.log(JSON.stringify(outputs, null, 2));
