#!/usr/bin/env node
/**
 * text-dir.test.js — 站级文字方向（#1473）的机械检查。
 *
 * 跑法:  node scripts/lib/text-dir.test.js      （`npm run test:scripts` 会自动发现它）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 *   ① `dirForLocale`：ar / he / fa / ur（含 `ar-EG` / `fa_IR` / 大写）⟹ rtl，其余与空值 ⟹ ltr
 *   ② `writeSiteCss`：在一个临时模板根上真编一次 LTR、一次 RTL（同一份内容）——
 *      · 同一条规则 `.ms-2`：LTR 是 margin-left、RTL 是 margin-right（两份里都必须找得到它，找不到是读数没取到）
 *      · RTL 那份有图标翻转（四个名字都在、chevron-down 不在），LTR 那份一条都没有
 *      · LTR 那份跟改前的链路（compile → purge，不过 RTLCSS、不追加）逐字节相同
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

let failed = 0;
const ok = (m) => console.log(`  ✅ ${m}`);
const bad = (m) => { failed += 1; console.log(`  ❌ ${m}`); };
const eq = (got, want, m) => (got === want ? ok(`${m} → ${JSON.stringify(got)}`) : bad(`${m}：期望 ${JSON.stringify(want)}，读到 ${JSON.stringify(got)}`));
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };

let td, siteCss;
try {
  td = require('./text-dir.js');
  siteCss = require('./site-css.js');
} catch (e) {
  die(e.message);
}
const NEXT = path.resolve(__dirname, '..', '..');

console.log('① dirForLocale');
for (const l of ['ar', 'he', 'fa', 'ur', 'ar-EG', 'fa_IR', 'AR', ' he ']) eq(td.dirForLocale(l), 'rtl', JSON.stringify(l));
for (const l of ['en', 'zh', 'zh-tw', 'fr', 'ja', 'hi', 'arn', '', null, undefined, 42]) eq(td.dirForLocale(l), 'ltr', JSON.stringify(l));

(async () => {
  console.log('② writeSiteCss：LTR / RTL 各编一次');
  if (!fs.existsSync(path.join(NEXT, 'node_modules', '@webpixels', 'css'))) die('没有 node_modules/@webpixels/css（先 npm ci）');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tmp-text-dir-'));
  try {
    fs.symlinkSync(path.join(NEXT, 'node_modules'), path.join(root, 'node_modules'));
    fs.mkdirSync(path.join(root, 'public'));
    fs.mkdirSync(path.join(root, 'src'));
    fs.mkdirSync(path.join(root, 'blocks'));
    // 内容里有 ms-2（按钮箭头那一格的写法）和 data-icon —— 跟真块一样；没有 `rtl` 这个词。
    fs.writeFileSync(path.join(root, 'src', 'a.tsx'),
      'export const A = () => <a className="btn btn-primary">Go<svg className="ms-2" data-icon="arrow-right" /></a>;\n');
    const brand = { colors: { primary: { 500: '#2563eb' } } };
    const read = () => fs.readFileSync(path.join(root, 'public', 'site.css'), 'utf8');
    const ltrRes = await siteCss.writeSiteCss({ brand, rootDir: root });
    const ltr = read();
    const rtlRes = await siteCss.writeSiteCss({ brand, rootDir: root, dir: 'rtl' });
    const rtl = read();
    eq(ltrRes.dir, 'ltr', '不传 dir 时是 ltr');
    eq(rtlRes.dir, 'rtl', 'dir: rtl 回 rtl');
    const ms2 = (css) => { const m = /\.ms-2\s*\{([^}]*)\}/.exec(css); return m ? m[1].replace(/\s+/g, '') : null; };
    const l = ms2(ltr);
    const r = ms2(rtl);
    if (l === null || r === null) bad(`.ms-2 这条规则没找到（LTR ${l === null ? '缺' : '在'} · RTL ${r === null ? '缺' : '在'}）—— 读数没取到，不是通过`);
    else {
      // 只判属性名（左还是右）—— 值的写法（`.5rem` / `0.5rem`）随 sass 输出格式走，不是这条要判的。
      const side = (decl) => (/margin-left:/.test(decl) ? 'margin-left' : /margin-right:/.test(decl) ? 'margin-right' : decl);
      eq(side(l), 'margin-left', `LTR 的 .ms-2（${l}）`);
      eq(side(r), 'margin-right', `RTL 的 .ms-2（${r}，RTLCSS 真跑了）`);
    }
    for (const n of td.FLIP_ICONS) {
      const sel = `[dir=rtl] [data-icon="${n}"]`;
      if (rtl.includes(sel) && !ltr.includes(sel)) ok(`${sel}：RTL 有、LTR 没有`);
      else bad(`${sel}：RTL ${rtl.includes(sel)} · LTR ${ltr.includes(sel)}`);
    }
    if (!rtl.includes('chevron-down')) ok('chevron-down 不翻（纵向）');
    else bad('RTL site.css 里出现了 chevron-down');
    if (/\[dir=rtl\][^{]*\{\s*transform:\s*scaleX\(-1\)/.test(rtl)) ok('翻转规则是 transform: scaleX(-1)，RTLCSS 之后追加（没被镜像改写）');
    else bad('RTL site.css 里找不到 transform: scaleX(-1) 那条');
    const before = await siteCss.purgeSiteCss(siteCss.compileSiteCss('#2563eb', { rootDir: root }), { rootDir: root });
    if (before === ltr) ok(`LTR 与「不过 RTLCSS、不追加」那条链路逐字节相同（${Buffer.byteLength(ltr)} 字节）`);
    else bad(`LTR 跟改前链路不同：${Buffer.byteLength(before)} vs ${Buffer.byteLength(ltr)} 字节`);
    if (rtl !== ltr) ok('阳性对照：RTL 跟 LTR 不同（上面那条「相同」不是比较器恒真）');
    else bad('RTL 与 LTR 逐字节相同 —— RTLCSS 没跑');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
  console.log(failed ? `\n❌ ${failed} 项失败` : '\n✅ 全过');
  process.exit(failed ? 1 : 0);
})().catch((e) => die(e.stack || e.message));
