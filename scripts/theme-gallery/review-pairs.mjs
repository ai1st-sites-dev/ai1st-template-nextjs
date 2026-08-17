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
import shotFiles from './shot-files.js';

const { SHOT_SUFFIXES } = shotFiles;

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
// 🔴 #1061 —— 判据是「这张图旁边有没有 `<id>.json`」，不是文件名黑名单。
//
//   shoot.mjs 每套主题写**一份** `<id>.json`（那些读数），而图有好几张：`<id>.png` 是首页，
//   `<id>-about.png` / `<id>-allblocks.png` / `<id>-header.png` 都是同一套的别的页。所以
//   「有同名 JSON」正好就是「这是一套主题的首页图」。
//
//   原来写的是 `!f.endsWith('-about.png')` —— 一条黑名单，每加一张图就漏一次：
//   `--header-closeup` 写的 `<id>-header.png` 今天就在漏（它被当成一套独立的主题参与两两比对，
//   30 套变 60 套、435 对变 1770 对，花的是真钱）；#1061 加的 `-allblocks.png` 会是第三次。
//   换成上面那个判据之后，以后再加页面不用回来改这里。
//
// 📌 #1061 r2 —— 这条判据的静默方向是「有图但没有 json」：`<id>.json` 是 shoot.mjs 最后才写的，
//   所以一套中途崩掉的主题，首页图在盘上、却配不上 json ⟹ 它不参与两两比对，而这一节看起来一切正常
//   （旧的文件名黑名单会把它带上 —— 带上更糟，那是拿一张来路不明的图去比）。判据不改，改成**点名**：
//   掉出比对的那几套在下面打印出来，不让它无声消失。QA3 在 r1 上把这一条标成不阻断。
const shots = new Map();
const orphans = new Set();
for (const f of fs.readdirSync(SHOTS)) {
  if (!f.endsWith('.png')) continue;
  const id = f.replace(/\.png$/, '');
  if (fs.existsSync(path.join(SHOTS, `${id}.json`))) { shots.set(id, path.join(SHOTS, f)); continue; }
  // 同一套的别的页（-about / -allblocks / -header）本来就配不上 json，那是正常的，别报它们。
  orphans.add(SHOT_SUFFIXES.reduce((b, s) => (s && b.endsWith(s) ? b.slice(0, -s.length) : b), id));
}
for (const id of [...orphans]) if (shots.has(id)) orphans.delete(id);
if (orphans.size) {
  console.log(`⚠️  ${orphans.size} 套只有图、没有 <id>.json，没参与比对：${[...orphans].sort().join(' ')}`);
  console.log('    （那一轮多半中途崩了 —— json 是 shoot.mjs 最后写的。重拍它们再跑。）');
}
if (!shots.size) {
  console.error(`${SHOTS} 里没有一张图配得上 <id>.json —— 那是 shoot.mjs 给每套主题写的读数文件。`);
  console.error('这个目录不是 shoot-themes.sh 出的，或者那一轮没跑完。什么都没比对。');
  process.exit(2);
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
// 🔴 #971 item 15 — this step shells out to `python3` with `PIL` (Pillow), and neither is declared
// anywhere in the repo: not in package.json (they are not npm packages), not in the README. On a
// machine without them the failure arrives as a raw execFileSync stack trace from inside the loop
// below, AFTER the pair list is built — which reads as "the review is broken", not "install two
// things". Ask once, up front, and say what to do.
try {
  execFileSync('python3', ['-c', 'import PIL'], { stdio: 'pipe' });
} catch {
  console.error('🔴 this step needs python3 with Pillow, and one of them is missing.');
  console.error('   It resizes each screenshot before sending it — thumbnail size is the cost lever (see the header).');
  console.error('   Install:  apt-get install -y python3 python3-pil     (or: python3 -m pip install Pillow)');
  process.exit(2);
}
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
  // 🔴 #971 item 14 — AND WHICH PICTURE OF EACH THEME. This only ever compares the home-page shot;
  //    every other page's shot is filtered out at the readdir above. Saying "every pair" alone reads
  //    as "the whole gallery was looked at", and the person acting on this list has no way to tell
  //    that the sub-pages never entered it — two themes could differ only on /about and this would
  //    still call them a near-duplicate.
  //    #1061 — 而 sub-page 现在不止一张（-about / -allblocks / -header），所以这句话也改成说全。
  coverage: (scored.length === pairs.length ? 'every pair' : `first ${scored.length} of ${pairs.length} pairs (--limit)`)
    + ', home-page shot only (the -about / -allblocks / -header shots of the same theme are not compared)',
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
// 🔴 #971 item 16 — every pair failing must not exit 0. This is a hint and not a gate (see the header),
// so a few unscored pairs stay rc=0 and are disclosed in the line above. But when NOT ONE pair came
// back, "the review ran and found nothing similar" and "the review did not run" produce the same
// artifact: a review.json whose `top` is empty. Only the exit code can still tell them apart, and a
// caller that chains on `&&` is the one who needs to know.
if (failures > 0 && failures === scored.length) {
  console.error(`🔴 all ${scored.length} pair(s) failed to score — this is NOT "nothing looks alike", it is "the review did not run".`);
  process.exit(1);
}
