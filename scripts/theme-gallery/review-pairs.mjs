// #963 — AI visual review of the theme gallery.
//
// Why it exists: whether the themes are actually varied could only be judged by a person paging
// through every screenshot — which is how #932 found "30 colours of the same theme", after the
// pictures had already been handed over. This step asks a vision model the same question about
// every pair and hands the person a short list instead of the whole gallery.
//
// It is a HINT, NOT A GATE. Nothing here fails a build or blocks a ship; taste is still the
// person's call. What it changes is where they have to look.
//
// Usage:
//   THEME_GALLERY_DIR=/some/dir ANTHROPIC_API_KEY=... node review-pairs.mjs [options]
//     --top N          how many pairs the report highlights (default 10)
//     --limit N        only score the first N pairs — for a cheap smoke run, not for a report
//     --extra id=path  score an extra image alongside the gallery (used by the control run)
//     --out path       where to write the result (default <THEME_GALLERY_DIR>/review.json)
//     --concurrency N  parallel requests (default 8)
//
// Cost: every pair is scored — no pre-filter, so the list has no blind spot. The lever on cost is
// thumbnail size (THUMB_WIDTH/THUMB_MAX_HEIGHT below), as the ticket asks. 30 themes = 435 pairs
// ≈ $2 and a few minutes. The measured spend goes into review.json and onto the gallery page, so a
// change that makes this more expensive shows up rather than creeping.
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import { NEXT_DIR, galleryDir } from './paths.mjs';

const MODEL = process.env.THEME_REVIEW_MODEL || 'claude-opus-5';
// list price per million tokens, only used to print a cost estimate next to the result
const PRICE_IN = Number(process.env.THEME_REVIEW_PRICE_IN || 5);
const PRICE_OUT = Number(process.env.THEME_REVIEW_PRICE_OUT || 25);
const THUMB_WIDTH = Number(process.env.THEME_REVIEW_THUMB_WIDTH || 200);
const THUMB_MAX_HEIGHT = Number(process.env.THEME_REVIEW_THUMB_HEIGHT || 1000);

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const argAll = (name) => process.argv.reduce((acc, v, i) => (v === name && process.argv[i + 1] ? [...acc, process.argv[i + 1]] : acc), []);

const TOP = Number(arg('--top', 10));
const LIMIT = Number(arg('--limit', 0));
const CONCURRENCY = Number(arg('--concurrency', 8));
const GAL = galleryDir();
const SHOTS = path.join(GAL, 'public', 'shots');

// 🔴 No key means the run FAILS. It must not quietly produce an empty list: on the gallery page
// "we did not run the review" and "the review found nothing similar" would look identical, and
// the second one is the reading a person would take away.
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error('ANTHROPIC_API_KEY is not set — refusing to write an empty review.');
  console.error('An empty list reads as "nothing looks alike", which is not what happened.');
  process.exit(2);
}

const { default: Anthropic } = await import(`${NEXT_DIR}/node_modules/@anthropic-ai/sdk/index.mjs`);
const client = new Anthropic({ apiKey });

// ── which images to compare ──────────────────────────────────────────────────────────────────
const shots = new Map();
for (const f of fs.readdirSync(SHOTS)) {
  // the home-page shot is <id>.png; <id>-about.png is the sub-page, not compared here
  if (f.endsWith('.png') && !f.endsWith('-about.png')) shots.set(f.replace(/\.png$/, ''), path.join(SHOTS, f));
}
for (const spec of argAll('--extra')) {
  const [id, p] = spec.split('=');
  if (!id || !p || !fs.existsSync(p)) { console.error(`--extra ${spec}: no such image`); process.exit(2); }
  shots.set(id, path.resolve(p));
}
const ids = [...shots.keys()].sort();
if (ids.length < 2) { console.error(`only ${ids.length} screenshot(s) in ${SHOTS} — nothing to compare`); process.exit(2); }

const pairs = [];
for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) pairs.push([ids[i], ids[j]]);
const scored = LIMIT > 0 ? pairs.slice(0, LIMIT) : pairs;
console.log(`${ids.length} themes → ${pairs.length} pairs; scoring ${scored.length} on ${MODEL}`);
if (LIMIT > 0 && LIMIT < pairs.length) {
  console.log(`⚠️  --limit ${LIMIT}: this is a smoke run. ${pairs.length - LIMIT} pairs were NOT looked at.`);
}

