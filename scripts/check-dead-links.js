#!/usr/bin/env node

/**
 * check-dead-links.js — #1176
 *
 * Reads the built site under `out/` and reports every internal `href` that points at a page or file
 * the build did not produce. Generated sites were shipping dead links and nothing in the repo was
 * looking (the only link check we had, manager/ticket722_test.go, covers ONBOARDING.md).
 *
 * 🔴 IT REPORTS, IT DOES NOT BLOCK. Callers (worker/entrypoint.sh on create, worker/main.go's
 * rebuildPreviewAfterEdit on edit) must deliver the site anyway. The reason is measured, not stylistic:
 * one of the producers of dead links is a fallback written into our own template —
 * src/components/sections/PricingTableSection.tsx:58 `const ctaHref = data.ctaHref || '/quote'` — so a
 * site that uses the pricing-table block, gives no ctaHref and has no /quote page grows a dead link
 * with no help from the model. A check that failed the build would turn that line into a reason a real
 * customer cannot get a website. A dead link costs SEO; a hard failure costs the whole site.
 * This script therefore keeps its own teeth (non-zero exit + names every offender) and leaves the
 * decision to the caller.
 *
 * 🔴 THE POSITIVE CONTROL IS PART OF THE OUTPUT, not a nicety. "No dead links" and "no links were
 * examined" are the same output otherwise — manager/ticket722_test.go:58 says exactly this about the
 * one link check we already had. So this prints how many html files it opened and how many internal
 * hrefs it resolved, and finding ZERO html files is exit 2, not a pass.
 *
 * 🔴 FRAGMENTS AND QUERIES ARE STRIPPED BEFORE RESOLVING. Measured on the #1162 artifact
 * (out/security-vendor, 12 html files): without stripping, `/services#svc-1`..`#svc-4` are reported as
 * dead and the count is 7; with stripping it is 3. Those four are anchors on /services, which exists.
 * Feeding false reports into a list nobody is forced to act on is how the list stops being read.
 *
 * 🔴 THERE ARE TWO out/ SHAPES AND POINTING AT THE WRONG ONE REPORTS EVERY PAGE AS DEAD.
 * The containers run `npx next build --webpack` directly, so out/ IS the site root (out/index.html).
 * `npm run build` does not: its `build` script appends `move-build-output.js restore`, which moves the
 * fresh build to `out/<SITE_CONFIG>/` (default site name `security-vendor`). Pointed at the outer out/
 * in that shape, `/` resolves against a directory with no index.html and EVERY internal href reads dead
 * — a wall of false reports on a check whose whole value is that its list gets believed. So when the
 * given directory holds no html of its own but exactly one subdirectory that does, this descends into
 * it and says so (`descendedInto` in the summary, and a line on stderr). Ambiguous cases — two such
 * subdirectories — are NOT guessed: it stays put and reports what it finds where it was pointed.
 *
 * Usage:  node scripts/check-dead-links.js [outDir]      (outDir defaults to ./out)
 *   stdout: ONE JSON line — {"event":"dead-links","pages":N,"checked":N,"dead":[{file,href}],...}
 *           Callers forward this line as-is; worker/entrypoint.sh puts it straight on the event stream.
 *   stderr: the same thing for humans.
 *   exit:   0 = checked something, found nothing · 1 = found dead links · 2 = found no html to check
 */

const fs = require('fs');
const path = require('path');

const givenDir = path.resolve(process.argv[2] || 'out');
const outDir = resolveSiteRoot(givenDir);

/**
 * `npm run build` nests the site one level down (see the note above). Descend only when it is
 * unambiguous: the given directory has no html of its own, and exactly ONE of its subdirectories has
 * an index.html. Two candidates (out/ holding several sites' builds) is a real shape too — guessing
 * there would silently audit one site and call it the answer, so it stays put.
 */
function resolveSiteRoot(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return dir;
  }
  if (entries.some(e => e.isFile() && e.name.endsWith('.html'))) return dir;
  const nested = entries.filter(e =>
    e.isDirectory() && e.name !== '_next' && isFile(path.join(dir, e.name, 'index.html')));
  return nested.length === 1 ? path.join(dir, nested[0].name) : dir;
}

