#!/usr/bin/env node
/**
 * block-media.test.js — 图槽 `<img>` 与评分星级只许住在共用那一份里（#1538，照 #1519 `block-class-rules.test.js` 的写法）。
 *
 *   node scripts/block-media.test.js     （由 `npm run test:scripts` 自动发现）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * ── 为什么要有它 ────────────────────────────────────────────────────────────────────────────────
 * 这两样以前各块各写一份（图槽 11 个块、星级 reviews / testimonials 两份），#1538 收进了
 * `src/lib/sections/blockMedia.tsx`（§slotImg / §ratingStars）。没有这一格，下一个新块照样抄一份。
 *
 * ── 它问的是什么 ────────────────────────────────────────────────────────────────────────────────
 * ① 图槽：manifest 的 `slots` 里写着 `imageUrl` 的块（从数据现取，不写死名单），块目录下全部 `*.tsx`（含子目录，
 *    剥掉注释）里的每一个 `<img>`，`src={…}` 那一整段表达式（按括号配平取，不按「`.imageUrl` 紧挨着 `}`」取）
 *    只要读了 `imageUrl` 就红 —— 要画就调 `slotImg`。`|| ''` / `?? ''` / 三元 / 模板字符串 / `?.` 都在内（#1538 r2，QA1 打回）。
 *    🔴 往严的方向兜：`src` 读不出来源的也红（`src={src}` 这种先赋给变量再用的、`{...props}` 里带进来的、没写 src 的）——
 *       看不出它是不是图槽，就当它是。只有两种放行：`src="…"` 写死的字符串，和 `src` 只读 `NOT_SLOT_FIELDS` 里那几个
 *       字段的。今天那一张是 testimonials 的平台 logo（读 `logoUrl`，`review-platforms.js`），它不是图槽。
 *       以后真要在图槽块里画一张不是图槽的图，把它读的字段加进 `NOT_SLOT_FIELDS`，这一格会在 diff 里被看见。
 *    📌 blog 的封面来自站点博客数据、manifest 里没有图槽，整块不在射程；没有图槽的块（header / footer / reviews …）同理。
 *    📌 射程只到 `blocks/`：`src/components/` 里要是出现一张图槽 `<img>`，这一格看不见。
 * ② 星级：所有块的 `*.tsx`（含子目录，剥掉注释）里，以 `star` 开头、后面紧跟引号结束 / `-` / `${` 的字符串或模板字符串
 *    一律红 —— `'star'` `"star-fill"` `` `star-${k}` `` `` `star-fill` `` 都在内（#1538 r2）。要画就调 `ratingStars`。
 *    📌 hero / pricing 的 `★★★★★` 是装饰字符、不读评分（#1538 裁定不收），这一格按构造不管它们。
 * ③ 每条违例点名文件和行号。阳性对照在下面 §对照：往真文件的文本里塞一份本地渲染，各自当场红并点名那个文件。
 */

'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');              // templates/nextjs
const BLOCKS = path.join(ROOT, 'blocks');
const SHARED = path.join(ROOT, 'src', 'lib', 'sections', 'blockMedia.tsx');

let pass = 0; let fail = 0;
const ok = (m) => { pass++; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail++; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };
const check = (cond, m, detail) => (cond ? ok(m) : bad(detail ? `${m} —— ${detail}` : m));

/** 注释换成等长空白（行号不挪）。字符串里的 `//`（地址）不算注释：只认行首或空白 / `{` 之后的 `//`。 */
function stripComments(src) {
  const blank = (s) => s.replace(/[^\n]/g, ' ');
  return src
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[\s{])\/\/[^\n]*/g, (m, lead) => lead + blank(m.slice(lead.length)));
}
const lineOf = (src, i) => src.slice(0, i).split('\n').length;

