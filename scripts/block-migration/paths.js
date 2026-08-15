// #1020 — where these scripts find things, derived from this file's own location.
//
// 🔴 This exists for exactly the reason `scripts/theme-gallery/paths.mjs` exists, and it is the same
// defect one ticket later: the #1008 copies of geo.js / ac3.js / ac3-wrap.js each named
// `/root/wt/1008/tests/e2e/node_modules/playwright-core` outright, so they only ran inside one
// ticket's worktree — a directory `git worktree remove` deletes. Every other path in these scripts is
// relative to `templates/nextjs`, so only this one had to change when they moved into the repo.
//
// CommonJS on purpose: the scripts that need it are CommonJS (`require`), and playwright-core is too.
// theme-gallery/paths.mjs is the ESM sibling of this file and points at `playwright/index.mjs`.
const path = require('path');

/** templates/nextjs — this file is at templates/nextjs/scripts/block-migration/paths.js */
const NEXT_DIR = path.resolve(__dirname, '..', '..');

/** The repo root, used only to find the playwright install the e2e suite already has. */
const REPO_ROOT = path.resolve(NEXT_DIR, '..', '..');

/** Playwright is not a dependency of templates/nextjs; borrow the one tests/e2e installs. */
const PLAYWRIGHT_CORE_MODULE =
  process.env.PLAYWRIGHT_CORE_MODULE ||
  path.join(REPO_ROOT, 'tests', 'e2e', 'node_modules', 'playwright-core');

module.exports = { NEXT_DIR, REPO_ROOT, PLAYWRIGHT_CORE_MODULE };
