#!/usr/bin/env node
// theme-css-lint.js — does this stylesheet obey the theme CSS contract? (#991, contract v1)
//
// The contract is docs/reference/theme-css-contract.md; this file is the half of it a machine can
// run. It is the gate a GENERATED theme has to pass, which is the whole reason the contract is
// narrow enough to have one: nobody is going to read three hundred AI-written sheets rule by rule.
//
//   node scripts/theme-css-lint.js public/themes/hero-media-left.css
//   node scripts/theme-css-lint.js public/themes/*.css
//
// Exit 0 = every sheet is legal. Exit 1 = at least one is not, and every violation is printed with
// its file, line, and the exact selector or property that did it. Exit 2 = could not read a file.
//
// 🔴 IT REPORTS EVERY VIOLATION, NOT THE FIRST. A generated sheet tends to break a rule in a dozen
// places at once; stopping at the first would turn one fix into a dozen round trips.
//
// 🔴 IT USES POSTCSS, NOT A REGULAR EXPRESSION. `content: "}"` and a comment containing a brace both
// defeat brace counting, and the second one is not hypothetical — every sheet in public/themes/
// opens with a comment. postcss is already a devDependency here (tailwind's own).
const fs = require('fs');
const path = require('path');
const postcss = require('postcss');

const CONTRACT_VERSION = 'v1';

// ── §1 hooks ────────────────────────────────────────────────────────────────────────────────────
// Exact strings. A prefix rule (`starts with .hero__`) would admit the next typo as a new part.
const HOOKS = new Set([
  '.hero', '.hero__media', '.hero__body', '.hero__title', '.hero__sub', '.hero__cta', '.hero__deco',
  '[data-block="hero"]',
  '[data-role="essential"]', '[data-role="lead"]', '[data-role="optional"]',
  'body', '[data-region-layout]',
]);
// `[data-region-layout="pill-floating"]` and friends: the attribute is on the list, its values are
// the region names #960 already ships, so a value-qualified form is legal.
const HOOK_PATTERNS = [/^\[data-region-layout="[a-z-]+"\]$/];

// ── §2 properties ───────────────────────────────────────────────────────────────────────────────
const PROP_EXACT = new Set([
  'display', 'order', 'gap', 'row-gap', 'column-gap',
  'width', 'min-width', 'max-width', 'height', 'min-height', 'max-height', 'aspect-ratio',
  'color', 'border-radius', 'box-shadow', 'opacity', 'filter',
  'line-height', 'letter-spacing', 'text-align', 'text-transform',
  'object-fit', 'object-position',
  'content', 'overflow',
]);
const PROP_PREFIXES = [
  'grid-', 'flex-', 'place-', 'align-', 'justify-',
  'padding', 'margin',
  'background', 'border',
  'font-',
];

const isHook = (s) => HOOKS.has(s) || HOOK_PATTERNS.some((re) => re.test(s));
const isAllowedProp = (p) => PROP_EXACT.has(p) || PROP_PREFIXES.some((pre) => p.startsWith(pre));

