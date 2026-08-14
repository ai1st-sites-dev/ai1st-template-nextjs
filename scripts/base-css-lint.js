#!/usr/bin/env node
// base-css-lint.js — is public/base.css still weak enough for a theme to override it? (#1001)
//
//   node scripts/base-css-lint.js public/base.css
//
// Exit 0 = legal. Exit 1 = at least one rule is not, every one of them printed with file, line and
// the exact thing that did it. Exit 2 = could not read or could not parse (an instrument failure is
// not the same answer as "it is legal", and this repo has paid for treating them alike).
//
// 🔴 WHAT IT IS DEFENDING. base.css and a theme sheet select the same hooks, and the whole fallback
// design rests on the theme winning: they tie on specificity and the theme is loaded later. One
// rule here with a specificity above a single class — `[data-block="hero"] .hero__title` is (0,2,0)
// against a theme's (0,1,0) — and the theme can no longer override that property from ANY position
// in the load order. Measured in spec §4.8: base wins, 40px, with the theme asking for 24px.
//
// So the test is not a style preference, it is: can every declaration in this file still be beaten
// by `.hook { … }` in a sheet loaded after it? Three ways to break that, three checks:
//
//   · a selector stronger than one class     → refused below
//   · a rule nested inside another rule      → refused below (#1001 r2, QA3 found it): CSS native
//     nesting is another SPELLING of the compound selector above. `.hero { .hero__title { … } }` is
//     `:is(.hero) .hero__title` = (0,2,0), so a theme's `.hero__title` (0,1,0) can never win — and
//     the two halves each read as a legal single class, so a selector-by-selector check passes them
//     both. Measured: checker said rc=0, the browser read 99px where the theme asked for 24px.
//     🔴 The lesson is bigger than this one rule and is why the check below asks about ANCESTRY
//     rather than the immediate parent: when a guard's test is "does this text equal that shape",
//     the same meaning always has another spelling. (#992's `opacity: 0` vs `filter: opacity(0)` is
//     the same story in this repo.)
//   · `!important`                           → refused below
//   · a cascade layer                        → refused below, and this one is the subtle one:
//
// One more thing is refused here for a reason that has nothing to do with specificity:
//
//   · `animation` / `transition` (any spelling) → refused below (#1001 r3, spec §5.5). The invariant
//     that decides whether text is on screen photographs the box twice and calls the pixels that
//     changed "the text". That reading is only true while the box holds still. Measured in #992 r4:
//     a background-colour animation plus `filter: opacity(0)` made the text genuinely invisible
//     while 33814 pixels were counted as text. A theme sheet already cannot animate — not by a rule
//     of its own, but because theme-css-lint's property list is a whitelist and neither property is
//     on it (measured: both refused, and `@keyframes` with them) — so this file is the last surface
//     an animation could get in through, and it is the one every phase-2 block edits again, with a
//     different person holding the pen each time.
//     `@layer` does not RAISE this file, it SINKS it — unlayered rules beat every layered rule, and
//     Tailwind 3.4's preflight is unlayered, so `@layer base { .hero__title { … } }` loses to
//     `h1 { margin: 0 }` and the fallback arm quietly renders with no floor at all (spec §4.8
//     measured it twice: 0px where 40px was intended).
//
// 🔴 IT USES POSTCSS, NOT A REGULAR EXPRESSION — same reason as scripts/theme-css-lint.js: a comment
// or a `content: "}"` defeats brace counting, and this file opens with a long comment.
const fs = require('fs');
const path = require('path');
const postcss = require('postcss');

const CONTRACT_VERSION = 'v1';

// One class. Nothing before it, nothing after it, no second one chained on.
// `.a, .b` is a list of two of these and is fine — it is split on commas first.
const SINGLE_CLASS = /^\.-?[_a-zA-Z][_a-zA-Z0-9-]*$/;

// Every spelling of the two animating property families: shorthand and longhand, with or without a
// vendor prefix — `animation`, `animation-name`, `-webkit-transition`, `transition-property`, …
// Asking about the family rather than listing the properties is the point: the list grows
// (`transition-behavior` is newer than this file) and a check that names members goes stale silently.
const ANIMATING_PROP = /^(?:-[a-z]+-)?(?:animation|transition)(?:-|$)/i;

// `from`, `to` and `47%` are keyframe offsets, not selectors — they only ever appear inside
// @keyframes, which is already refused whole by walkAtRules. Running the selector check over them
// prints three more lines that name a rule the author never wrote, burying the one line that says
// what to delete. (QA1 reported it on r2.)
function insideKeyframes(node) {
  for (let p = node.parent; p; p = p.parent) {
    if (p.type === 'atrule' && /keyframes$/i.test(p.name)) return true;
  }
  return false;
}

