#!/usr/bin/env node
// css-contract-check.js — the automatic caller for the two CSS contract checkers (#1009)
//
//   node scripts/css-contract-check.js            # this tree's public/base.css + public/themes/*.css
//   node scripts/css-contract-check.js <dir>      # some other tree (a cloned site repo, say)
//
// Exit 0 = every sheet obeys its contract. Exit 1 = at least one does not, with file and line.
// Exit 2 = the reading could not be taken at all (see "TWO KINDS OF RED" below).
//
// ══ WHY THIS FILE EXISTS ═════════════════════════════════════════════════════════════════════════
// scripts/theme-css-lint.js (#991) and scripts/base-css-lint.js (#1001) were written, reviewed and
// then never called: `git grep` for either name over package.json, .github/, sync-config.js, manager/
// and worker/ hit exactly one line — the eslint invocation that checks the two scripts' own SOURCE.
// A checker only a person can start is a checker that runs on the day it is written. QA1/QA2 said so
// on #1001 in as many words: "the check has no automatic caller, so one green hand-run gets taken for
// a pass".
//
// It matters most for what comes next. Phase 2 of the theme CSS architecture (spec §8) moves 34
// blocks to neutral markup one at a time, and each move needs a rule added to every theme sheet.
// Miss one and that block silently falls back to base.css — the page opens, the build is green, and
// nobody finds out until a person looks at a picture. spec §8: "'every theme got its rules' has to be
// a pre-merge check".
//
// ══ WHERE IT IS CALLED FROM ══════════════════════════════════════════════════════════════════════
//   1. scripts/sync-config.js — so EVERY site build runs it (see the comment there for why it is not
//      npm's `prebuild` hook: the container calls `npx next build` directly and prebuild never fires).
//   2. .github/workflows/ci-cd.yml, the `templates` step — because the CI path and the build path are
//      not the same path: `sync-template` subtree-pushes templates/nextjs to the template repos, and
//      whatever it pushes becomes the bytes every NEW site is created from.
//   3. #1004 (a theme's admission to the pool) is meant to call the same function, not write its own.
//
// ══ TWO KINDS OF RED, KEPT APART (PM ruled this on #1009) ════════════════════════════════════════
// `node scripts/base-css-lint.js public/base.css` in a tree with no node_modules dies on
// `require('postcss')` and exits 1 — the same code it uses for "this sheet is illegal". A caller
// cannot tell those apart, and treating "the tool did not run" as "the sheet is bad" (or the other
// way round) is a mistake this repo has paid for in both directions. So: the deps are resolved FIRST,
// and their absence is exit 2 with a sentence naming npm, never a violation.
const fs = require('fs');
const path = require('path');

// 🔴 The linters `require('postcss')` at load time, so the resolve has to happen around the requires
// themselves — not before them, which would be a second guess at what they need. Only
// MODULE_NOT_FOUND becomes "cannot take the reading": anything else (a syntax error in a linter, say)
// is a real defect and is allowed to throw, loudly, with its stack.
function loadLinters() {
  try {
    return {
      themeLint: require('./theme-css-lint.js').lint,
      baseLint: require('./base-css-lint.js').lint,
      hooks: require('./theme-css-lint.js').HOOKS,
      isHook: require('./theme-css-lint.js').isHook,
      propExact: require('./theme-css-lint.js').PROP_EXACT,
      propPrefixes: require('./theme-css-lint.js').PROP_PREFIXES,
      unavailable: null,
    };
  } catch (e) {
    if (e.code !== 'MODULE_NOT_FOUND') throw e;
    return { unavailable: `${e.message.split('\n')[0]} — run \`npm ci\` in templates/nextjs` };
  }
}

// ══ THE HOOK TABLE IN THE DOC vs THE HOOK SET IN THE LINTER (#1018) ══════════════════════════════
// docs/reference/theme-css-contract.md §1 and theme-css-lint.js's `HOOKS` were two hand-written
// copies of one list, and nothing compared them. #1018 is the first ticket that had to edit both
// (phase 2 adds a batch of hooks per block, 31 more blocks to go) — which is the moment a pair like
// that starts to drift. Drift is quiet in the direction that matters: a hook in the doc that the
// linter does not know refuses every sheet that follows the documentation.
//
// 🔴 The doc is the copy that gets checked; the linter's set stays the one thing a sheet is judged
// by. Making the doc the source instead would mean parsing prose to run a build.
//
// 🔴 A MISSING DOC IS NOT A VIOLATION. This file also runs inside site repos (subtree-pushed
// templates/nextjs, no docs/ directory) — same discipline as the two kinds of red above: "the
// reading could not be taken" is reported as skipped, never as drift.
const DOC_RELATIVE = path.join('docs', 'reference', 'theme-css-contract.md');

