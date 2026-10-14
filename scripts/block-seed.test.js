#!/usr/bin/env node
/**
 * block-seed.test.js — #1767：拖下任何一个块，默认布局下画出来的位置都不空 —— 按槽位的**种类**逐格查拖下那一刻的数据。
 *   ① 归类：每块每一格（含对象里的子槽、列表项里的字段）都从 manifest 认得出种类（`editor-schema.js` §seedCellsOf）；
 *      认不出（`unknown`）算红，不默默跳过。另查尺子没瞎：全部 manifest 里每一种都至少认出一格。
 *   ② 豁免名单两头查（§SEED_EXEMPT）：名单里的路径在归类里找得到、下面至少有一格属于要播的那几类、拖下时真的没播。
 *   ③ 验收 1：逐块 `seedProps` 之后，按钮 / 一列按钮 / 数字 / 图标 / `[string]` 列表 / 成排的小图每一格都有值
 *      （按钮有字有链接、数字非空、图标非空且 Bootstrap Icons 里有、列表 3 条、成排的图 3 项）；路过的列表是空的也算红
 *      （那样「每一格都有值」是空集上恒真）。同一块里一列数字各不相同。
 *   ④ 验收 2：每颗播出来的按钮的 `href` 是电话 / 邮箱引用或站内路径（`/` 开头），不是空、不是 `#` —— 四种站点资料各跑一遍。
 *   ⑤ 整体评分：站里有真实评分就用真的（hero / pricing 的 `proof.rating`、testimonials 的 `summary`），一条一条的评价不用；
 *      contact 的 `items` 按站里有的资料各播一行，值不复制进块。
 *   ⑥ 两份副本相等：示例数 / 示例图标在 `editor-schema.js` 和 `block-placeholders.js`（浏览器包）各一份。
 *   ⑧ 画得出、存得下：播出来的每一格经 `editor-convert.js` §dataFromProps（画布渲染、存盘都用它）一格不丢，整页过 `block-manifest.js` §validateSite。
 *   ⑦ 点得到（验收 4）：同一块里同一个位置的字各不相同 —— 一字不差的两项，画布上点它会被判「对上不止一条」。
 *
 *   node scripts/block-seed.test.js     （由 `npm run test:scripts` 自动发现）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 📌 量「今天 main 上红在哪」：`BLOCK_SEED_IMPL=<另一棵树的 templates/nextjs/scripts/lib>` —— ③ 用那棵树的 `editor-schema.js` §editorSchema /
 *    `block-placeholders.js` §seedProps 播种（归类、豁免名单照旧用这棵树的）。只给交付留言取红格清单用，CI 不设它。
 */

'use strict';

let pass = 0; let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const check = (cond, m, detail) => (cond ? ok(m) : bad(detail === undefined ? m : `${m} —— ${JSON.stringify(detail)}`));
function die(msg) { console.log(`💥 ${msg}`); process.exit(2); }
// 跑到一半抛出来（比如取红格清单时被测实现缺一格、缺一个函数）⟹ 跑不起来，不是「如预期地红」：rc=2，不是 node 默认的 1。
process.on('uncaughtException', (e) => die(`跑到一半抛出：${e && e.stack ? e.stack : e}`));

const fs = require('fs');
const path = require('path');

let schemaLib; let bp; let impl; let implSchema; let blockShapeCatalog;
try {
  schemaLib = require('./lib/editor-schema.js');
  bp = require('./lib/block-placeholders.js');
  ({ blockShapeCatalog } = require('./lib/block-catalog.js'));
  const dir = process.env.BLOCK_SEED_IMPL ? path.resolve(process.env.BLOCK_SEED_IMPL) : path.join(__dirname, 'lib');
  impl = require(path.join(dir, 'block-placeholders.js'));
  implSchema = require(path.join(dir, 'editor-schema.js')).editorSchema();
  if (process.env.BLOCK_SEED_IMPL) console.log(`(③ 用 ${dir} 的 editorSchema / seedProps 播种)`);
} catch (e) {
  die(`加载不了被测模块: ${e.message}`);
}
const manifests = blockShapeCatalog().manifests;
const blocks = [...manifests].filter(([, m]) => m && m.region !== true);
if (blocks.length < 10) die(`只读到 ${blocks.length} 个页面块 —— 被测对象不在`);
const implByType = new Map(implSchema.components.map((c) => [c.type, c]));
const ICON_DIR = path.join(__dirname, '..', 'node_modules', 'bootstrap-icons', 'icons');
if (!fs.existsSync(ICON_DIR)) die(`没有 ${ICON_DIR}（模板依赖没装）`);
const { SEED_KINDS, SEED_EXEMPT, SEED_EXCLUDED_BLOCKS, seedCellsOf, seedExemptOf } = schemaLib;