// ── thumbnails: the cost lever ───────────────────────────────────────────────────────────────
const thumbDir = path.join(GAL, 'review-thumbs');
fs.mkdirSync(thumbDir, { recursive: true });
const thumbs = new Map();
for (const [id, src] of shots) {
  const out = path.join(thumbDir, `${id}.png`);
  execFileSync('python3', ['-c', `
from PIL import Image
im = Image.open(${JSON.stringify(src)})
w = ${THUMB_WIDTH}
h = min(${THUMB_MAX_HEIGHT}, round(im.height * w / im.width))
im.crop((0, 0, im.width, round(im.width * h / w))).resize((w, h)).save(${JSON.stringify(out)})
`]);
  thumbs.set(id, out);
}
console.log(`thumbnails: ${THUMB_WIDTH}px wide, at most ${THUMB_MAX_HEIGHT}px tall → ${thumbDir}`);

// ── ask the model ────────────────────────────────────────────────────────────────────────────
const b64 = (p) => fs.readFileSync(p).toString('base64');
const imageBlock = (p) => ({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: b64(p) } });

const QUESTION =
  'These are the home pages of two website themes, built from the exact same content.\n' +
  'Answer as an ordinary visitor, not a designer: would they think these two are the same ' +
  'design with different colours?\n' +
  'Judge the page as a whole — the layout, the order and shape of the sections, the typography, ' +
  'how light or dark it feels. Different colours alone do NOT make two themes different.\n' +
  'Reply with JSON and nothing else: ' +
  '{"same_design_recoloured": true|false, "similarity": <0-100>, "reason": "<one short sentence, ' +
  'naming what makes them alike or different>"}';

let inTok = 0, outTok = 0, failures = 0;

async function score([a, b]) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await client.messages.create({
        model: MODEL,
        max_tokens: 400,
        // Thinking stays on (the default) at low effort: it is both cheaper and safer than
        // disabling it, and this question does not need deep reasoning.
        output_config: { effort: 'low' },
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: `Theme A (${a}):` }, imageBlock(thumbs.get(a)),
            { type: 'text', text: `Theme B (${b}):` }, imageBlock(thumbs.get(b)),
            { type: 'text', text: QUESTION },
          ],
        }],
      });
      inTok += res.usage.input_tokens + (res.usage.cache_creation_input_tokens || 0) + (res.usage.cache_read_input_tokens || 0);
      outTok += res.usage.output_tokens;
      const text = res.content.filter(c => c.type === 'text').map(c => c.text).join('');
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) throw new Error(`no JSON in reply: ${text.slice(0, 120)}`);
      const v = JSON.parse(m[0]);
      return { a, b, similarity: Number(v.similarity), sameDesign: !!v.same_design_recoloured, reason: String(v.reason || '').trim() };
    } catch (e) {
      if (attempt === 3) {
        failures++;
        console.error(`🔴 ${a} × ${b}: ${e.message}`);
        return { a, b, similarity: null, sameDesign: null, reason: `not scored: ${e.message}` };
      }
      await new Promise(r => setTimeout(r, 1000 * attempt));
    }
  }
}

const results = [];
let next = 0, done = 0;
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, scored.length) }, async () => {
  while (next < scored.length) {
    const r = await score(scored[next++]);
    results.push(r);
    if (++done % 25 === 0 || done === scored.length) console.log(`  ${done}/${scored.length}`);
  }
}));

// ── report ───────────────────────────────────────────────────────────────────────────────────
const ranked = results
  .filter(r => Number.isFinite(r.similarity))
  .sort((x, y) => y.similarity - x.similarity || (x.a + x.b).localeCompare(y.a + y.b));

const cost = (inTok * PRICE_IN + outTok * PRICE_OUT) / 1e6;
const review = {
  model: MODEL,
  themes: ids.length,
  pairs_total: pairs.length,
  pairs_scored: scored.length,
  pairs_failed: failures,
  // 🔴 the report says out loud what it did NOT look at — a truncated run must not read as a
  //    complete one
  coverage: scored.length === pairs.length ? 'every pair' : `first ${scored.length} of ${pairs.length} pairs (--limit)`,
  thumbnail: `${THUMB_WIDTH}px wide, ≤${THUMB_MAX_HEIGHT}px tall`,
  usage: { input_tokens: inTok, output_tokens: outTok },
  cost_usd: Number(cost.toFixed(4)),
  price_basis: `list price $${PRICE_IN}/$${PRICE_OUT} per million tokens`,
  top: ranked.slice(0, TOP),
  all: ranked,
};
const outPath = path.resolve(arg('--out', path.join(GAL, 'review.json')));
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(review, null, 1));

console.log(`\ntop ${Math.min(TOP, ranked.length)} most similar pairs:`);
ranked.slice(0, TOP).forEach((r, i) => console.log(`  ${String(i + 1).padStart(2)}. ${r.similarity}  ${r.a} × ${r.b} — ${r.reason}`));
console.log(`\ntokens in ${inTok} / out ${outTok} · this round cost $${cost.toFixed(2)} (${review.price_basis})`);
console.log(`wrote ${outPath}`);
if (failures) console.log(`⚠️  ${failures} pair(s) could not be scored and are not in the ranking.`);