function findContractDoc(rootDir) {
  // Upwards from the template tree: templates/nextjs → templates → repo root. Bounded, and it stops
  // at the filesystem root rather than assuming a depth.
  let dir = path.resolve(rootDir);
  for (;;) {
    const candidate = path.join(dir, DOC_RELATIVE);
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** The hooks §1's table names, in document order. Only the table — prose mentions hooks too. */
function hooksInDocTable(md) {
  const section = md.split(/^## /m).find((s) => s.startsWith('1. What a sheet may select'));
  if (!section) return null;
  const tokens = [];
  for (const line of section.split('\n')) {
    // Table rows only: `| Hero parts | `.hero` · … |`. The header separator and prose are skipped.
    if (!line.startsWith('|') || /^\|\s*-+/.test(line)) continue;
    if (/^\|\s*\|\s*Hook\s*\|/.test(line)) continue;
    for (const m of line.matchAll(/`([^`]+)`/g)) tokens.push(m[1]);
  }
  return tokens;
}

/**
 * @returns {{problems: string[], skipped: string|null}}
 */
function checkHookTable(rootDir, hooks, isHook) {
  const docPath = findContractDoc(rootDir);
  if (!docPath) return { problems: [], skipped: `${DOC_RELATIVE} (not in this tree)` };

  let md;
  try {
    md = fs.readFileSync(docPath, 'utf8');
  } catch (e) {
    return { problems: [], skipped: `${DOC_RELATIVE} (${e.message})` };
  }

  const tokens = hooksInDocTable(md);
  if (tokens === null) {
    return { problems: [`${DOC_RELATIVE} — no "## 1. What a sheet may select" section in it, so the `
      + 'hook table could not be read. The check is looking for that heading.'], skipped: null };
  }

  const problems = [];
  // Rows written with a placeholder (`[data-block-layout="<value>"]`) stand for a whole family and
  // cannot be compared as strings. They are checked the only way that means anything: instantiate
  // one and ask the linter whether it would accept it.
  const exact = new Set();
  for (const t of tokens) {
    if (t.includes('<')) {
      const sample = t.replace(/<[^>]+>/g, 'sample-value');
      if (!isHook(sample)) {
        problems.push(`${DOC_RELATIVE} §1 — the table offers \`${t}\`, but theme-css-lint.js refuses `
          + `\`${sample}\`. A sheet written from the documentation would be rejected.`);
      }
      continue;
    }
    exact.add(t);
  }

  const docOnly = [...exact].filter((h) => !hooks.has(h)).sort();
  const codeOnly = [...hooks].filter((h) => !exact.has(h)).sort();
  if (docOnly.length > 0) {
    problems.push(`${DOC_RELATIVE} §1 — ${docOnly.length} hook(s) in the table that theme-css-lint.js `
      + `does not know: ${docOnly.join(' · ')}. A sheet that used them would be refused.`);
  }
  if (codeOnly.length > 0) {
    problems.push(`${DOC_RELATIVE} §1 — ${codeOnly.length} hook(s) the linter accepts that the table `
      + `does not list: ${codeOnly.join(' · ')}. Themes are generated from the documentation.`);
  }
  return { problems, skipped: null };
}

