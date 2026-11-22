#!/usr/bin/env node

// Runs after `blume build` and finishes what Blume 2.2.7 leaves out of the
// static output:
//
// - The home page is a custom Astro page, so Blume's sitemap lists it with no
//   <lastmod>. The page itself carries a JSON-LD dateModified from git
//   (pages/index.astro); this copies that date into the sitemap entry.
//
//   node scripts/site-postbuild.mjs [static dir]

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

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

/** Date the home page's sitemap entry. Returns what it changed. */
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

  return changed;
};

if (process.argv[1] && import.meta.filename === path.resolve(process.argv[1])) {
  const [staticDir = path.join(".vercel", "output", "static")] =
    process.argv.slice(2);

  for (const line of postbuild(path.resolve(staticDir))) {
    console.log(`Post-build: ${line}`);
  }
}
