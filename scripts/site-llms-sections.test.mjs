import assert from "node:assert/strict";
import { test } from "node:test";

import {
  linkSections,
  parseFull,
  parseIndex,
  slug,
  splitSections,
} from "./site-llms-sections.mjs";

const ORIGIN = "https://docs.example";

const page = (title, route, body = "Some text.") =>
  `# ${title}\nSource: ${ORIGIN}${route}\n\n${body}`;

// A page body may hold a Markdown rule; only a rule followed by a page
// heading and its Source line starts a new page.
const PAGES = [
  page("Introduction", "/docs", "Intro.\n\n---\n\nStill the intro."),
  page("Adapters", "/docs/adapters"),
  page("Instantly adapter", "/docs/adapters/instantly"),
  page("A guide", "/docs/guides/a", "x".repeat(300)),
  page("B guide", "/docs/guides/b", "y".repeat(300)),
];

const FULL = `# Example\n\n> One line.\n\n${PAGES.join("\n\n---\n\n")}\n`;

const INDEX = [
  "# Example",
  "",
  "> One line.",
  "",
  "## Docs",
  "",
  `- [Introduction](${ORIGIN}/docs): Start here.`,
  "",
  "### Adapters",
  "",
  `- [Adapters](${ORIGIN}/docs/adapters): All of them.`,
  `- [Instantly adapter](${ORIGIN}/docs/adapters/instantly): One.`,
  "",
  "### Guides",
  "",
  `- [A guide](${ORIGIN}/docs/guides/a): A.`,
  `- [B guide](${ORIGIN}/docs/guides/b): B.`,
  "",
  "## Agent skills",
  "",
  `- [skill](${ORIGIN}/.well-known/agent-skills/x/SKILL.md): A skill.`,
  "",
  "## Agent resources",
  "",
  `- [llms-full.txt](${ORIGIN}/llms-full.txt): The full Markdown of every page in one file.`,
  `- [Sitemap](${ORIGIN}/sitemap.xml): Every page.`,
  "",
].join("\n");

test("reads the corpus header and every page, without splitting on a rule inside a page", () => {
  const { header, pages } = parseFull(FULL);

  assert.equal(header, "# Example\n\n> One line.");
  assert.deepEqual(
    pages.map(({ url }) => url),
    PAGES.map((text) => text.match(/^Source: (?<url>\S+)$/mu).groups.url)
  );
  assert.match(pages[0].body, /Still the intro\.$/u);
});

test("reads the sections that list docs pages and leaves out the generated ones", () => {
  assert.deepEqual(
    parseIndex(INDEX).map(({ title, urls }) => [title, urls.length]),
    [
      ["Docs", 1],
      ["Adapters", 2],
      ["Guides", 2],
    ]
  );
  assert.equal(slug("API reference"), "api-reference");
  assert.equal(slug("AI tools"), "ai-tools");
});

test("puts every page in exactly one file, in its llms.txt section", () => {
  const files = splitSections({ full: FULL, index: INDEX, origin: ORIGIN });

  assert.deepEqual(
    files.map(({ name }) => name),
    ["docs.txt", "adapters.txt", "guides.txt"]
  );
  assert.deepEqual(
    files.flatMap(({ pages }) => pages).toSorted(),
    parseFull(FULL)
      .pages.map(({ url }) => url)
      .toSorted()
  );
  assert.match(files[1].text, /^# Example: Adapters section\n/u);
  assert.match(files[1].text, /Instantly adapter\nSource: /u);
  assert.doesNotMatch(files[1].text, /A guide/u);
});

test("cuts a large section into parts at page boundaries", () => {
  const files = splitSections({
    full: FULL,
    index: INDEX,
    maxBytes: 400,
    origin: ORIGIN,
  });

  const guides = files.filter(({ name }) => name.startsWith("guides"));

  assert.deepEqual(
    guides.map(({ label, name }) => [name, label]),
    [
      ["guides-1.txt", "Guides section, part 1 of 2"],
      ["guides-2.txt", "Guides section, part 2 of 2"],
    ]
  );
  assert.deepEqual(
    guides.map(({ pages }) => pages),
    [[`${ORIGIN}/docs/guides/a`], [`${ORIGIN}/docs/guides/b`]]
  );
});

test("refuses a page llms.txt does not list, or lists twice", () => {
  const unlisted = INDEX.replace(
    `- [B guide](${ORIGIN}/docs/guides/b): B.\n`,
    ""
  );

  assert.throws(
    () => splitSections({ full: FULL, index: unlisted, origin: ORIGIN }),
    /no section for https:\/\/docs\.example\/docs\/guides\/b/u
  );

  const twice = INDEX.replace(
    "### Guides\n",
    `### Guides\n\n- [Again](${ORIGIN}/docs/adapters): Again.\n`
  );

  assert.throws(
    () => splitSections({ full: FULL, index: twice, origin: ORIGIN }),
    /lists https:\/\/docs\.example\/docs\/adapters in two sections/u
  );
});

test("links each file after llms-full.txt, once, however often it runs", () => {
  const files = splitSections({ full: FULL, index: INDEX, origin: ORIGIN });
  const once = linkSections({ files, index: INDEX, origin: ORIGIN });

  assert.equal(linkSections({ files, index: once, origin: ORIGIN }), once);

  const lines = once.split("\n");
  const at = lines.findIndex((line) => line.startsWith("- [llms-full.txt]"));

  assert.match(
    lines[at + 1],
    /^- \[llms-full\/docs\.txt\]\(https:\/\/docs\.example\/llms-full\/docs\.txt\): The full Markdown of the Docs section, 1 KB\.$/u
  );
  assert.match(lines[at + 3], /llms-full\/guides\.txt/u);
  assert.match(lines[at + 4], /^- \[Sitemap\]/u);
});

test("refuses an llms.txt without the llms-full.txt line", () => {
  assert.throws(
    () =>
      linkSections({
        files: [],
        index: INDEX.replace(/^- \[llms-full\.txt\].*$/mu, ""),
        origin: ORIGIN,
      }),
    /no llms-full\.txt line/u
  );
});
