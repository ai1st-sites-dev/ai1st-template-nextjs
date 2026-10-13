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
  check(same(ro.customizeKnobNames('header'), ['logo', 'menu']) && same(ro.customizeKnobNames('footer'), ['brand', 'form']),
    'Customize 页：顶栏 logo / menu；页脚 brand / form（layout 就是预设本身）');
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
    headerShape: 'logo-center-split', headerOptions: { bg: '#0f172a', menu: 'below', logo: 'center', icons: true },
    footerShape: 'columns', footerOptions: { bg: 'brand', brand: 'right', form: 'teaser' },
  });
  const theme = JSON.parse(fs.readFileSync(path.join(WORK, 'site', 'theme.json'), 'utf8'));
  check(same(theme.regionOptions, { header: { bg: '#0f172a', menu: 'below', logo: 'center', icons: true }, footer: { bg: 'brand', brand: 'right', form: 'teaser' } })
    && same(theme.regionLayout, { header: 'logo-center-split', footer: 'columns' }),
    '写盘：theme.json 里是 regionLayout + regionOptions 两段', JSON.stringify({ regionLayout: theme.regionLayout, regionOptions: theme.regionOptions }));
  const regions = build(WORK);
  const seen = editorSees(WORK);
  const h = regionProblems(regions, seen, 'header');
  check(!h.length, `顶栏：构建出来的形态 / 底色 / 旋钮 / 生效的预设（${ro.regionPresetName('header', seen.headerShape, seen.headerOptions)}）跟编辑器读到的一致`, h.join(' · '));
  const f = regionProblems(regions, seen, 'footer');
  check(!f.length, `页脚：同上（${ro.regionPresetName('footer', seen.footerShape, seen.footerOptions)}）`, f.join(' · '));
  check(regions.header.options && regions.header.options.menu === 'below' && regions.header.shape === 'logo-center-split',
    '顶栏真的是存进去的那一组（不是两边都读空、空等于空）', JSON.stringify(regions.header.options));

  // 清空：底色 + 旋钮交一个空对象 ⟹ theme.json 里那一段删掉，构建出来没有 options 键。
  editorSave(WORK, { headerOptions: {}, footerOptions: {} });
  const theme2 = JSON.parse(fs.readFileSync(path.join(WORK, 'site', 'theme.json'), 'utf8'));
  const regions2 = build(WORK);
  check(!('regionOptions' in theme2) && !('options' in regions2.header) && !('options' in regions2.footer),
    '交空对象 ⟹ theme.json 没有 regionOptions、构建产物没有 options 键', JSON.stringify({ t: theme2.regionOptions, h: regions2.header.options }));

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
