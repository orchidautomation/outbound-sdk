// Posts a run's markdown summaries to a Linear issue as one comment.
// The summaries are checked again for anything personal before they leave
// the machine. Needs LINEAR_API_KEY.
//
//   node evals/post.ts --issue OUT-145 <summary.md>...

import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";

import { at, text } from "./json.ts";
import { assertCountsOnly } from "./report.ts";

const API = "https://api.linear.app/graphql";

const graphql = async (
  key: string,
  query: string,
  variables: Readonly<Record<string, unknown>>
): Promise<unknown> => {
  const response = await fetch(API, {
    body: JSON.stringify({ query, variables }),
    headers: { authorization: key, "content-type": "application/json" },
    method: "POST",
  });

  const body: unknown = await response.json();

  if (!response.ok || at(body, "errors") !== undefined) {
    throw new Error(`Linear answered ${response.status}`);
  }

  return body;
};

const main = async (): Promise<number> => {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { issue: { type: "string" } },
  });

  const key = process.env.LINEAR_API_KEY;

  if (
    key === undefined ||
    values.issue === undefined ||
    positionals.length === 0
  ) {
    process.stderr.write(
      "usage: LINEAR_API_KEY=... node evals/post.ts --issue OUT-145 <summary.md>...\n"
    );

    return 2;
  }

  const body = assertCountsOnly(
    positionals.map((file) => readFileSync(file, "utf-8").trim()).join("\n\n")
  );

  const issue = await graphql(
    key,
    "query($id: String!) { issue(id: $id) { id } }",
    { id: values.issue }
  );

  const id = text(at(issue, "data", "issue", "id"));

  if (id === null) {
    throw new Error(`no Linear issue ${values.issue}`);
  }

  await graphql(
    key,
    "mutation($input: CommentCreateInput!) { commentCreate(input: $input) { success } }",
    { input: { body, issueId: id } }
  );
  process.stdout.write(
    `Posted ${positionals.length} summaries to ${values.issue}\n`
  );

  return 0;
};

if (import.meta.main) {
  process.exitCode = await main();
}
