import { outbound } from "./outbound.ts";

const { data, meta } = await outbound.insights.tagRollup({});

for (const tag of data.tags) {
  console.log(
    `${tag.tag ?? "(no tag)"}: campaigns ${tag.campaigns}, sent ${tag.sent}, reply rate ${tag.replyRate.rate} (low end ${tag.replyRate.low}), bounce rate ${tag.bounceRate.rate}`
  );
}

for (const note of meta.notes) {
  console.log(`note: ${note}`);
}
