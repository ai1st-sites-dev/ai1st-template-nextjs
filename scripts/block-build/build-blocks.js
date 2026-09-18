#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════════════════════════════
// build-blocks.js — 从 `blocks/` 拼出三份生成物（#1387，设计文档 D20 / §3 三点六）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 跑法:  node scripts/block-build/build-blocks.js          写盘
//        node scripts/block-build/build-blocks.js --check  只对，不写；对不上 exit 1 并点名
//
// 生成三份：
//   public/shapes.css                     形态层
//   public/base.css                       地板层
//   src/lib/sections/registry.generated.ts  块类型 → 组件
//
// 🔴 **三份都进 git，并且有一道检查盯着「文件里那份 == 现在拼出来的那份」**
//    （`scripts/block-build/generated-fresh.test.js`，`npm run test:scripts` 会发现它）。
//    为什么不改成构建时生成：读这三份的人里有一多半根本不构建 —— `block-manifest.js` 直接解析
//    `public/shapes.css`、`theme-css-invariants.mjs` 与 `theme-css-lint.js` 读 `public/base.css`、
//    manager 的 admin 区块页读模板目录、dashboard 的 vite 插件也读它。生成物不在盘上时这些人拿到的
//    是「文件不存在」，而那个方向是静默的（读不到 ⟹ 当成空 ⟹ 少判一堆东西）。进 git 的代价是
//    每次改块要多跑一次生成器，那件事由上面那道检查当场点名。
//
// ── 顺序（确定的，全部从文件夹派生，没有任何外部清单）────────────────────────────────────────────
//   块序    先内容块（按文件夹名字典序），再外壳区（`region: true`，同样按名字）
//   形态序  `shape.md` frontmatter 的 `order`，没写就按形态文件夹名字典序
//   块内     block.css（这个块的跨形态规则）在前，各形态 shape.css 在后
//            —— 低特异度的块级默认在前、形态各自的覆盖在后，跟层叠同向
'use strict';

const fs = require('fs');
const path = require('path');
const postcss = require('postcss');

const NEXT = path.resolve(__dirname, '..', '..');
const BLOCKS = path.join(NEXT, 'blocks');
const HERE = __dirname;

const { parseFrontmatter, formatFrontmatter } = require('./frontmatter.js');

function readBlock(type) {
  const dir = path.join(BLOCKS, type);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf-8'));
  const shapes = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const md = path.join(dir, e.name, 'shape.md');
    const fm = fs.existsSync(md) ? parseFrontmatter(fs.readFileSync(md, 'utf-8')) : {};
    shapes.push({
      name: e.name,
      order: typeof fm.order === 'number' ? fm.order : null,
      needs: Array.isArray(fm.needs) ? fm.needs : [],
      candidate: fm.candidate === true,
      source: typeof fm.source === 'string' ? fm.source : undefined,
      layout_intent: fm.layout_intent && typeof fm.layout_intent === 'object' ? fm.layout_intent : undefined,
      dir: path.join(dir, e.name),
    });
  }
  shapes.sort((a, b) => {
    if (a.order !== null && b.order !== null && a.order !== b.order) return a.order - b.order;
    if (a.order !== null && b.order === null) return -1;
    if (a.order === null && b.order !== null) return 1;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
  return { type, dir, manifest, shapes, region: manifest.region === true };
}

function readBlocks() {
  const types = fs.readdirSync(BLOCKS, { withFileTypes: true })
    .filter((e) => e.isDirectory()).map((e) => e.name).sort();
  const all = types.map(readBlock);
  return [...all.filter((b) => !b.region), ...all.filter((b) => b.region)];
}

const banner = (name) => `/* ══ ${name} ${'═'.repeat(70)} */\n`;
const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, 'utf-8').replace(/\s+$/, '') : '');

