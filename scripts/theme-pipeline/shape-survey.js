#!/usr/bin/env node
/**
 * shape-survey.js — 生成器里那十张画法候选表，跟 `blocks/*.json` 的形态清单对一次账（#1340）。
 *
 *   node scripts/theme-pipeline/shape-survey.js                  普查：候选对 N = 已在库 X + 待迁 Y
 *   node scripts/theme-pipeline/shape-survey.js --cut <块> <形态>  把那一对的几何按 shapes.css 的写法打出来
 *   node scripts/theme-pipeline/shape-survey.js --check           拿同一把刀重剪盘上每一对，跟 shapes.css 比
 *
 * 退出码：0 正常 · 2 跑不起来（**不许当成 0**）。`--check` 有对不上的也是 0 —— 它是取读数的工具，
 * 不是闸：盘上有几对是人手调过的（`hero/text-center` 的 `[data-has-imageUrl]` 拆分就是一处，
 * 理由写在 `public/shapes.css` 那一段里），把它判成红会逼下一个人去把手调的那处改回机器的样子。
 *
 * ══ 尺子是「(块, 形态) 对」，不是形态名 ══════════════════════════════════════════════════════
 * 形态名不唯一：`three-up` 在九个块上都有，`two-up` 在十三个块上都有。问的是「`process-steps` 有没有
 * `three-up`」，不是「有没有哪个块有 `three-up`」—— 按名字量，#1340 立票时有 7 项待迁会被读成
 * 「已经有了」（PM 2026-09-15 裁定 ②）。
 *
 * ══ 哪张表对哪几个块也不手抄 ══════════════════════════════════════════════════════════════════
 * `sheet-recipes.js` 的 `LOOK_FAMILIES` 就是那份注册表。卡片那一族服务 `features-grid` 和
 * `card-group` 两个块，所以它 4 个名字是 8 对；表单那一族只服务 `contact-form`（`quote-form` 的
 * `main-aside` 和 `newsletter-signup` 的 `form-side` 不在那张表里，是另一回事）。
 *
 * ══ `content-split` 的名字带节律后缀 —— 名字要写全，不许按前缀匹配 ══════════════════════════════
 * 它的几何由「图在哪」加「隔一段翻不翻面」两维决定，而形态名只有一个 ⟹ 盘上写成
 * `media-right-alternate` / `narrow-stack-uniform`（理由在 `public/shapes.css` 的文件头）。
 *
 * 🔴 这一族的候选项因此要**展开成全名再精确比**：4 副画法 × 2 档节律 = 8 对，不是 4 对。
 *    按前缀匹配对「节奏」这一维是瞎的 —— 库里有 `media-right-alternate`，前缀尺就说 `media-right`
 *    已在库，而 `media-right-uniform` 缺不缺它一个字都不说。两把尺同一棵树上的读数：
 *      按前缀匹配   候选对 49 = 已在库 21 + 待迁 28   ← 旧尺
 *      写全名精确比 候选对 53 = 已在库 21 + 待迁 32   ← 现在用这把
 *    差的 4 对全在 `content-split`（#1340 · PM 2026-09-15 裁定）。
 *
 * 🔴 展开集自己要有自检：拿 `voiceFor(i)` 把 97 套候选真发得出来的 `content-split` 全名枚举一遍，
 *    展开集必须全部罩住，否则当场退 2。（**用 `voiceFor` 不用 `layoutNamesFor`** —— 后者只是前者的
 *    一层壳，而 #1341 要删掉它；两个键 97/97 相同，PM 与 DEV 各量过一次。）
 */

'use strict';

const fs = require('fs');
const path = require('path');

const DIR = __dirname;
const NEXT = path.resolve(DIR, '..', '..');
const BLOCKS = path.join(NEXT, 'blocks');

