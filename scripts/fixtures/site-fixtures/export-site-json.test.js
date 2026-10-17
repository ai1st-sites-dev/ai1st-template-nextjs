// SiteAsData 夹具：`export-site-json.js` 的往返必须无损 —— JSON 铺回目录再导回 JSON，跟原 JSON 深相等；
// 进仓的五个夹具站都能铺回目录且文件数对得上（T1d / T2a / T2b 的验收拿它们当夹具）。
// #1804 —— 再加三样：从 skipAI 真出的 site/ 起算的 dir → JSON → dir 逐文件相同；五个夹具过块校验（scope 'create'）
//    和顶栏形状检查；三个 make-fixture.sh 造的站各自带着它该带的东西。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, execSync } = require('child_process');

const here = __dirname;
const script = path.join(here, 'export-site-json.js');
const NEXT = path.resolve(here, '..', '..', '..');
const FIXTURES = ['site-0448c807', 'site-bbc4ff97', 'site-multilang', 'site-blog', 'site-rtl', 'site-zh'];
const load = (name) => JSON.parse(fs.readFileSync(path.join(here, `${name}.json`), 'utf-8'));

for (const name of FIXTURES) {
  test(`${name}.json 往返无损`, () => {
    const src = path.join(here, `${name}.json`);
    const original = JSON.parse(fs.readFileSync(src, 'utf-8'));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-fixture-'));
    execFileSync(process.execPath, [script, 'to-dir', src, dir]);
    const back = path.join(dir, 'back.json');
    execFileSync(process.execPath, [script, 'to-json', dir, back]);
    const again = JSON.parse(fs.readFileSync(back, 'utf-8'));
    // back.json 自己也被扫进去了，剔掉再比
    delete again['back.json'];
    assert.deepStrictEqual(again, original);
    assert.ok(Object.keys(original).length >= 13, `${name} 至少 13 个文件`);
    const loc = original['site_meta.json'] && original['site_meta.json'].defaultLocale;
    assert.ok(original['brand.json'] && loc && original[`${loc}/pages/home.json`], '三个必有的键（brand.json · site_meta.json · <主语言>/pages/home.json）');
    assert.ok(!('build-report.json' in original), '夹具里没有 build-report.json（每次建站都变）');
    fs.rmSync(dir, { recursive: true, force: true });
  });
}

// ① 起点是 skipAI 真出的 site/ 目录（不是 to-dir 铺出来的 —— 那样「导出时丢了什么 / 改了格式」传导不过来）。
//    建站在模板树的 tar 副本里跑（先例 create-site-all-locales.test.js §makeTree），模板根的 site/ 不碰。
test('skipAI 真出的 site/ → JSON → 目录：逐文件 Buffer.equals', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'site-fixture-real-'));
  try {
    const work = path.join(root, 'nextjs');
    fs.mkdirSync(work);
    execSync(`tar --exclude=./node_modules --exclude=./out --exclude=./.next --exclude=./site --exclude=./public/photos -cf - . | tar -xf - -C "${work}"`, { cwd: NEXT, stdio: 'pipe' });
    fs.symlinkSync(path.join(NEXT, 'node_modules'), path.join(work, 'node_modules'));
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    execFileSync(process.execPath, ['scripts/create-site.js'], {
      cwd: work, env, stdio: ['pipe', 'pipe', 'pipe'], timeout: 180000,
      input: fs.readFileSync(path.join(here, 'payload-multilang.json')),
    });
    const site = path.join(work, 'site');
    const json = path.join(root, 'site.json');
    const out = path.join(root, 'out');
    execFileSync(process.execPath, [script, 'to-json', site, json]);
    execFileSync(process.execPath, [script, 'to-dir', json, out]);
    const files = (d, rel = '', acc = []) => {
      for (const e of fs.readdirSync(path.join(d, rel), { withFileTypes: true })) {
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) files(d, r, acc); else acc.push(r);
      }
      return acc.sort();
    };
    const a = files(site);
    assert.ok(a.length >= 13 && a.some((f) => f.endsWith('.json')), `真站有足够的文件（${a.length}）`);
    assert.deepStrictEqual(files(out), a, '文件清单相同');
    const diff = a.filter((f) => !fs.readFileSync(path.join(site, f)).equals(fs.readFileSync(path.join(out, f))));
    assert.deepStrictEqual(diff, [], '每个文件逐字节相同');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// ② 五个夹具每种语言过块校验 + 顶栏形状。🔴 `scope: 'create'`（'build' 把一切塞进 warnings，problems 恒空）；