function checkSelector(selector, report) {
  for (const raw of selector.split(',')) {
    const one = raw.trim();
    if (!one) continue;
    if (SINGLE_CLASS.test(one)) continue;
    // Say which kind of too-strong it is; "not a single class" alone does not tell the author what
    // to write instead, and the fix is different for each of these.
    let why = 'only a single class selector is allowed here';
    if (/[\s>+~]/.test(one)) {
      why = 'it is a compound/descendant selector — its specificity is above a theme\'s, so a theme '
        + 'could never override it. Give the part you want to style its own class instead';
    } else if (/^#/.test(one) || /#/.test(one)) {
      why = 'an id selector is (1,0,0) — nothing a theme can write reaches it';
    } else if (/\[/.test(one)) {
      why = 'an attribute selector chained onto a class raises the specificity above a theme\'s';
    } else if (/^[a-zA-Z*]/.test(one)) {
      why = 'a type/universal selector — base styles the neutral markup\'s classes, and a page-wide '
        + 'element rule would reach markup no theme has a hook for';
    } else if (/:/.test(one)) {
      why = 'a pseudo-class raises the specificity (or, for ::before/::after, invents content the '
        + 'floor has no business inventing)';
    } else if ((one.match(/\./g) || []).length > 1) {
      why = 'two classes chained is (0,2,0) — above what a theme can write';
    }
    report(`selector "${one}" — ${why}`);
  }
}

function lint(file) {
  let css;
  try {
    css = fs.readFileSync(file, 'utf-8');
  } catch (e) {
    console.error(`🔴 ${file}: cannot read it — ${e.message}`);
    return null;
  }

  const problems = [];
  const at = (node, msg) => problems.push(
    `${file}:${node && node.source && node.source.start ? node.source.start.line : '?'} — ${msg}`);

  const first = css.split('\n').slice(0, 3).join('\n');
  const declared = first.match(/base-css-contract:\s*(v\d+)/);
  if (!declared) {
    problems.push(`${file}:1 — no "base-css-contract: ${CONTRACT_VERSION}" line in the first three `
      + 'lines. Without it nobody can tell which markup this floor was written against');
  } else if (declared[1] !== CONTRACT_VERSION) {
    problems.push(`${file}:1 — written against ${declared[1]}, this checker knows `
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
    if (rule.name === 'media') return;
    if (rule.name === 'layer') {
      at(rule, '@layer — an unlayered rule beats every layered one, and Tailwind\'s preflight is '
        + 'unlayered. Inside a layer this file loses to `h1 { margin: 0 }` precisely when no theme '
        + 'sheet is loaded, which is the case it exists for (spec §4.8)');
      return;
    }
    at(rule, `@${rule.name} is not allowed in the floor — only @media`);
  });

  // #1001 r2 — A RULE MAY ONLY SIT AT THE TOP OF THE FILE, OR DIRECTLY INSIDE @media.
  //
  // 🔴 The question is asked about the whole ANCESTOR CHAIN, not about `rule.parent`. Checking only
  // the parent lets `.hero { @media (min-width: 40em) { .hero__title { … } } }` through — the inner
  // rule's parent is an @media, which is allowed, while the @media's own parent is a rule, so the
  // nesting is still there and the specificity is still (0,2,0).
  //
  // An at-rule that is not @media is already reported by walkAtRules above, so a rule sitting inside
  // one is not reported twice — the construct that has to go is the at-rule, and naming its children
  // as well would only bury it.
  root.walkRules((rule) => {
    for (let p = rule.parent; p; p = p.parent) {
      if (p.type !== 'rule') continue;
      at(rule, `"${rule.selector}" is nested inside "${p.selector}" — CSS nesting is the same thing `
        + 'as a descendant selector (it resolves to `:is(…) …`), so its specificity is above a '
        + 'theme\'s and the theme could never override it. Write it at the top of the file with its '
        + 'own class instead');
      break;
    }
    if (insideKeyframes(rule)) return;
    checkSelector(rule.selector, (m) => at(rule, m));
  });

  root.walkDecls((decl) => {
    if (decl.important) {
      at(decl, `"${decl.prop}: … !important" — nothing a theme writes can beat it, so the sheet `
        + 'stops being able to override the floor');
    }
    if (ANIMATING_PROP.test(decl.prop)) {
      at(decl, `"${decl.prop}: …" — the floor must not animate. The invariant that decides whether `
        + 'text is on screen photographs the box twice and calls the changed pixels "the text", '
        + 'which is only true while the box holds still: in #992 r4 a background animation plus '
        + '`filter: opacity(0)` hid the text while 33814 pixels still read as text. A theme sheet '
        + 'cannot animate either, so this file is the last way one could get in (spec §5.5)');
    }
  });

  return problems;
}

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: node scripts/base-css-lint.js <base.css> [more.css …]');
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

if (unreadable) process.exit(2);
process.exit(illegal ? 1 : 0);
