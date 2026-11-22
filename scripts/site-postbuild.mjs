#!/usr/bin/env node

// Runs after `blume build` and finishes what Blume 2.2.7 leaves out of the
// static output:
//
// - The home page is a custom Astro page, so Blume's sitemap lists it with no
//   <lastmod>. The page itself carries a JSON-LD dateModified from git
//   (pages/index.astro); this copies that date into the sitemap entry.
//
// - llms-full.txt is one file of every page. This writes one file per docs
//   section under llms-full/ and links them from llms.txt (see
//   site-llms-sections.mjs).
//
//   node scripts/site-postbuild.mjs [static dir]

import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { linkSections, splitSections } from "./site-llms-sections.mjs";

/** The JSON-LD `dateModified` of a built page, or null when it has none. */
export const pageDateModified = (html) => {
  for (const match of html.matchAll(
    /<script type="application\/ld\+json">(?<json>[^<]*)<\/script>/gu
  )) {
    const graph = JSON.parse(match.groups.json)["@graph"] ?? [];
    const page = graph.find((node) => node.dateModified);

    if (page) {
      return page.dateModified;
    }
  }

  return null;
};

/**
 * The sitemap with a `<lastmod>` (W3C date, as Blume writes them) on the
 * entry for `loc`. An entry that already has one is left alone; a sitemap
 * without the entry is an error, since the home page must be listed.
 */
export const withLastmod = (xml, loc, isoDate) => {
  const entry = `<url><loc>${loc}</loc></url>`;

  if (xml.includes(`<url><loc>${loc}</loc><lastmod>`)) {
    return xml;
  }

  if (!xml.includes(entry)) {
    throw new Error(`The sitemap has no entry for ${loc}.`);
  }

  const day = new Date(isoDate).toISOString().slice(0, 10);

  return xml.replace(
    entry,
    `<url><loc>${loc}</loc><lastmod>${day}</lastmod></url>`
  );
};

/** Write llms-full/<section>.txt and link them from llms.txt. */
const writeSections = (staticDir) => {
  const full = readFileSync(path.join(staticDir, "llms-full.txt"), "utf-8");
  const indexFile = path.join(staticDir, "llms.txt");
  const index = readFileSync(indexFile, "utf-8");

  const { origin } = new URL(full.match(/^Source: (?<url>\S+)$/mu).groups.url);

  const files = splitSections({ full, index, origin });
  const dir = path.join(staticDir, "llms-full");

  rmSync(dir, { force: true, recursive: true });
  mkdirSync(dir);

  for (const { name, text } of files) {
    writeFileSync(path.join(dir, name), text);
  }

  writeFileSync(indexFile, linkSections({ files, index, origin }));

  return `llms-full/: ${files.length} section file(s), linked from llms.txt`;
};

/** Date the home page's sitemap entry and split llms-full.txt. */
export const postbuild = (staticDir) => {
  const sitemapFile = path.join(staticDir, "sitemap.xml");
  const sitemap = readFileSync(sitemapFile, "utf-8");

  const home = sitemap.match(/<url><loc>(?<home>https?:\/\/[^/<]+\/)<\/loc>/u)
    ?.groups.home;

  const modified = pageDateModified(
    readFileSync(path.join(staticDir, "index.html"), "utf-8")
  );

  const changed = [];

  if (home && modified) {
    const next = withLastmod(sitemap, home, modified);

    if (next !== sitemap) {
      writeFileSync(sitemapFile, next);
      changed.push(`sitemap.xml: <lastmod> for ${home}`);
    }
  }

  changed.push(writeSections(staticDir));

  return changed;
};

if (process.argv[1] && import.meta.filename === path.resolve(process.argv[1])) {
  const [staticDir = path.join(".vercel", "output", "static")] =
    process.argv.slice(2);

  for (const line of postbuild(path.resolve(staticDir))) {
    console.log(`Post-build: ${line}`);
  }
}