let recipes; let postcss;
try {
  recipes = require(path.join(DIR, 'sheet-recipes.js'));
  // eslint-disable-next-line global-require
  postcss = require('postcss');
} catch (e) {
  console.error(`🔴 跑不起来：${e.message}`);
  process.exit(2);
}

/** 每个块今天在 manifest 里的形态名 */
function shapesByBlock() {
  const out = {};
  for (const fn of fs.readdirSync(BLOCKS)) {
    if (!fn.endsWith('.json')) continue;
    const m = JSON.parse(fs.readFileSync(path.join(BLOCKS, fn), 'utf-8'));
    out[fn.replace(/\.json$/, '')] = (m.shapes || []).map((s) => s.name);
  }
  return out;
}

/** 一个候选表条目展开成它在盘上的**全名**：`split` 那一族带节律后缀，其余就是名字本身 */
function expand(fam, look) {
  return fam.key === 'split' ? recipes.SPLIT_RHYTHMS.map((r) => `${look}-${r}`) : [look];
}

/**
 * 展开集自检：97 套候选里生成器**真发得出来**的每一个 `content-split` 全名，都要落在展开集里。
 * 分母从 `poolSlots()` 现取，不手抄一个 97。
 */
function selfCheck() {
  const { poolSlots } = require(path.join(DIR, 'industry-sectors.js'));
  const n = poolSlots().length;
  const produced = new Set();
  for (let i = 0; i < n; i += 1) {
    const v = recipes.voiceFor(i);
    produced.add(`${v.split}-${v.splitRhythm}`);
  }
  const fam = recipes.LOOK_FAMILIES.find((f) => f.key === 'split');
  const all = new Set(Object.keys(fam.table).flatMap((look) => expand(fam, look)));
  const uncovered = [...produced].filter((x) => !all.has(x));
  if (uncovered.length) throw new Error(`展开漏了生成器真发的全名：${uncovered.join(' ')}`);
  return `自检：${n} 套候选里生成器发得出 ${produced.size} 个 content-split 全名，`
    + `展开集 ${all.size} 个，全部罩住`;
}

/** 候选表展开成 (块, 全名) 对，分成「已在库」和「待迁」两堆。🔴 精确比，不按前缀 */
function survey() {
  const man = shapesByBlock();
  const todo = []; const done = [];
  for (const f of recipes.LOOK_FAMILIES) {
    for (const b of f.blocks) {
      for (const look of Object.keys(f.table)) {
        for (const name of expand(f, look)) {
          ((man[b] || []).includes(name) ? done : todo).push(`${b}/${name}`);
        }
      }
    }
  }
  return { todo, done };
}

// ── 剪几何：跟 #1318 剪 `public/shapes.css` 用的是同一把刀 ─────────────────────────────────────
//
// 🔴 `geometryFor(i)` 是那把刀本身（`sheet-recipes.js` 里 `EMIT='geom'` 的那一半），不是它的复制品。
//    「哪个画法画成什么样」这件知识只有那几张表有；这里做的只是**换选择器**：`.hero` 换成
//    `[data-block="hero"][data-shape="<名>"]`，声明一个字节不动。
// 🔴 同一个画法名、不同候选号剪出来必须一样 —— 下面取三个候选号比一次，不一样就当场停
//    （那说明这一对的几何还依赖别的维度，「一对一段几何」这个前提不成立）。

/** look 名 == name 的前 n 个候选号 */
function pickIds(pred, n = 3, max = 40000) {
  const out = [];
  for (let i = 0; i < max && out.length < n; i += 1) if (pred(recipes.voiceFor(i))) out.push(i);
  return out;
}

/** 第 i 套候选的几何里属于 block 的那些规则 */
function segmentFor(i, block) {
  const root = postcss.parse(recipes.geometryFor(i));
  const keep = [];
  root.walkRules((rule) => {
    if (!rule.selectors.every((s) => s.includes(`.${block}`))) {
      if (rule.selectors.some((s) => s.includes(`.${block}`))) throw new Error(`选择器混了：${rule.selector}`);
      return;
    }
    const media = rule.parent && rule.parent.type === 'atrule' ? rule.parent.params : null;
    keep.push({ media, selectors: rule.selectors, decls: rule.nodes.map((d) => `${d.prop}: ${d.value}`) });
  });
  return keep;
}

