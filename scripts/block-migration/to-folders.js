#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════════════════════════
// to-folders.js — 一次性搬家：一个块散在六处 → 一个块一个文件夹（#1387，设计文档 D20 / §3 三点六）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 跑法:  node scripts/block-migration/to-folders.js            （就地改 templates/nextjs）
//        node scripts/block-migration/to-folders.js --dry-run  （只印计划，不写盘）
//
// 搬完之后长这样：
//   blocks/hero/manifest.json          ← 原 blocks/hero/manifest.json 去掉 shapes[]
//   blocks/hero/Section.tsx            ← 原 src/components/sections/HeroSection.tsx
//   blocks/hero/floor.css              ← 原 public/base.css 里属于 hero 的那些规则
//   blocks/hero/block.css              ← 原 public/shapes.css 里 hero 的跨形态规则（有才写）
//   blocks/hero/media-cover/shape.css  ← 原 public/shapes.css 里这一形态的那一段
//   blocks/hero/media-cover/shape.md   ← 这一形态的说明（frontmatter 带 layout_intent / needs / …）
//
// 🔴 可重复跑：已经搬过就直接说一句然后退出（判据是 blocks/ 里有没有文件夹），不会搬第二次。
// 🔴 它不删 `public/shapes.css` / `public/base.css` / `registry.ts` —— 那三份从此由
//    `scripts/block-build/build-blocks.js` 生成，搬完之后跑一次生成器覆盖它们。
'use strict';

const fs = require('fs');
const path = require('path');
const postcss = require('postcss');
const { splitCss } = require('../block-build/css-split.js');
const { formatFrontmatter } = require('../block-build/frontmatter.js');

const NEXT = path.resolve(__dirname, '..', '..');
const BLOCKS = path.join(NEXT, 'blocks');
const SHAPES_CSS = path.join(NEXT, 'public', 'shapes.css');
const BASE_CSS = path.join(NEXT, 'public', 'base.css');
const SECTIONS = path.join(NEXT, 'src', 'components', 'sections');
const BUILD_DIR = path.join(NEXT, 'scripts', 'block-build');

const DRY = process.argv.includes('--dry-run');
const write = (p, s) => {
  if (DRY) { console.log(`   [dry] ${path.relative(NEXT, p)}  ${s.length} 字节`); return; }
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, s);
};

// ── 组件文件名：块类型 → src/components/sections/XxxSection.tsx ──────────────────────────────────
// 外壳区（header / footer）的骨架不在那个目录，它们是 src/components/Header.tsx / Footer.tsx。
function componentPathFor(type, isRegion) {
  if (isRegion) {
    const n = type.charAt(0).toUpperCase() + type.slice(1);
    return path.join(NEXT, 'src', 'components', `${n}.tsx`);
  }
  const camel = type.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');
  return path.join(SECTIONS, `${camel}Section.tsx`);
}

// ── FlyonUI 落点表反查：(块, 形态) ← 哪几条对表条目 ───────────────────────────────────────────────
function flyonuiSources() {
  const py = path.join(NEXT, '..', '..', 'docs', 'reference', 'flyonui', 'gen-pick-md.py');
  if (!fs.existsSync(py)) return {};
  const src = fs.readFileSync(py, 'utf-8');
  const start = src.indexOf('T = {');
  if (start < 0) return {};
  let depth = 0; let end = -1;
  for (let i = src.indexOf('{', start); i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') { depth -= 1; if (depth === 0) { end = i; break; } }
  }
  const body = src.slice(src.indexOf('{', start) + 1, end);
  const out = {};
  for (const m of body.matchAll(/"([^"]+)":\s*\("([^"]+)",\s*"([^"]+)"\)/g)) {
    const [, item, blockField, shapeField] = m;
    // 形态那一栏写着「media-right（已有）」「不做（…）」这类后缀，落点名是括号前那一段。
    const shape = shapeField.split(/[（(\s]/)[0].trim();
    if (!shape || shape === '不做') continue;
    for (const b of blockField.split('/').map((x) => x.trim())) {
      (out[`${b}/${shape}`] ||= []).push(item);
    }
  }
  return out;
}

