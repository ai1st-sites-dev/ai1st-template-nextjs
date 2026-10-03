#!/usr/bin/env node
/**
 * intro-layout.test.js — 块头排版只剩一份（#1535）：`introAlign` / `introPosition` 的排版规则只在
 * `scripts/block-build/intro-layout.js` 里（由 manifest 的 `introLayout` 声明驱动），块自己的 CSS 里不许再写。
 *
 *   node scripts/intro-layout.test.js     （由 `npm run test:scripts` 自动发现）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * ① 射程从数据派生，不用名单：凡 manifest 的 `slots.*.knobs` 里有 `introAlign` 或 `introPosition` 的块（今天 11 个），
 *    都必须写 `introLayout`；introPosition 取值含 left / right / top / bottom 的，还必须声明 frame 那一套。
 * ② 扫【所有】块的 CSS（`blocks/<块>/block.css` + `<形态>/shape.css`，postcss 解析，注释不算、CSS 嵌套展开），
 *    每条声明 × 选择器的每一支，按两条判（任一条命中就红，并点名 文件:行）：
 *    (a) 【位置 + 属性族】—— 末端落在 introLayout 声明过的元素上，并且属性属于那个元素的「排版族」（FAMILIES）：
 *          text（块头的字）     对齐 · 宽度族 · 左右外边距
 *          frame（外框）        画法（display / flex-direction / flex-flow / flex-wrap / grid* / 多列 / direction）
 *          introCol / mainCol   宽度族 · flex 族 · 定位（position / top / inset）· align-self · order · 外边距 · 左右内边距 · display
 *        值怎么写都不看（简写、相对单位、`!important` 一样算），有没有块头条件也不看。
 *        「落在」= 最后一个复合选择器带那个元素的 class，或带它在 JSX 上的别名（同一个标签上的其它 class，如 `.row` / `.col-12`；
 *        它的 `data-part` 值，如 `[data-part="intro"]`）—— 别名从块的 `*.tsx` 现取；`[class~=…]` / `[data-part^=…]` 这类
 *        属性写法按运算符匹配；`:is()` / `:where()` 拆开。末端不带 class 的（`> *` · `> div` · `> :first-child`）按它前一个
 *        复合选择器算：外框里的 = 两列，块头列里的 = 块头的字。
 *    (b) 【块头条件】—— 选择器里出现 `data-intro-position` / `data-intro-align`（大小写不论、`:not()` / `:is()` 里也算、
 *        不带值的 `[data-intro-align]` 也算），而这条不在下面 KEEP 那份「块自己的部件跟着块头换布局」的清单里。
 *        清单按「块 × 末端 class × 哪个旋钮做条件 × 改什么属性」四元组判（PM 2026-10-03 裁定：不按类名、也不按属性单独分桶 ——
 *        `.fq-help` 同一个 class、同一个属性族，按 introAlign 跟随归生成器，按 introPosition 在侧列归零归 faq 自己）。
 *    唯一放行的一条无条件规则：testimonials `.tn-intro-text { max-width: none }`（EXEMPT，值也要对上）。
 * ③ 读数：块自己的 CSS 里带块头条件的规则还剩几条（= KEEP 的 12 条）、清单里每一条都还在（清单不许过期）。
 * ④ 生成出来的 CSS 只用逻辑属性（RTL 站 shapes.css 不过 RTLCSS，#1473）、每个块各生成一份。
 * ⑤ 故意改坏：往真实的 block.css 里塞一条块头排版规则（多种写法：照抄回去、简写、相对单位、`> *`、换画法、别名、
 *    属性不带值、`:not()`、`:is()`、大写属性名、嵌套、shape.css 里）—— 每一条当场红、点名文件:行；删掉一个块的声明也红。
 *    另有一组「必须不红」的反向对照（KEEP 里的每一条、颜色 / 字号 / 上下外边距、块头的字里面的子元素），
 *    证明判法没放宽到见什么拦什么。
 *
 * 📌 守不住的（说在明处）：选择器里既不写这几个元素的 class / 别名、也不从外框或块头列往下够，只靠纯结构
 *    （例 `[data-block="blog"] > div > div > div`）去碰它们的写法，这一格看不见；块的 CSS 以外（`globals.css`、主题）不在射程。
 *    KEEP 里那 12 条的属性**值**不看 —— 它们是块自己的部件，改值是那个块自己的事。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const postcss = require('postcss');
const { introLayoutOf, introLayoutCss } = require('./block-build/intro-layout');

const NEXT = path.resolve(__dirname, '..');
const BLOCKS = path.join(NEXT, 'blocks');
let pass = 0;
let fail = 0;
const check = (ok, msg) => { if (ok) { pass += 1; console.log(`  ✅ ${msg}`); } else { fail += 1; console.log(`  ❌ ${msg}`); } };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };

// ── 各元素的「排版族」：属性名（去掉浏览器前缀后）命中 = 这条声明在排这个元素的位置 ─────────────────────────────
const WIDTH = /^(width|min-width|max-width|inline-size|min-inline-size|max-inline-size)$/;
const INLINE_MARGIN = /^(margin|margin-inline|margin-inline-start|margin-inline-end|margin-left|margin-right)$/;
const FAMILIES = {
  text: (p) => p === 'all' || /^(text-align|text-align-last|justify-self|align-self|float)$/.test(p) || WIDTH.test(p) || INLINE_MARGIN.test(p),
  frame: (p) => p === 'all' || /^(display|flex-direction|flex-flow|flex-wrap|direction|writing-mode|columns|column-count|column-width)$/.test(p) || /^grid(-|$)/.test(p),
  col: (p) => p === 'all' || WIDTH.test(p) || /^(flex|flex-basis|flex-grow|flex-shrink|display|position|top|bottom|inset|inset-block|inset-block-start|inset-block-end|align-self|justify-self|order|float|box-sizing)$/.test(p)
    || /^margin(-|$)/.test(p) || /^padding(-inline(-start|-end)?|-left|-right)?$/.test(p) || /^grid-(column|area|row)/.test(p),
};
const ROLE_FAMILY = { text: 'text', frame: 'frame', introCol: 'col', mainCol: 'col' };

// ── 块自己的部件跟着块头换布局：留在 block.css 的 12 条（PM 2026-10-03 裁定 A 的「块专属」那一类）──────────────────
// 四元组：块 × 末端 class × 做条件的旋钮（position / align）× 改的属性。值不看。
const KEEP = [
  { block: 'contact', target: '.ct-textcol', knobs: ['position'], props: ['align-self'], why: 'beside + data-split=even 时文字列垂直居中' },
  { block: 'faq', target: '.fq-help', knobs: ['position'], props: ['margin-inline-start'], why: '块头在侧列时 help 卡贴列的左边（按 introAlign 跟随那两条归生成器）' },
  { block: 'features', target: '.fx-intro', knobs: ['position'], props: ['flex-direction', 'align-items'], why: '块头在侧列时块头图改竖排' },
  { block: 'features', target: '.fx-intro-img', knobs: ['position'], props: ['flex', 'margin-block', 'margin-inline'], why: '同上，图的尺寸与间距' },
  { block: 'milestones', target: '.mi-intro', knobs: ['position'], props: ['flex-direction', 'align-items'], why: '同 features' },
  { block: 'milestones', target: '.mi-intro-img', knobs: ['position'], props: ['flex', 'margin-block', 'margin-inline'], why: '同 features' },
  { block: 'logos', target: '.lo-grid', knobs: ['position'], props: ['justify-content'], why: 'row 排法在块头侧列时靠左' },
  { block: 'pricing', target: '.pr-highlights', knobs: ['align'], props: ['display', 'flex-wrap', 'justify-content', 'gap'], why: 'center 时亮点排成一排' },
  { block: 'pricing', target: '.pr-hl', knobs: ['align'], props: ['flex', 'width', 'min-width', 'flex-direction', 'align-items', 'text-align', 'gap', 'margin-bottom'], why: 'center 时两列 / 四列、right 时镜像（3 条规则）' },
  { block: 'reviews', target: '.rv-items', knobs: ['position'], props: ['grid-template-columns'], why: '块头在上下时网格最多 4 列' },
];
const KEEP_RULES = 12; // KEEP 覆盖的规则条数（pricing .pr-hl 是 3 条）
// 落在块头元素上、却不是块头排版的规则（不跟 introAlign / introPosition 走）。同一个四元组：块 × 末端 × 条件 × 属性；
// `value` 写了就连值一起对（无条件的那条只放行 none）。
const EXEMPT = [
  { block: 'testimonials', target: '.tn-intro-text', cond: null, props: ['max-width'], value: 'none', why: '无条件的 max-width: none，不跟旋钮走' },
  { block: 'features', target: '.fx-intro-text', cond: 'data-intro-image', props: ['flex', 'min-width', 'max-width'], why: 'introImage left / right（≥992）：图在字旁，字让出宽度' },
  { block: 'milestones', target: '.mi-intro-text', cond: 'data-intro-image', props: ['flex', 'min-width', 'max-width', 'margin'], why: '同 features' },
];

// ── 读块 ─────────────────────────────────────────────────────────────────────────────────────────────
const knobsOf = (m) => Object.values(m.slots || {}).flatMap((s) => (s && Array.isArray(s.knobs) ? s.knobs : []));
function readBlocks() {
  if (!fs.existsSync(BLOCKS)) die(`找不到 ${BLOCKS}`);
  const out = [];
  for (const b of fs.readdirSync(BLOCKS, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
    const mf = path.join(BLOCKS, b, 'manifest.json');
    if (!fs.existsSync(mf)) continue;
    const manifest = JSON.parse(fs.readFileSync(mf, 'utf8'));
    const css = [];
    const add = (p) => { if (fs.existsSync(p)) css.push({ file: path.relative(NEXT, p), text: fs.readFileSync(p, 'utf8') }); };
    add(path.join(BLOCKS, b, 'block.css'));
    for (const d of fs.readdirSync(path.join(BLOCKS, b), { withFileTypes: true })) if (d.isDirectory()) add(path.join(BLOCKS, b, d.name, 'shape.css'));
    const tsx = fs.readdirSync(path.join(BLOCKS, b)).filter((f) => f.endsWith('.tsx')).map((f) => fs.readFileSync(path.join(BLOCKS, b, f), 'utf8')).join('\n');
    out.push({ block: b, manifest, css, tsx });
  }
  if (!out.length) die('blocks/ 下一个块都没读到');
  return out;
}

/** 块头那几个元素 → 认它们的记号：`.class`（自己的 + 同一个 JSX 标签上的别的 class）和 `part:<data-part 值>`。 */
function ownedTokens(blocks) {
  const own = []; // { block, role, token }
  for (const { block, manifest, tsx } of blocks) {
    let L;
    try { L = introLayoutOf(manifest, block); } catch { L = null; }
    if (!L) continue;
    for (const role of ['text', 'frame', 'introCol', 'mainCol']) {
      if (!L[role]) continue;
      const cls = L[role].slice(1);
      own.push({ block, role, token: `.${cls}` });
      // 同一个标签：className 里含这个 class 的那个开标签（到下一个 `>` 为止）
      const re = new RegExp(`<[A-Za-z][\\w.]*\\b[^<>]*className="([^"]*\\b${cls}\\b[^"]*)"[^<>]*>`, 'g');
      for (const m of tsx.matchAll(re)) {
        own.push({ block, role, token: `tag:${cls}` });
        for (const c of m[1].split(/\s+/).filter(Boolean)) if (c !== cls) own.push({ block, role, token: `.${c}` });
        const part = /data-part="([^"]+)"/.exec(m[0]);
        if (part) own.push({ block, role, token: `part:${part[1]}` });
      }
    }
  }
  return own;
}

