#!/usr/bin/env node
/**
 * region-options.test.js — #1738：顶栏 / 页脚的「预设 + 底色 + 旋钮」，编辑器存下去、构建派生出来，两边是同一个样子。
 *
 *   node scripts/region-options.test.js     （由 `npm run test:scripts` 自动发现）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * ① `lib/region-options.js` 的几个纯函数（清洗 / 叠加 / 选预设 / 拧旋钮的耦合纠正 / 认预设）。
 * ② 票正文验收 5：拿**编辑器那条写盘路**（`write-editor-save.js`，worker 在站容器里调的同一个）写出 theme.json，再跑一次
 *    **真构建**（`sync-config.js`，写 `src/lib/config-data.ts`），顶栏一格、页脚一格：构建派生出来的形态、底色、旋钮
 *    跟编辑器打开时读到的（`editor-root.js` §readRootValues，编辑器 root 的初值）一致，生效的预设也一致。
 *    反向：把构建读 `regionOptions` 那一步拿掉（换一份被改过的 `site-regions.js`）⟹ 这一格红。
 *
 * 夹具用仓里那条 skipAI 建站路造一个真站（同 editor-root.test.js），在拷出来的那棵模板里跑。
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const NEXT = path.resolve(__dirname, '..');

let pass = 0; let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const check = (cond, m, detail) => (cond ? ok(m) : bad(detail ? `${m} —— ${detail}` : m));
function die(msg) { console.log(`💥 ${msg}`); process.exit(2); }
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const temps = [];
process.on('exit', () => { for (const t of temps) fs.rmSync(t, { recursive: true, force: true }); });

let ro;
try {
  ro = require('./lib/region-options.js');
} catch (e) {
  die(`加载不起来：${e.message}`);
}

// ══ ① 纯函数 ═════════════════════════════════════════════════════════════════════════════════════
console.log('① region-options.js');
{
  check(same(ro.regionOptionsProblems('header', { bg: '#0f172a', logo: 'center', menu: 'below', topbar: true, icons: false }), []),
    '顶栏：底色 + 两个旋钮 + 两个开关都认');
  const probs = ro.regionOptionsProblems('header', { bg: 'nope', menu: 'sideways', foo: 1, icons: 'yes' });
  check(probs.length === 4, '顶栏：坏底色 / 值域外的旋钮 / 不认识的键 / 不是布尔的开关 ⟹ 各点一次名', JSON.stringify(probs));
  check(ro.regionOptionsProblems('footer', { topbar: true }).length === 1, '页脚没有 topbar 这个开关 ⟹ 点名');
  check(same(ro.cleanRegionOptions('header', { bg: '#0F172A', menu: 'x', logo: 'center', foo: 1 }), { bg: '#0f172a', logo: 'center' }),
    '清洗：底色归一化成小写、坏的那几格丢掉');
  const data = { brandName: 'A', options: { icons: false } };
  check(ro.applyRegionOptions(data, {}) === data, '没存东西 ⟹ 原样回（同一个对象，站上一个字节不变）');
  check(same(ro.applyRegionOptions(data, { bg: 'brand', menu: 'below' }), { brandName: 'A', options: { icons: false, menu: 'below' }, bg: 'brand' }),
    '叠加：底色进 `bg`，旋钮并进 `options`');
  check(same(ro.regionKnobChange('header', 'logo-left', {}, 'menu', 'below'), { logo: 'center', menu: 'below' }),
    '拧 menu=below（logo 还是 left）⟹ 按「刚拧的是 menu」纠正，logo 跟着变 center，两个一起存');
  check(ro.regionPresetName('header', 'logo-left', { logo: 'center', menu: 'below' }) === 'stacked', '那一组就是 stacked 预设');
  check(same(ro.regionPresetPick('header', 'topbar', { bg: '#111111', logo: 'center', menu: 'below', icons: true, topbar: false }),
    { shape: 'topbar', options: { bg: '#111111', icons: true } }), '选预设：形态换掉、旋钮和归预设管的开关清掉，底色和 icons 留着');
  // #1784 r7 —— logoType 不在 Customize（logo 的东西都在 Content 页的 Logo 子页）；logoSize 是数字，本来就不是旋钮。
  check(same(ro.customizeKnobNames('header'), ['logo', 'menu']) && same(ro.customizeKnobNames('footer'), ['brand', 'form']),
    'Customize 页：顶栏 logo / menu（#1784 r7 起 logoType 不在这一页）；页脚 brand / form（layout 就是预设本身）', JSON.stringify(ro.customizeKnobNames('header')));
  // #1784 —— logoType 声明在 `knobs` 里，但没有任何预设写到它 ⟹ 不归预设管（`header-knobs.js` 文件头）；
  //   r7：logoSize 是数字（图高 px），声明在 `slots.options.numbers`：24–80、步长 4。
  check(same(ro.regionOptionsProblems('header', { logoType: 'image', logoSize: 80 }), []), '#1784：顶栏认 logoType / logoSize（数字）');
  for (const ok of [24, 40, 44, 76, 80]) check(same(ro.regionOptionsProblems('header', { logoSize: ok }), []), `#1784 r7：logoSize=${ok} 收`);
  for (const no of ['xl', 'm', '40', 20, 84, 42, 40.5, null, true]) {
    check(ro.regionOptionsProblems('header', { logoSize: no }).length === 1, `#1784 r7：logoSize=${JSON.stringify(no)} 拒收（r6 的四档字符串、范围外、不在步上、不是数）`);
  }
  check(ro.regionOptionsProblems('header', { logoType: 'both', logoSize: 'xxl' }).length === 2, '#1784：值域外的 logoType / logoSize 各点一次名');
  check(ro.regionOptionsProblems('footer', { logoSize: 40 }).length === 1, '#1784：页脚不单独设 logo 大小 ⟹ 写在页脚那份里点名');
  check(same(ro.cleanRegionOptions('header', { logoType: 'text', logoSize: 'huge' }), { logoType: 'text' }), '#1784：清洗留合法的那一格');
  check(same(ro.cleanRegionOptions('header', { logoType: 'image', logoSize: 'xl' }), { logoType: 'image' }), '#1784 r7：r6 存下的四档字符串在构建那一侧丢掉（⟹ 默认 40，不迁移）');
  check(same(ro.cleanRegionOptions('header', { logoSize: 64 }), { logoSize: 64 }), '#1784 r7：合法的数字留着');
  check(same(ro.regionPresetPick('header', 'stacked', { logo: 'left', menu: 'center', logoType: 'text', logoSize: 64, topbar: true }),
    { shape: 'stacked', options: { logoType: 'text', logoSize: 64 } }), '#1784 验收 6：点预设 ⟹ 预设旋钮 / topbar 清掉，logoType / logoSize 留着');
  check(ro.regionPresetName('header', 'topbar', { logoType: 'text', logoSize: 24 }) === 'topbar', '#1784：存了 logoType / logoSize 仍认得出是哪个预设（不是 custom）');
  check(same(ro.regionKnobChange('header', 'logo-left', { logo: 'left', menu: 'beside' }, 'logoSize', 52), { logo: 'left', menu: 'beside', logoSize: 52 }),
    '#1784：拧 logoSize 只写它自己，预设旋钮不动');
  check(same(ro.regionKnobChange('header', 'logo-left', { logoSize: 52 }, 'logoSize', 'huge'), { logoSize: 52 }), '#1784：值域外的值不写进去');
  check(same(ro.regionKnobChange('header', 'logo-left', { logoSize: 52 }, 'logoSize', 82), { logoSize: 52 }), '#1784 r7：范围外的数不写进去');
  check(same(ro.regionNumbers('header').map((n) => [n.name, n.min, n.max, n.step, n.default]), [['logoSize', 24, 80, 4, 40]]) && same(ro.regionNumbers('footer'), []),
    '#1784 r7：regionNumbers —— 顶栏 logoSize 24–80/4 默认 40，页脚没有');
  // 🔴 拧 logo / menu 会把整组生效旋钮一起存（耦合纠正要它）—— 不归预设管的那两个不许被顺手填上默认存下：logoType 一旦被存成
  //    text，`brand.logoHasWordmark` 那条默认就再也不起作用了。
  const turned = ro.regionKnobChange('header', 'logo-left', {}, 'menu', 'center');
  check(same(turned, { logo: 'left', menu: 'center' }), '#1784：拧 menu ⟹ 只存 logo / menu，logoType / logoSize 不被顺手存下', JSON.stringify(turned));
  check(same(Object.keys(ro.effectiveRegionKnobs('header', 'logo-left', {})).sort(), ['logo', 'menu', 'topbar']),
    '#1784：生效值里只有归预设管的那几格（logoType / logoSize 没有预设给的底）');
  check(same(ro.regionFreeKnobNames('header'), ['logoType', 'logoSize']) && same(ro.regionFreeKnobNames('footer'), []),
    '#1784：不归预设管的那几格 —— 顶栏 logoType（旋钮）/ logoSize（r7：数字），页脚没有');
  check(same(ro.customizeGroups('header'), [['logo', 'menu', 'bool:topbar', 'bool:sticky'], ['bool:icons']]),
    '#1784 r7：顶栏 Customize 的分组 —— 只剩排版（位置 / 菜单 / 顶条 / 吸顶 → 图标），没有 logo 的东西', JSON.stringify(ro.customizeGroups('header')));
  // 反向对照：Customize 不过滤不归预设管的旋钮 ⟹ logoType 又回到这一页（上一格读得出差别）。
  const bk = require('./lib/block-knobs.js');
  const m = JSON.parse(fs.readFileSync(path.join(NEXT, 'blocks', 'header', 'manifest.json'), 'utf-8'));
  const unfiltered = bk.arrangeToolbar(['logo', 'menu', 'logoType', 'bool:topbar', 'bool:sticky', 'bool:icons'], bk.toolbarGroupsOf(m));
  check(!same(unfiltered, ro.customizeGroups('header')) && unfiltered.flat().includes('logoType'),
    '反向对照：不过滤 logoType ⟹ 分组里多出它（上一格读得出差别）', JSON.stringify(unfiltered));
  // 读的是没展开共用槽的原始 manifest（`bg` 还是 `{ ref }`）⟹ `color:bg` 那一条恒被点名，跟本票无关，滤掉。
  const declProbs = bk.knobDeclarationProblems(m).filter((x) => !x.includes('"color:bg"'));
  check(same(declProbs, []), '#1784：header manifest 的声明（两个没有预设写到的旋钮、toolbarGroups 里的两个新 token）没有问题', JSON.stringify(declProbs));
  const m2 = JSON.parse(JSON.stringify(m)); m2.presets[0].knobs.logoType = 'text';
  check(bk.knobDeclarationProblems(m2).some((x) => x.includes('logoType')), '反向对照：只有一个预设写了 logoType ⟹ 它归预设管了，别的预设没写 ⟹ 声明校验点名');
  // #1788 —— 构建那一侧（给了形态）：menu 存着值域外的字符串（被删掉的 split / gathered、手写坏的）⟹ 就地纠正成跟 logo 走的那个值，不丢。
  for (const old of ['gathered', 'split', 'x']) {
    check(same(ro.cleanRegionOptions('header', { menu: old }, 'stacked'), { menu: 'left' }), `形态 stacked（logo=center）+ menu=${old} ⟹ left（不丢、不落回 stacked 的 below）`);
    check(same(ro.cleanRegionOptions('header', { menu: old }, 'logo-left'), { menu: 'beside' }), `形态 logo-left + menu=${old} ⟹ beside`);
    check(same(ro.cleanRegionOptions('header', { logo: 'center', menu: old }, 'logo-left'), { logo: 'center', menu: 'left' }), `存着 logo=center + menu=${old}（形态 logo-left）⟹ 跟存着的 logo 走 ⟹ left`);
  }
  check(same(ro.readRegionOptions({ regionOptions: { header: { menu: 'gathered', bg: '#0F172A' } } }, { header: 'stacked' }).header, { bg: '#0f172a', menu: 'left' }),
    'readRegionOptions 把形态递下去 ⟹ stacked + gathered ⟹ left（底色照旧归一化）');
  // 反向对照：不给形态（写盘那一侧的清洗）⟹ 照旧丢掉；写盘本身由 regionOptionsProblems 拒收值域外的值。
  check(same(ro.cleanRegionOptions('header', { menu: 'gathered' }), {}) && ro.regionOptionsProblems('header', { menu: 'gathered' }).length === 1,
    '反向对照：不给形态 ⟹ 值域外的 menu 照旧丢掉；写盘照旧拒收');
  // #1784 × #1788（QA2 r5 点名）—— theme.json 存着被删的 menu + 两个不归预设管的旋钮 ⟹ menu 被纠正，logoType / logoSize 原样留着。
  //   （被纠正的 menu 最后才写进去，所以排在末尾 —— 跟上面 #1788 那格的 `{ bg, menu }` 同一个次序。）
  check(same(ro.readRegionOptions({ regionOptions: { header: { menu: 'split', logoType: 'image', logoSize: 64 } } }, { header: 'stacked' }).header,
    { logoType: 'image', logoSize: 64, menu: 'left' }), '#1784 × #1788：stacked + menu=split + logoType=image + logoSize=64 ⟹ menu=left，logoType / logoSize 不动');
  check(same(ro.cleanRegionOptions('header', { menu: 'gathered', logoType: 'text', logoSize: 28 }, 'logo-left'), { logoType: 'text', logoSize: 28, menu: 'beside' }),
    '#1784 × #1788：logo-left + menu=gathered ⟹ beside，logoType / logoSize 不动');
}

// ══ ② 验收 5：编辑器写的 theme.json → 真构建 → 跟编辑器读到的一致 ══════════════════════════════════
function makeTemplate() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'region-options-'));
  temps.push(root);
  const work = path.join(root, 'nextjs');
  cp.execSync(`cp -a --no-dereference "${NEXT}" "${work}"`, { stdio: 'pipe' });
  for (const junk of ['out', '.next', '.out-backup', '.out-temp', 'site', 'node_modules']) {
    fs.rmSync(path.join(work, junk), { recursive: true, force: true });
  }
  fs.symlinkSync(path.join(NEXT, 'node_modules'), path.join(work, 'node_modules'));
  const r = cp.spawnSync(process.execPath, [path.join(work, 'scripts', 'create-site.js')], {
    input: JSON.stringify({ siteId: 'rotest01', siteUrl: 'https://rotest01.example.com', companyName: 'Northside Auto Care', industry: 'auto repair', location: 'Toronto', skipAI: true }),
    cwd: work, encoding: 'utf8', env: { ...process.env, ANTHROPIC_API_KEY: undefined }, timeout: 180000,
  });
  if (!fs.existsSync(path.join(work, 'site', 'theme.json'))) die(`夹具立不起来（rc=${r.status}）\n${(r.stderr || '').slice(-600)}`);
  return work;
}

/** 编辑器那条写盘路：`write-editor-save.js`（只带 root，跟编辑器只改外壳时交出去的那一笔同形）。 */
function editorSave(work, root) {
  const r = cp.spawnSync(process.execPath, [path.join(work, 'scripts', 'write-editor-save.js'), JSON.stringify({ page: 'home', locale: 'en' })], {
    cwd: work, input: JSON.stringify({ root }), encoding: 'utf8', timeout: 60000,
  });
  if (r.status !== 0) die(`写盘脚本拒了（rc=${r.status}）：${r.stdout}${r.stderr}`);
}
/** 真构建：`sync-config.js`，读它写出来的 `src/lib/config-data.ts` 里那行 `regions`。 */
function build(work) {
  const r = cp.spawnSync(process.execPath, [path.join(work, 'scripts', 'sync-config.js')], { cwd: work, encoding: 'utf8', timeout: 300000 });
  if (r.status !== 0) die(`构建失败（rc=${r.status}）\n${(r.stdout || '').slice(-600)}${(r.stderr || '').slice(-600)}`);
  const line = fs.readFileSync(path.join(work, 'src', 'lib', 'config-data.ts'), 'utf8').split('\n').find((l) => l.startsWith('export const regions = '));
  if (!line) die('config-data.ts 里没有 `export const regions` 那一行 —— 这一格量不到东西');
  return JSON.parse(line.slice('export const regions = '.length).replace(/;\s*$/, ''));
}
/** 编辑器打开时读到的 root（`editor-root.js` §readRootValues —— 编辑器 root 的初值、Design 面板据它画）。 */
function editorSees(work) {
  const lib = require(path.join(work, 'scripts', 'lib', 'editor-root.js'));
  const site = path.join(work, 'site');
  return lib.readRootValues({ siteDir: site, localeDir: path.join(site, 'en'), locale: 'en', layoutsDir: path.join(work, 'page-layouts') });
}
/** 两边比：形态、底色 + 旋钮（存下的那份）、生效的预设（形态给底 + 旋钮盖上去之后）。 */
function regionProblems(regions, seen, region) {
  const k = { header: ['headerShape', 'headerOptions'], footer: ['footerShape', 'footerOptions'] }[region];
  const built = regions[region] || {};
  const out = [];
  if (built.shape !== seen[k[0]]) out.push(`${region} 形态：构建 ${built.shape} · 编辑器 ${seen[k[0]]}`);
  if (!same(built.options || {}, seen[k[1]])) out.push(`${region} 底色/旋钮：构建 ${JSON.stringify(built.options)} · 编辑器 ${JSON.stringify(seen[k[1]])}`);
  // 外壳渲染时叠进 data 的那一步（SiteShell §shellBlockData → applyRegionOptions），生效的预设两边一样。
  const data = ro.applyRegionOptions((built.dataByLocale || {}).en || {}, built.options);
  const live = ro.regionPresetName(region, built.shape, { ...(data.options || {}), ...(data.bg !== undefined ? { bg: data.bg } : {}) });
  const want = ro.regionPresetName(region, seen[k[0]], seen[k[1]]);
  if (live !== want) out.push(`${region} 生效的预设：构建 ${live} · 编辑器 ${want}`);
  if (seen[k[1]].bg !== undefined && !same(data.bg, seen[k[1]].bg)) out.push(`${region} 底色没进外壳 data：${JSON.stringify(data.bg)}`);
  return out;
}