function buildShapesCss(blocks) {
  const parts = [read(path.join(HERE, 'shapes-head.css'))];
  for (const b of blocks) {
    const chunks = [];
    const blockCss = read(path.join(b.dir, 'block.css'));
    if (blockCss) chunks.push(blockCss);
    for (const s of b.shapes) {
      const css = read(path.join(s.dir, 'shape.css'));
      if (css) chunks.push(css);
    }
    if (!chunks.length) continue;
    parts.push(banner(b.type) + chunks.join('\n\n'));
  }
  return `${parts.filter(Boolean).join('\n\n')}\n`;
}

function buildBaseCss(blocks) {
  const parts = [read(path.join(HERE, 'base-head.css'))];
  for (const b of blocks) {
    const css = read(path.join(b.dir, 'floor.css'));
    if (css) parts.push(banner(b.type) + css);
  }
  return `${parts.filter(Boolean).join('\n\n')}\n`;
}

const pascal = (t) => t.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('');

function buildRegistry(blocks) {
  // 外壳区不进这张表：它是「页面 JSON 里写的 type → 渲染它的组件」，而顶栏页脚不进页面 JSON
  // （哪一页有它们由 page layout 库定，`SiteShell.tsx` 渲染）。判据是 manifest 自己的 region。
  const own = blocks.filter((b) => !b.region);
  const imports = own.map((b) => `import ${pascal(b.type)}Section from '@blocks/${b.type}/Section';`);
  const rows = own.map((b) => `  '${b.type}': ${pascal(b.type)}Section,`);
  return [
    '// 🔴 这个文件是生成的 —— 手改会被下一次 `node scripts/block-build/build-blocks.js` 覆盖，',
    '//    而 `scripts/block-build/generated-fresh.test.js` 会在那之前就把它点名。',
    '//    要加一个块：在 `blocks/` 下新建一个文件夹（manifest.json + Section.tsx + 一个形态子文件夹），',
    '//    然后跑一次生成器。#1387（设计文档 D20）。',
    "import type { ComponentType } from 'react';",
    ...imports,
    '',
    '// eslint-disable-next-line @typescript-eslint/no-explicit-any',
    'export const sectionRegistry: Record<string, ComponentType<any>> = {',
    ...rows,
    '};',
    '',
  ].join('\n');
}

/**
 * 每个零件里的每一条规则，选择器都必须指着它自己那个块（形态零件还要指着它自己那个形态）；
 * 两份文件头（纯文档）里一条规则都不许有。
 *
 * 🔴 这一条挡的是一个真出现过的失败：某个零件的**注释里**出现了「星号紧跟斜杠」的组合（写一条
 *    `ls -d` 加通配的示例命令就会），CSS 的块注释在那儿当场结束，后面几十行注释被解析成一条选择器
 *    —— 文件照样是合法 CSS、构建照样绿、页面上多出一条谁也没写过的规则。本票交付时这件事发生过
 *    一次（写在 `shapes-head.css` 里），是 `scripts/block-migration/css-equiv.js` 事后读出来的。
 * 🔴 **判据不是「拼出来的条数 == 各零件条数之和」** —— 那个数对这件事是瞎的：坏掉的注释在零件里
 *    和在成品里各多出同一条，两边一样多。判据必须问「这条规则是谁的」。
 */
function selectorsOf(css, file) {
  const out = [];
  let root;
  try {
    root = postcss.parse(css, { from: file });
  } catch (e) {
    throw new Error(`${file}: 解析不了（${e.message}）`);
  }
  root.walkRules((r) => r.selectors.forEach((sel) => out.push(sel.trim())));
  return out;
}

