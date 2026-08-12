// #963 — where everything lives. The #932 copies of these scripts named one ticket's temporary
// workspace and one output directory outright, so they only ran on one machine, in a directory
// that was going to be cleaned up. Nothing here is fixed: the template directory is derived from
// this file's own location, and the output directory is a parameter.
import path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));

/** templates/nextjs — this file is at templates/nextjs/scripts/theme-gallery/paths.mjs */
export const NEXT_DIR = path.resolve(here, '..', '..');

/** The repo root, used only to find the playwright install the e2e suite already has. */
export const REPO_ROOT = path.resolve(NEXT_DIR, '..', '..');

/** Where the gallery is written: index.html, shots/, sites/, review.json. */
export function galleryDir() {
  const dir = process.env.THEME_GALLERY_DIR;
  if (!dir) {
    console.error('Set THEME_GALLERY_DIR to the directory the gallery should be written to.');
    console.error('  e.g.  THEME_GALLERY_DIR=/root/theme-gallery/latest');
    process.exit(2);
  }
  return path.resolve(dir);
}

/** Playwright is not a dependency of templates/nextjs; borrow the one tests/e2e installs. */
export const PLAYWRIGHT_MODULE =
  process.env.PLAYWRIGHT_MODULE ||
  path.join(REPO_ROOT, 'tests', 'e2e', 'node_modules', 'playwright', 'index.mjs');
