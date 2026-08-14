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
// 🔴 THE VALUE IS PARSED, NOT MATCHED. #992: the first version of the third-party rule tested the
// value against /url\(https?:/ , and `background-image: image-set("https://…/x.png" 1x)` walks past
// it — every token legal, static checker green, and the browser really does fetch from that host
// (measured: 1 request to the probe's host). One syntax for one idea is the assumption that broke;
// a CSS value can name a URL as url(), as a bare string inside image-set(), and any number of times
// in one declaration.
const valueParser = require('postcss-value-parser');

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

// Every URL a declaration names, whatever syntax names it: `url(…)` quoted or bare, and the bare
// strings `image-set()` / `-webkit-image-set()` take (which is how a sheet names an image without
// ever writing `url`). Multiple backgrounds are a comma-separated list of the same, so walking the
// parsed value covers them without a rule of their own.
// `\75 rl(https://host/x.png)` is `url(https://host/x.png)` to a browser — an identifier may spell
// any of its characters as an escape — and the browser really does fetch it (measured: 1 request).
// The parser cannot see it: it splits that text into `word "\75"`, `space`, `function "rl"`, so no
// test on a function's name can reach it. Decoding first is what makes it visible. Refusing to
// decode `\\` keeps a literal backslash from eating the character behind it.
// A backslash at the end of a line is a continuation INSIDE a string: the browser drops both
// characters before it ever sees a URL, so `"https:\<newline>//host/x"` is `https://host/x` and the
// request goes out (#992 r4, measured by QA2). It has to go first — the escape rule below excludes
// `\n` on purpose (an escape never spans a line), so nothing else would ever remove it.
const CSS_CONTINUATION = /\\(?:\r\n|[\n\r\f])/g;
const CSS_ESCAPE = /\\(?:([0-9a-fA-F]{1,6})[ \t\n\f]?|([^\n0-9a-fA-F]))/g;
function decodeEscapes(s) {
  return s.replace(CSS_CONTINUATION, '').replace(CSS_ESCAPE, (whole, hex, ch) => {
    if (!hex) return ch === '\\' ? whole : ch;
    const cp = parseInt(hex, 16);
    // 0 and out-of-range are U+FFFD per CSS tokenization; fromCodePoint would throw on them.
    return cp === 0 || cp > 0x10ffff ? '�' : String.fromCodePoint(cp);
  });
}

function collectUrls(value, found) {
  valueParser(value).walk((node) => {
    if (node.type === 'function' && node.value.toLowerCase() === 'url') {
      // 🔴 REBUILT FROM ALL OF THE CHILDREN, NOT `nodes[0]`. postcss-value-parser only folds the
      // contents of a url() into one node when the function is spelled in lower case. `URL(` is
      // the same function to a browser and it really does fetch it, but the parser hands back
      // `word "https"`, `div ":"`, `div "/"`, `div "/"`, `word "host"`, … — so `nodes[0].value` is
      // the string "https", which no third-party test can recognise. That is how five spellings
      // (`URL(…)`, `Url(…)`, `URL(//…)`, `image-set(URL(…))`, `-WEBKIT-IMAGE-SET(URL(…))`) walked
      // past the first #992 version of this function while the version on main caught all five.
      // Quoted contents arrive as a single `string` node with the quotes already stripped, which is
      // why one bare node still uses its own value instead of being stringified back.
      const inner = node.nodes || [];
      const single = inner.length === 1 && (inner[0].type === 'string' || inner[0].type === 'word');
      found.push(single ? inner[0].value : valueParser.stringify(inner));
      // url() names one resource; descending would re-report its pieces, so the walk stops here.
      return false;
    }
    if (node.type === 'string') found.push(node.value);
    return undefined;
  });
}

