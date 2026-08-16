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
//
// ══ EVERY JUDGEMENT IN THIS FILE, AND WHICH SHAPE IT IS (#1011 r10) ══════════════════════════════
//
// A rule written as "refuse these words" is only as good as the list of words. #1011 was bounced
// five times and four of those were one more spelling of an idea already refused: `min()/max()/
// clamp()` → `abs()` → a part's margin collapsing into its block → five more spellings of
// `overflow: visible`. So every judgement here is written as an ALLOWED SET with refusal as the
// default, and the two that are not say why. The table is the deliverable of that round — keep it
// true when a rule is added.
//
//   judgement (function)          shape          refused by default?
//   ─────────────────────────────────────────────────────────────────────────────────────────────
//   isHook / checkSelector        allowed set    yes — a simple selector not on §1's list refuses
//                                                the whole compound; `::before`/`::after` are the
//                                                only pseudo anything
//   isSingleMinWidth              allowed set    yes — `@media (min-width: …)` and nothing else
//   isAllowedProp                 allowed set    yes — §2's property list, prefixes included
//   content: only `""` / `''`     allowed set    yes — every other value refused
//   isThirdPartyUrl               allowed set    yes — a URL passes only with no scheme at all or
//                                                `data:`; `//host` and every other scheme refuse
//   literalFontsIn                allowed set    yes — only `var()` (recursively, fallbacks and
//                                                all) and the generic families pass
//   CONSTANT_UNITS / isWindowUnit allowed set    yes, in the SAFE direction — a unit this file has
//                                                never heard of counts as window-relative, so a new
//                                                CSS unit makes it stricter, never blinder
//   SEPARATE_ARG_FUNCTIONS        allowed set    yes — a function not on it cannot build a length
//                                                (see the 🔴 note there: this is why `abs()` and
//                                                next year's function are refused unnamed)
//   walkArithmetic/checkOneLength allowed set    yes — numbers with units, `0`, `+ - * /`, `calc()`
//                                                and `var()`; one window-relative unit per length
//   onlyAddsToLayout              allowed set    yes — only a margin/padding/border/background/gap/
//                                                font/shadow/filter position may hold a
//                                                window-relative length; sizes and tracks refuse,
//                                                including whatever §2 gains later
//   negativeMarginRisksIn         allowed set    yes — a margin passes only when every added-up
//                                                piece is provably ≥ 0; unreadable (a `var()`, a
//                                                function) is refused, not assumed positive
//   isContainingOverflow          allowed set    yes — `hidden`/`auto`/`scroll`; this is the one
//                                                r9 got wrong (it matched the word `visible`) and
//                                                QA2 walked five other spellings through it
//   PART_HOOKS                    exemption list 🔴 #1031: DERIVED from `HOOKS` (a class hook with
//                                                `__` in its name), no longer hand-written, and the
//                                                "safe direction" claim below is wrong — see the
//                                                note at its definition. Kept verbatim otherwise:
//                                 (old wording)  yes, in the SAFE direction — the list says which
//                                                hooks are PARTS (exempt); a hook nobody has added
//                                                to it is judged as a block, which is stricter.
//                                                📌 A block whose parts arrive later (phase 2 adds
//                                                one per ticket) is judged strictly until its part
//                                                hooks are added here — that is a real cost, and
//                                                the safe direction to pay it in
//   ─────────────────────────────────────────────────────────────────────────────────────────────
//   literalColoursIn              BLACKLIST      #1003's rule, and its reason is written there: it
//                                                names the colour syntaxes (hex, the CSS named
//                                                colours, the colour functions) and pairs that with
//                                                decoding escapes twice, because a colour can be
//                                                spelled four ways in any of a dozen properties and
//                                                there is no "value position that must be a token"
//                                                to allow-list against. 🔴 The residual risk is
//                                                real and belongs to #1003, not here: a colour
//                                                syntax CSS adds later (`color(display-p3 …)`)
//                                                would pass. Named here rather than fixed, because
//                                                changing #1003's rule is outside this ticket
//   `!important`                  one token      it is not a spelling: postcss parses it into
//                                                `decl.important`, so this reads the parse tree,
//                                                and CSS has exactly one form of it
//   ─────────────────────────────────────────────────────────────────────────────────────────────
//   📌 A second table, above `checkDecl`, answers the other half of the same question (#1011 r12):
//   not "what shape is this rule" but "what does the pipeline already hand every rule, and did the
//   three new ones pick it up". Reading each value twice — as written and with escapes decoded — is
//   on it, because r11 shipped without it and `-1000\70x` walked past a rule Chris himself set.
//   ─────────────────────────────────────────────────────────────────────────────────────────────
//   §4's own checks (the runtime half, scripts/theme-css-invariants.mjs) are measurements rather
//   than classifications: the paint-order one compares geometry against the DOM at a list of widths
//   it prints, and it names every element it could not compare. What makes that sampling sound is
//   the length rules above, not a list of properties.
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
  // #1018 — cta-banner, phase 2's first paid-in-full move. One class per part, no part for the
  // button itself: the box around it is a theme's business, the button's own look is the brand's.
  '.cta-banner', '.cta-banner__headline', '.cta-banner__desc', '.cta-banner__action',
  '[data-block="cta-banner"]',
  // #1019 — page-header, phase 2's third block and the widest one on a site (7 instances per site,
  // #1007). Three parts: the crumb trail, the heading, the subtitle. The hook is on the <nav>
  // rather than the <ol> inside it, because only a direct child of the block can be given `order`.
  '.page-header', '.page-header__crumbs', '.page-header__title', '.page-header__sub',
  '[data-block="page-header"]',
  // #1027 — batch B, six blocks at once, four of them `essential`. None of them had a `variant`
  // branch to delete (values-grid's five looks were keyed off `data.style`, which its manifest
  // declares as `kind: "variant"`), so this batch is the other half of a migration: the Tailwind
  // classes that decided a look left the markup and these hooks arrived in its place.
  '.contact-form', '.contact-form__heading', '.contact-form__intro', '.contact-form__form',
  '.contact-form__error', '.contact-form__note', '.contact-form__success',
  '[data-block="contact-form"]',
  '.quote-form', '.quote-form__form', '.quote-form__intro', '.quote-form__main',
  '.quote-form__aside', '.quote-form__step', '.quote-form__error', '.quote-form__action',
  '.quote-form__success',
  '[data-block="quote-form"]',
  '.services-list', '.services-list__item', '.services-list__icon', '.services-list__title',
  '.services-list__desc', '.services-list__actions', '.services-list__features',
  '.services-list__products',
  '[data-block="services-list"]',
  '.values-grid', '.values-grid__headline', '.values-grid__item', '.values-grid__title',
  '.values-grid__desc',
  '[data-block="values-grid"]',
  '.services-nav', '.services-nav__link',
  '[data-block="services-nav"]',
  '.service-related-pages', '.service-related-pages__headline', '.service-related-pages__sub',
  '.service-related-pages__card',
  '[data-block="service-related-pages"]',
  // #1028 — batch C, four blocks whose old branches were pure appearance. One of them
  // (`contact-info`) is `essential`, and its hooks are the ones a sheet needs to lay out a phone
  // number and an address without the markup deciding: `__location` is the child grid/flex places,
  // `__phone` and `__email` are the two links a customer actually uses.
  '.contact-info', '.contact-info__headline', '.contact-info__location', '.contact-info__label',
  '.contact-info__address', '.contact-info__phone', '.contact-info__email',
  '[data-block="contact-info"]',
  '.stats-counter', '.stats-counter__headline', '.stats-counter__stat', '.stats-counter__value',
  '.stats-counter__label',
  '[data-block="stats-counter"]',
  '.process-steps', '.process-steps__headline', '.process-steps__sub', '.process-steps__step',
  '.process-steps__num', '.process-steps__title', '.process-steps__desc',
  '[data-block="process-steps"]',
  '.timeline', '.timeline__headline', '.timeline__sub', '.timeline__event', '.timeline__year',
  '.timeline__title', '.timeline__desc',
  '[data-block="timeline"]',
  // #1029 — batch D, four more blocks whose old branches were pure appearance. Nothing new about the
  // shape of this list; the one thing worth writing down is what is NOT here:
  //   · no hook for the check mark, the sparkle, the two-digit number, the avatar's initial or the
  //     card's gradient strip. Every one of those was decoration or arithmetic living in the markup,
  //     and the contract admits only `content: ""` — so a sheet can put a shape back in those places
  //     (`::before` on the part below) but not that glyph, and not this person's initial.
  //   · no per-post colour on `.blog-preview__post`. The old cards rotated four gradients by index;
  //     `::before` cannot select "the third one" (§1 refuses `nth-child`), so the rotation is gone
  //     and one colour for all of them is what a sheet can say.
  '.benefits-list', '.benefits-list__headline', '.benefits-list__sub', '.benefits-list__item',
  '.benefits-list__title', '.benefits-list__desc',
  '[data-block="benefits-list"]',
  '.team-grid', '.team-grid__headline', '.team-grid__sub', '.team-grid__member', '.team-grid__name',
  '.team-grid__role', '.team-grid__bio',
  '[data-block="team-grid"]',
  '.checklist', '.checklist__headline', '.checklist__sub', '.checklist__item',
  '[data-block="checklist"]',
  '.blog-preview', '.blog-preview__headline', '.blog-preview__sub', '.blog-preview__post',
  '.blog-preview__category', '.blog-preview__date', '.blog-preview__title', '.blog-preview__excerpt',
  '[data-block="blog-preview"]',
  // #1031 — batch F, seven blocks whose branches were only ever a look or a content shape (no
  // interaction: not one of them is a `'use client'` component). Three of them grew their
  // `block_layout` list at the same time, because their branches really did carry different
  // content: text-block (default / quote / with-list), content-split (with-media / text-only /
  // with-stats / with-bullets) and social-proof (default / with-platforms / with-badges /
  // with-quote). The other four keep one value.
  '.content-split', '.content-split__media', '.content-split__headline', '.content-split__body',
  '.content-split__bullets', '.content-split__stats', '.content-split__stat',
  '.content-split__stat-value', '.content-split__stat-label',
  '[data-block="content-split"]',
  '.text-block', '.text-block__headline', '.text-block__body', '.text-block__attribution',
  '.text-block__list',
  '[data-block="text-block"]',
  '.divider', '.divider__rule', '.divider__label',
  '[data-block="divider"]',
  '.social-proof', '.social-proof__headline', '.social-proof__rating', '.social-proof__reviews',
  '.social-proof__platform', '.social-proof__badge', '.social-proof__quote',
  '.social-proof__quote-author',
  '[data-block="social-proof"]',
  '.features-grid', '.features-grid__headline', '.features-grid__sub', '.features-grid__item',
  '.features-grid__icon', '.features-grid__title', '.features-grid__desc',
  '[data-block="features-grid"]',
  '.awards-certifications', '.awards-certifications__headline', '.awards-certifications__sub',
  '.awards-certifications__item', '.awards-certifications__title',
  '.awards-certifications__year', '.awards-certifications__desc',
  '[data-block="awards-certifications"]',
  '.newsletter-signup', '.newsletter-signup__headline', '.newsletter-signup__desc',
  '.newsletter-signup__form',
  '[data-block="newsletter-signup"]',
  // #1036 — batch G, the six blocks that had BEHAVIOUR in at least one variant. Five of those
  // behaviours went away for want of a live user (measured on all six production sites: `carousel`,
  // `toggle` and `dismissible` have zero instances between them); the one that stayed —
  // faq-accordion's open/close — is native `<details>/<summary>` now, so no hook of its own is
  // needed for it and no sheet can reach `[open]` (contract §1 refuses attribute selectors, which
  // is written down in the component). What a sheet CAN reach is every part below.
  //
  // 🔴 Two of these names are not "a part of the markup" but a piece of DATA the markup had no other
  // way to expose, and they are the reason this batch is not purely subtractive:
  //   · `.pricing-table__item--featured` — the tier's own `highlighted` boolean. All four old
  //     variants expressed it with Tailwind classes; a sheet cannot select "the third card", it can
  //     only select a class, so the boolean has to arrive as one.
  //   · `.testimonials__star` — the rating is N stars, and N comes from the data. A sheet decides
  //     how big and what colour a star is; it cannot decide how many there are.
  '.faq-accordion', '.faq-accordion__headline', '.faq-accordion__sub', '.faq-accordion__item',
  '.faq-accordion__question', '.faq-accordion__answer',
  '[data-block="faq-accordion"]',
  '.testimonials', '.testimonials__headline', '.testimonials__sub', '.testimonials__item',
  '.testimonials__rating', '.testimonials__star', '.testimonials__quote', '.testimonials__name',
  '.testimonials__meta', '.testimonials__service',
  '[data-block="testimonials"]',
  '.announcement-bar', '.announcement-bar__message', '.announcement-bar__link',
  '[data-block="announcement-bar"]',
  '.service-highlights', '.service-highlights__headline', '.service-highlights__sub',
  '.service-highlights__item', '.service-highlights__title', '.service-highlights__desc',
  '.service-highlights__features',
  '[data-block="service-highlights"]',
  '.pricing-table', '.pricing-table__headline', '.pricing-table__sub', '.pricing-table__item',
  '.pricing-table__item--featured', '.pricing-table__badge', '.pricing-table__name',
  '.pricing-table__price', '.pricing-table__desc', '.pricing-table__features',
  '.pricing-table__action',
  '[data-block="pricing-table"]',
  '.gallery', '.gallery__headline', '.gallery__sub', '.gallery__item', '.gallery__image',
  '.gallery__placeholder', '.gallery__caption', '.gallery__category', '.gallery__title',
  '.gallery__desc',
  '[data-block="gallery"]',
  '[data-role="essential"]', '[data-role="lead"]', '[data-role="optional"]',
  'body', '[data-region-layout]',
]);