// 在图槽块里，`<img>` 的 src 只读这些字段的不算图槽（见文件头 ①）。
const NOT_SLOT_FIELDS = ['logoUrl'];
const STAR_RE = /['"`]star(?=['"`]|-|\$\{)/g;

/** 从 `open`（一个 `{`）起按括号配平，跳过字符串 / 模板字符串，返回配对的 `}` 的位置；配不上返回 -1。 */
function closeBrace(code, open) {
  let depth = 0;
  for (let i = open; i < code.length; i++) {
    const c = code[i];
    if (c === '"' || c === "'" || c === '`') {
      for (i++; i < code.length && code[i] !== c; i++) if (code[i] === '\\') i++;
      continue;
    }
    if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  return -1;
}

/** 代码里每一个 `<img` 标签：{ index, src }。src = `{…}` 里的表达式 · `null`（写死的字符串）· `undefined`（没写 src）。 */
function imgTags(code) {
  const out = [];
  for (const m of code.matchAll(/<img\b/g)) {
    let src;
    for (let i = m.index + 4; i < code.length; i++) {
      const c = code[i];
      if (c === '{') {
        const end = closeBrace(code, i);
        if (end < 0) break;
        if (/\bsrc\s*=\s*$/.test(code.slice(m.index, i))) src = code.slice(i + 1, end);
        i = end;
      } else if (c === '"' || c === "'") {
        if (/\bsrc\s*=\s*$/.test(code.slice(m.index, i))) src = null;
        i = code.indexOf(c, i + 1);
        if (i < 0) break;
      } else if (c === '>') break;
    }
    out.push({ index: m.index, src });
  }
  return out;
}

/** 这张 `<img>` 算不算图槽：读了 imageUrl 的算；读不出来源的也算（往严的方向兜）；写死的字符串、只读非图槽字段的不算。 */
function isSlotImg({ src }) {
  if (src === null) return false;
  if (src === undefined) return true;
  if (/\bimageUrl\b/.test(src)) return true;
  return !NOT_SLOT_FIELDS.some((f) => new RegExp(`\\b${f}\\b`).test(src));
}

/** 一个块目录下的违例。files = [{ rel, text }]。 */
function violations(block, files, { imageBlock }) {
  const out = [];
  for (const { rel, text } of files) {
    const code = stripComments(text);
    if (imageBlock) for (const t of imgTags(code).filter(isSlotImg)) out.push(`${rel}:${lineOf(code, t.index)} 图槽 <img> 没走 slotImg`);
    for (const m of code.matchAll(STAR_RE)) out.push(`${rel}:${lineOf(code, m.index)} 星级图标 ${code.slice(m.index).match(/^.[^'"`\n]*['"`]?/)[0]} 没走 ratingStars`);
  }
  return out;
}

function readBlock(block) {
  const dir = path.join(BLOCKS, block);
  const files = fs.readdirSync(dir, { recursive: true }).filter((f) => f.endsWith('.tsx'))
    .map((f) => ({ rel: `blocks/${block}/${f}`, text: fs.readFileSync(path.join(dir, f), 'utf-8') }));
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf-8'));
  return { files, imageBlock: /\bimageUrl\b/.test(JSON.stringify(manifest.slots || {})) };
}

let blocks;
try {
  blocks = fs.readdirSync(BLOCKS).filter((d) => fs.existsSync(path.join(BLOCKS, d, 'manifest.json'))).sort();
} catch (e) { die(`读不到 ${BLOCKS}: ${e.message}`); }
if (!blocks.length) die('blocks/ 下一个块都没读到 —— 分母为 0');

console.log('\n① ② 全部块现读');
const read = Object.fromEntries(blocks.map((b) => [b, readBlock(b)]));
const imageBlocks = blocks.filter((b) => read[b].imageBlock);
if (!imageBlocks.length) die('manifest 里一个带 imageUrl 的图槽都没读到 —— 尺子坏了');
console.log(`  图槽块 ${imageBlocks.length} 个：${imageBlocks.join(' · ')}`);
const all = blocks.flatMap((b) => violations(b, read[b].files, read[b]));
check(all.length === 0, `${blocks.length} 个块里没有本地的图槽 <img> / 星级渲染`, all.join(' | '));

// 共用那一份真的在画（否则上面的 0 也可能是「谁都不画了」）。
const shared = fs.readFileSync(SHARED, 'utf-8');
const sharedImgs = imgTags(stripComments(shared));
check(sharedImgs.length === 1 && /\bimageUrl\b/.test(sharedImgs[0].src || '') && /['"]star-fill['"]/.test(shared) && /['"]star['"]/.test(shared),
  'blockMedia.tsx 里有那张图槽 <img> 和两种星（尺子在共用件上读得到东西）', `<img> ${sharedImgs.length} 张`);
const callers = (fn) => blocks.filter((b) => read[b].files.some((f) => new RegExp(`\\b${fn}\\(`).test(stripComments(f.text))));
check(callers('slotImg').join() === imageBlocks.join(), `调 slotImg 的块 = 图槽块（${callers('slotImg').length} 个）`,
  `调的：${callers('slotImg').join(' · ')}`);
check(callers('ratingStars').join() === 'reviews,testimonials', `调 ratingStars 的块 = reviews · testimonials`, callers('ratingStars').join(' · '));

console.log('\n③ 对照：往真文件里塞一份本地渲染，必须当场红并点名那个文件');
const inject = (block, needle) => {
  const files = read[block].files.map((f) => (f.rel.endsWith('/Section.tsx') ? { ...f, text: f.text + needle } : f));
  return violations(block, files, read[block]);
};
const imgHit = inject(imageBlocks[0], '\nconst x = <img className="x" src={img.imageUrl} alt="" />;\n');
check(imgHit.length === 1 && imgHit[0].startsWith(`blocks/${imageBlocks[0]}/Section.tsx:`), `${imageBlocks[0]} 塞一张本地图槽 <img> ⟹ 红并点名`, imgHit.join(' | '));
const imgMulti = inject(imageBlocks[0], '\nconst x = (\n  <img\n    className="x"\n    src={it.image!.imageUrl}\n  />\n);\n');
check(imgMulti.length === 1, '属性跨行写的那种也认得', imgMulti.join(' | '));
const starHit = inject('reviews', '\nconst s = <InlineIcon name="star-fill" icons={iconTable} />;\n');
check(starHit.length === 1 && starHit[0].startsWith('blocks/reviews/Section.tsx:'), 'reviews 塞一份本地星级 ⟹ 红并点名', starHit.join(' | '));
const starTern = inject('testimonials', "\nconst s = icon(full ? 'star-fill' : 'star');\n");
check(starTern.length === 2 && starTern.every((v) => v.startsWith('blocks/testimonials/Section.tsx:')), 'testimonials 塞 fill / empty 两种 ⟹ 两条都点名', starTern.join(' | '));
// r2（QA1 打回）：`.imageUrl` 后面还有东西、星名写成模板字符串的，以前都从谓词底下走过去。逐条塞、逐条要红。
for (const [why, needle] of [
  ['`|| ""` 兜底', '<img src={d.image.imageUrl || ""} alt="" />'],
  ['`?? ""` 兜底', '<img src={d.image.imageUrl ?? ""} alt="" />'],
  ['三元', '<img src={ok ? d.image.imageUrl : ""} alt="" />'],
  ['三元里先判再读', '<img src={m.photo ? m.photo.imageUrl : ""} alt="" />'],
  ['`?.`', '<img src={img?.imageUrl} alt="" />'],
  ['模板字符串', '<img src={`${d.image.imageUrl}?w=800`} alt="" />'],
  ['先赋给变量再用（看不出来源 ⟹ 当它是图槽）', '<img src={src} alt="" />'],
  ['没写 src、从展开里带进来', '<img {...d.image} alt="" />'],
]) {
  const hit = inject(imageBlocks[0], `\nconst x = ${needle};\n`);
  check(hit.length === 1 && hit[0].startsWith(`blocks/${imageBlocks[0]}/Section.tsx:`), `图槽 ${why} ⟹ 红并点名`, hit.join(' | ') || '没红');
}
for (const [why, needle] of [
  ['模板字符串拼星名', 'icon(`star-${k}`)'],
  ['JSX 里模板字符串', '<InlineIcon name={`star-${kind}`} icons={iconTable} />'],
  ['反引号字面量', 'const x = `star-fill`'],
]) {
  const hit = inject('reviews', `\nconst s = ${needle};\n`);
  check(hit.length === 1 && hit[0].startsWith('blocks/reviews/Section.tsx:'), `星级 ${why} ⟹ 红并点名`, hit.join(' | ') || '没红');
}
// 反过来：该放行的照样放行 —— 只读非图槽字段的、写死字符串的、名字只是以 star 起头的。
check(inject('testimonials', '\nconst x = <img src={l.logoUrl} alt={p.source} loading="lazy" />;\n').length === 0, '图槽块里只读 logoUrl 的 <img>（平台 logo）⟹ 放行');
check(inject(imageBlocks[0], '\nconst x = <img src="/placeholder.png" alt="" />;\n').length === 0, '图槽块里写死字符串的 <img> ⟹ 放行');
check(inject('reviews', "\nconst x = stars(p.rating, 'stars') && 'startsWith';\n").length === 0, "'stars' / 'startsWith' 这种只是以 star 起头的 ⟹ 放行");
check(inject(imageBlocks[0], '\n// <img src={img.imageUrl} />  {/* <InlineIcon name="star-fill" /> */}\n').length === 0, '只出现在注释里 ⟹ 不算（注释剥得掉）');
const notImageBlock = blocks.find((b) => !read[b].imageBlock && b === 'reviews');
if (!notImageBlock) die('reviews 不在 blocks/ 里或者有了图槽 —— 下面那格的前提变了，回来改这一格');
check(inject(notImageBlock, '\nconst x = <img src={p.imageUrl} />;\n').length === 0, '没有图槽的块（reviews）读 imageUrl 的 <img> 不归这一格管');

console.log(`\n${fail ? '🔴' : '✅'} block-media: ${pass} 过 / ${fail} 不过`);
process.exit(fail ? 1 : 0);