// ── 选择器 ────────────────────────────────────────────────────────────────────────────────────────────
/** 顶层（括号 / 方括号 / 引号之外）切。 */
function splitTop(s, isSep) {
  const out = []; let cur = ''; let depth = 0; let q = null;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (q) { cur += ch; if (ch === '\\') cur += s[++i] || ''; else if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === '(' || ch === '[') depth += 1;
    if (ch === ')' || ch === ']') depth -= 1;
    const sep = depth === 0 ? isSep(s, i) : 0;
    if (sep) { out.push({ text: cur, sep: s.slice(i, i + sep) }); cur = ''; i += sep - 1; continue; }
    cur += ch;
  }
  out.push({ text: cur, sep: null });
  return out;
}
const commas = (s) => splitTop(s, (t, i) => (t[i] === ',' ? 1 : 0)).map((x) => x.text.trim()).filter(Boolean);
const attrMatch = (op, want, got) => {
  if (want === null) return true; // [data-part] 不带值 = 任何值
  switch (op) {
    case '=': return got === want;
    case '~=': return got.split(/\s+/).includes(want);
    case '^=': return got.startsWith(want);
    case '$=': return got.endsWith(want);
    case '*=': return got.includes(want);
    case '|=': return got === want || got.startsWith(`${want}-`);
    default: return false;
  }
};
/** 复合选择器 → 正面写着的记号（class、属性条件；`:is/:where/:matches` 拆开，`:not/:has` 里的不算它自己）。 */
function compound(text) {
  const c = { classes: [], attrs: [], pseudoEl: /::|:(before|after|first-line|first-letter|marker|placeholder)\b/i.test(text) };
  const walk = (t) => {
    let rest = '';
    for (let i = 0; i < t.length; i += 1) {
      const m = /^:(not|has|is|where|matches|-webkit-any|-moz-any|nth-[a-z-]+)\(/i.exec(t.slice(i));
      if (m) {
        let d = 0; let j = i + m[0].length - 1;
        for (; j < t.length; j += 1) { if (t[j] === '(') d += 1; else if (t[j] === ')') { d -= 1; if (d === 0) break; } }
        if (/^(is|where|matches|-webkit-any|-moz-any)$/i.test(m[1])) for (const one of commas(t.slice(i + m[0].length, j))) if (!/[\s>+~]/.test(one)) walk(one);
        i = j; continue;
      }
      rest += t[i];
    }
    for (const m of rest.replace(/\[[^\]]*\]/g, '').matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) c.classes.push(m[1]);
    for (const m of rest.matchAll(/\[\s*([\w-]+)\s*(?:([~|^$*]?=)\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+)))?\s*[is]?\s*\]/gi)) {
      c.attrs.push({ name: m[1].toLowerCase(), op: m[2] || null, val: m[3] ?? m[4] ?? m[5] ?? null });
    }
  };
  walk(text);
  return c;
}
/** 一个复合选择器认得出的块头元素（role 集合）。 */
function rolesOf(c, own) {
  const roles = new Set();
  for (const o of own) {
    if (o.token.startsWith('tag:')) continue;
    if (o.token.startsWith('.')) {
      const cls = o.token.slice(1);
      if (c.classes.includes(cls) || c.attrs.some((a) => a.name === 'class' && a.op && attrMatch(a.op, a.val, cls))) roles.add(`${o.block}:${o.role}`);
    } else {
      const part = o.token.slice(5);
      if (c.attrs.some((a) => a.name === 'data-part' && (a.op ? attrMatch(a.op, a.val, part) : true))) roles.add(`${o.block}:${o.role}`);
    }
  }
  return roles;
}
const hasTokens = (c) => c.classes.length > 0 || c.attrs.some((a) => a.name === 'class' || a.name === 'data-part');
/** 一支选择器的末端落在哪些块头元素上（见文件头 ②(a)）。 */
function targetRoles(branch, own) {
  const parts = splitTop(branch, (s, i) => { const m = /^\s*[>+~]\s*|^\s+/.exec(s.slice(i)); return m ? m[0].length : 0; })
    .map((p) => compound(p.text.trim())).filter((c, i, a) => i === a.length - 1 || true);
  const last = parts[parts.length - 1];
  if (!last || last.pseudoEl) return new Set();
  const direct = rolesOf(last, own);
  if (direct.size || hasTokens(last) || parts.length < 2) return direct;
  // 末端不带 class / data-part：按前一个复合选择器算
  const out = new Set();
  for (const r of rolesOf(parts[parts.length - 2], own)) {
    const [b, role] = r.split(':');
    if (role === 'frame') { out.add(`${b}:introCol`); out.add(`${b}:mainCol`); }
    if (role === 'introCol') out.add(`${b}:text`);
  }
  return out;
}
const lastClasses = (branch) => {
  const parts = splitTop(branch, (s, i) => { const m = /^\s*[>+~]\s*|^\s+/.exec(s.slice(i)); return m ? m[0].length : 0; });
  return compound(parts[parts.length - 1].text.trim()).classes.map((c) => `.${c}`);
};
const introKnobs = (branch) => new Set([...branch.matchAll(/data-intro-(position|align)/gi)].map((m) => m[1].toLowerCase()));