// ── shape.md 的正文 ───────────────────────────────────────────────────────────────────────────────
// 「长什么样」不是编的：`shapes.css` 里每一段的第一行注释本来就写着这件事（121 段里 120 段有），
// 形状逐字是 `/* <块> · <形态>  （……）`，括号里那句就是当初写它的人对它的描述。
// 「什么时候用」= 必填槽 + 排版意图里最说明问题的那几根轴（不是全部 13 根 —— 全抄一遍等于没写）。
const AXIS_WORDS = {
  columns: { one: '一列', two: '两列', three: '三列', four: '四列', many: '多列' },
  media: { side: '图在旁边', cover: '图铺满', above: '图在上', below: '图在下', none: '没有图' },
  items: { row: '同级项横排', grid: '同级项排成网格', stack: '同级项竖着排', none: '没有同级项' },
  align: { stretch: '横向撑满', start: '靠左', center: '居中', end: '靠右' },
};

function describeFromCss(css, type, name) {
  const first = css.split('\n')[0];
  if (!first.startsWith('/*')) return '';
  // 两种写法都有：内容块是 `/* hero · media-cover  （…）`，外壳区是 `/* ── header · solid-bar（…）──── `
  const after = first.replace(/^\/\*\s*/, '').replace(/^──\s*/, '');
  const head = `${type} · ${name}`;
  if (!after.startsWith(head)) return '';
  return after.slice(head.length)
    .replace(/\s*\*\/\s*$/, '')
    .replace(/[─]+\s*$/, '')
    .trim()
    .replace(/^（/, '').replace(/）$/, '').trim();
}

function shapeDoc(type, sh, css, sources) {
  const when = [];
  if (sh.needs && sh.needs.length) when.push(`要先填 ${sh.needs.join(' / ')} 才用得上它`);
  const li = sh.layout_intent || {};
  const axes = Object.entries(AXIS_WORDS)
    .map(([k, words]) => words[li[k]])
    .filter(Boolean);
  if (axes.length) when.push(axes.join(' · '));
  const looks = describeFromCss(css, type, sh.name);
  const lines = [`# ${type} · ${sh.name}`, ''];
  lines.push(`**什么时候用：** ${when.length ? when.join('；') : '没有前置条件。'}`);
  lines.push('');
  lines.push(`**长什么样：** ${looks || '几何写在同目录的 shape.css 里。'}`);
  if (sources) { lines.push(''); lines.push(`**出处：** ${sources}`); }
  lines.push('');
  return lines.join('\n');
}