// 🔴 WHICH TICKET ADDED WHICH HOOKS — and why this list is here rather than in the version number.
// #1018 decided that a migration which only ADDS hooks does not bump CONTRACT_VERSION (the reasoning
// and the reading behind it are in that ticket): `HOOKS` is a whitelist, so a longer list can only
// make an older sheet MORE legal, and the three phase-1 sheets stay green against it — measured, not
// assumed. What a bump costs instead is one edit to the header of every sheet that exists at that
// moment: 3 today, 60-80 after phase 3, times the 31 blocks still to move. So the thing a bump would
// have told you — when did the markup grow — is written down here, where it costs nothing:
//
//   #991  hero parts, block/role/page hooks           (phase 1)
//   #998  [data-block-layout="…"]                     (the third hook)
//   #1018 cta-banner parts + [data-block="cta-banner"]
//   #1019 page-header parts + [data-block="page-header"]
//   #1027 contact-form / quote-form / services-list / values-grid / services-nav /
//         service-related-pages parts + their six [data-block="…"]
//   #1028 contact-info / stats-counter / process-steps / timeline parts + their four
//         [data-block="…"]  (batch C)
//   #1031 content-split / text-block / divider / social-proof / features-grid /
//         awards-certifications / newsletter-signup parts + their seven [data-block="…"]
//         (batch F, seven blocks at once)
//
// A BREAKING change (renaming a hook, removing one, changing what one means) still MUST bump: that
// is the case where an old sheet keeps loading and quietly points at nothing, which is the reason
// the version line exists at all.
// `[data-region-layout="pill-floating"]` and friends: the attribute is on the list, its values are
// the region names #960 already ships, so a value-qualified form is legal.
//
// #998 adds `[data-block-layout="…"]` on the same footing — the third hook (spec §5.2). Its values are
// each block's own content-structure list, which lives in that block's manifest (#999), so this file
// checks the SHAPE of the value and the build checks that the site only ever writes a value the
// manifest declares. Two checkers, two different questions: "is this a legal selector" is not "does
// this site use that layout".
const HOOK_PATTERNS = [
  /^\[data-region-layout="[a-z-]+"\]$/,
  /^\[data-block-layout="[a-z0-9-]+"\]$/,
];

// 🔴 THE CLASS HOOKS ALONE, WITHOUT THE LEADING DOT — derived here so nobody keeps a second copy.
// The two RUNTIME checks (`theme-css-invariants.mjs`, `theme-pipeline/gates.js`) ask a different
// question from the linter above: not "is this selector legal" but "this class is on the page — did
// the theme write a rule for it?". They match against class NAMES, so they need this shape.
//
// Why derived and not hand-written (#1018 QA2 caught it): both of them used to carry their own
// literal list, and both were still holding phase 1's seven hero names after cta-banner moved. The
// failure is silent in the worst possible direction — delete every cta-banner rule from a theme
// sheet and the check still reports `hooks in the markup: 7 · not dressed by the theme: 0` and exits
// 0. spec §8 names that exact scenario as the thing this check exists to stop, and 31 more blocks
// are going to lean on it.
//
// Only class hooks: `body`, `[data-block]`, `[data-role]`, `[data-region-layout]` are contract hooks
// too, but no theme selects them today, so requiring a rule for them would invent a rule nobody
// agreed to (the reasoning is written out at the invariants call site).
const HOOK_CLASSES = [...HOOKS].filter((h) => /^\.[\w-]+$/.test(h)).map((h) => h.slice(1));

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
// pseudo-elements off each compound. Every simple selector inside what is left has to be a hook.
function compoundsOf(selector) {
  return selector
    .split(/\s*[\s>+~]\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// #998 — A COMPOUND MAY BE SEVERAL HOOKS ON ONE ELEMENT, AND THE THIRD HOOK IS WHY.
//
// Until now a compound had to be exactly one hook, so `[data-block="hero"][data-block-layout="with-media"]`
// was refused. That form is the entire point of `data-block-layout`: the layout values are each block's own
// list, and different blocks reuse the same word — `with-media` on hero and on features-grid mean different
// pictures in different places. Without the qualifier a sheet could only write the value alone, which would
// style every block that happens to share the word. So the rule becomes: split the compound into its simple
// selectors and require EVERY one of them to be on the list.
//
// 🔴 This does not widen what a sheet can reach. `div[data-block="hero"]` still fails (a tag selector is not
// a hook), `.md\:flex[data-role="lead"]` still fails, `#id[data-block="hero"]` still fails — one non-hook part
// refuses the whole compound, exactly as before. What changed is only that a compound made ENTIRELY of hooks
// is now legal, which is the same rule the descendant form has always had (`.hero .hero__title`).
function simpleSelectorsOf(compound) {
  // attribute · class (with CSS escapes) · id · everything else (tag / `*` / leftovers)
  const parts = compound.match(/\[[^\]]*\]|\.(?:\\.|[\w-])+|#[\w-]+|[^.#[]+/g);
  return parts ? parts.map((s) => s.trim()).filter(Boolean) : [compound];
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
      for (const simple of simpleSelectorsOf(base)) {
        if (!isHook(simple)) {
          report(`selector "${complex}" reaches for "${simple}", which is not a contract hook`);
        }
      }
    }
  }
}

// ── §4 #1003 —— 受限 CSS 里不许出现字面色值和字面字体名 ─────────────────────────────────────────
//
// 🔴 没有这一条，D9（「能声明的就别让 AI 自由写」）不成立：属性白名单里有 `color` / `background*` /
// `font-*`，所以一份完全合法的表可以写 `color: #ff0000` 直接绕开 tokens 那份 schema。本票落地前实测：
// 三份已上线的表里有 9 处字面色值，这个检查器对它们**全绿、退出码 0**。
//
// 🔴 只盯 `color:` 和 `font-family:` 两个属性的实现会放行真问题：颜色能从 `background` / `border` /
// `box-shadow` 里以四种语法进来（#rrggbb · 颜色名 · rgb() · hsl()），所以这里查的是**每一条声明的值**。
//
// 🔴 一个例外，写进契约 §3：`box-shadow` 里的**纯黑 / 纯白 + alpha**。理由是阴影本来就是中性色，
// 而它的强度在 tokens 里有自己的字段（`shadowStrength`）；把 `rgb(0 0 0 / .55)` 也禁掉，等于逼每份表
// 用 `var(--shadow-*)` 那四档现成阴影，而那四档是给卡片用的、不是给一张 60px 模糊的大投影用的。
// 例外**只认这两个颜色**：任何带色相的阴影仍然被拦。
const CSS_NAMED_COLOURS = new Set(['aliceblue', 'antiquewhite', 'aqua', 'aquamarine', 'azure', 'beige',
  'bisque', 'black', 'blanchedalmond', 'blue', 'blueviolet', 'brown', 'burlywood', 'cadetblue',
  'chartreuse', 'chocolate', 'coral', 'cornflowerblue', 'cornsilk', 'crimson', 'cyan', 'darkblue',
  'darkcyan', 'darkgoldenrod', 'darkgray', 'darkgreen', 'darkgrey', 'darkkhaki', 'darkmagenta',
  'darkolivegreen', 'darkorange', 'darkorchid', 'darkred', 'darksalmon', 'darkseagreen',
  'darkslateblue', 'darkslategray', 'darkslategrey', 'darkturquoise', 'darkviolet', 'deeppink',
  'deepskyblue', 'dimgray', 'dimgrey', 'dodgerblue', 'firebrick', 'floralwhite', 'forestgreen',
  'fuchsia', 'gainsboro', 'ghostwhite', 'gold', 'goldenrod', 'gray', 'green', 'greenyellow', 'grey',
  'honeydew', 'hotpink', 'indianred', 'indigo', 'ivory', 'khaki', 'lavender', 'lavenderblush',
  'lawngreen', 'lemonchiffon', 'lightblue', 'lightcoral', 'lightcyan', 'lightgoldenrodyellow',
  'lightgray', 'lightgreen', 'lightgrey', 'lightpink', 'lightsalmon', 'lightseagreen', 'lightskyblue',
  'lightslategray', 'lightslategrey', 'lightsteelblue', 'lightyellow', 'lime', 'limegreen', 'linen',
  'magenta', 'maroon', 'mediumaquamarine', 'mediumblue', 'mediumorchid', 'mediumpurple',
  'mediumseagreen', 'mediumslateblue', 'mediumspringgreen', 'mediumturquoise', 'mediumvioletred',
  'midnightblue', 'mintcream', 'mistyrose', 'moccasin', 'navajowhite', 'navy', 'oldlace', 'olive',
  'olivedrab', 'orange', 'orangered', 'orchid', 'palegoldenrod', 'palegreen', 'paleturquoise',
  'palevioletred', 'papayawhip', 'peachpuff', 'peru', 'pink', 'plum', 'powderblue', 'purple',
  'rebeccapurple', 'red', 'rosybrown', 'royalblue', 'saddlebrown', 'salmon', 'sandybrown', 'seagreen',
  'seashell', 'sienna', 'silver', 'skyblue', 'slateblue', 'slategray', 'slategrey', 'snow',
  'springgreen', 'steelblue', 'tan', 'teal', 'thistle', 'tomato', 'turquoise', 'violet', 'wheat',
  'white', 'whitesmoke', 'yellow', 'yellowgreen']);