// `_next/` holds the framework's own hashed assets. They are emitted by the build itself, are never
// authored by anyone, and their names carry content hashes — nothing here can say anything useful
// about them, so they are excluded on both sides (as link targets and as files to scan).
const SKIP_DIR = /(^|\/)_next(\/|$)/;

function htmlFiles(dir, acc = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return acc;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const rel = path.relative(outDir, full);
    if (SKIP_DIR.test(rel)) continue;
    if (e.isDirectory()) htmlFiles(full, acc);
    else if (e.isFile() && e.name.endsWith('.html')) acc.push(full);
  }
  return acc;
}

/**
 * Does `p` (a site-absolute path, no fragment, no query) resolve to something the build produced?
 *
 * 🔴 A DIRECTORY IS NOT AN ANSWER. `output: 'export'` writes BOTH `services.html` AND a `services/`
 * directory — and that directory is not empty, it holds the RSC payload files (`__next.*.txt`).
 * So "does out/<path> exist" is true for a path that serves nothing. Only a regular file counts:
 * `<path>.html`, `<path>/index.html`, or `<path>` itself (that last one is how /base.css and
 * /images/grid-pattern.svg resolve).
 */
function resolves(p) {
  const clean = p.replace(/\/+$/, '');
  if (clean === '') return isFile(path.join(outDir, 'index.html'));
  const base = path.join(outDir, clean);
  return isFile(base + '.html') || isFile(path.join(base, 'index.html')) || isFile(base);
}

function isFile(f) {
  try {
    return fs.statSync(f).isFile();
  } catch {
    return false;
  }
}

// Only site-absolute hrefs are ours to check. Everything else is somebody else's problem by
// construction: `http(s)://`, `mailto:`, `tel:`, `data:` leave the site; a bare `#anchor` stays on the
// page; a relative href does not occur in this template (every href is written from the site root) and
// guessing a base for one would invent findings.
function internalPath(href) {
  if (!href.startsWith('/')) return null;
  if (href.startsWith('//')) return null; // protocol-relative → external
  const stripped = href.replace(/[#?].*$/, '');
  if (stripped === '') return null; // href="/#section" → the current site root plus an anchor
  if (SKIP_DIR.test(stripped.slice(1))) return null;
  try {
    return decodeURI(stripped);
  } catch {
    return stripped; // malformed percent-escape: check it as written rather than dropping it
  }
}

const HREF = /href="([^"]*)"/g;

const files = htmlFiles(outDir);
const dead = [];
let checked = 0;

for (const file of files) {
  const rel = path.relative(outDir, file);
  const html = fs.readFileSync(file, 'utf8');
  const seen = new Set(); // one page repeating the same href is one finding, not fifty
  let m;
  while ((m = HREF.exec(html)) !== null) {
    const p = internalPath(m[1]);
    if (p === null) continue;
    if (seen.has(p)) continue;
    seen.add(p);
    checked += 1;
    if (!resolves(p)) dead.push({ file: rel, href: p });
  }
}

dead.sort((a, b) => a.href.localeCompare(b.href) || a.file.localeCompare(b.file));

const summary = {
  event: 'dead-links',
  outDir,
  pages: files.length,
  checked,
  deadCount: dead.length,
  dead,
};
if (outDir !== givenDir) summary.descendedInto = path.relative(givenDir, outDir);
process.stdout.write(JSON.stringify(summary) + '\n');

if (outDir !== givenDir) {
  process.stderr.write(`check-dead-links: ${givenDir} holds no html of its own — descended into ` +
    `${path.relative(givenDir, outDir)}/ (that is the \`npm run build\` shape, see the note at the top).\n`);
}

if (files.length === 0) {
  process.stderr.write(`🔴 check-dead-links: no html files under ${outDir} — nothing was checked. ` +
    `This is NOT a clean bill of health (build first, or point me at the right directory).\n`);
  process.exit(2);
}

if (dead.length === 0) {
  process.stderr.write(`✅ check-dead-links: ${files.length} page(s), ${checked} internal href(s), 0 dead.\n`);
  process.exit(0);
}

process.stderr.write(`🔴 check-dead-links: ${dead.length} dead link(s) in ${files.length} page(s) ` +
  `(${checked} internal href(s) checked):\n`);
for (const d of dead) process.stderr.write(`   ${d.file}  →  ${d.href}\n`);
process.exit(1);
