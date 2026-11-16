// A campaign whose copy is all template: the subject and body come from each
// lead's custom fields, the signature from the sending tool.
import { createOutbound } from "outbound-sdk";
import { insights } from "outbound-sdk/insights";
import { memory } from "outbound-sdk/memory";

const outbound = createOutbound({
  adapter: memory({
    data: {
      campaigns: [
        {
          id: "templated",
          steps: [
            {
              variants: [
                {
                  body: "<div>{{content1}}</div><div><br /></div><div>{{accountSignature}}</div>",
                  subject: "{{subject1}}",
                },
              ],
            },
            {
              delayDays: 2,
              variants: [
                { body: "<div>Hi {{firstName|there}}, {{content2}}</div>" },
              ],
            },
          ],
        },
      ],
      leads: [
        {
          campaignId: "templated",
          custom: {
            content1: "Saw Acme is hiring two SDRs. Worth a short call?",
            content2: "did my note reach you?",
            subject1: "Hiring at Acme",
          },
          email: "person1@example.com",
          firstName: "Ann",
          id: "lead_1",
        },
      ],
    },
    workspaceId: "acme",
  }),
  plugins: [insights()],
});

const { data } = await outbound.insights.copyPreview({
  campaign: "memory:acme:templated",
});

console.log(`rendered for ${data.lead?.email}`);

for (const step of data.steps) {
  for (const variant of step.variants) {
    console.log(`\nstep ${step.step + 1} ${variant.variantKey}`);
    console.log(`  template subject: ${variant.template.subject}`);
    console.log(`  rendered subject: ${variant.rendered.subject}`);
    console.log(`  template body:    ${variant.template.body}`);
    console.log(
      `  rendered text:    ${JSON.stringify(variant.rendered.bodyText)}`
    );
    console.log(`  left as written:  ${variant.unfilled.join(", ") || "none"}`);
  }
}