/** 这个块今天真的会渲染出来的类名 —— 从它的组件现读，不手抄 */
const COMPONENT = {
  hero: 'HeroSection',
  'content-split': 'ContentSplitSection',
  'features-grid': 'FeaturesGridSection',
  'card-group': 'CardGroupSection',
  'cta-banner': 'CtaBannerSection',
  'contact-form': 'ContactFormSection',
  'page-header': 'PageHeaderSection',
  'faq-accordion': 'FaqAccordionSection',
  'process-steps': 'ProcessStepsSection',
  'contact-info': 'ContactInfoSection',
  testimonials: 'TestimonialsSection',
};
function liveHooks(block) {
  const f = path.join(NEXT, 'src', 'components', 'sections', `${COMPONENT[block]}.tsx`);
  const src = fs.readFileSync(f, 'utf-8');
  const out = new Set([block]);
  for (const m of src.matchAll(/([a-z][a-z0-9-]*)__([a-z][a-z0-9-]*)/g)) {
    if (m[1] === block) out.add(`${block}__${m[2]}`);
  }
  // `card-group` 这类用 `${v.name}__x` 写类名
  for (const m of src.matchAll(/\$\{v\.name\}__([a-z][a-z0-9-]*)/g)) out.add(`${block}__${m[1]}`);
  return out;
}

/** `.hero` → `[data-block=…][data-shape=…]`；`.hero__x` → 那个属性选择器后面跟着它；兄弟链两端都带 */
function remap(sel, block, shape) {
  const at = `[data-block="${block}"][data-shape="${shape}"]`;
  let seen = false;
  return sel.trim().split(/\s+/).map((p) => {
    if (p === `.${block}`) { seen = true; return at; }
    if (p === '+' || p === '>' || p === '~') return p;
    if (p.startsWith(`.${block}__`)) { const o = seen ? p : `${at} ${p}`; seen = true; return o; }
    return p;
  }).join(' ');
}

/** 一对的 shapes.css 文本。`dropped` 是丢掉的规则：那些部件今天不在这个块的 DOM 里 */
function emit(block, shape, seg, hooks) {
  const dropped = [];
  const rules = seg.filter((x) => {
    const cls = x.selectors.flatMap((s) => [...s.matchAll(/\.([a-z][a-z0-9_-]*)/g)].map((m) => m[1]));
    const dead = [...new Set(cls.filter((c) => !hooks.has(c)))];
    if (dead.length) { dropped.push({ sel: x.selectors.join(', '), dead }); return false; }
    return true;
  });
  const body = (x) => `${x.selectors.map((s) => remap(s, block, shape)).join(',\n')} {\n`
    + `${x.decls.map((d) => `  ${d};`).join('\n')}\n}`;
  let css = rules.filter((x) => !x.media).map(body).join('\n\n');
  const byQ = new Map();
  for (const x of rules.filter((y) => y.media)) {
    if (!byQ.has(x.media)) byQ.set(x.media, []);
    byQ.get(x.media).push(x);
  }
  for (const [q, xs] of byQ) {
    css += `\n\n@media ${q} {\n${xs.map((x) => body(x).split('\n')
      .map((l) => (l ? `  ${l}` : l)).join('\n')).join('\n\n')}\n}`;
  }
  return { css, dropped };
}