function assertPieceOwnsItsRules(file, css, { block, shape } = {}) {
  for (const sel of selectorsOf(css, file)) {
    if (block === undefined) {
      throw new Error(`${file}: 这是一份纯文档（文件头），里面不该有规则，却读到一条选择器`
        + ` \`${sel.slice(0, 80)}\` —— 多半是注释里出现了「星号紧跟斜杠」，把注释提前关掉了`);
    }
    // 🔴 判据是选择器**从哪儿开头**，不是「里面含不含这个串」。含不含是瞎的：注释被提前关掉之后，
    //    漏出来的那段文字会**粘在下一条选择器前面**，而下一条本来就带着这个块和这个形态 ⟹ 含，绿。
    const isFloor = file.endsWith('floor.css');
    const head = isFloor
      ? new RegExp(`^\\.${block}(__[a-z0-9-]+)?([\\s.:,[>+~]|$)`)
      : new RegExp(`^\\[data-block="${block}"\\]`);
    if (!head.test(sel)) {
      throw new Error(`${file}: 有一条规则不是这个块的，或者开头多了东西 —— \`${sel.slice(0, 90)}\``
        + `（期望以${isFloor ? ` .${block} ` : ` [data-block="${block}"] `}开头）。`
        + '多半是注释里出现了「星号紧跟斜杠」，把那条注释提前关掉了');
    }
    if (shape !== undefined && !new RegExp(`^\\[data-block="${block}"\\]\\[data-shape="${shape}"\\]`).test(sel)) {
      throw new Error(`${file}: 有一条规则没在开头点名这个形态 —— \`${sel.slice(0, 90)}\``
        + `（期望 [data-block="${block}"][data-shape="${shape}"] 开头；跨形态的规则放 blocks/${block}/block.css）`);
    }
  }
}

function main() {
  const check = process.argv.includes('--check');
  const blocks = readBlocks();
  // 每个零件自证：规则只许是它自己的（理由见 assertPieceOwnsItsRules）。
  assertPieceOwnsItsRules(path.join(HERE, 'shapes-head.css'), read(path.join(HERE, 'shapes-head.css')));
  assertPieceOwnsItsRules(path.join(HERE, 'base-head.css'), read(path.join(HERE, 'base-head.css')));
  for (const b of blocks) {
    for (const f of ['floor.css', 'block.css']) {
      const p = path.join(b.dir, f);
      if (fs.existsSync(p)) assertPieceOwnsItsRules(p, read(p), { block: b.type });
    }
    for (const sh of b.shapes) {
      const p = path.join(sh.dir, 'shape.css');
      if (fs.existsSync(p)) assertPieceOwnsItsRules(p, read(p), { block: b.type, shape: sh.name });
    }
  }
  const shapesCss = buildShapesCss(blocks);
  const baseCss = buildBaseCss(blocks);
  const targets = [
    [path.join(NEXT, 'public', 'shapes.css'), shapesCss],
    [path.join(NEXT, 'public', 'base.css'), baseCss],
    [path.join(NEXT, 'src', 'lib', 'sections', 'registry.generated.ts'), buildRegistry(blocks)],
  ];
  let bad = 0;
  for (const [p, want] of targets) {
    const rel = path.relative(NEXT, p);
    if (check) {
      const have = fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : null;
      if (have === want) { console.log(`  ✅ ${rel}`); continue; }
      bad += 1;
      console.log(`  ❌ ${rel} 跟 blocks/ 现在拼出来的不一样`
        + `（盘上 ${have === null ? '不存在' : `${have.length} 字节`} · 现拼 ${want.length} 字节）`);
    } else {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, want);
      console.log(`  写了 ${rel}  ${want.length} 字节`);
    }
  }
  if (check && bad) {
    console.log('\n🔴 生成物跟 blocks/ 对不上 —— 跑一次 `node scripts/block-build/build-blocks.js`。');
    return 1;
  }
  console.log(`${check ? '对过了' : '生成完'}：${blocks.length} 个块 · `
    + `${blocks.reduce((n, b) => n + b.shapes.length, 0)} 个形态`);
  return 0;
}

module.exports = {
  readBlocks, readBlock, parseFrontmatter, formatFrontmatter,
  buildShapesCss, buildBaseCss, buildRegistry,
};

if (require.main === module) process.exit(main());