const CTX = {
  phone: true, email: true, contactHref: '/contact', blogHref: '/blog', rating: null,
  facts: { phone: '+1 416 555 0100', email: 'hi@example.com', address: '1 Main St, Toronto', hours: 'Mon–Fri 9:00–17:00' },
};

// ══ ① 归类 ══════════════════════════════════════════════════════════════════════════════════════════
console.log('① 每一格都认得出种类（认不出算红）');
const cellsByType = new Map();
const seenKinds = new Set();
for (const [type, m] of blocks) {
  const cells = seedCellsOf(m, type);
  cellsByType.set(type, cells);
  cells.forEach((c) => seenKinds.add(c.kind));
  const unknown = cells.filter((c) => c.kind === 'unknown').map((c) => c.id);
  check(unknown.length === 0, `${type}：${cells.length} 格，没有认不出的`, unknown);
}
const wantKinds = [...SEED_KINDS, 'image', 'text', 'link', 'setting', 'list', 'object'];
check(wantKinds.every((k) => seenKinds.has(k)), `尺子没瞎：全部 manifest 里 ${wantKinds.length} 种各认出至少一格`, wantKinds.filter((k) => !seenKinds.has(k)));
// 反向对照：认数字先认声明了的标记 —— 一个 shape 里写了 `N–M`、键名不在字段名清单里的槽也认得出（拿一份假 manifest 喂它）。
const fake = { slots: { x: { kind: 'list', required: true, shape: '[{score: 1–10, title, go: {label, href}, pic: {imageUrl, alt}, tag: "a" | "b", odd: <thing>}]' } } };
const fk = Object.fromEntries(seedCellsOf(fake, 'f').map((c) => [c.id, c.kind]));
check(fk['f.x.score'] === 'number' && fk['f.x.go'] === 'button' && fk['f.x.pic'] === 'image' && fk['f.x.tag'] === 'setting' && fk['f.x.title'] === 'text',
  '假 manifest：`N–M` 认成数字、`{label, href}` 认成按钮、`{imageUrl, alt}` 认成一张图、引号枚举认成设置', fk);
check(fk['f.x.odd'] === 'unknown', '假 manifest：没见过的写法（`<thing>`）认成 unknown（会让 ① 红）', fk['f.x.odd']);

// ══ ② 豁免名单两头查 ═════════════════════════════════════════════════════════════════════════════
console.log('② 豁免名单（§SEED_EXEMPT）两头查');
const allCells = [...cellsByType.values()].flat();
for (const [id, why] of Object.entries(SEED_EXEMPT)) {
  const covered = allCells.filter((c) => seedExemptOf(c.id) === id);
  check(typeof why === 'string' && why.trim().length >= 10, `${id}：带理由`, why);
  check(covered.some((c) => c.id === id), `${id}：在 manifest 里找得到`, covered.map((c) => c.id));
  check(covered.some((c) => SEED_KINDS.includes(c.kind)), `${id}：下面至少一格属于要播的那几类（${SEED_KINDS.join(' / ')}）`, covered.map((c) => `${c.id}:${c.kind}`));
}

// 一格在数据里展开成每一个具体位置：`[{ path, value }]`；路过的列表空着 ⟹ 回 `{ emptyList: 路径 }`。
function expand(props, steps) {
  const out = [];
  const go = (v, at, pathSoFar) => {
    const step = steps[at];
    const holder = v !== null && typeof v === 'object' ? v[step.key] : undefined;
    const here = [...pathSoFar, step.key];
    if (at === steps.length - 1) { out.push({ path: here, value: holder }); return; }
    if (step.list) {
      if (!Array.isArray(holder) || !holder.length) { out.push({ path: here, emptyList: true }); return; }
      holder.forEach((item, j) => go(item, at + 1, [...here, j]));
      return;
    }
    go(holder, at + 1, here);
  };
  go(props, 0, []);
  return out;
}
const filled = (v) => !(v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0));