/** 一对 → { css, dropped, ids }；`familyFor` 负责找出这个形态名属于哪一族 */
function cutPair(block, shape) {
  const fam = recipes.LOOK_FAMILIES.find((f) => f.blocks.includes(block)
    && Object.keys(f.table).some((n) => shape === n || shape.startsWith(`${n}-`)));
  if (!fam) throw new Error(`${block}/${shape}: 候选表里没有这一族`);
  const name = Object.keys(fam.table).find((n) => shape === n || shape.startsWith(`${n}-`));
  const rhythm = shape === name ? null : shape.slice(name.length + 1);
  const ids = pickIds((v) => v[fam.key] === name && (!rhythm || v.splitRhythm === rhythm));
  if (!ids.length) throw new Error(`${block}/${shape}: 一个候选号都没挑到`);
  const segs = ids.map((i) => segmentFor(i, block));
  if (!segs.every((s) => JSON.stringify(s) === JSON.stringify(segs[0]))) {
    throw new Error(`${block}/${shape}: 三个候选号剪出来的几何不一样 —— 「一对一段几何」这个前提不成立`);
  }
  return { ...emit(block, shape, segs[0], liveHooks(block)), ids, family: fam.key, name, rhythm };
}

// ── 入口 ──────────────────────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
try {
  if (args[0] === '--cut') {
    const [, block, shape] = args;
    if (!block || !shape) { console.error('用法：--cut <块> <形态>'); process.exit(2); }
    const r = cutPair(block, shape);
    console.error(`# ${block}/${shape} ← ${r.family}='${r.name}'${r.rhythm ? ` 节律 ${r.rhythm}` : ''}`
      + ` · 候选号 ${r.ids.join(' ')}`);
    for (const d of r.dropped) console.error(`#   丢掉 ${d.sel}（${d.dead.join(' ')} 今天不在这个块的 DOM 里）`);
    console.log(r.css);
  } else if (args[0] === '--check') {
    const cssText = fs.readFileSync(path.join(NEXT, 'public', 'shapes.css'), 'utf-8');
    const shipped = (block, shape) => {
      const at = `[data-block="${block}"][data-shape="${shape}"]`;
      const keep = [];
      postcss.parse(cssText).walkRules((rule) => {
        if (!rule.selectors.every((s) => s.includes(at))) return;
        keep.push({
          media: rule.parent && rule.parent.type === 'atrule' ? rule.parent.params : null,
          decls: rule.nodes.map((d) => `${d.prop}: ${d.value}`).join('; '),
        });
      });
      return keep;
    };
    let same = 0; let diff = 0;
    const man = shapesByBlock();
    for (const f of recipes.LOOK_FAMILIES) {
      for (const b of f.blocks) {
        for (const look of Object.keys(f.table)) {
          for (const hit of expand(f, look)) {
          if (!(man[b] || []).includes(hit)) continue;
          const cut = cutPair(b, hit);
          const mineDecls = [];
          postcss.parse(cut.css).walkRules((rule) => mineDecls.push({
            media: rule.parent && rule.parent.type === 'atrule' ? rule.parent.params : null,
            decls: rule.nodes.map((d) => `${d.prop}: ${d.value}`).join('; '),
          }));
          const key = (xs) => JSON.stringify([...xs].map((x) => `${x.media}|${x.decls}`).sort());
          if (key(mineDecls) === key(shipped(b, hit))) { same += 1; console.log(`  ✅ ${b}/${hit}`); }
          else { diff += 1; console.log(`  ⚠️  ${b}/${hit} —— 跟刀剪出来的不一样（人手调过的那几对会落在这里）`); }
          }
        }
      }
    }
    console.log(`\n══ 重剪对账：跟刀一致 ${same} · 不一致 ${diff} ══`);
  } else {
    console.log(selfCheck());
    const { todo, done } = survey();
    console.log(`候选对 ${done.length + todo.length} = 已在库 ${done.length} + 待迁 ${todo.length}`);
    console.log(`待迁：${todo.join(' ') || '（空）'}`);
    console.log(`已在库：${done.join(' ')}`);
  }
} catch (e) {
  console.error(`🔴 跑不起来：${e.message}`);
  process.exit(2);
}
