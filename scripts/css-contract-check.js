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
      unavailable: null,
    };
  } catch (e) {
    if (e.code !== 'MODULE_NOT_FOUND') throw e;
    return { unavailable: `${e.message.split('\n')[0]} — run \`npm ci\` in templates/nextjs` };
  }
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
  const { themeLint, baseLint, unavailable } = loadLinters();
  if (unavailable) return { problems: [], checked: [], skipped: [], unreadable: [], unavailable };

  const problems = [];
  const checked = [];
  const skipped = [];
  const unreadable = [];

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
