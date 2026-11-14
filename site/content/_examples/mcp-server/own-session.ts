import { serve } from "./own-server.ts";

// The line a client would write, fed in place of standard input: a model
// asking for reply text from a server that has redact() on.
const lines = async function* lines(): AsyncGenerator<string> {
  yield JSON.stringify({
    id: 1,
    jsonrpc: "2.0",
    method: "tools/call",
    params: { arguments: { include_bodies: true }, name: "reply_samples" },
  });
};

await serve(lines(), (line) => {
  console.log(line);
});