// ══ THE PROPERTY TABLE IN THE DOC vs THE TWO SETS IN THE LINTER (#1190) ══════════════════════════
// The same pair, the same drift, one section further down: §2's first table and `PROP_EXACT` /
// `PROP_PREFIXES` are two hand-written copies of one list, and until this ticket nothing compared
// them. §1 got its check in #1018 because that was the first ticket that had to edit both copies;
// #1190 is that ticket for §2 — it adds six properties — and the drift was already there to find:
// §2's prose said `overflow` was not on the list while `PROP_EXACT` had carried it since #1011 and 13
// pool sheets were writing it.
//
// 🔴 ONLY THE FIRST TABLE IN §2. That section carries several — the refusals, the block-display
// keywords, the worked examples — and every one of them is full of backticked property names that
// are being REFUSED. Reading the whole section would compare the allowed list against a list that is
// mostly the opposite of it. So: rows are taken from where the first `|` line starts until the first
// line that is not one.
//
// 🔴 The two spellings the table uses are the two shapes the linter has. `grid-*` / `padding*` is a
// PREFIX (the `-` belongs to the prefix when the table writes one: `grid-*` → `grid-`, `padding*` →
// `padding`, which is exactly how `PROP_PREFIXES` spells them), anything else is EXACT. A token with
// a `*` anywhere else, or a table cell with no backticks in it, is not something this pair has agreed
// on and is reported rather than guessed at.
function propertiesInDocTable(md) {
  const section = md.split(/^## /m).find((s) => s.startsWith('2. What a sheet may set'));
  if (!section) return null;
  const tokens = [];
  let started = false;
  for (const line of section.split('\n')) {
    if (!line.startsWith('|')) { if (started) break; continue; }
    started = true;
    if (/^\|\s*-+/.test(line)) continue;
    if (/^\|\s*Group\s*\|/.test(line)) continue;
    for (const m of line.matchAll(/`([^`]+)`/g)) tokens.push(m[1]);
  }
  return started ? tokens : null;
}

/**
 * @returns {{problems: string[], skipped: string|null}}
 */
function checkPropertyTable(rootDir, propExact, propPrefixes) {
  const docPath = findContractDoc(rootDir);
  if (!docPath) return { problems: [], skipped: `${DOC_RELATIVE} §2 (not in this tree)` };
  if (!propExact || !propPrefixes) {
    return { problems: [], skipped: `${DOC_RELATIVE} §2 (theme-css-lint.js does not export its `
      + 'property sets — this check needs both halves and had only one)' };
  }

  let md;
  try {
    md = fs.readFileSync(docPath, 'utf8');
  } catch (e) {
    return { problems: [], skipped: `${DOC_RELATIVE} §2 (${e.message})` };
  }

  const tokens = propertiesInDocTable(md);
  if (tokens === null) {
    return { problems: [`${DOC_RELATIVE} — no "## 2. What a sheet may set" section with a table in `
      + 'it, so the property list could not be read. The check is looking for that heading followed '
      + 'by a table.'], skipped: null };
  }

  const problems = [];
  const docExact = new Set();
  const docPrefixes = new Set();
  for (const t of tokens) {
    if (t.endsWith('*')) {
      docPrefixes.add(t.slice(0, -1));
    } else if (t.includes('*')) {
      problems.push(`${DOC_RELATIVE} §2 — the table offers \`${t}\`, and this check only understands `
        + 'a plain property name or one ending in `*`. Write it one of those two ways, or widen this '
        + 'check on purpose.');
    } else {
      docExact.add(t);
    }
  }

  const diff = (a, b) => [...a].filter((x) => !b.has(x)).sort();
  const lintExact = new Set(propExact);
  const lintPrefixes = new Set(propPrefixes);
  const pairs = [
    ['exact property', diff(docExact, lintExact), diff(lintExact, docExact)],
    ['property prefix', diff(docPrefixes, lintPrefixes), diff(lintPrefixes, docPrefixes)],
  ];
  for (const [what, docOnly, codeOnly] of pairs) {
    if (docOnly.length > 0) {
      problems.push(`${DOC_RELATIVE} §2 — ${docOnly.length} ${what}(s) in the table that `
        + `theme-css-lint.js does not allow: ${docOnly.join(' · ')}. A sheet that used them would be `
        + 'refused, having been written from the documentation.');
    }
    if (codeOnly.length > 0) {
      problems.push(`${DOC_RELATIVE} §2 — ${codeOnly.length} ${what}(s) theme-css-lint.js allows that `
        + `the table does not list: ${codeOnly.join(' · ')}. Themes are generated from the `
        + 'documentation, so a property only the checker knows about is one nobody will use — and a '
        + 'doc that under-states what passes is how §2 came to claim `overflow` was refused while 13 '
        + 'sheets wrote it.');
    }
  }
  return { problems, skipped: null };
}

/**
 * Check a template tree's CSS against both contracts.
 *
 * Returns FACTS, and leaves the policy to the caller, because the two callers need different ones:
 * a template tree with no public/base.css is broken, while a site repo created before #1001 simply
 * does not have that file yet and must keep building. See both call sites.
 *
 * 🔴 `unreadable` and `unavailable` are two different facts and are returned separately (#1009 r1,
 * QA3). They used to be merged into `unavailable`, and merging them opened a way past the gate that is
 * EASIER to hit than a plain violation: add the illegal line, then leave one extra `}` in the file.
 * postcss cannot parse it, lint() returns null, the whole thing read as "the tool did not run" — and
 * sync-config's policy for that is a warning and carry on. Measured: the `@import` line rode into
 * out/<site>/themes/<sheet>.css with a green build. A missing postcss says nothing about any sheet; a
 * sheet that is present and will not parse is a statement about that sheet.
 *
 * @param {string} rootDir  a templates/nextjs tree (or a site repo, which is a copy of one)
 * @returns {{problems: string[], checked: string[], skipped: string[], unreadable: string[],
 *            unavailable: string|null}}
 */
