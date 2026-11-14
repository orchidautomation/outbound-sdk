# The documentation site

The site at [outbound-sdk.dev](https://outbound-sdk.dev) is built from `site/` with [Blume](https://useblume.dev). This page is how to change it and how to publish it.

## Layout

| Path | Holds |
| --- | --- |
| `site/pages/index.astro` | The home page at `/`, a custom Astro page. Its samples are files in `content/_examples`; its adapter badges come from `outbound-sdk/providers` |
| `site/content/docs/` | The pages (`.mdx`), guides under `docs/guides/`. The folder is the route, so everything is under `/docs` |
| `site/content/_examples/<name>/` | Every code sample, and the output each one printed (`.out.txt`) |
| `site/content/_snippets/status.mdx` | The "not published yet" notice the guides include |
| `site/blume.config.ts` | Title, banner, tabs, the text of `llms.txt`, the Vercel adapter |
| `site/test/` | The tests that run the samples and hold the site's claims to the code |
| `scripts/examples-loader.mjs` | Lets a sample import `outbound-sdk` from source, refuses the network, fixes the clock |

`site/` is not an npm workspace. It has its own `package.json` and lockfile, so installing the SDK does not install the site's dependencies.

## Change a page

```sh
npm --prefix site ci      # once
npm run site:dev          # the site on localhost, reloading as you edit
```

A page carries no code of its own. To show code:

1. Write it as a file in `site/content/_examples/<name>/`. Import the package as a reader would: `from "outbound-sdk"`, `from "outbound-sdk/insights"`. Use the in-memory adapter and made-up data.
2. Record what it prints, then read the recorded file and check the numbers against the data:

   ```sh
   UPDATE_EXAMPLES=1 npm test
   git diff site/content/_examples   # every changed output is a change to what the site claims
   ```

3. Splice both into the page. The path is relative to the page; from `content/docs/guides/` it is `../../_examples`:

   ```mdx
   <include meta='title="run.ts"'>../../_examples/<name>/run.ts</include>

   <include lang="text" meta='title="Output"'>../../_examples/<name>/run.out.txt</include>
   ```

Use `<Callout type="warning">` for callouts. The `:::` form is broken by the formatter.

## Check

```sh
npm run check                    # the whole repository, including every sample
npm --prefix site run validate   # every link on the site resolves
npm --prefix site run build      # the site builds
```

`npm test` fails when a sample prints something other than its recorded output, when a page has a code fence that is a program, when a sample is not shown on any page, and when the site's claims about maturity or publication no longer match the code (`site/test/site-truth.test.ts`). When the SDK changes what a sample prints, re-record and review the diff; do not edit an `.out.txt` by hand.

## Publish

The site is deployed by hand with the Vercel CLI, from a build made on your machine. Merging a pull request does **not** update it.

```sh
cd site
vercel link --yes --project outbound-sdk-docs   # once per checkout
npx blume build                                 # writes site/.vercel/output
vercel deploy --prebuilt                        # a preview, behind Vercel's login
vercel deploy --prebuilt --prod                 # production: outbound-sdk.dev
```

Then check it:

```sh
curl -s -o /dev/null -w '%{http_code}\n' https://outbound-sdk.dev/docs
curl -s https://outbound-sdk.dev/llms.txt | head -5
```

Things to know:

- **Publish from a commit that passed `npm run check`,** and say which commit in the pull request. Nothing ties a deployment to a commit except you.
- **The Vercel project must stay disconnected from Git.** Connected, Vercel builds every pushed branch from the repository root and puts a failing check on pull requests that have nothing to do with the site. If `vercel link` connects it, run `vercel git disconnect --yes`.
- **A preview is behind Vercel's login.** Read one with `vercel curl /docs --deployment <url>`.
- **The domain** `outbound-sdk.dev` and `www.outbound-sdk.dev` are attached to the project. Nothing needs doing per deploy.
- **`vercel link` writes `site/.env.local`** with a short-lived token. It is git-ignored. Never commit it or print it.

## The live model run

Two transcripts on the site come from a real model calling the tools through the Vercel AI Gateway. They cost money, need a credential and do not answer the same way twice, so they are not part of `npm test`.

```sh
cd site && vercel env pull && cd ..      # writes VERCEL_OIDC_TOKEN to site/.env.local
set -a && . site/.env.local && set +a
npm run site:live                        # asserts the model called a tool and answered from it
RECORD_LIVE=1 npm run site:live          # also rewrites the two live-run.json transcripts
```

`AI_GATEWAY_API_KEY` works in place of the token. `LIVE_MODEL` picks another model.

## When the package is published

`site/test/site-truth.test.ts` and `skills/test/skills.test.ts` enforce "no install command" while their `unpublished` constant is `true`. A GitHub Release is not npm: set both to `false` in the pull request that first publishes to npm, and in it remove the banner in `site/blume.config.ts`, rewrite `site/content/_snippets/status.mdx` and `site/content/docs/installation.mdx`, and update `site/content/docs/status.mdx`. A new public subpath needs a page before the same test passes.