/** 规则的完整选择器：CSS 嵌套按父规则展开（`&` 替换；没有 `&` 的接在父后面）。 */
function fullSelectors(rule) {
  const own = commas(rule.selector.replace(/\s+/g, ' '));
  let up = rule.parent;
  while (up && up.type !== 'rule' && up.type !== 'root') up = up.parent;
  if (!up || up.type !== 'rule') return own;
  const parents = fullSelectors(up);
  return parents.flatMap((p) => own.map((s) => (s.includes('&') ? s.replace(/&/g, p) : `${p} ${s}`)));
}

/** 一份 CSS 的违例：[{ line, msg }]。 */
function violations(file, text, own) {
  const block = file.split('/')[1];
  let root;
  try { root = postcss.parse(text, { from: file }); } catch (e) { return [{ line: e.line || 0, msg: `解析不了：${e.reason || e.message}` }]; }
  const out = [];
  root.walkDecls((decl) => {
    if (!decl.parent || decl.parent.type !== 'rule') return;
    const prop = decl.prop.toLowerCase().replace(/^-(webkit|moz|ms|o)-/, '');
    if (prop.startsWith('--')) return;
    for (const br of fullSelectors(decl.parent)) {
      const where = `${file}:${decl.source.start.line}`;
      // (a) 位置 + 属性族
      const hit = [...targetRoles(br, own)].filter((r) => FAMILIES[ROLE_FAMILY[r.split(':')[1]]](prop));
      const exempt = EXEMPT.some((e) => e.block === block && e.props.includes(prop) && (e.value === undefined || decl.value.trim() === e.value) && introKnobs(br).size === 0
        && (e.cond ? br.includes(`[${e.cond}=`) : !/\[data-/.test(br.replace(/^\[data-block="[^"]+"\]/, ''))) && lastClasses(br).includes(e.target));
      if (hit.length && !exempt) { out.push({ line: decl.source.start.line, msg: `${where} \`${br}\` 的 ${prop} 落在块头元素 ${hit.join(' / ')} 上 —— 块头排版只在 manifest 的 introLayout 里写` }); continue; }
      // (b) 块头条件
      const knobs = introKnobs(br);
      if (!knobs.size) continue;
      const keep = KEEP.some((k) => k.block === block && lastClasses(br).includes(k.target) && k.props.includes(prop) && [...knobs].every((n) => k.knobs.includes(n)));
      if (!keep) out.push({ line: decl.source.start.line, msg: `${where} \`${br}\` 的 ${prop} 按 data-intro-${[...knobs].join(' / data-intro-')} 写 —— 不在「块自己的部件」清单里（intro-layout.test.js KEEP），归 introLayout` });
    }
  });
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════════
const blocks = readBlocks();
const own = ownedTokens(blocks);

console.log('── ① 射程从数据派生：有块头旋钮的块都写了 introLayout');
{
  const scope = blocks.filter((b) => knobsOf(b.manifest).some((k) => k.name === 'introAlign' || k.name === 'introPosition'));
  check(scope.length > 0, `有 introAlign / introPosition 的块 ${scope.length} 个：${scope.map((b) => b.block).join(' ')}`);
  const probs = [];
  for (const { block, manifest } of blocks) {
    const inScope = scope.some((b) => b.block === block);
    if (!inScope) { if (manifest.introLayout) probs.push(`${block}：没有块头旋钮却写了 introLayout`); continue; }
    if (!manifest.introLayout) { probs.push(`blocks/${block}/manifest.json：有块头旋钮却没写 introLayout`); continue; }
    let L;
    try { L = introLayoutOf(manifest, block); } catch (e) { probs.push(e.message); continue; }
    const pos = knobsOf(manifest).find((k) => k.name === 'introPosition');
    const full = pos && ['left', 'right', 'top', 'bottom'].every((v) => pos.values.includes(v));
    if (full && !L.hasFrame) probs.push(`blocks/${block}/manifest.json：introPosition 有 left / right / top / bottom，introLayout 却没写 frame / introCol / mainCol`);
  }
  check(!probs.length, probs.length ? probs.join(' · ') : '每个都写了，形状都过 introLayoutOf 的校验');
  const roles = new Set(own.map((o) => `${o.block}:${o.role}`));
  const missing = scope.flatMap(({ block, manifest }) => ['text', 'frame', 'introCol', 'mainCol'].filter((r) => manifest.introLayout && manifest.introLayout[r] && !own.some((o) => o.block === block && o.role === r && o.token.startsWith('tag:'))).map((r) => `${block}.${r}`));
  const aliases = own.filter((o) => !o.token.startsWith('tag:') && !Object.values(blocks.find((b) => b.block === o.block).manifest.introLayout).includes(o.token));
  check(!missing.length, missing.length ? `这些元素在块的 *.tsx 里找不到开标签（别名取不到 ⟹ ② 只认 class）：${missing.join(' ')}` : `块头元素 ${roles.size} 个，开标签全部在 *.tsx 里找到，取到别名 ${aliases.length} 个（${[...new Set(aliases.map((o) => o.token))].join(' ')}）`);
}

console.log('\n── ② 块自己的 CSS 里没有块头排版');
const files = blocks.flatMap((b) => b.css);
{
  const v = files.flatMap((f) => violations(f.file, f.text, own));
  check(files.length > 0, `扫了 ${files.length} 份 CSS（${blocks.length} 个块的 block.css + shape.css）`);
  check(!v.length, v.length ? `${v.length} 处：\n      ${v.map((x) => x.msg).join('\n      ')}` : '0 处');
}

console.log('\n── ③ 读数：带块头条件的规则还剩几条（只许是 KEEP 里的）');
{
  let rules = 0; const hits = new Map(KEEP.map((k) => [k, 0])); const lines = [];
  for (const f of files) {
    postcss.parse(f.text).walkRules((r) => {
      if (!r.nodes.some((n) => n.type === 'decl')) return;
      const brs = fullSelectors(r).filter((b) => introKnobs(b).size);
      if (!brs.length) return;
      rules += 1; lines.push(`${f.file}:${r.source.start.line}`);
      for (const k of KEEP) if (f.file.split('/')[1] === k.block && brs.some((b) => lastClasses(b).includes(k.target))) hits.set(k, hits.get(k) + 1);
    });
  }
  check(rules === KEEP_RULES, `块自己的 CSS 里带 data-intro-position / data-intro-align 的规则 ${rules} 条（期望 = KEEP 的 ${KEEP_RULES} 条）：${lines.join(' · ')}`);
  const stale = [...hits].filter(([, n]) => n === 0).map(([k]) => `${k.block} ${k.target}`);
  check(!stale.length, stale.length ? `KEEP 过期（这几条已经不在块里了，把清单删掉）：${stale.join(' · ')}` : `KEEP 的 ${KEEP.length} 项全部还在块里`);
  const ex = EXEMPT.filter((e) => !files.some((f) => f.file.split('/')[1] === e.block && f.text.includes(e.target) && (!e.cond || f.text.includes(`[${e.cond}=`))));
  check(!ex.length, ex.length ? `EXEMPT 过期：${ex.map((e) => `${e.block} ${e.target}`).join(' · ')}` : `EXEMPT 的 ${EXEMPT.length} 项还在块里`);
}

console.log('\n── ④ 生成物');
{
  const gen = blocks.map((b) => ({ b: b.block, css: introLayoutCss(b.manifest, b.block) })).filter((x) => x.css);
  check(gen.length === blocks.filter((b) => b.manifest.introLayout).length, `生成了 ${gen.length} 个块的块头排版`);
  const phys = gen.filter((x) => /(^|[\s;{])(margin|padding|border)-(left|right)\s*:|text-align:\s*(left|right)\b|(^|[\s;{])(left|right)\s*:|float:\s*(left|right)/m.test(x.css)).map((x) => x.b);
  check(!phys.length, phys.length ? `用了物理方向属性：${phys.join(' ')}` : '只用逻辑属性（text-align: end · margin-inline-* …）');
  const shapes = fs.readFileSync(path.join(NEXT, 'public', 'shapes.css'), 'utf8');
  const missing = gen.filter((x) => !shapes.includes(x.css)).map((x) => x.b);
  check(!missing.length, missing.length ? `public/shapes.css 里没有这几块的生成物（跑 node scripts/block-build/build-blocks.js）：${missing.join(' ')}` : 'public/shapes.css 里逐字含每一块的生成物');
}

console.log('\n── ⑤ 故意改坏（每一条都要红、点名文件:行）');
{
  const base = (b) => files.find((f) => f.file === `blocks/${b}/block.css`);
  const inject = (b, extra, file) => {
    const f = file ? { file, text: '' } : base(b);
    const text = `${f.text}\n${extra}\n`;
    const line = f.text.split('\n').length + 1 + extra.split('\n').findIndex((l) => /:\s*[^;{]+;/.test(l));
    return { v: violations(f.file, text, own), want: `${f.file}:${line}` };
  };
  const RED = [
    ['照抄回去', 'blog', '[data-block="blog"][data-intro-align="center"] .bl-intro-text {\n  text-align: center;\n}'],
    ['侧列宽 · flex 简写', 'faq', '@media (min-width: 992px) {\n  [data-block="faq"][data-intro-position="left"] .fq-introcol { flex: 0 0 40%; }\n}'],
    ['无条件 · 相对单位', 'team', '[data-block="team"] .tm-introcol {\n  width: 40cqw;\n}'],
    ['外框里的 > *', 'gallery', '[data-block="gallery"] .gl-frame > * {\n  width: 50%;\n}'],
    ['换画法', 'logos', '[data-block="logos"] .lo-frame {\n  display: block;\n}'],
    ['反向', 'reviews', '[data-block="reviews"] .rv-frame {\n  flex-flow: row-reverse wrap;\n}'],
    ['别名 data-part', 'blog', '[data-block="blog"] [data-part="intro-text"] {\n  text-align: end;\n}'],
    ['别名 Bootstrap class', 'features', '[data-block="features"] .row.fx-frame, [data-block="features"] .fx-frame.row {\n  flex-direction: column-reverse;\n}'],
    ['别名 col-12 + 属性前缀', 'pricing', '[data-block="pricing"] [data-part^="pla"] {\n  max-width: 50%;\n}'],
    ['[class~=]', 'milestones', '[data-block="milestones"] [class~="mi-statscol"] {\n  flex-basis: 60%;\n}'],
    ['sticky 定位', 'testimonials', '[data-block="testimonials"] .tn-introcol {\n  position: static;\n}'],
    ['块头列里的 > *', 'team', '[data-block="team"] .tm-introcol > * {\n  margin-inline: auto;\n}'],
    ['跟随部件照抄回去', 'features', '[data-block="features"][data-intro-align="right"] .fx-ctas {\n  justify-content: flex-end;\n}'],
    ['跟随部件换属性', 'faq', '[data-block="faq"][data-intro-align="center"] .fq-help {\n  margin-inline-start: auto;\n}'],
    ['属性不带值', 'reviews', '[data-block="reviews"][data-intro-align] .rv-total {\n  justify-content: center;\n}'],
    [':not()', 'blog', '[data-block="blog"]:not([data-intro-position="top"]) .bl-item {\n  text-align: center;\n}'],
    [':is()', 'gallery', '[data-block="gallery"]:is([data-intro-align="center"]) .gl-item {\n  margin-inline: auto;\n}'],
    ['大写属性名', 'team', '[data-block="team"][DATA-INTRO-ALIGN="center"] .tm-member {\n  text-align: center;\n}'],
    ['CSS 嵌套', 'blog', '[data-block="blog"] .bl-frame {\n  & > .bl-introcol { width: 25%; }\n}'],
    ['KEEP 部件换了旋钮', 'pricing', '[data-block="pricing"][data-intro-position="left"] .pr-hl {\n  width: 50%;\n}'],
    ['KEEP 部件加了清单外的属性', 'logos', '[data-block="logos"][data-intro-position="left"] .lo-grid {\n  flex-wrap: nowrap;\n}'],
  ];
  for (const [name, b, css] of RED) {
    const { v, want } = inject(b, css);
    check(v.some((x) => x.msg.startsWith(want)), `${name}（${b}）⟹ 红 ${v.length ? v[0].msg.split(' ')[0] : '—'}${v.some((x) => x.msg.startsWith(want)) ? '' : `（期望点名 ${want}）`}`);
  }
  {
    const shape = files.find((f) => /^blocks\/team\/[^/]+\/shape\.css$/.test(f.file));
    const css = `${shape.text}\n[data-block="team"][data-shape="x"] .tm-memberscol {\n  width: 70%;\n}\n`;
    const v = violations(shape.file, css, own);
    check(v.some((x) => x.msg.startsWith(`${shape.file}:`)), `shape.css 里写（${shape.file}）⟹ 红`);
  }
  {
    const m = JSON.parse(JSON.stringify(blocks.find((b) => b.block === 'gallery').manifest));
    delete m.introLayout;
    const scope = knobsOf(m).some((k) => k.name === 'introAlign');
    check(scope && !m.introLayout, '删掉 gallery 的 introLayout ⟹ ① 判「有块头旋钮却没写」（同一判据，射程内无声明）');
    const m2 = JSON.parse(JSON.stringify(blocks.find((b) => b.block === 'blog').manifest));
    m2.introLayout.side = '133%';
    let threw = false; try { introLayoutOf(m2, 'blog'); } catch { threw = true; }
    check(threw, 'introLayout 写坏（side 133%）⟹ introLayoutOf 当场抛错（构建红）');
  }

  console.log('\n── ⑤ 反向对照（必须不红）');
  const GREEN = [
    ['块头的字换颜色', 'blog', '[data-block="blog"][data-tone="dark"] .bl-intro-text {\n  color: #fff;\n}'],
    ['块头的字上下外边距', 'gallery', '[data-block="gallery"] .gl-intro-text {\n  margin-bottom: 1rem;\n}'],
    ['块头的字里面的子元素', 'team', '[data-block="team"] .tm-intro-text > :last-child {\n  margin-bottom: 0 !important;\n}'],
    ['块头列的伪元素', 'faq', '[data-block="faq"] .fq-introcol::before {\n  content: "";\n  width: 2rem;\n}'],
    ['外框的列距变量', 'logos', '[data-block="logos"] .lo-frame {\n  --bs-gutter-y: 2rem;\n}'],
    ['KEEP 里的部件改值', 'reviews', '@media (min-width: 992px) {\n  [data-block="reviews"][data-items-layout="grid"][data-intro-position="top"] .rv-items {\n    grid-template-columns: repeat(3, minmax(0, 1fr));\n  }\n}'],
    ['不相干的旋钮', 'features', '[data-block="features"][data-intro-image="left"] .fx-item {\n  text-align: center;\n}'],
  ];
  for (const [name, b, css] of GREEN) {
    const { v } = inject(b, css);
    check(!v.length, `${name}（${b}）⟹ 不红${v.length ? `（却红了：${v[0].msg}）` : ''}`);
  }
}

console.log(`\n${fail ? '❌' : '✅'} intro-layout: ${pass} 过 / ${fail} 不过`);
process.exit(fail ? 1 : 0);