function checkCssContracts(rootDir) {
  const { themeLint, baseLint, hooks, isHook, propExact, propPrefixes, unavailable } = loadLinters();
  if (unavailable) return { problems: [], checked: [], skipped: [], unreadable: [], unavailable };

  const problems = [];
  const checked = [];
  const skipped = [];
  const unreadable = [];

  // #1018 — docs §1 against the linter's set. It runs before the sheets because a drifted table is
  // the thing that would make the sheet results hard to read: sheets written from the documentation
  // fail one by one, and the shared cause is one line up here.
  const table = checkHookTable(rootDir, hooks, isHook);
  if (table.skipped) skipped.push(table.skipped);
  else { checked.push(DOC_RELATIVE + ' §1 (hooks vs theme-css-lint.js)'); problems.push(...table.problems); }

  // #1190 — and §2 against the linter's two property sets, for the reason written above that function.
  const props = checkPropertyTable(rootDir, propExact, propPrefixes);
  if (props.skipped) skipped.push(props.skipped);
  else { checked.push(DOC_RELATIVE + ' §2 (properties vs theme-css-lint.js)'); problems.push(...props.problems); }

  const base = path.join(rootDir, 'public', 'base.css');
  if (fs.existsSync(base)) {
    const found = baseLint(base);
    if (found === null) unreadable.push(base);
    else { checked.push('public/base.css'); problems.push(...found); }
  } else {
    skipped.push('public/base.css (not in this tree)');
  }

  const themesDir = path.join(rootDir, 'public', 'themes');
  if (fs.existsSync(themesDir)) {
    // Every sheet in the directory, not just the one this site wears. They all ship in the same
    // repo, they all reach a site the moment somebody applies them, and there are three of them —
    // checking the lot costs milliseconds and removes "which one was current when it went in" as a
    // question anyone has to answer.
    const sheets = fs.readdirSync(themesDir).filter((f) => f.endsWith('.css')).sort();
    if (sheets.length === 0) skipped.push('public/themes/ (no .css in it)');
    for (const sheet of sheets) {
      const found = themeLint(path.join(themesDir, sheet));
      if (found === null) unreadable.push(path.join(themesDir, sheet));
      else { checked.push(`public/themes/${sheet}`); problems.push(...found); }
    }
  } else {
    skipped.push('public/themes/ (not in this tree)');
  }

  // A file that is there but cannot be read or parsed goes back as its OWN fact — see the 🔴 note on
  // this function. It is not folded into `unavailable` (that word means "no linter to run at all"),
  // and it is not folded into `problems` either: the linter never got far enough to name a line, so
  // the caller gets the file and decides. Both callers refuse on it.
  return { problems, checked, skipped, unreadable, unavailable: null };
}

function main() {
  const rootDir = path.resolve(process.argv[2] || path.join(__dirname, '..'));
  const { problems, checked, skipped, unreadable, unavailable } = checkCssContracts(rootDir);

  if (unavailable) {
    console.error(`🔴 css contracts: could not check them — ${unavailable}`);
    console.error('   This is NOT a statement about the sheets. Nothing was judged.');
    process.exit(2);
  }

  // 🔴 A sheet that is in the tree and will not parse is REFUSED, never skipped. It is reported before
  // the violations below because it is the one state in which the count of violations is not the whole
  // answer: nothing at all was read out of that file, so a "0 violations" from the others says nothing
  // about it.
  if (unreadable.length > 0) {
    console.error(`🔴 css contracts: ${unreadable.length} sheet(s) in the tree could not be read or `
      + 'parsed — refused, not skipped:');
    for (const u of unreadable) console.error(`   ${u}`);
    console.error('   The 🔴 line each linter printed above says what it choked on. A sheet nobody can '
      + 'parse cannot be judged against the contract, and an unjudged sheet is not a pass.');
    if (problems.length > 0) {
      console.error(`   (${problems.length} violation(s) were also found in the sheets that did parse:)`);
      for (const p of problems) console.error(`   ${p}`);
    }
    process.exit(2);
  }

  // 🔴 Zero files checked is exit 2 HERE and a printed line in sync-config.js, and the difference is
  // deliberate. This command is pointed at a template tree, where both of those paths are part of the
  // template — if they are gone, the reading is empty and "nothing to look at is not a pass". A site
  // repo cloned from a template older than #991/#1001 genuinely has neither, and refusing to build it
  // would brick every site that already exists.
  if (checked.length === 0) {
    console.error(`🔴 css contracts: nothing was checked in ${rootDir}`);
    for (const s of skipped) console.error(`   · ${s}`);
    process.exit(2);
  }

  if (problems.length === 0) {
    console.log(`✅ css contracts: ${checked.length} file(s) legal — ${checked.join(', ')}`);
    for (const s of skipped) console.log(`   · skipped: ${s}`);
    process.exit(0);
  }

  console.log(`🔴 css contracts: ${problems.length} violation(s) in ${checked.join(', ')}`);
  for (const p of problems) console.log(`   ${p}`);
  process.exit(1);
}

if (require.main === module) main();

module.exports = { checkCssContracts };
