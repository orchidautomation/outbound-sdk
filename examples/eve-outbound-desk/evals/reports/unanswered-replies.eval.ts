import { defineEval } from "eve/evals";

// In the demo data one positive reply, from Northwind Studio, has waited
// about three days with nothing sent back.
export default defineEval({
  description: "The agent finds the positive reply nobody answered.",
  tags: ["reports"],
  async test(t) {
    const turn = await t.send(
      "Did any interested prospect reply that we haven't answered yet?"
    );

    t.succeeded();
    t.calledTool("dropped_replies");
    turn.messageIncludes(/Northwind|Dana/u);
  },
});