function urlsIn(value) {
  const found = [];
  collectUrls(value, found);
  // The decoded pass only ever ADDS to what the plain one saw. Reading the decoded text alone would
  // mean trusting the decoder not to have destroyed anything — a union cannot lose a URL, whatever
  // the decoder does to the rest of the value.
  const decoded = decodeEscapes(value);
  if (decoded !== value) collectUrls(decoded, found);
  return [...new Set(found)];
}
// Off this site: the protocol-relative `//host/…`, or ANY explicit scheme except `data:`.
// `data:` stays legal — it is bytes in the sheet, not a request to a third party, and the sheets
// this contract is written for use it for small decorations.
//
// 🔴 THE SLASHES AFTER THE SCHEME ARE NOT PART OF THE TEST (#992 r4; QA2 measured all three).
// This first read `(scheme:)?//`, i.e. it wanted the two slashes. But a browser's URL parser is
// forgiving about them for http/https, and it really does fetch every one of these:
//
//	url(https:/h09.invalid/x.png)     one slash
//	url(https:h10.invalid/y.png)      none at all
//	url("https:\<newline>//h11.…")    a line continuation inside the string, removed before parsing
//
// Three requests really went out, and all three walked past this rule — while §3 of the contract
// says "Every URL in a declaration counts, however it is written". A sentence that the code does
// not back is the next reader's wrong turn, so the code is what changed.
const isThirdPartyUrl = (u) => {
  const s = u.trim();
  if (s.startsWith('//')) return true;
  const m = s.match(/^([a-z][a-z0-9+.-]*):/i);
  return m !== null && m[1].toLowerCase() !== 'data';
};

// `(min-width: <value>)`, that and nothing else. Counted through rather than matched with one
// regular expression because the two things being told apart both contain parentheses: a value may
// legally hold `calc(40em + 10px)` — one condition, one feature, and the browser honours it (measured
// #992: `matchMedia` matches it and the rule inside really applies, row-gap 0 → 137px) — while
// `(min-width:0) and (max-width:480px)` is two conditions. The
// first version of this check refused every parenthesis in the value, which threw out the legal one
// too; the group closing anywhere but at the very end is what actually says "there is more here".
function isSingleMinWidth(params) {
  const s = params.trim();
  if (!s.startsWith('(') || !s.endsWith(')')) return false;
  let depth = 0;
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] === '(') depth += 1;
    else if (s[i] === ')') {
      depth -= 1;
      if (depth === 0 && i !== s.length - 1) return false; // `… ) and (…`, `… ), (…`
      if (depth < 0) return false;
    }
  }
  if (depth !== 0) return false;
  const m = s.slice(1, -1).match(/^\s*min-width\s*:\s*(\S.*)$/i);
  if (!m) return false;
  // A second condition tucked INSIDE the value — `(min-width: 0px and (max-width: 480px))` — closes
  // its only group at the very end, so the count above is happy with it. No browser honours those
  // (QA2 measured all three forms: the rule never applies, so what got through was dead CSS), but
  // the refusal message says in so many words that `and` / `or` / `not` are not allowed, and a
  // message that is not true of the code is the next reader's wrong turn. None of these words can
  // appear in a legal length: `calc()` / `min()` / `max()` / `clamp()` / `var()` and units have no
  // use for them.
  if (/(^|[\s(])(and|or|not)([\s(]|$)/i.test(m[1])) return false;
  let d = 0;
  for (const ch of m[1]) {
    if (ch === '(') d += 1;
    else if (ch === ')') d -= 1;
    else if (d === 0 && (ch === ',' || ch === ';' || ch === ':')) return false;
  }
  return d === 0;
}

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
  for (const url of urlsIn(value)) {
    if (isThirdPartyUrl(url)) {
      report(`"${prop}: ${value}" loads a third-party resource (${url.trim()})`);
    }
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
      // 🔴 THE WHOLE CONDITION HAS TO BE THAT ONE FEATURE, not merely start with it (#992). The
      // previous test was `/^\(\s*min-width\s*:/` on the same string, so `(min-width: 0px), print`
      // and `(min-width:0) and (max-width:480px)` both passed: the first is a media QUERY LIST
      // whose second member is a media type, the second bolts a max-width on. Both were measured
      // green.
      if (!isSingleMinWidth(rule.params)) {
        at(rule, `@media ${rule.params} — only a single "(min-width: …)" condition is allowed `
          + '(no media query list, no "and"/"or"/"not", no other feature)');
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

function main() {
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
}

// #1009 — the file is both a command and a module now. `lint()` is what the build-time gate
// (scripts/css-contract-check.js) calls, so the rules a sheet is judged by exist ONCE: a second
// implementation for the automatic caller is a second thing to keep in step, and the two would
// disagree the first time either changed. Running it by hand is unchanged.
if (require.main === module) main();

module.exports = { lint, CONTRACT_VERSION };