for (const [id] of Object.entries(SEED_EXEMPT)) {
  const type = id.split('.')[0];
  const c = implByType.get(type);
  if (!c) { bad(`${id}：editorSchema 里没有 ${type}`); continue; }
  const props = impl.seedProps(c, 'en', CTX);
  const seeded = allCells.filter((x) => seedExemptOf(x.id) === id && SEED_KINDS.includes(x.kind))
    .flatMap((x) => expand(props, x.steps).filter((e) => !e.emptyList && filled(e.value)).map((e) => e.path.join('.')));
  check(seeded.length === 0, `${id}：拖下时真的没播（名单里有、其实播了 ⟹ 红）`, seeded);
}

// ══ ③ 验收 1：要播的那几类每一格都有值 ═══════════════════════════════════════════════════════════════
console.log('③ 验收 1：拖下那一刻，按钮 / 数字 / 图标 / [string] 列表 / 成排的小图每一格都有值');
const iconExists = (n) => typeof n === 'string' && /^[a-z0-9-]+$/.test(n) && fs.existsSync(path.join(ICON_DIR, `${n}.svg`));
const isButton = (b) => b !== null && typeof b === 'object' && typeof b.label === 'string' && b.label.trim() !== '' && filled(b.href);
const reds = [];
for (const [type, m] of blocks) {
  if (Object.prototype.hasOwnProperty.call(SEED_EXCLUDED_BLOCKS, type)) { console.log(`  ·  ${type}：归 ${SEED_EXCLUDED_BLOCKS[type]}，不查`); continue; }
  const c = implByType.get(type);
  if (!c) { bad(`${type}：editorSchema 里没有这个块`); continue; }
  const props = impl.seedProps(c, 'en', CTX);
  const targets = cellsByType.get(type).filter((x) => SEED_KINDS.includes(x.kind) && !seedExemptOf(x.id));
  for (const t of targets) {
    const spec = m.slots[t.steps[0].key] || {};
    const problems = [];
    const at = expand(props, t.steps);
    for (const e of at) {
      const where = e.path.join('.');
      if (e.emptyList) { problems.push(`${where} 是空列表`); continue; }
      const v = e.value;
      if (t.kind === 'buttons') {
        if (!Array.isArray(v) || !v.length) problems.push(`${where} 没有按钮`);
        else v.forEach((b, j) => { if (!isButton(b)) problems.push(`${where}.${j} 不是有字有链接的按钮`); });
      } else if (t.kind === 'button') {
        if (!isButton(v)) problems.push(`${where} 不是有字有链接的按钮`);
      } else if (t.kind === 'number') {
        if (!filled(v) || (typeof v !== 'string' && typeof v !== 'number')) problems.push(`${where} 没有数字`);
      } else if (t.kind === 'icon') {
        if (!iconExists(v)) problems.push(`${where} 没有图标（或 Bootstrap Icons 里没有「${v}」）`);
      } else if (t.kind === 'strings') {
        if (!Array.isArray(v) || v.length !== 3 || !v.every((x) => typeof x === 'string' && x.trim())) problems.push(`${where} 不是 3 条字`);
      } else if (t.kind === 'row') {
        const max = t.steps.length === 1 ? (Number.isInteger(spec.maxItems) ? spec.maxItems : Infinity) : ((spec.listMax || {})[t.steps[t.steps.length - 1].key] ?? Infinity);
        const want = Math.min(3, max);
        if (!Array.isArray(v) || v.length !== want || !v.every((x) => x !== null && typeof x === 'object')) problems.push(`${where} 不是 ${want} 项`);
      }
    }
    // 同一块里一列数字各不相同（「三条不要一样」）：列表里的数字格。
    if (t.kind === 'number' && t.steps.some((s) => s.list)) {
      const vals = at.filter((e) => !e.emptyList).map((e) => String(e.value));
      if (vals.length > 1 && new Set(vals).size !== vals.length) problems.push(`几条的数一样：${vals.join(' / ')}`);
    }
    if (problems.length) reds.push(`${t.id}（${t.kind}）`);
    check(problems.length === 0, `${t.id}（${t.kind}）`, problems);
  }
}
if (reds.length) console.log(`\n  红格清单（${reds.length}）：${reds.join(' · ')}\n`);