console.log('② 验收 5：编辑器存的 theme.json → 构建 → 跟编辑器读到的一致');
const WORK = makeTemplate();
{
  editorSave(WORK, {
    headerShape: 'logo-center', headerOptions: { bg: '#0f172a', menu: 'below', logo: 'center', icons: true },
    footerShape: 'columns', footerOptions: { bg: 'brand', brand: 'right', form: 'teaser' },
  });
  const theme = JSON.parse(fs.readFileSync(path.join(WORK, 'site', 'theme.json'), 'utf8'));
  check(same(theme.regionOptions, { header: { bg: '#0f172a', menu: 'below', logo: 'center', icons: true }, footer: { bg: 'brand', brand: 'right', form: 'teaser' } })
    && same(theme.regionLayout, { header: 'logo-center', footer: 'columns' }),
    '写盘：theme.json 里是 regionLayout + regionOptions 两段', JSON.stringify({ regionLayout: theme.regionLayout, regionOptions: theme.regionOptions }));
  const regions = build(WORK);
  const seen = editorSees(WORK);
  const h = regionProblems(regions, seen, 'header');
  check(!h.length, `顶栏：构建出来的形态 / 底色 / 旋钮 / 生效的预设（${ro.regionPresetName('header', seen.headerShape, seen.headerOptions)}）跟编辑器读到的一致`, h.join(' · '));
  const f = regionProblems(regions, seen, 'footer');
  check(!f.length, `页脚：同上（${ro.regionPresetName('footer', seen.footerShape, seen.footerOptions)}）`, f.join(' · '));
  check(regions.header.options && regions.header.options.menu === 'below' && regions.header.shape === 'logo-center',
    '顶栏真的是存进去的那一组（不是两边都读空、空等于空）', JSON.stringify(regions.header.options));

  // 清空：底色 + 旋钮交一个空对象 ⟹ theme.json 里那一段删掉，构建出来没有 options 键。
  editorSave(WORK, { headerOptions: {}, footerOptions: {} });
  const theme2 = JSON.parse(fs.readFileSync(path.join(WORK, 'site', 'theme.json'), 'utf8'));
  const regions2 = build(WORK);
  check(!('regionOptions' in theme2) && !('options' in regions2.header) && !('options' in regions2.footer),
    '交空对象 ⟹ theme.json 没有 regionOptions、构建产物没有 options 键', JSON.stringify({ t: theme2.regionOptions, h: regions2.header.options }));

  // #1788 —— 老站 theme.json 里手写 / 残留的 menu=gathered（写盘那条路发不出它，直接写文件）：真构建出来是 left，编辑器读到的也是 left。
  {
    const tp = path.join(WORK, 'site', 'theme.json');
    const t = JSON.parse(fs.readFileSync(tp, 'utf8'));
    fs.writeFileSync(tp, `${JSON.stringify({ ...t, regionLayout: { ...(t.regionLayout || {}), header: 'stacked' }, regionOptions: { header: { menu: 'gathered' } } }, null, 2)}\n`);
    const r3 = build(WORK);
    const seen3 = editorSees(WORK);
    check(r3.header.shape === 'stacked' && same(r3.header.options, { menu: 'left' }) && same(seen3.headerOptions, { menu: 'left' })
      && ro.regionPresetName('header', 'stacked', seen3.headerOptions) === 'logo-center',
      '手写 stacked + menu=gathered ⟹ 构建产物和编辑器都读成 menu=left，生效的预设是 logo-center',
      JSON.stringify({ shape: r3.header.shape, built: r3.header.options, editor: seen3.headerOptions }));
  }

  // 反向：构建那一侧不读 regionOptions（被改过的 site-regions.js）⟹ 上面那一格红。
  editorSave(WORK, { headerOptions: { bg: '#0f172a', menu: 'below', logo: 'center' } });
  const sr = path.join(WORK, 'scripts', 'lib', 'site-regions.js');
  const orig = fs.readFileSync(sr, 'utf8');
  const cut = "for (const r of ['header', 'footer']) if (regions[r] && Object.keys(options[r]).length) regions[r].options = options[r];";
  if (!orig.includes(cut)) die('site-regions.js 里找不到挂 options 的那一行 —— 反向那一格没法做，先改这里');
  fs.writeFileSync(sr, orig.replace(cut, ''));
  const broken = regionProblems(build(WORK), { ...editorSees(WORK), headerOptions: { bg: '#0f172a', menu: 'below', logo: 'center' } }, 'header');
  fs.writeFileSync(sr, orig);
  check(broken.length > 0, '反向：构建不读 regionOptions ⟹ 顶栏那一格会红', JSON.stringify(broken));
}

console.log(`\n══ region-options: ${pass} 过 · ${fail} 失败 ══`);
process.exit(fail ? 1 : 0);