function main() {
  const entries = fs.readdirSync(BLOCKS, { withFileTypes: true });
  if (entries.some((e) => e.isDirectory())) {
    console.log('blocks/ 里已经有文件夹了 —— 已经搬过，什么都不做。');
    return 0;
  }
  const files = entries.filter((e) => e.isFile() && e.name.endsWith('.json')).map((e) => e.name).sort();
  const manifests = files.map((f) => JSON.parse(fs.readFileSync(path.join(BLOCKS, f), 'utf-8')));
  const types = manifests.map((m) => m.type);
  console.log(`读到 ${files.length} 份 manifest，形态合计 ${manifests.reduce((n, m) => n + (m.shapes || []).length, 0)}`);

  const sources = flyonuiSources();

  // ── ① shapes.css 切开 ──────────────────────────────────────────────────────────────────────────
  const shapesSrc = fs.readFileSync(SHAPES_CSS, 'utf-8');
  const shapeChunks = splitCss(shapesSrc, types);
  // 文件头那一段（第一个有主人的节点之前的全部注释）归生成器。
  const firstOwned = shapeChunks.findIndex((c) => c.owner.kind !== 'tail');
  const headNodes = shapeChunks[firstOwned].nodes.filter((n) => n.type === 'comment'
    && /shapes\.css — 形态层/.test(n.toString()));
  let shapesHead = '';
  if (headNodes.length) {
    shapesHead = `${headNodes.map((n) => n.toString()).join('\n\n')}\n`;
  }

  const shapeCssOf = new Map();   // "block/shape" → css
  const blockCssOf = new Map();   // "block" → css
  for (const c of shapeChunks) {
    let text = c.text;
    if (headNodes.length && c.index === firstOwned) {
      // 把文件头那段从第一段里摘掉（它不属于任何块）。
      text = text.slice(text.indexOf(headNodes[headNodes.length - 1].toString())
        + headNodes[headNodes.length - 1].toString().length);
    }
    // 分节线 `/* ══ hero ══… */` 由生成器重新写，这里去掉。
    text = text.replace(/\/\* ══ [a-z0-9-]+ ═+ \*\/\n?/g, '');
    if (c.owner.kind === 'shape') {
      const k = `${c.owner.block}/${c.owner.shape}`;
      shapeCssOf.set(k, (shapeCssOf.get(k) || '') + text);
    } else if (c.owner.kind === 'block') {
      blockCssOf.set(c.owner.block, (blockCssOf.get(c.owner.block) || '') + text);
    } else if (text.trim()) {
      throw new Error(`shapes.css 有一段没人认领（第 ${c.index} 段）：${text.slice(0, 120)}`);
    }
  }

  // ── ② base.css 切开（跨块的规则按块拆开）───────────────────────────────────────────────────────
  const baseSrc = fs.readFileSync(BASE_CSS, 'utf-8');
  const baseChunks = splitCss(baseSrc, types);
  const baseFirstOwned = baseChunks.findIndex((c) => c.owner.kind !== 'tail');
  const baseHeadNode = baseChunks[baseFirstOwned].nodes.find((n) => n.type === 'comment'
    && /base-css-contract/.test(n.toString()));
  // 生成物的头 = 原来那段合同说明 + 一段讲清楚「这份文件现在是拼出来的」。
  // 🔴 那一段只写一次：跨块共用的规则按块拆开之后，它们的来由只留在字典序第一个块的 floor.css 里。
  //    第一版是每个块各抄一份注释，base.css 从 56 KB 涨到 100 KB —— 而这份文件是发给浏览器的。
  const baseNote = [
    '/* 🔴 这份文件是拼出来的 —— 手改会被下一次 `node scripts/block-build/build-blocks.js` 覆盖，',
    '   而 `scripts/block-build/generated-fresh.test.js` 会在那之前就把它点名。要改一个块的地板，',
    '   改 `blocks/<块>/floor.css`。#1387（设计文档 D20）。',
    '',
    '   🔴 有 47 条规则原来一条同时写了好几个块（`.contact-form, .quote-form, …`）。一块一份',
    '   `floor.css` 之后它们按块拆开了，而**解释它们的那段注释只留在按字典序第一个块的 floor.css 里**',
    '   —— 每个块各抄一份的话这份文件要多 43 KB，而它是 `layout.tsx` 直接 <link> 给访客的。',
    '   在别的块里看到一组没有来由的规则时，去那一组里名字最靠前的那个块的 `floor.css` 找。 */',
  ].join('\n');
  const baseHead = baseHeadNode ? `${baseHeadNode.toString()}\n\n${baseNote}\n` : '';

  const floorOf = new Map();      // "block" → css
  for (const c of baseChunks) {
    let text = c.text;
    if (baseHeadNode && c.index === baseFirstOwned) {
      text = text.slice(text.indexOf(baseHeadNode.toString()) + baseHeadNode.toString().length);
    }
    if (c.owner.kind === 'block') {
      floorOf.set(c.owner.block, (floorOf.get(c.owner.block) || '') + text);
    } else if (c.owner.kind === 'multi') {
      // 一条规则同时写了好几个块（base.css 167 条规则里有 47 条这样）—— 按块各留自己那几个选择器。
      // 🔴 **注释只跟第一个块走，其余各块只留规则 + 一行指路。** 第一版是每个块各抄一份，
      //    生成出来的 base.css 从 56 KB 涨到 100 KB —— 而这份文件是**发给浏览器**的（`layout.tsx`
      //    直接 <link> 它），涨的那 43 KB 全是给人读的中文注释，每个访客都要下载一次。
      const owner = c.owner.blocks[0];
      for (const b of c.owner.blocks) {
        const root = postcss.parse(text);
        root.walk((n) => {
          if (n.type !== 'rule') return;
          const keep = n.selectors.filter((s) => new RegExp(`^\\.${b}(__|[\\s.:,[>+~]|$)`).test(s.trim()));
          if (keep.length) n.selectors = keep; else n.remove();
        });
        root.walkAtRules((a) => { if (!a.nodes || !a.nodes.some((n) => n.type === 'rule')) a.remove(); });
        if (b !== owner) root.walkComments((n) => n.remove());
        const out = root.toString();
        if (!out.trim()) continue;
        floorOf.set(b, (floorOf.get(b) || '') + out);
      }
    } else if (text.trim()) {
      throw new Error(`base.css 有一段没人认领（第 ${c.index} 段）：${text.slice(0, 120)}`);
    }
  }

  // ── ③ 写盘 ────────────────────────────────────────────────────────────────────────────────────
  write(path.join(BUILD_DIR, 'shapes-head.css'), shapesHead);
  write(path.join(BUILD_DIR, 'base-head.css'), baseHead);

  const tidy = (s) => `${s.replace(/^\n+/, '').replace(/\s+$/, '')}\n`;
  let shapeFiles = 0;
  for (const m of manifests) {
    const type = m.type;
    const dir = path.join(BLOCKS, type);
    const isRegion = m.region === true;

    const out = { ...m };
    delete out.shapes;
    write(path.join(dir, 'manifest.json'), `${JSON.stringify(out, null, 2)}\n`);

    const comp = componentPathFor(type, isRegion);
    if (!fs.existsSync(comp)) throw new Error(`${type}: 找不到组件 ${path.relative(NEXT, comp)}`);
    // 🔴 组件挪了一层，里面的**相对** import 要跟着改。今天只有一处
    //    （`hero-with-form` 的 `./HeroLeadForm`），但漏改的方向是构建当场红、不是静默 ——
    //    所以这里只把已知那一处改掉，剩下的如果有，`npm run build` 会点名。
    const comps = fs.readFileSync(comp, 'utf-8')
      .replace(/from '\.\/HeroLeadForm'/g, "from '@/components/sections/HeroLeadForm'");
    write(path.join(dir, 'Section.tsx'), comps);
    if (!DRY) fs.unlinkSync(comp);

    if (floorOf.has(type)) write(path.join(dir, 'floor.css'), tidy(floorOf.get(type)));
    if (blockCssOf.has(type)) write(path.join(dir, 'block.css'), tidy(blockCssOf.get(type)));

    (m.shapes || []).forEach((sh, i) => {
      const k = `${type}/${sh.name}`;
      const css = shapeCssOf.get(k);
      if (css === undefined) throw new Error(`${k}: manifest 里有这个形态，shapes.css 里一段都没有`);
      write(path.join(dir, sh.name, 'shape.css'), tidy(css));
      const fm = { order: i };
      if (sh.needs && sh.needs.length) fm.needs = sh.needs;
      if (sh.candidate) fm.candidate = true;
      const src = sources[k] ? sources[k].map((x) => `FlyonUI ${x}`).join(', ') : '';
      if (src) fm.source = src;
      if (sh.layout_intent) fm.layout_intent = sh.layout_intent;
      const body = shapeDoc(type, sh, tidy(css), src);
      write(path.join(dir, sh.name, 'shape.md'), `${formatFrontmatter(fm)}\n${body}`);
      shapeFiles += 1;
    });

    if (!DRY) fs.unlinkSync(path.join(BLOCKS, `${type}.json`));
  }

  // shapes.css 里有、manifest 里没有的形态 —— 搬完就没人管了，当场报出来。
  for (const k of shapeCssOf.keys()) {
    const [b, s] = k.split('/');
    const m = manifests.find((x) => x.type === b);
    if (!m || !(m.shapes || []).some((x) => x.name === s)) {
      throw new Error(`${k}: shapes.css 里有这一段，manifest 的 shapes 里没有它`);
    }
  }

  console.log(`搬完：${manifests.length} 个块文件夹 · ${shapeFiles} 个形态子文件夹`);
  console.log(`  带 block.css 的块：${[...blockCssOf.keys()].sort().join(', ')}`);
  console.log(`  带 floor.css 的块：${floorOf.size} 个`);
  return 0;
}

process.exit(main());