// ══ ④ 验收 2：按钮链接不是死的 ════════════════════════════════════════════════════════════════════
console.log('④ 验收 2：每颗播出来的按钮 href 是电话 / 邮箱引用或站内路径，不是空、不是 #');
const buttonsIn = (v, out = []) => {
  if (Array.isArray(v)) v.forEach((x) => buttonsIn(x, out));
  else if (v && typeof v === 'object') {
    if (typeof v.label === 'string' && 'href' in v) out.push(v);
    Object.values(v).forEach((x) => buttonsIn(x, out));
  }
  return out;
};
const liveHref = (h) => (h && typeof h === 'object' ? ['phone', 'email'].includes(h.source) : typeof h === 'string' && /^\/[^#]*$/.test(h));
const CTXS = {
  '有电话 + 联系页 + 博客': CTX,
  '没电话、有邮箱 + 联系页': { email: true, contactHref: '/contact', facts: {} },
  '什么都没有（没联系页 ⟹ 首页）': { contactHref: '/', facts: {} },
  '不给 ctx': undefined,
};
for (const [name, ctx] of Object.entries(CTXS)) {
  const dead = [];
  let n = 0;
  for (const c of implSchema.components) {
    if (Object.prototype.hasOwnProperty.call(SEED_EXCLUDED_BLOCKS, c.type)) continue;
    for (const b of buttonsIn(impl.seedProps(c, 'en', ctx))) {
      n += 1;
      if (!liveHref(b.href)) dead.push(`${c.type}: ${b.label} → ${JSON.stringify(b.href)}`);
    }
  }
  check(n > 0 && dead.length === 0, `${name}：${n} 颗按钮，没有空链接 / #`, dead);
}
{
  const hero = implByType.get('hero');
  const h1 = impl.seedProps(hero, 'en', CTX).ctas || [];
  check(h1.length === 2 && h1[0].style === 'solid' && h1[1].style === 'outline', 'hero 播两颗：一颗实心、一颗描边', h1);
  check(h1.length === 2 && JSON.stringify(h1[0].href) === '{"source":"phone"}' && h1[1].href === '/contact', '有电话：第一颗链电话（#1506 的引用），第二颗链联系页', h1.map((b) => b.href));
  const h2 = impl.seedProps(hero, 'en', CTXS['没电话、有邮箱 + 联系页']).ctas || [];
  check(h2[0] && h2[0].href === '/contact', '没电话：第一颗链联系页', h2.map((b) => b.href));
  const blog = impl.seedProps(implByType.get('blog'), 'en', CTX).introCta || {};
  check(blog.href === '/blog', 'blog 的按钮链博客列表（站里有文章时）', blog);
  const blog2 = impl.seedProps(implByType.get('blog'), 'en', { contactHref: '/contact' }).introCta || {};
  check(liveHref(blog2.href) && blog2.href !== '/blog', '站里没有文章 ⟹ blog 的按钮不链 /blog（那是死链，发布前会被拦，#1553）', blog2);
}

// ══ ⑤ 整体评分 / contact ══════════════════════════════════════════════════════════════════════════
console.log('⑤ 真实评分 / contact 的行');
{
  const real = { ...CTX, rating: { rating: 4.7, count: 212 } };
  const hero = impl.seedProps(implByType.get('hero'), 'en', real);
  check(hero.proof && hero.proof.rating === 4.7, '有真实评分：hero 的 proof.rating 用真的', hero.proof);
  const t = impl.seedProps(implByType.get('testimonials'), 'en', real);
  check(Array.isArray(t.summary) && t.summary.length === 1 && t.summary[0].rating === 4.7 && t.summary[0].count === 212, '有真实评分：testimonials 的 summary 用真的（分数 + 条数）', t.summary);
  check(Array.isArray(t.items) && t.items.every((it) => it.rating !== 4.7), '一条一条的评价不用整体评分', (t.items || []).map((it) => it.rating));
  // 整体评分只认来自 Google 的（编辑器 §seedContextFor 用 §realGoogleRating 算 ctx.rating，同 #1766）：summary 那一行写着 Google。
  const seoOf = (r) => ({ defaultLocale: 'en', seoByLocale: { en: { schema: { aggregateRating: r } } } });
  // 取不到第一行（红臂里被测实现不播 summary）按红算，不抛 —— 抛了后面 contact 那几格就跑不到（QA1 r3）。
  const first = (a) => (Array.isArray(a) && a[0] && typeof a[0] === 'object' ? a[0] : null);
  const googleOf = (r) => (typeof impl.realGoogleRating === 'function' ? impl.realGoogleRating(seoOf(r), 'en') : undefined);
  const tY = impl.seedProps(implByType.get('testimonials'), 'en', { ...CTX, rating: googleOf({ ratingValue: 4.4, reviewCount: 37, source: 'yelp' }) });
  const y0 = first(tY.summary);
  check(y0 !== null && y0.rating !== 4.4 && y0.count !== 37, '站里的真实评分来自 Yelp ⟹ summary（写着 Google）用示例数，不顶上去', tY.summary);
  const tG = impl.seedProps(implByType.get('testimonials'), 'en', { ...CTX, rating: googleOf({ ratingValue: 4.4, reviewCount: 37, source: 'google' }) });
  const g0 = first(tG.summary);
  check(g0 !== null && g0.rating === 4.4 && g0.count === 37, '来自 Google ⟹ summary 用真的', tG.summary);
  const t0 = impl.seedProps(implByType.get('testimonials'), 'en', CTX);
  const demo = manifests.get('testimonials').slots.summary.demo;
  check(JSON.stringify(t0.summary) === JSON.stringify(demo), '没有真实评分：summary 照 manifest 的 demo', { got: t0.summary, demo });
  const p = impl.seedProps(implByType.get('pricing'), 'en', CTX);
  check(p.proof && typeof p.proof.rating === 'number' && p.proof.rating > 0 && p.proof.rating <= 5, '没有真实评分：proof.rating 是一个 0–5 之间的示例数（不是 0）', p.proof);
  const rev = (manifests.get('testimonials').slots.items.ranges || {}).rating;
  check(Array.isArray(t0.items) && t0.items.length > 0 && t0.items.every((it) => typeof it.rating === 'number' && it.rating > rev[0]), `一条一条的评价不贴下界 ${rev[0]}`, (t0.items || []).map((it) => it.rating));

  const contact = implByType.get('contact');
  const ci = impl.seedProps(contact, 'en', CTX).items;
  check(Array.isArray(ci) && ci.map((x) => x.kind).join() === 'phone,email,address,hours', 'contact：站里有电话 / 邮箱 / 地址 / 营业时间 ⟹ 各播一行', ci);
  check(Array.isArray(ci) && ci.length > 0 && ci.every((x) => Object.keys(x).sort().join() === 'kind,title' && x.title.trim()), 'contact：每行只有 kind + 标题，值不复制进块', ci);
  const ci2 = impl.seedProps(contact, 'en', { facts: { phone: '', email: 'a@b.co', address: '', hours: '' } }).items;
  check(Array.isArray(ci2) && ci2.map((x) => x.kind).join() === 'email', 'contact：站里只有邮箱 ⟹ 只播邮箱那一行', ci2);
}

// ══ ⑦ 点得到：同一块里同一个位置的字各不相同 ══════════════════════════════════════════════════════════
// 画布上点一段字，T6 的点击层（`inline-edit.js` §resolveInlineSlot）按**内容**找回是哪一项；两项一字不差 ⟹ 判「对上不止一条」不让就地改
// （验收 4「看得见、点得到」）。所以每一段画布上的字（`editor-schema.js` §inlineSlotsOf 的路径，`plans.cta.label`、`plans.features`）在播出来的各项里不许重复。
// 四臂都跑（QA3 r2 量到：只跑有电话那一臂时，没电话没邮箱的站 hero / cta 播出两颗一字不差的「Contact us」，这一格照样绿）。
console.log('⑦ 点得到：同一块里同一个位置的字各不相同（不会被判「对上不止一条」）');
for (const [arm, ctx] of Object.entries(CTXS)) for (const c of implSchema.components) {
  if (Object.prototype.hasOwnProperty.call(SEED_EXCLUDED_BLOCKS, c.type)) continue;
  const props = impl.seedProps(c, 'en', ctx);
  const dup = [];
  for (const cell of c.inline || []) {
    if (cell.image) continue;
    const vals = [];
    const go = (v, segs) => {
      if (!segs.length) { if (typeof v === 'string') vals.push(v); else if (Array.isArray(v)) v.forEach((x) => typeof x === 'string' && vals.push(x)); return; }
      if (Array.isArray(v)) { v.forEach((x) => go(x, segs)); return; }
      if (v && typeof v === 'object') go(v[segs[0]], segs.slice(1));
    };
    go(props, cell.path.split('.'));
    if (vals.length > 1 && new Set(vals).size !== vals.length) dup.push(`${cell.path}: ${vals.join(' / ')}`);
  }
  check(dup.length === 0, `[${arm}] ${c.type}：画布上同一个位置的字各不相同`, dup);
}

// ══ ⑧ 画得出、存得下：播出来的每一格经编辑器那一道（`editor-convert.js` §dataFromProps：画布渲染、存盘都用它）一格不丢，整页过站里的校验 ══════
// hero / pricing 的 `proof.rating` 原来没有编辑格，§dataFromProps 只带对象字段里有格子的子键 ⟹ 播了也画不出、存不下（本票给它补了 editLabel）。
console.log('⑧ 播出来的每一格画得出、存得下（dataFromProps 不丢格，validateSite 不拦）');
if (!process.env.BLOCK_SEED_IMPL) {
  const convert = require('./lib/editor-convert.js');
  const { validateSite } = require('./lib/block-manifest.js');
  const leaves = (v, p = '', o = new Map()) => {
    if (v && typeof v === 'object') { for (const [k, x] of Object.entries(v)) leaves(x, p ? `${p}.${k}` : k, o); } else if (v !== undefined) o.set(p, v);
    return o;
  };
  const page = [];
  for (const c of implSchema.components) {
    if (Object.prototype.hasOwnProperty.call(SEED_EXCLUDED_BLOCKS, c.type)) continue;
    const props = impl.seedProps(c, 'en', { ...CTX, rating: { rating: 4.7, count: 212 } });
    const data = convert.dataFromProps(c, {}, props);
    const kept = leaves(data);
    const lost = [...leaves(props)].filter(([k]) => !kept.has(k)).map(([k]) => k);
    check(lost.length === 0, `${c.type}：dataFromProps 之后一格不丢`, lost);
    page.push({ id: `b${page.length}`, type: c.type, data });
  }
  const v = validateSite({ pages: [{ slug: 'home', blocks: page }], scope: 'edit' });
  check(v.problems.length === 0, `一页放下 ${page.length} 种块（拖下时的数据）：validateSite 0 条问题`, v.problems);
}

// ══ ⑥ 两份副本相等 ═════════════════════════════════════════════════════════════════════════════════
console.log('⑥ 示例数 / 示例图标的两份副本相等，示例图标都在 Bootstrap Icons 里');
check(JSON.stringify(schemaLib.NUMBER_EXAMPLES) === JSON.stringify(bp.NUMBER_EXAMPLES), 'NUMBER_EXAMPLES：editor-schema.js == block-placeholders.js');
check(JSON.stringify(schemaLib.SEED_ICONS) === JSON.stringify(bp.SEED_ICONS), 'SEED_ICONS：editor-schema.js == block-placeholders.js');
check(bp.SEED_ICONS.every(iconExists), `示例图标 ${bp.SEED_ICONS.length} 个都有 svg`, bp.SEED_ICONS.filter((n) => !iconExists(n)));
check(new Set(bp.SEED_ICONS.slice(0, 3)).size === 3, '前三个各不相同（一块里三条的图标不一样）');

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} 过 · ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