// Split a selector list on top-level commas, then a complex selector on its combinators, then peel
// pseudo-elements off each compound. What is left has to be one hook, exactly.
function compoundsOf(selector) {
  return selector
    .split(/\s*[\s>+~]\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function checkSelector(sel, report) {
  for (const raw of sel.split(',')) {
    const complex = raw.trim();
    if (!complex) continue;
    for (const compound of compoundsOf(complex)) {
      // ::before / ::after are allowed on any hook. A single-colon pseudo-CLASS (:hover, :nth-child)
      // is not on the list — refused with the rest.
      const m = compound.match(/^(.*?)(::(?:before|after))?$/);
      const base = (m && m[1]) || compound;
      if (!isHook(base)) {
        report(`selector "${complex}" reaches for "${base}", which is not a contract hook`);
      }
    }
  }
}

function checkDecl(decl, report) {
  const prop = decl.prop.toLowerCase();
  const value = decl.value;

  if (decl.important) {
    report(`"${prop}: … !important" — the theme sheet already loads last, so it never needs this`);
  }
  // `position` gets its own sentence instead of falling through to the generic whitelist message at
  // the bottom, because "not on the whitelist" does not tell the author what to do instead — and
  // this is the one refusal a sheet author is most likely to think is a mistake (the design doc's
  // forbidden list names `position: fixed`, which reads as if the others were fine).
  if (prop === 'position') {
    report('"position" is not on the v1 whitelist — place decoration with `order` / `grid-column`');
    return;
  }
  if (prop === 'content') {
    // Drawing is fine, writing is not. Only the empty string passes, in either quote.
    const trimmed = value.trim();
    if (trimmed !== '""' && trimmed !== "''") {
      report(`content: ${trimmed} — a sheet may draw but never write (text here is invisible to `
        + 'the DOM, to structured data and to translation)');
    }
  }
  if (/url\(\s*['"]?(https?:)?\/\//i.test(value)) {
    report(`"${prop}: ${value}" loads a third-party resource`);
  }
  if (!isAllowedProp(prop)) {
    report(`"${prop}" is not on the contract's property whitelist`);
  }
}

function lint(file) {
  let css;
  try {
    css = fs.readFileSync(file, 'utf-8');
  } catch (e) {
    console.error(`🔴 ${file}: cannot read it — ${e.message}`);
    return null; // null = instrument failure, which is not the same answer as "illegal".
  }

  const problems = [];
  const at = (node, msg) => problems.push(
    `${file}:${node && node.source && node.source.start ? node.source.start.line : '?'} — ${msg}`);

  // The version line, first, because everything below is a statement about v1 specifically.
  const first = css.split('\n').slice(0, 3).join('\n');
  const declared = first.match(/theme-css-contract:\s*(v\d+)/);
  if (!declared) {
    problems.push(`${file}:1 — no "theme-css-contract: ${CONTRACT_VERSION}" line in the first three `
      + 'lines. Without it nobody can tell which markup this sheet was written against');
  } else if (declared[1] !== CONTRACT_VERSION) {
    problems.push(`${file}:1 — written against contract ${declared[1]}, this checker knows `
      + `${CONTRACT_VERSION}`);
  }

  let root;
  try {
    root = postcss.parse(css, { from: file });
  } catch (e) {
    console.error(`🔴 ${file}: not parseable CSS — ${e.message}`);
    return null;
  }

  root.walkAtRules((rule) => {
    if (rule.name === 'media') {
      if (!/^\(\s*min-width\s*:/.test(rule.params.trim())) {
        at(rule, `@media ${rule.params} — only "(min-width: …)" is allowed`);
      }
      return;
    }
    at(rule, `@${rule.name} is not allowed`);
  });

  root.walkRules((rule) => checkSelector(rule.selector, (m) => at(rule, m)));
  root.walkDecls((decl) => checkDecl(decl, (m) => at(decl, m)));

  // §3's last line: the second defence for essential content. Written as its own pass because it is
  // a property AND a selector together — neither check above can see the pair.
  root.walkRules((rule) => {
    if (!/\[data-role="essential"\]/.test(rule.selector)) return;
    rule.walkDecls('display', (decl) => {
      if (decl.value.trim() === 'none') {
        at(decl, `"${rule.selector} { display: none }" hides content a theme may never hide`);
      }
    });
  });

  return problems;
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: node scripts/theme-css-lint.js <sheet.css> [more.css …]');
  process.exit(2);
}

let illegal = 0;
let unreadable = 0;
for (const f of files) {
  const problems = lint(f);
  if (problems === null) { unreadable++; continue; }
  if (problems.length === 0) {
    console.log(`✅ ${path.basename(f)}`);
    continue;
  }
  illegal++;
  console.log(`🔴 ${path.basename(f)} — ${problems.length} violation(s)`);
  for (const p of problems) console.log(`   ${p}`);
}

// 🔴 "Could not read it" and "it breaks the contract" exit differently on purpose. They are not the
// same answer, and a caller that treats a missing file as a clean bill of health is the failure this
// repo keeps writing down (#741).
if (unreadable) process.exit(2);
process.exit(illegal ? 1 : 0);
