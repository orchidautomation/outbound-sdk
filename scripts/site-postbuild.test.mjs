import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

import { pageDateModified, postbuild, withLastmod } from "./site-postbuild.mjs";

const roots = [];

after(() => {
  for (const root of roots) {
    rmSync(root, { force: true, recursive: true });
  }
});

const SITE = "https://docs.example";

const sitemap = (home) =>
  [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
    home,
    `  <url><loc>${SITE}/docs</loc><lastmod>2026-11-16</lastmod></url>`,
    `</urlset>`,
    "",
  ].join("\n");

const page = (node) =>
  `<html><head><script type="application/ld+json">${JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [{ "@type": "WebSite" }, node],
  })}</script></head></html>`;

const staticDir = ({ home, html }) => {
  const root = mkdtempSync(path.join(realpathSync(tmpdir()), "postbuild-"));
  roots.push(root);
  writeFileSync(path.join(root, "sitemap.xml"), sitemap(home));
  writeFileSync(path.join(root, "index.html"), html);

  return root;
};

test("reads the page's dateModified from its JSON-LD", () => {
  assert.equal(
    pageDateModified(
      page({ "@type": "WebPage", dateModified: "2026-11-18T20:55:49.000Z" })
    ),
    "2026-11-18T20:55:49.000Z"
  );
  assert.equal(pageDateModified(page({ "@type": "WebPage" })), null);
  assert.equal(pageDateModified("<html></html>"), null);
});

test("dates the home page entry and leaves the others alone", () => {
  const root = staticDir({
    home: `  <url><loc>${SITE}/</loc></url>`,
    html: page({
      "@type": "WebPage",
      dateModified: "2026-11-18T23:30:00-05:00",
    }),
  });

  assert.deepEqual(postbuild(root), [`sitemap.xml: <lastmod> for ${SITE}/`]);

  const xml = readFileSync(path.join(root, "sitemap.xml"), "utf-8");

  // The UTC day, as Blume writes the other entries.
  assert.match(
    xml,
    /<url><loc>https:\/\/docs\.example\/<\/loc><lastmod>2026-11-19<\/lastmod><\/url>/u
  );
  assert.match(
    xml,
    /<loc>https:\/\/docs\.example\/docs<\/loc><lastmod>2026-11-16<\/lastmod>/u
  );
});

test("changes nothing when the home page has no date", () => {
  const root = staticDir({
    home: `  <url><loc>${SITE}/</loc></url>`,
    html: page({ "@type": "WebPage" }),
  });

  assert.deepEqual(postbuild(root), []);
  assert.equal(
    readFileSync(path.join(root, "sitemap.xml"), "utf-8"),
    sitemap(`  <url><loc>${SITE}/</loc></url>`)
  );
});

test("keeps a lastmod Blume already wrote", () => {
  const dated = sitemap(
    `  <url><loc>${SITE}/</loc><lastmod>2026-11-01</lastmod></url>`
  );

  assert.equal(withLastmod(dated, `${SITE}/`, "2026-11-18T00:00:00Z"), dated);
});

test("refuses a sitemap that does not list the page", () => {
  assert.throws(
    () => withLastmod(sitemap(""), `${SITE}/`, "2026-11-18T00:00:00Z"),
    /no entry for https:\/\/docs\.example\//u
  );
});