const COLOUR_FUNCTIONS = new Set(['rgb', 'rgba', 'hsl', 'hsla', 'hwb', 'lab', 'lch', 'oklab', 'oklch',
  'color', 'color-mix']);
const GENERIC_FAMILIES = new Set(['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy',
  'system-ui', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded', 'math', 'emoji', 'fangsong',
  'inherit', 'initial', 'unset', 'revert']);

/** `box-shadow` 里那一格例外：纯黑或纯白（可带 alpha），别的一律不算。 */
function isNeutralShadowColour(node) {
  const nums = (node.nodes || []).filter((n) => n.type === 'word').map((n) => n.value);
  const rgb = nums.slice(0, 3).map(Number);
  if (rgb.length < 3 || rgb.some((n) => Number.isNaN(n))) return false;
  return rgb.every((n) => n === 0) || rgb.every((n) => n === 255);
}

function collectLiteralColours(prop, value, found) {
  const inShadow = prop === 'box-shadow' || prop === 'text-shadow';
  const parsed = valueParser(value);
  parsed.walk((node) => {
    if (node.type === 'function') {
      const fn = node.value.toLowerCase();
      if (!COLOUR_FUNCTIONS.has(fn)) return undefined;
      if (inShadow && (fn === 'rgb' || fn === 'rgba') && isNeutralShadowColour(node)) return false;
      found.push(`${fn}(…)`);
      return false;  // 里面的东西已经由这一条代表了
    }
    if (node.type === 'word') {
      const w = node.value;
      if (/^#[0-9a-fA-F]{3,8}$/.test(w)) { found.push(w); return undefined; }
      // 颜色名只在【不是字体】的地方查:字体那半由下面 literalFontsIn 管,不然 "Red Hat Display" 会被
      // 当成颜色报一遍,同一处报两个理由。
      if (prop !== 'font-family' && prop !== 'font' && CSS_NAMED_COLOURS.has(w.toLowerCase())) {
        found.push(w);
      }
    }
    return undefined;
  });
}

/**
 * 一条声明里有没有字面色值 → string[]（每条是给人看的理由）。
 *
 * 🔴 要读两遍：原文一遍，解转义之后再一遍，取并集 —— 跟 `urlsIn()` 同一个理由，也是同一个坑
 * （#992 为 URL 写的 `decodeEscapes()` 就在上面，契约 §3 也已经写着 `URL(…)` 和 `\75 rl(…)` 是同一个请求）。
 * 颜色这半是**黑名单**（颜色名集合 + `#` 正则 + 函数名集合），而 CSS 允许把标识符里的任何字符写成
 * 转义，所以黑名单的每一项都有另一种拼法。真浏览器实测（#1003 r2，`getComputedStyle` + 读 `cssRules`）：
 *
 *     color: r\65 d              → 保留成 `red`             黑名单漏了（颜色名）
 *     background-color: \72 gb(0 128 0) → 保留成 `rgb(0,128,0)`  黑名单漏了（函数名）
 *     color: \23 ff0000          → 整条被浏览器丢掉          不是漏，`#` 起的是 hash token，转义拼不出来
 *
 * 字体那半不需要这一遍：它是**白名单**（不是 `var()`、不是通用字体族就报），转义只会让一个值更不像
 * 白名单里的东西 ⟹ 方向是更严，不是绕过。
 *
 * 并集而不是"只读解码后那一份"：那样等于信任解码器没毁掉别的东西，而并集无论解码器做了什么都不会丢。
 */
function literalColoursIn(prop, value) {
  const found = [];
  collectLiteralColours(prop, value, found);
  const decoded = decodeEscapes(value);
  if (decoded !== value) collectLiteralColours(prop, decoded, found);
  return [...new Set(found)];
}

/**
 * `font-family` / `font` 里有没有字面字体名 → string[]。
 *
 * 🔴 `var()` 的**兜底值**要按同一把标准再查一遍（QA3 在 #1003 终审量出来的）。第一版的规则是
 * 「这一格以 `var(` 开头就放行」，于是这条通过了、退出码 0：
 *
 *     font-family: var(--font-nope, "Inter"), sans-serif
 *
 * 而真浏览器里 `--font-nope` 不存在时，计算值就是 `Inter, sans-serif` —— 字面字体真的上屏了
 * （QA3 用 `getComputedStyle` 量的，`var(--font-nope, Georgia), serif` 算出来是 `Georgia, serif`）。
 * **白名单要安全，它的原子必须是「浏览器不再往下解析的终端」**，而 `var()` 是带参数的包装，
 * 浏览器还会往兜底参数里再解析一层。颜色那半早就在查函数参数了（`color: var(--x, #ff0000)` 一直报），
 * 所以这不是苛求，是两半口径没对齐。
 *
 * 兜底里的通用字体族（`var(--x, sans-serif)`）照常放行，跟顶层同一条规则；嵌套的
 * `var(--a, var(--b, "Inter"))` 靠递归走到底。
 */
function literalFontsIn(prop, value) {
  if (prop !== 'font-family' && prop !== 'font') return [];
  const found = [];
  collectLiteralFonts(splitByComma(valueParser(value).nodes), found);
  return [...new Set(found)];
}

function collectLiteralFonts(groups, found) {
  for (const group of groups) {
    const text = valueParser.stringify(group).trim();
    if (!text) continue;
    const meaningful = group.filter((n) => n.type !== 'space');
    if (meaningful.length === 1 && meaningful[0].type === 'function'
      && meaningful[0].value.toLowerCase() === 'var') {
      // splitByComma 的第一格是自定义属性名（`--font-nope`），它不是字体名；其余每一格都是兜底值，
      // 按顶层同一条规则再判一次。
      collectLiteralFonts(splitByComma(meaningful[0].nodes).slice(1), found);
      continue;
    }
    const bare = text.replace(/^["']|["']$/g, '').toLowerCase();
    if (GENERIC_FAMILIES.has(bare)) continue;                 // sans-serif / system-ui …
    // 🔴 这里曾经还有一行跳过（QA3 在 #1003 r3 终审量出来的）：
    //
    //     if (/^[0-9.]|^(bold|normal|italic|oblique|small-caps|lighter|bolder)$/i.test(bare)) continue;
    //
    // 它想跳过的是 `font:` 简写里字体名前面那些不是字体名的词（`bold 14px/1.4`），但它判的是
    // **整个逗号分组的文本**，不是分组里的单个词 —— 于是它在两个方向上都是坏的：
    //
    //   · `font-family: "8514oem", sans-serif`  剥掉引号后以数字开头 ⟹ 整组被跳过，退出码 0。
    //     而真浏览器把这条原样收下，计算值就是 `"8514oem", sans-serif` —— 装了这个字体的访客
    //     屏上就是它。以数字开头的字体真实存在（Windows 的 8514oem、SAP 的 72、29LT Bukra）。
    //     `font-family` 里根本不存在「字号前缀」这回事，这个跳过从一开始就不该走到这个属性。
    //   · `font: 14px "Inter", sans-serif`      同一行代码把**字体名连同字号一起**跳掉了，
    //     所以它连自己那扇门也没守住（QA1 在 r3 量的）。
    //
    // 删掉它，两个方向一起关。它唯一想服务的 `font:` 简写本来就不在属性白名单上
    // （`PROP_EXACT` 没有 `font`，`'font'.startsWith('font-')` 为假），写它的表照样被拒——
    // 只是现在那条表会连字体名一起被点名，而不是被这行跳过悄悄放行。
    found.push(text);
  }
}

function splitByComma(nodes) {
  const out = [[]];
  for (const n of nodes) {
    if (n.type === 'div' && n.value === ',') { out.push([]); continue; }
    out[out.length - 1].push(n);
  }
  return out;
}

// ── §2 #1011 — on a block or a region, a length may only move ONE WAY as the window grows ────────
//
// 🔴 WHY THIS IS A SYNTAX RULE AND NOT ONE MORE MEASUREMENT. That the page is PAINTED in the order
// the DOM has it is measured on the real page (`scripts/theme-css-invariants.mjs`, contract §4), and
// any such reading is taken at a finite set of window sizes. #1011 tried three ways of choosing them
// — a fixed list, then the thresholds the page itself declares, then doubling the window while the
// distances between neighbours keep closing — and each time a legal declaration was found that swaps
// two blocks inside a narrow band of widths and is back in order on both sides of it. All three were
// measured on a real build, all three passed this checker and that one:
//
//	.hero { margin-bottom: calc(-1200px + 8 * abs(100vw - 1900px)) }        swapped at 1900 and 1901
//	.hero { margin-bottom: calc(-1 * mod(100vw, 1200px)) }                  swapped from 2300 to 2399
//	.hero { margin-bottom: calc(-1px * ((100vw / 1px) - 1800)
//	                            * (2000 - (100vw / 1px)) / 10) }            swapped at 1900
//
// A peak cannot be sampled away: wherever a check puts its widths, a sheet can put the peak between
// two of them. So the peaks are taken out of the language instead, and the measuring check stops
// needing luck — past every threshold a page declares, a distance that has started closing goes on
// closing, so widening the window has to run into it.
//
// 🔴 THE PROOF THIS RULE OWES, because the other check's argument stands on it. Inside one length:
// at most one window-relative token · nothing window-relative may be a divisor · the only functions
// are `calc()` and `var()`. `var()` is a constant here, measured both ways: every custom property
// this template defines is a plain `rem`/`px` literal (15 definitions across `src/app/globals.css`
// and `public/base.css`, not one with `calc()` / `min()` / `max()` / `clamp()`), and a theme's own
// tokens cannot be lengths at all (`schemas/theme-tokens.schema.json` — colours are `#rrggbb`,
// fonts are names, settings are enums or bare numbers). So a length here is arithmetic in which
// exactly one leaf, k·w, follows the window; `+` and `-` against constants, `*` by constants and `/`
// by constants all leave it k′·w + c, and a straight line moves one way. That is the whole proof.
// 📌 A percentage resolves against the containing block rather than the window, and that saturates
// (the content column stops growing while the window keeps going). Saturating is still one-way, and
// one-way of one-way is one-way — so `-50%` stays legal here and it is the measuring check, widening
// the window, that catches what it does.
// 🔴 IF EITHER MEASUREMENT ABOVE EVER CHANGES, THIS RULE HAS TO CHANGE WITH IT: an app-side token
// defined as `clamp(…)` would be a peak arriving through `var()`, and this file would not see it.

// Units that do not move when the window does. Everything NOT on this list counts as window-relative,
// which is the safe direction to be wrong in: a unit nobody here has heard of (`cqw`, `dvh`, whatever
// comes after them) is treated as following the window, so it can only make this rule stricter — never
// open a hole.
//
// 🔴 `fr` IS ON IT BECAUSE IT IS NOT A LENGTH. It is a share of what is left over after every real
// length in the same track list has been taken out, it can be written nowhere but a grid track list
// (`calc()` will not take it), and a track sized in `fr` cannot come out bigger than the box it is
// dividing. So it can neither be the straight line this rule is about nor bend one. It has to be here
// rather than counted as window-relative, because `grid-template-columns: 5fr 6fr` is what two of the
// three shipped sheets write and the rule below refuses a window-relative length in a track size.
//
// 🔴 `em` AND ITS FAMILY ARE NOT ON THIS LIST, AND I FOUND THAT OUT BY MEASURING IT. They resolve
// against the ELEMENT'S OWN font — and `font-*` and `line-height` are on the property whitelist, so a
// sheet may write `font-size: 5vw` on the very hook it then measures in `em`. That gives it a second
// quantity that follows the window without a second `vw` token, and two of those multiply. Measured on
// this build, legal against the first version of this rule, both checkers green:
//
//	.hero { font-size: 5vw;
//	        margin-bottom: calc(-1200px + (1em - 95px) * ((100vw / 1px) - 1900)) }
//
// `1em - 95px` is 0.05·(w − 1900)px, times `(w − 1900)` it is a parabola: the blocks swap from about
// 1837 to 1963 and are in order at 1440 and at 2100 (probe: −1075px at 1850, −1200px at 1900, +9380px
// at 1440, +800px at 2100). Counting `em` as window-relative makes it two tokens in one length, refused.
// 🔴 The `r*` twins stay: they resolve against the ROOT element, and `:root` / `html` is not a hook, so
// no sheet can move them. Measured, not assumed — the same fixture with `1rem` in place of `1em` and
// `body { font-size: 5vw }` added does not move a single block (`rem` never follows `body`).
const CONSTANT_UNITS = new Set([
  'px', 'cm', 'mm', 'q', 'in', 'pt', 'pc',
  'rem', 'rex', 'rch', 'ric', 'rcap', 'rlh', 'fr',
  'deg', 'grad', 'rad', 'turn', 's', 'ms', 'hz', 'khz', 'dpi', 'dpcm', 'dppx', 'x',
]);

// Functions whose arguments are separate values rather than one number: colours, gradients, filters,
// images, grid track sizes. A length inside one of those is judged on its own — a gradient's
// `var(--a) 50%` stop is a length like any other — which is not the same as the function being allowed
// to build a length.
//
// 🔴 REFUSAL IS THE DEFAULT, AND THAT IS THE ONLY REASON THIS LIST IS SAFE TO KEEP. `min()` / `max()` /
// `clamp()` / `abs()` / `mod()` / `round()` / `sign()` are not on it, and neither is next year's math
// function, so every one of them is refused WITHOUT BEING NAMED. Naming them would be the blacklist
// this rule exists to replace: the first draft of #1011 named three of them and `abs()` walked past it
// the same afternoon. Forgetting a colour or filter function here makes this checker stricter, never
// blinder — which is the direction a list is allowed to be wrong in.
//
// 🔴 `minmax()` AND `fit-content()` CAME OFF THIS LIST (#1011 r6, QA1). Their arguments look separate
// and are not: `minmax(a, b)` is the browser taking a min and a max between them and the content, which
// is `clamp()` spelled as a track size — QA1 measured `grid-template-rows: minmax(calc(100vw - 1800px),
// calc(2200px - 100vw))` swapping two blocks from 1950 to 2050 with both checkers green. Being on this
// list meant each argument was judged alone and neither was a peak. `repeat()` stays: its arguments
// really are separate (a count, then a track list), and each track inside it is judged on its own.
const SEPARATE_ARG_FUNCTIONS = new Set([...COLOUR_FUNCTIONS,
  'linear-gradient', 'radial-gradient', 'conic-gradient', 'repeating-linear-gradient',
  'repeating-radial-gradient', 'repeating-conic-gradient', 'image-set', '-webkit-image-set',
  'cross-fade', 'url', 'blur', 'brightness', 'contrast', 'drop-shadow', 'grayscale', 'hue-rotate',
  'invert', 'opacity', 'saturate', 'sepia', 'repeat',
]);

// ── §2 #1011 — and a length that follows the window may only ADD to the page, never SIZE a box ────
//
// 🔴 BEING A STRAIGHT LINE IS NOT ENOUGH ON ITS OWN, AND QA1 MEASURED WHY. The browser takes a min and
// a max of its own accord wherever a length SIZES a box: the height a box comes out at is
// `max(min-height, min(max-height, what the content needs))`. Two straight lines written into two of
// those slots come out of it as a V, and a V is the peak this whole section exists to remove. Both of
// these are legal against everything above, and both were measured on the real build with the static
// checker at rc=0 and the paint-order check printing `✅ every invariant holds`:
//
//	.hero { min-height: calc(100vw - 1800px); max-height: calc(2200px - 100vw);
//	        margin-bottom: -500px }
//	     — the second block is painted above the page header from 1800px to 2200px of window, and in
//	       order at 1440, 1700, 2400 and 3072 (QA1's, reproduced here)
//	.hero { min-height: calc(100vw - 1800px); margin-bottom: calc(350px - 50vw) }
//	     — swapped at 2704 and 2800, in order at 1440, 1536, 2400, 3072 and 6144. ONE bound is enough,
//	       because the browser's other operand is the content: `max(904px, w − 1800px)` has a corner in
//	       it, and a straight line added to a corner is a V.
//
// So the question this asks is not "is the value a straight line" — that is the rule above — but "does
// this property let the browser bend it". The list below is where a window-relative length is allowed
// at all: places where the value is ADDED to what is already there (a margin, a padding, a gap, a
// border) or does not take part in layout at all (a shadow, a radius, a background, a filter).
// Everything else refuses one, INCLUDING EVERY PROPERTY §2 MAY GAIN LATER — a size, a track, a flex
// basis, and whatever tomorrow's §2 adds all default to refusal, which is the direction a list is
// allowed to be wrong in. What it costs today, measured: `.hero { width: 100% }` and
// `.hero { grid-template-columns: repeat(2, minmax(20%, 1fr)) }` were legal before this line and are
// refused by it. Neither is in the pool — all three shipped sheets size in `rem` and `fr`, and their
// only `width: 100%` is on a part — and a sheet that wants either writes a constant.
//
// 🔴 WHY NOT COUNT WINDOW-RELATIVE LENGTHS PER ELEMENT INSTEAD, which would also refuse both fixtures
// above: because that count is only accidentally enough. The corner is in the hero's own height, while
// the straight line that turns it into a V may sit on the NEXT block — one window-relative length on
// each of two elements. `.hero { min-height: calc(100vw - 1800px) }` with
// `[data-role="optional"] { margin-top: calc(350px - 50vw) }` reorders this build from 2400px up
// (measured). That the reorder is wide rather than narrow here is a fact about THIS page's hooks —
// `[data-role="optional"]` is the only way to reach that neighbour and it reaches three other blocks
// with it — not a fact about the rule. A per-element count would be a rule whose proof depends on how
// coarse the hooks happen to be this quarter.
const ADDS_ONLY_PROPS = new Set([
  'gap', 'row-gap', 'column-gap', 'line-height', 'letter-spacing', 'box-shadow', 'filter',
  'object-position',
]);
const ADDS_ONLY_PREFIXES = ['margin', 'padding', 'border', 'background', 'font-'];
const onlyAddsToLayout = (prop) => ADDS_ONLY_PROPS.has(prop)
  || ADDS_ONLY_PREFIXES.some((pre) => prop.startsWith(pre));

// The parts INSIDE a block are outside this rule: which part comes first is the theme's business, and
// all three phase-1 sheets reorder them with `order`. Everything else on the hook list — the page, a
// region, a block, a role — is the order the page is READ in, which is the site's.
//
// 🔴 `.hero` IS NOT A PART, however §1's hook table groups it. That table lists it on the "Hero parts"
// row next to `.hero__media` (contract §1), and an implementation that classified by that row would
// exempt the one selector all three narrow-peak attacks above used. `.hero` is a class on the block
// element itself. The same goes for `.cta-banner`.
//
// 🔴 DERIVED FROM `HOOKS`, NOT WRITTEN OUT BY HAND — #1031 changed this, and the reason is that the
// old note (still quoted in the table at the top of this file) turned out to be wrong about which
// direction the failure runs in. It said leaving a part off is SAFE because "nothing goes red when a
// ticket forgets, and the cost lands on the theme instead". Measured on this batch: things DO go red,
// and they go red in the theme sheet, one ticket away from the list that caused it —
// `.content-split__media { width: 100% }` was refused with the §2 block-sizing message, five times
// across two sheets, because the part was not on this list and was therefore judged as a block. That
// is a message about a rule the author never broke. `CLAUDE.md`'s standing line covers the shape:
// two copies of one judgement necessarily drift, and this pair had already drifted four times in
// four tickets (#1018 paid it first, then #1019, #1027 and this one).
//
// The predicate is exactly what every ticket was applying by hand: a CLASS hook whose name has a
// `__` in it is a part; everything else on the hook list — the block classes, `[data-block=…]`,
// `[data-role=…]`, `body`, the region attribute — is not. Proven equal before the switch, by
// evaluating BOTH constants out of `origin/main`'s own copy of this file and comparing the sets:
// 41 names each, identical member for member. (Evaluated rather than grepped on purpose — a first
// pass that pulled the names out with a regex read 38 on both sides, because the quoted words inside
// the comments between the entries had eaten three of them. Two wrong numbers that agree still
// agree.)
//
// 🔴 `.hero` IS STILL NOT A PART and neither is any other block class, which is the property the
// hand-written list existed to guarantee and the one this must not lose: `.hero` has no `__`, so the
// predicate refuses it — and exempting a block class is what would hand the three narrow-peak
// attacks above the one selector they all used. #1018's original reading also still holds: with the
// parts recognised, `.cta-banner__headline { margin-top: -8px }` passes exactly as
// `.hero__sub { margin-top: -8px }` does, while the fifteen reverse cells (a block or a region
// carrying the same thing, reached by class, by `[data-block=…]`, through a pseudo-element, from a
// selector list, behind an escape, sizing itself off the window) do not move.
const PART_HOOKS = new Set([...HOOKS].filter((h) => /^\.[\w-]*__[\w-]+$/.test(h)));
// 🔴 #1028 那 22 个名字(批 C 的部件)和 #1029 那 21 个(批 D 的部件)都不在这里手写,它们由上面
//    这一行从 HOOKS 派生出来。每次跟 main 合并都重新求值核一遍,#1031 r5 这次的读数:main 那份
//    手写清单 84 条,拿这个谓词从 main 自己的 HOOKS 派生也是 84 条,逐条相同(手写有而派生没有的
//    0 条,反之也是 0)。上一轮(r4,对手是 #1028)是 63 == 63,两个数不一样是因为中间落了 #1029。
//    🔴 求值不是 grep —— 条目之间注释里带引号的词会被正则当成条目,那样两边都读成 38,
//    而两个错数彼此还一致。

// Does this rule style a block or a region (rather than a part inside one)? The subject of a complex
// selector is its LAST compound — `.hero .hero__title` styles the title — and one selector in the list
// being in scope is enough for the declaration to be judged.
// A pseudo-element on a block (`.hero::before`) counts as in scope: its box is drawn by that block's
// rule, and being stricter there costs nothing (no sheet in the pool has one).
function stylesABlockOrRegion(selector) {
  return selector.split(',').some((raw) => {
    const complex = raw.trim();
    if (!complex) return false;
    const compounds = compoundsOf(complex);
    const subject = compounds[compounds.length - 1] || complex;
    const m = subject.match(/^(.*?)(::(?:before|after))?$/);
    const base = (m && m[1]) || subject;
    return !simpleSelectorsOf(base).some((s) => PART_HOOKS.has(s));
  });
}

// ── §2 #1011 r11 — A BLOCK HAS TO KEEP ITS OWN BOX ───────────────────────────────────────────────
//
// 🔴 THE FIFTH WAY ROUND, AND IT DOES NOT TOUCH `overflow` OR A MARGIN ON A HOOK (QA1 measured it
// while r10 was being written). Two legal declarations:
//
//	[data-block="hero"] { display: contents }
//	.hero__deco { margin-bottom: calc(-1200px + 8 * abs(100vw - 1900px)) }
//
// `display: contents` throws away the BLOCK's box while its parts keep theirs, so the parts become
// siblings of the other blocks inside <main>. The parts are where §2 leaves values free on purpose —
// all three shipped sheets pull `.hero__deco` up with a negative margin — so the peak lives there
// legally, and with the block's own box gone there is nothing between that peak and the neighbouring
// blocks. Reproduced here: swapped at 1900 and 1901, in order at 1440 / 1850 / 1950 / 3072; take out
// only the `display: contents` line and every one of those widths is in the DOM order.
//
// It walks past everything else in §2 because each of those rules is about a different thing: the
// margin is on a PART (allowed), the value is a peak (allowed on a part), `overflow` is not written
// at all, and the §4 runtime check SKIPS the block — correctly, it has no box (AC3b) — while the
// parts it left behind go on pushing the blocks around it.
//
// So: on a BLOCK hook, `display` may only be a value that still generates a box for the block itself.
// Written as an allowed set, like every other rule here (#1011 AC11): `contents` is refused because
// it is not on the list, not because it is named — and so is `inline`, `table`, `list-item`, a
// CSS-wide keyword and the two-value syntax. `none` IS on the list: it takes the parts away with the
// box, so nothing is left to push anything, and hiding an optional block is what themes do today
// (AC3b).
//
// 🔴 REGIONS ARE DELIBERATELY NOT IN THIS RULE'S SCOPE, and AC3b says so in as many words:
// `[data-region-layout] { display: contents }` must keep passing. It is not the same case, and the
// difference is measurable rather than a matter of taste: the attack needs a hook INSIDE the
// box-less element to hang the peak on, and no hook on §1's list reaches inside a header or a
// footer (measured on the real page: every hook selector, run against the region subtrees, matches
// nothing). A region that loses its box takes its whole subtree out of this file's reach with it.
// What that does cost is a blind spot in the §4 check, which is why AC3b makes it print who it
// skipped.
const REGION_HOOKS = new Set(['body']);
const isRegionHook = (s) => REGION_HOOKS.has(s) || s.startsWith('[data-region-layout');
function stylesABlock(selector) {
  return selector.split(',').some((raw) => {
    const complex = raw.trim();
    if (!complex) return false;
    const compounds = compoundsOf(complex);
    const subject = compounds[compounds.length - 1] || complex;
    const m = subject.match(/^(.*?)(::(?:before|after))?$/);
    const base = (m && m[1]) || subject;
    const simples = simpleSelectorsOf(base);
    if (simples.some((s) => PART_HOOKS.has(s))) return false;   // a part
    if (simples.some((s) => isRegionHook(s))) return false;     // a region
    return true;
  });
}

// ── #1043 — which blocks can this selector's subject be, and is any of them `essential`? ─────────
//
// The roles come from the SAME file the app renders `data-role` from
// (`src/lib/sections/block-roles.json`), so this check and the runtime one cannot answer differently
// about the same block. Read once, at load: it is a build-time file and re-reading it per rule would
// only add a way for the two reads to disagree.
//
// 🔴 A MISSING OR UNREADABLE ROLES FILE IS AN ERROR, NOT AN EMPTY SET. An empty set here would make
// this whole pass silently answer "nothing is essential" — the check would print ✅ on every sheet
// forever, which is the exact failure shape #1043 exists to remove. Fail loudly instead.
let BLOCK_ROLES;
try {
  BLOCK_ROLES = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', 'src', 'lib', 'sections', 'block-roles.json'), 'utf-8'));
} catch (e) {
  console.error(`theme-css-lint: cannot read src/lib/sections/block-roles.json (${e.message}) — `
    + 'without it the essential-content check below cannot tell which blocks it protects, and a '
    + 'silent empty answer would make it pass everything. Refusing to run.');
  process.exit(2);
}
const roleOf = (block) => {
  const r = BLOCK_ROLES[block];
  return (r && typeof r === 'object') ? r.role : r;
};
const ESSENTIAL_BLOCKS = new Set(Object.keys(BLOCK_ROLES).filter((b) => roleOf(b) === 'essential'));

// `.contact-info__phone` → `contact-info` · `.contact-info` → `contact-info` ·
// `[data-block="contact-info"]` → `contact-info`. Anything else → null.
function blockNameOf(simple) {
  const cls = simple.match(/^\.((?:\\.|[\w-])+)$/);
  if (cls) {
    const name = cls[1].replace(/\\(.)/g, '$1');
    return name.includes('__') ? name.split('__')[0] : name;
  }
  const attr = simple.match(/^\[data-block=["']?([\w-]+)["']?\]$/);
  return attr ? attr[1] : null;
}

/** The `essential` blocks this selector's subject can be, by ANY spelling. Empty = none of them. */
function essentialTargetsOf(selector) {
  const hits = new Set();
  for (const raw of selector.split(',')) {
    const complex = raw.trim();
    if (!complex) continue;
    // The literal attribute keeps working exactly as before — it says `essential` without naming a
    // block, so it cannot be resolved to one and is reported under its own name.
    if (/\[data-role="essential"\]/.test(complex)) hits.add('[data-role="essential"]');
    const compounds = compoundsOf(complex);
    const subject = compounds[compounds.length - 1] || complex;
    const m = subject.match(/^(.*?)(::(?:before|after))?$/);
    for (const s of simpleSelectorsOf((m && m[1]) || subject)) {
      const block = blockNameOf(s);
      if (block && ESSENTIAL_BLOCKS.has(block)) hits.add(block);
    }
  }
  return [...hits];
}

// Values of `display` a block may take: each of them keeps a box for the element itself (or, for
// `none`, takes the element and everything in it away together).
const BLOCK_DISPLAY = new Set([
  'block', 'flow-root', 'flex', 'inline-flex', 'grid', 'inline-grid', 'inline-block', 'none',
]);
const isBlockDisplay = (value) => {
  const words = valueParser(value).nodes
    .filter((n) => n.type !== 'space' && n.type !== 'div')
    .map((n) => (n.type === 'word' ? n.value.toLowerCase() : `<${n.type}>`));
  return words.length === 1 && BLOCK_DISPLAY.has(words[0]);
};

// `-45vw` → `vw` · `0` and `1.5` → `''` (a bare number) · `auto`, `--gap`, `#ff0000` → null, not a
// number at all. The unit is whatever letters (or `%`) follow the number, lower-cased — this does not
// need to know which units exist, only which ones stand still (above).
const DIMENSION = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?([a-zA-Z%]*)$/;
function unitOf(word) {
  const m = DIMENSION.exec(word);
  return m ? m[1].toLowerCase() : null;
}
const isWindowUnit = (unit) => unit !== '' && !CONSTANT_UNITS.has(unit);

/** Every window-relative token anywhere under this node, as written. */
function windowTokens(node, found) {
  if (node.type === 'word') {
    const unit = unitOf(node.value);
    if (unit !== null && isWindowUnit(unit)) found.push(node.value);
    return found;
  }
  for (const child of node.nodes || []) windowTokens(child, found);
  return found;
}

// At the top level of a value — and inside a function whose arguments are separate values — `,` and `/`
// separate one value from the next (`border-radius: 50% / 20%`, `rgb(0 0 0 / .55)`, `aspect-ratio:
// 4 / 5`), and so does a space (`padding: 3rem 1.5rem` is two lengths). Inside `calc()` a slash is
// division, which is why the arithmetic is walked separately rather than split here.
function splitValues(nodes) {
  const out = [[]];
  for (const n of nodes) {
    if (n.type === 'space' || (n.type === 'div' && (n.value === ',' || n.value === '/'))) {
      out.push([]);
      continue;
    }
    out[out.length - 1].push(n);
  }
  return out.filter((g) => g.length);
}

const MATH_OPERATORS = new Set(['+', '-', '*', '/']);
const isOperator = (n) => (n.type === 'word' || n.type === 'div') && MATH_OPERATORS.has(n.value);
// `calc()` itself, and a bare `( … )` group inside one, which postcss-value-parser hands back as a
// function with an empty name.
const isArithmetic = (n) => n.type === 'function'
  && (n.value === '' || n.value.toLowerCase() === 'calc' || n.value.toLowerCase() === '-webkit-calc');

/** One length. Anything that does not follow the window is left alone — a constant is already one-way. */
function checkOneLength(nodes, report) {
  // A single function whose arguments are separate values is not one length but a value with lengths
  // inside it, so each argument is its own length. Counting across them would add up two gradient
  // stops and call the pair a peak.
  if (nodes.length === 1 && nodes[0].type === 'function') {
    const fn = nodes[0].value.toLowerCase();
    if (fn === 'var' || SEPARATE_ARG_FUNCTIONS.has(fn)) {
      // For `var()` the first group is the custom property's NAME, which is not a number and drops out
      // of this on its own. Every later group is a fallback, and a fallback really does reach the page
      // — #1003 was shipped with a font hiding in one.
      for (const group of splitValues(nodes[0].nodes || [])) checkOneLength(group, report);
      return;
    }
  }
  const tokens = [];
  for (const n of nodes) windowTokens(n, tokens);
  if (tokens.length === 0) return;
  for (const n of nodes) walkArithmetic(n, report);
  if (tokens.length > 1) {
    report(`puts ${tokens.length} window-relative lengths (${tokens.join(', ')}) in one length. One of `
      + 'them is a straight line in the window size; two of them multiply into a curve that can be in '
      + 'order at two widths and swapped between them');
  }
}

/** Inside a length that follows the window: only numbers, `+ - * /`, `calc()`, `var()`. */
function walkArithmetic(node, report) {
  if (node.type === 'space') return;
  if (isOperator(node)) return;
  if (node.type === 'word') {
    if (unitOf(node.value) === null) {
      report(`writes "${node.value}" into a length that follows the window, which is not a number`);
    }
    return;
  }
  if (node.type === 'div') {
    report(`uses "${node.value}" inside a length that follows the window; only + - * / may join the `
      + 'pieces of one');
    return;
  }
  if (node.type !== 'function') {
    report(`writes ${node.type === 'string' ? `"${node.value}"` : node.value} into a length that `
      + 'follows the window');
    return;
  }
  const fn = node.value.toLowerCase();
  if (isArithmetic(node)) {
    const pieces = (node.nodes || []).filter((n) => n.type !== 'space');
    pieces.forEach((piece, i) => {
      // 🔴 DIVIDING BY SOMETHING THAT FOLLOWS THE WINDOW IS NOT A STRAIGHT LINE, and the form that
      // matters here is `100vw / 1px`: it turns a length into a plain NUMBER, and a number may be
      // multiplied by another number, which is how the parabola at the top of this section is built
      // out of nothing but `calc()`. The count above catches that one (two tokens); this catches the
      // other half of the family — `1000px / ((100vw / 1px) - 1900)` uses ONE token and has a pole,
      // so it runs off to infinity on one side of 1900px and comes back on the other.
      const previous = pieces[i - 1];
      if (previous && isOperator(previous) && previous.value === '/'
        && windowTokens(piece, []).length > 0) {
        report(`divides by ${valueParser.stringify(piece)}, which follows the window — dividing by `
          + 'something that moves makes a curve, and one that can pass through zero makes two');
      }
      walkArithmetic(piece, report);
    });
    return;
  }
  if (fn === 'var') {
    for (const group of splitValues(node.nodes || [])) checkOneLength(group, report);
    return;
  }
  if (SEPARATE_ARG_FUNCTIONS.has(fn)) {
    for (const group of splitValues(node.nodes || [])) checkOneLength(group, report);
    return;
  }
  report(`builds a length that follows the window with ${fn}(). A length on a block or a region may `
    + 'only be a number with a unit, a bare 0, calc() with + - * /, or var() — a function that can '
    + 'turn round makes a peak, and no set of measured widths can be trusted to find one');
}

// ── §2 #1011 — and a margin on a block or a region may never be negative ─────────────────────────
//
// 🔴 CHRIS DECIDED THIS ONE (2026-08-14). Asked whether a theme should still be able to make two
// blocks OVERLAP — which is what a negative margin is honestly for, a hero pulled up over the band
// under it — his answer was "不要！": blocks queue up one after another, always.
//
// 🔴 WHY IT IS A CEILING AND NOT A FIFTH WAY OF SAMPLING. What a page reads in is the order of the
// tops of the blocks, and a later block's top is the earlier one's top plus a height plus the margins
// between them. A used height is never negative. So the ONLY way a sheet can put a later block above
// an earlier one is to hand it a negative offset, and §2's whitelist leaves exactly two ways to do
// that: `order` (which does not follow the window at all, so the check that measures the real page
// catches it at every viewport it looks at, this build's `[data-region-layout="slim-row"]
// { order: -1 }` included) and a negative margin. `position`, `transform`, `float` and `inset` are all
// off the whitelist. Take negative margins off the hooks and the second lever is gone: a sheet can
// still build a curve out of lengths, and the curve can still move things, but it cannot move
// anything PAST anything. Four rounds of #1011 were spent proving "the order did not change" against
// an opponent free to choose the value — which needs sampling and lost every time. This asks a
// question that can simply be answered.
//
// 🔴 WHAT COUNTS IS THE SIGN AT EVERY WINDOW WIDTH, NOT THE PRINTED MINUS. `calc(100px - 100vw)` has
// no minus in front of it and is negative on any window wider than 100px. So the test below is over
// the whole value: every additive term in it has to be non-negative on its own, because every unit
// CSS has is a non-negative quantity and only the numbers written next to them carry a sign. A sum of
// terms that are each ≥ 0 is ≥ 0 at every width — that is the whole proof, and it needs no arithmetic
// on window sizes and no list of thresholds to be true at.
//
// 📌 That is a SUFFICIENT test, not an exact one: `calc(1000px - 100px)` is never negative and this
// refuses it anyway, because reading its sign would mean converting `rem` and `%` and `vw` into one
// another, which cannot be done without knowing the page. The cost of being coarse there, measured:
// zero. All three shipped sheets keep every margin on a PART (`.hero__sub`, `.hero__cta`,
// `.hero__deco`, `.hero__body` — 12 of 12, including all four negative ones), so not one of them
// writes a margin this rule even looks at, and a sheet that wants a constant difference writes the
// constant.
//
// 🔴 `var()` IS REFUSED HERE, and that is the disposition #1011's AC10 asked to have written down.
// It is allowed in a length everywhere else in §2 — treated as a constant, for reasons measured in
// the block above — but "constant" is not "positive", and a theme's own tokens cannot be lengths at
// all (`schemas/theme-tokens.schema.json`), so a `var()` in a margin can only be reaching for an
// APP-side custom property. Its sign would then be asserted by a sheet that does not own the value
// and is not rechecked when the app changes it. Measured cost, again zero: `grep 'var('` over the
// three shipped sheets is 19 hits, every one of them a colour or a gradient, none in a margin. A
// sheet that wants the app's spacing writes the length.
// 🔴 AND THE HALF OF THE SAME CEILING THAT LIVES ON `overflow`, WHICH I FOUND BY MEASURING AC10
// RATHER THAN BY READING IT. Banning negative margins on the hooks is not on its own enough to make
// "a block never sits over its neighbour" true, because a margin does not have to be written ON the
// block to become the block's. A first child's top margin COLLAPSES INTO ITS PARENT — the parent's
// border box moves, not the child's — and the parts inside a block keep their negative margins on
// purpose (all three shipped sheets pull `.hero__deco` up that way; AC10 says so in as many words).
// What stops that today is app-side, not theme-side: `globals.css` gives `.hero { overflow: hidden }`,
// which makes the hero its own formatting context, and a formatting context does not collapse with
// its children. §2 hands a sheet the one key that unlocks it. Measured on this build, three legal
// declarations, both checkers green at every width either of them looks at:
//
//	[data-block="hero"] { display: block; padding: 0 }
//	.hero { overflow: visible }
//	.hero__deco { margin-top: calc(-1200px + 8 * abs(100vw - 1900px)) }
//
//	375 / 768 / 1440 / 1536 / 3072 / 6144   in the DOM order (the margin is POSITIVE there: +11000px
//	                                        at 375, +2480px at 1440, +8176px at 3072)
//	1850 / 1900 / 1901 / 1950               the hero and the two blocks after it are painted ABOVE the
//	                                        page header (hero at y −724 … −1124 against a header at 0)
//
// The peak is on a PART, where §2 leaves values free on purpose, and the collapse carries it onto the
// block. Drop the `overflow: visible` line and the same fixture is in the DOM order at all eleven
// widths — the margin then hangs the decoration outside the hero's box and leaves the box where it
// was (measured: `.hero` stays at y=76 at 1900 while `.hero__deco` goes to −1124). So a hook may only
// carry a value of `overflow` that keeps the block a formatting context: that is what keeps its top
// where the flow put it, and it is the cheapest thing to hold on to — no shipped sheet writes
// `overflow` at all (`grep -c overflow public/themes/*.css` → 0, 0, 0).
// 🔴 THIS RULE IS PROPPED UP BY AN APP-SIDE DECLARATION, AND IF THAT GOES SO DOES THE RULE:
// `globals.css`'s `.hero, .hero__media { overflow: hidden }`. Take it away and a block is a plain
// block box again, and then `display: block` + `padding: 0` on the hook is enough on its own.
// 📌 Only the shorthand needs saying, because `overflow-x` / `overflow-y` are not on §2's list at all
// (they are neither in `PROP_EXACT` nor under a prefix).
// 🔴 r9 SAID HERE THAT `visible` IS "THE ONLY VALUE OF IT THAT IS NOT A FORMATTING CONTEXT". THAT
// SENTENCE WAS FALSE, and the rule written from it leaked: QA2 measured `clip` (on both axes) not
// being one either, and `initial` / `unset` / `revert` / `revert-layer` computing to `visible`. Six
// spellings, one attack, both checkers green. The fix is not six names — it is the allowed set below.
const MARGIN_PROP = (prop) => prop === 'margin' || prop.startsWith('margin-');

// ── §2 #1011 r10 — WHICH VALUES OF `overflow` KEEP A BLOCK A FORMATTING CONTEXT ──────────────────
//
// 🔴 THIS IS AN ALLOWED SET, AND IT IS ONE BECAUSE THE BLACKLIST IT REPLACES WAS MEASURED LEAKING.
// r9 wrote this rule as `/\bvisible\b/i.test(value)` — the word as it is SPELLED. QA2 measured five
// other spellings whose computed value is exactly `visible` (`initial`, `unset`, `revert`,
// `revert-layer`) or which is not a formatting context on both axes (`clip`), and the same collapse
// attack walked through all five with the static check at rc=0 and the §4 check printing
// `✅ every invariant holds`. That is the identical mistake §2's length rule already refuses to make:
// "not a function-name blacklist — an allowed set, everything else refused, whether or not this
// ticket named it, so next year's addition cannot quietly open the hole".
//
// So: three words pass. `hidden`, `auto` and `scroll` each establish a block formatting context on
// their own, and any pair of them does too (a shorthand may name one value per axis). Everything
// else is refused WITHOUT BEING NAMED — `visible`, `clip`, the four CSS-wide keywords, `overlay`,
// a `var()` whose value this file cannot see, and whatever CSS gains next.
//
// 📌 `clip` is refused although `overflow: clip hidden` really would be a formatting context: one
// axis of `clip` next to one that is not IS one, and two axes of `clip` are not (QA2 measured both).
// Keeping the rule at "is every word in the allowed set" rather than "which combination is safe"
// costs nothing — `grep -c overflow public/themes/*.css` is 0, 0, 0 — and a rule about spelling
// combinations is the shape that just leaked.
//
// 📌 Only the shorthand needs a rule: `overflow-x` / `overflow-y` are not on §2's property list at
// all, so a sheet cannot write them (they hit the whitelist refusal at the bottom of checkDecl).
const CONTAINING_OVERFLOW = new Set(['hidden', 'auto', 'scroll']);
function isContainingOverflow(value) {
  const words = valueParser(value).nodes
    .filter((n) => n.type !== 'space' && n.type !== 'div')
    .map((n) => (n.type === 'word' ? n.value.toLowerCase() : `<${n.type}>`));
  if (words.length === 0 || words.length > 2) return false;
  return words.every((w) => CONTAINING_OVERFLOW.has(w));
}

/** +1 = provably ≥ 0 · -1 = provably ≤ 0 · null = not readable here (a var(), a function, a word). */
function signOfFactor(node) {
  if (node.type === 'word') {
    const unit = unitOf(node.value);
    if (unit === null) return null; // `auto` inside arithmetic, a token name, anything unreadable
    return parseFloat(node.value) < 0 ? -1 : 1; // every CSS unit is a non-negative quantity
  }
  if (node.type === 'function' && isArithmetic(node)) return signOfSum(node.nodes || []);
  return null; // var(), min(), max(), clamp(), and whatever CSS gains next
}

/** The sign of one `a * b - c / d`-shaped sum. Mixed signs are not readable, so they come back null. */
function signOfSum(nodes) {
  const pieces = nodes.filter((n) => n.type !== 'space');
  const terms = [];
  let sign = 1;
  let factors = [];
  for (const piece of pieces) {
    const additive = isOperator(piece) && (piece.value === '+' || piece.value === '-');
    if (additive && factors.length === 0) { // a leading `- 5px`, or the sign after another operator
      if (piece.value === '-') sign = -sign;
      continue;
    }
    if (additive) {
      terms.push({ sign, factors });
      factors = [];
      sign = piece.value === '-' ? -1 : 1;
      continue;
    }
    if (isOperator(piece)) continue; // `*` and `/` stay inside the term
    factors.push(piece);
  }
  if (factors.length) terms.push({ sign, factors });
  if (terms.length === 0) return null;
  let seen = null;
  for (const term of terms) {
    let s = term.sign;
    for (const f of term.factors) {
      const fs = signOfFactor(f);
      if (fs === null) return null;
      s *= fs;
    }
    if (seen === null) seen = s;
    else if (seen !== s) return null; // `100vw - 1800px`: positive somewhere, negative somewhere else
  }
  return seen;
}

// ── #1011 r12 — THE THREE LENGTH RULES READ THE VALUE TWICE, LIKE EVERY OTHER RULE HERE ─────────
//
// 🔴 What this fixes (QA3, r11, measured on the r11 delivery): `.hero { margin-bottom: -1000\70x }`
// was rc=0. `\70` is `p`, so the browser lays that out as `-1000px` and the page really does swap at
// 1440 — a sheet AC10 exists to refuse was called legal. `-100\76w`, `50\76w` and `80\76h` walked
// through the same gap. It is not a new idea: contract §3 already says the checker "reads each
// declaration twice — once as written, once decoded — and takes the union", and `urlsIn()` (#992)
// and `literalColoursIn()` / `literalFontsIn()` (#1003) do exactly that, less than 200 lines above.
// The rules this ticket added did not, so the escape was invisible to `unitOf()`: `DIMENSION` never
// matches `-1000\70x`, `unitOf` returns null, and null means "a keyword, not a length" in all three.
//
// 🔴 WHY A UNION AND NOT "JUST READ THE DECODED TEXT". The decoded pass can only ADD reasons to
// refuse; reading it alone would mean trusting the decoder not to have destroyed something on the
// way. A union cannot lose a risk, whatever the decoder does to the rest of the value — the same
// sentence is written over `urlsIn()`, and it is the same argument.
//
// 📌 It costs a second parse of every declaration on a block or a region, and only when the value
// actually contains a backslash (`decoded !== value`); the three shipped sheets contain none.
function overBothSpellings(value, collect) {
  const found = collect(value);
  const decoded = decodeEscapes(value);
  if (decoded !== value) found.push(...collect(decoded));
  return [...new Set(found)];
}

/** Every length in this margin value that is not provably ≥ 0 → ["-50%", "calc(100px - 100vw)"]. */
const negativeMarginRisksIn = (value) => overBothSpellings(value, negativeMarginRisksAsWritten);
function negativeMarginRisksAsWritten(value) {
  const bad = [];
  for (const group of splitValues(valueParser(value).nodes)) {
    const nodes = group.filter((n) => n.type !== 'space');
    if (nodes.length === 0) continue;
    // A keyword is not a length and has no sign to read — `margin: 0 auto` and `margin: inherit` are
    // both fine. `auto` resolves to a free-space share, never below zero; `inherit` can only reach a
    // parent whose own margin this same rule has already been over (a block's parent is `<main>`,
    // which no selector on the hook list can touch, and a region's is `body`, which is a hook).
    if (nodes.length === 1 && nodes[0].type === 'word' && unitOf(nodes[0].value) === null) continue;
    const s = nodes.length === 1 ? signOfFactor(nodes[0]) : signOfSum(nodes);
    if (s !== 1) bad.push(valueParser.stringify(group));
  }
  return bad;
}

/**
 * Reasons this declaration's lengths might not move one way with the window → string[].
 * Empty means every length in it is a straight line in the window size (or does not follow it at all).
 */
const windowPeakRisksIn = (value) => overBothSpellings(value, windowPeakRisksAsWritten);
function windowPeakRisksAsWritten(value) {
  const found = [];
  const report = (why) => { if (!found.includes(why)) found.push(why); };
  for (const group of splitValues(valueParser(value).nodes)) checkOneLength(group, report);
  return found;
}

/** Every window-relative token in this value, wherever it sits — `["100vw", "-50%"]`. */
const windowLengthsIn = (value) => overBothSpellings(value, windowLengthsAsWritten);
function windowLengthsAsWritten(value) {
  const found = [];
  for (const node of valueParser(value).nodes) windowTokens(node, found);
  return found;
}

// ══ WHAT THIS PIPELINE ALREADY GUARANTEES, AND WHETHER #1011'S RULES INHERIT IT (r12) ════════════
//
// The table above says what SHAPE each judgement is. This one says what the pipeline around them
// hands every judgement for free — and it exists because three rounds in a row were bounced for the
// same reason: a discipline this file already had, that the new rule did not pick up.
//
//   r9   `overflow` written as the word `visible`      → `clip` / `initial` / `unset` / `revert` walk through
//   r10  `display` not narrowed to an allowed set      → `display: contents` walks through
//   r11  the three length rules read the value once    → `-1000\70x` IS `-1000px`, walks through
//
// Each was one more spelling of an idea already refused. So the guarantees are listed one per line,
// with the answer for each of this ticket's three rules — `windowPeakRisksIn` (a length has to move
// one way), `windowLengthsIn` (a window-relative length may not size a box) and
// `negativeMarginRisksIn` (a margin on a block or a region is never negative).
//
//   guarantee                       who provides it            do the three inherit it?
//   ─────────────────────────────────────────────────────────────────────────────────────────────
//   the value is read TWICE — as     `overBothSpellings`,      YES, as of r12; before that, no —
//   written and with CSS escapes     the same union `urlsIn`   that is the bug QA3 measured. All
//   decoded — and the union of the   (#992) and                three go through it; the union is
//   two readings is judged           `literalColoursIn` /      taken over the RISKS, so a decoder
//                                    `literalFontsIn` (#1003)  bug can only add, never hide
//                                    already used
//   a line continuation inside a     `decodeEscapes` (its      YES, same call. Measured: a
//   value (backslash + newline) is   `CSS_CONTINUATION` half,  `margin-bottom: -1000p\<newline>x`
//   removed before judging           #992 r4)                  was rc=0 in r11 and is rc=1 now
//   the property name is lower-      `checkDecl`'s first line  YES — `MARGIN_PROP` and
//   cased once, so every test on it                            `onlyAddsToLayout` are handed the
//   is case-insensitive                                        lower-cased name, never `decl.prop`
//   shorthand and longhand are both  `MARGIN_PROP` (`margin`   YES — `margin`, `margin-block-end`
//   covered by prefix, not by a      + `margin-*`),            and next year's `margin-*` are all
//   list of the properties that      `ADDS_ONLY_PREFIXES`      the same rule. 🔴 The refusal is
//   exist today                                                what the prefix widens, so a new
//                                                              longhand lands on the strict side
//   units and function names are     `unitOf`, `isArithmetic`, YES — the three rules do not compare
//   compared lower-cased             `SEPARATE_ARG_FUNCTIONS`  spellings themselves, they ask these
//   the value is walked as a PARSE   `postcss-value-parser`    YES — `splitValues` / `windowTokens`
//   TREE, never matched as text, so  via `splitValues`,        / `signOfSum` all walk nodes. No
//   comments, odd whitespace and     `windowTokens`,           regex is run over a whole value
//   multi-value shorthands do not    `negativeMarginRisks…`    anywhere in the three
//   need a rule of their own
//   `!important` is read off the     `decl.important`          n/a — it is judged once for every
//   parse tree rather than the text                            declaration, above, and none of the
//                                                              three needs to ask
//   what cannot be READ is REFUSED   `signOfFactor` → null,    YES — a `var()` in a margin, an
//   rather than assumed harmless     `isWindowUnit` on an      unknown function and a unit this
//                                    unknown unit              file has never heard of are all
//                                                              refused, not waved through
//   ─────────────────────────────────────────────────────────────────────────────────────────────
//   NOT inherited, and measured to be safe without it:
//   an escaped PROPERTY NAME (`marg\69n-bottom`) is not decoded — `checkDecl` lower-cases
//   `decl.prop` and nothing else. It does not need to be: `isAllowedProp` is an allowed set, so the
//   escaped spelling is not on §2's list and the declaration is refused there instead (measured:
//   `.hero { marg\69n-bottom: -1000px }` is rc=1 both before and after r12, with the whitelist
//   speaking). Decoding it would move which sentence the author reads, not whether it is refused.
//   an escaped SELECTOR (`.h\65ro`, `[data-block="h\65ro"]`) is likewise not decoded, and likewise
//   refused by an allowed set — `checkSelector` says "not a contract hook" (measured: rc=1 before
//   and after). 🔴 Both of these are safe only in that direction: the escape makes the checker see
//   LESS of a hook than the browser does, and less means stricter here. A rule that ever refuses by
//   naming what it dislikes — rather than by naming what it allows — would have the opposite sign,
//   and that is what the table above is for.
function checkDecl(decl, report, stylesOrder, onABlock) {
  const prop = decl.prop.toLowerCase();
  const value = decl.value;

  // §2 #1011 r11 — a block keeps its own box. See the 🔴 block above `stylesABlock` for the two
  // declarations this refuses and the measurement behind them.
  if (onABlock && prop === 'display' && !isBlockDisplay(value)) {
    report(`"display: ${value}" on a block leaves the block without a box of its own while the parts `
      + 'inside it keep theirs (contract §2). Those parts then lay out as siblings of the OTHER '
      + 'blocks, and a part is the one place §2 still allows a negative margin and a value that turns '
      + 'round — so a peak written on a part moves whole blocks past one another, with the §4 check '
      + 'skipping this block because it has no box. Measured: `[data-block="hero"] { display: '
      + 'contents }` next to `.hero__deco { margin-bottom: calc(-1200px + 8 * abs(100vw - 1900px)) }` '
      + `paints the second block above the page header at 1900px and 1901px. What passes is `
      + `${[...BLOCK_DISPLAY].map((w) => `\`${w}\``).join(' / ')} — one keyword, each of which keeps a `
      + 'box (or, for `none`, takes the parts away with it). A region may still be `display: '
      + 'contents`: no hook on §1\'s list reaches inside a header or a footer, so there is nowhere to '
      + 'hang the peak');
  }

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
  for (const lit of literalColoursIn(prop, value)) {
    report(`"${prop}: ${value}" writes the colour ${lit} into the stylesheet — colours are tokens `
      + '(schemas/theme-tokens.schema.json). Use var(--color-primary-…) / var(--color-accent-…). '
      + 'The one exception is a pure black or white shadow colour in box-shadow (contract §3).');
  }
  for (const font of literalFontsIn(prop, value)) {
    report(`"${prop}: ${value}" names the font ${font} — fonts are tokens too. Use `
      + 'var(--font-heading) or var(--font-sans).');
  }
  // §2's last rule (#1011): on a block or a region, a length has to move one way as the window grows.
  // It asks nothing about WHICH property this is — a list of properties that can reorder a page was
  // written four times on that ticket and was wrong four times (`order`, then a `flex-flow` spelling,
  // then `margin`, then a region-level hook). What it asks is how the VALUE is built.
  if (stylesOrder) {
    for (const why of windowPeakRisksIn(value)) {
      report(`"${prop}: ${value}" ${why} (contract §2). Past the last (min-width: …) a sheet declares, `
        + 'the check that the page is painted in the DOM order has only the page\'s own numbers to go '
        + 'on, and a peak between two of its widths is invisible to it');
    }
    // The other half of the same rule: a straight line only stays one is if nothing bends it, and the
    // browser bends one wherever a length sizes a box.
    const following = onlyAddsToLayout(prop) ? [] : windowLengthsIn(value);
    if (following.length) {
      report(`"${prop}: ${value}" gives ${following.join(', ')} — a length that follows the window — to `
        + `"${prop}", which SIZES a box rather than adding to it (contract §2). What a box comes out `
        + 'as there is a min and a max between what is written, what the content needs and any other '
        + 'bound, so two window-relative lengths meeting in one of those come out as a peak, and one '
        + 'meeting the content comes out as a corner. On a block or a region a length that follows the '
        + 'window belongs in a margin, a padding, a gap, a border or somewhere that does not lay the '
        + 'page out at all; a size here has to be a constant');
    }
    // And the ceiling over both of them: a margin here may never be negative, at any window width.
    if (MARGIN_PROP(prop)) {
      for (const length of negativeMarginRisksIn(value)) {
        report(`"${prop}: ${value}" gives "${length}" to a margin on a block or a region, and this `
          + 'file cannot read that as never-negative at any window width (contract §2). Blocks and '
          + 'regions queue up one after another — a block never sits over its neighbour — and a '
          + 'negative margin is the only way left in §2 to move one PAST another, so it is refused '
          + 'here rather than measured for. What passes is a length whose every added-up piece is '
          + 'non-negative on its own (`2rem`, `0`, `calc(100vw / 3)`, `calc(2rem + 5vw)`); what does '
          + 'not is a minus (`-50%`), a subtraction whose sign depends on the window '
          + '(`calc(100px - 100vw)` is negative on anything wider than 100px), a difference of two '
          + 'units this file cannot compare (`calc(1000px - 100px)` — write the constant), and a '
          + 'var(), whose value belongs to the app rather than to this sheet. The parts inside a '
          + 'block keep their negative margins: all three shipped sheets pull `.hero__deco` up that '
          + 'way, and a part cannot move the block it is in past anything');
      }
    }
    // …as long as the block stays a formatting context, which is the only thing keeping a part's
    // negative margin from collapsing into it and becoming the block's own.
    if (prop === 'overflow' && !isContainingOverflow(value)) {
      report(`"overflow: ${value}" on a block or a region does not keep it a formatting context `
        + '(contract §2). A first child\'s top margin then COLLAPSES INTO IT — the block\'s own box '
        + 'moves, not the child\'s — and the parts inside a block are the one place §2 still allows a '
        + 'negative margin and a value that turns round. Measured on this build: with '
        + '`[data-block="hero"] { display: block; padding: 0 }` and '
        + '`.hero__deco { margin-top: calc(-1200px + 8 * abs(100vw - 1900px)) }`, this one line is the '
        + 'difference between the hero being painted above the page header from about 1750px to '
        + '2050px of window and the page being in its DOM order at every width. What passes here is '
        + `${[...CONTAINING_OVERFLOW].map((w) => `\`${w}\``).join(' / ')}, one value for both axes or `
        + 'one per axis; everything else is refused, including `visible`, the CSS-wide keywords that '
        + 'resolve to it (`initial` / `unset` / `revert` / `revert-layer`) and `clip`, which is not a '
        + 'formatting context when it is on both axes');
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
  // The §2 length rule needs to know what the declaration is ON, so the selector comes with it. A
  // declaration inside `@media` still has its rule as its parent, so nothing special is needed there.
  root.walkDecls((decl) => checkDecl(decl, (m) => at(decl, m),
    decl.parent && decl.parent.type === 'rule' && stylesABlockOrRegion(decl.parent.selector),
    decl.parent && decl.parent.type === 'rule' && stylesABlock(decl.parent.selector)));

  // §3's last line: the second defence for essential content. Written as its own pass because it is
  // a property AND a selector together — neither check above can see the pair.
  //
  // 🔴 #1043 — THIS PASS USED TO ASK FOR ONE SPELLING, AND EVERY OTHER SPELLING OF THE SAME TARGET
  // WALKED PAST IT. The old body was `if (!/\[data-role="essential"\]/.test(rule.selector)) return;`
  // — the attribute, written out literally. Measured on the shipped checker, all of these reached
  // rc=0 while naming a block whose role is `essential` in `src/lib/sections/block-roles.json`:
  //     .contact-info { display: none }                 ← the block's ROOT, reached by its class
  //     [data-block="contact-info"] { display: none }   ← the same element, reached by the attribute
  //     .contact-info__phone { display: none }          ← a PART inside it (QA3's finding on #1028:
  //                                                       tel: ×2 and mailto: ×1 all 0×0 on the page,
  //                                                       with this check, the contract check and the
  //                                                       runtime invariants all printing ✅)
  //     .contact-info__phone, .timeline__event { … }    ← one essential name in a selector LIST
  // `display: none` on a block is deliberately legal (`BLOCK_DISPLAY` has `none`: a theme may hide an
  // OPTIONAL block outright), so this pass is the ONLY thing standing between that permission and an
  // essential block. Asking for one spelling made it the only thing standing nowhere.
  //
  // So the question became "which blocks can this selector's subject be?", answered from the same
  // hook names the rest of this file already uses, and then "is any of them essential?", answered
  // from `block-roles.json` — 🔴 which the runtime half reaches through the page, not by opening the
  // file: `blockAttrs.ts` imports that JSON and writes `data-role` into the markup, and
  // `theme-css-invariants.mjs` reads the attribute (it never names the file — grep it: 0 hits). One
  // source, two readers, so the two halves cannot answer differently about the same block.
  //
  // 🔴 IT IS NOT A LIST OF FIVE BLOCK NAMES. Five essential blocks have part hooks TODAY
  // (contact-info · contact-form · quote-form · services-list · services-nav); `block-roles.json`
  // marks seven essential in all, and phase 2 adds part hooks with every batch. A list written here
  // would be a sixth blind spot the day the next batch lands.
  //
  // 🔴 AND IT IS NOT ONLY `display: none`. Hiding has more than one spelling, and the ones below are
  // the ones this file can decide WITHOUT running a browser. `visibility: hidden` is absent on
  // purpose — it never reaches this pass, because `visibility` is not on §2's property list at all
  // and `checkDecl`'s whitelist refuses it first (measured: rc=1, message names `visibility`);
  // `clip-path` is refused the same way.
  //
  // 🔴 NEITHER HALF IS A COMPLETE ANSWER, AND THIS ONE IS NOT MERELY "EARLY". The runtime half
  // (`theme-css-invariants.mjs`) reads three things — the box, the chain's opacity, `display` /
  // `visibility` on the chain — so it needs nobody to predict the spellings WITHIN those, but it
  // reads neither where the box is nor whether an ancestor clipped it. `filter: opacity(0)` is
  // therefore caught HERE and nowhere else: measured on the allblocks fixture it leaves a 576×27 box
  // computing `opacity: 1`, and the runtime check stays silent. Going the other way, `margin-top:
  // -9999px` on a part (its text ends up at document y −6940, above the top of the page) and
  // `.contact-info { max-height: 1px }` (the block's own `overflow: hidden` from globals.css does the
  // rest, and 0 pixels of the phone number are left) pass BOTH halves today: rc=0 here, no finding
  // there. QA3 drove those on this ticket's terminal review and #1049 is where the runtime half
  // grows the two dimensions it is missing — where the box is, and what clipped it.
  const HIDES = (prop, value) => {
    const v = value.trim().toLowerCase();
    if (prop === 'display') return v === 'none';
    if (prop === 'opacity') return parseFloat(v) === 0;
    if (prop === 'font-size') return /^0(?:[a-z%]*)$/.test(v) && parseFloat(v) === 0;
    if (prop === 'color') return v === 'transparent' || /^rgba?\([^)]*,\s*0\s*\)$/.test(v);
    // `filter: opacity(0)` paints nothing while `opacity` itself computes to 1 — a different
    // spelling of the same result, and one this file can read. `blur()` is NOT here, and 🔴 NOTHING
    // ELSE CATCHES IT EITHER — do not read this line as "the runtime half has it". That half reads
    // the box, the chain's opacity and `display` / `visibility` (see the list in
    // `theme-css-invariants.mjs`), and `blur` changes none of the three: measured on
    // `.contact-info__phone` in the allblocks fixture, `ocean-blue` + `hero-media-left`, 1440×900,
    // `blur(50px)` leaves the box at 576×27 and the runtime check silent, while inside that box not
    // one pixel is off the background any more (0, against 1137 at baseline) — the phone number is
    // gone with both halves green. What keeps it out of THIS pass is only that "how blurred is too
    // blurred" has no static answer: `blur(8px)` still reads (3573 pixels off the background — blur
    // spreads the same ink over more of them). That threshold is the same shape as the cases #1049
    // is opening (a legal declaration that leaves essential content unreadable), except its six are
    // geometric and `blur()` is not one of them: today this spelling has no owner.
    if (prop === 'filter') return /(^|\s)opacity\(\s*0(?:\.0+)?%?\s*\)/.test(v);
    if (['width', 'height', 'max-width', 'max-height'].includes(prop)) {
      return /^0(?:[a-z%]*)$/.test(v) && parseFloat(v) === 0;
    }
    return false;
  };
  root.walkRules((rule) => {
    const targets = essentialTargetsOf(rule.selector);
    if (targets.length === 0) return;
    rule.walkDecls((decl) => {
      if (!HIDES(decl.prop.toLowerCase(), decl.value)) return;
      at(decl, `"${rule.selector} { ${decl.prop}: ${decl.value} }" hides content a theme may never `
        + `hide — that selector reaches ${targets.join(' / ')}, and `
        + `${targets.length === 1 ? 'that block is' : 'those blocks are'} \`essential\` in `
        + 'src/lib/sections/block-roles.json (contract §3)');
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

// #1018 — `HOOKS` / `isHook` are exported so the docs↔code check in css-contract-check.js can read
// the list instead of keeping a second hand-written copy of it. The contract table in
// docs/reference/theme-css-contract.md is written for people; THIS is what a sheet is judged by.
module.exports = { lint, CONTRACT_VERSION, HOOKS, HOOK_CLASSES, isHook };
