import { defineEval } from "eve/evals";
import { includes } from "eve/evals/expect";

// What the Monday schedule asks for, sent by hand. In the demo data Acme's
// Ecommerce ops campaign started bouncing last week, so the report must
// name it under what needs attention.
export default defineEval({
  description:
    "The weekly report follows the skill and flags the bounce spike.",
  tags: ["reports"],
  async test(t) {
    const turn = await t.send(
      "Write Acme's weekly outreach report for the last 7 days."
    );

    t.succeeded();
    t.calledSkill("weekly-client-report");
    t.calledTool("client_report", { input: { days: 7 } });
    t.check(turn.reply, includes("Ecommerce ops"));
    t.judge(
      "The report has a one-sentence headline, the week's numbers, what needs attention (including Ecommerce ops' bounces), and next steps, in plain language a client can read, with no tool names or JSON."
    ).atLeast(0.7);
  },
});