//    `dir` 是块目录，不是文字方向。
test('五个夹具：每种语言 validateSite(scope create) 0 problem、shapeProblems 为空', () => {
  const { validateSite } = require(path.join(NEXT, 'scripts', 'lib', 'block-manifest.js'));
  const { shapeProblems } = require(path.join(NEXT, 'scripts', 'lib', 'navigation-owned.js'));
  for (const name of FIXTURES) {
    const c = load(name);
    for (const loc of c['site_meta.json'].locales) {
      const pages = Object.keys(c).filter((k) => k.startsWith(`${loc}/pages/`)).sort().map((k) => c[k]);
      assert.ok(pages.length > 0, `${name} ${loc} 有页面`);
      const { problems } = validateSite({
        pages, industry: '', dir: path.join(NEXT, 'blocks'), scope: 'create',
        siteBlocks: c[`${loc}/blocks/site-blocks.json`] || c['blocks/site-blocks.json'] || {},
        forms: c[`${loc}/forms.json`],
      });
      assert.deepStrictEqual(problems, [], `${name} ${loc} 块校验`);
      assert.deepStrictEqual(shapeProblems(c[`${loc}/navigation.json`]), [], `${name} ${loc} 顶栏形状`);
    }
  }
});

// ③ make-fixture.sh 造的三个站各自带着它该带的东西。
test('三个 make-fixture 站：双语有 fr、博客站有文章、RTL 站主语言是 ar', () => {
  const m = load('site-multilang');
  assert.deepStrictEqual(m['site_meta.json'].locales, ['en', 'fr']);
  assert.ok(m['fr/pages/home.json'], 'site-multilang 有 fr/pages/home.json');
  assert.ok(Object.keys(load('site-blog')).some((k) => /^en\/blog\/[^/]+\.json$/.test(k)), 'site-blog 有 en/blog/*.json');
  assert.strictEqual(load('site-rtl')['site_meta.json'].defaultLocale, 'ar');
});

// ④ site-blog 经 payload-blog.patch.json 带上 skipAI 写不进去的三样：社交链接（#1785）· 顶条链接（#1780）· 顶条开关和 logo 旋钮（#1784）。
//    住址按代码：社交在 brand.json、顶条链接在 navigation.json 的 header.topbarLinks、开关和旋钮在 theme.json 的 regionOptions.header。
test('site-blog：社交链接 + 顶条链接 + 顶条/logo 旋钮都在，且过各自的校验', () => {
  const { regionOptionsProblems } = require(path.join(NEXT, 'scripts', 'lib', 'region-options.js'));
  const { topbarLinksProblem } = require(path.join(NEXT, 'scripts', 'lib', 'topbar-links.js'));
  const c = load('site-blog');
  const social = c['brand.json'].socialLinks;
  assert.ok(Array.isArray(social) && new Set(social.filter((s) => s.url).map((s) => s.platform)).size >= 2, 'brand.json socialLinks 至少两个平台');
  const links = c['en/navigation.json'].header.topbarLinks;
  assert.ok(Array.isArray(links) && links.some((l) => l.href && l.href.source === 'phone') && links.some((l) => typeof l.href === 'string' && l.href.startsWith('/')),
    'header.topbarLinks 有电话引用和一个站内链接');
  assert.strictEqual(topbarLinksProblem(links, true), '');
  const header = c['theme.json'].regionOptions && c['theme.json'].regionOptions.header;
  assert.deepStrictEqual(header, { topbar: true, logoType: 'text', logoSize: 52 }, 'theme.json regionOptions.header');
  assert.deepStrictEqual(regionOptionsProblems('header', header), []);
});
