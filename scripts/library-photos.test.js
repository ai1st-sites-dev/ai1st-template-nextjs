#!/usr/bin/env node
/**
 * library-photos.test.js —— #1716 验收 8：建站照片搬进图库之后，`scripts/library-photos.js` 换地址、删本地文件。
 *
 * 跑法:  node scripts/library-photos.test.js   （或 `npm run test:scripts`，它按文件名发现）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 跑的是**真的**脚本（子进程，cwd = 一个临时站仓），夹具是一个两种语言的站：
 *   ① list 只列「原样还在、文件也在」的引用 —— 老板已经换掉的那个槽（值是别的地址）不在里面；touches 恰好是会被改写的那几份
 *   ② apply：两种语言的页面 JSON、服务清单、brand.json 的 logo 都换到；老板换过的槽、别人家的 `…/logo.png` 一个字节不动；
 *      除了被换的那几段，文件其余字节逐字不变
 *   ③ public/photos/ 下的文件（含没被引用的那张）和 public/logo.png 都删了
 *   ④ 拒收：博客正文 HTML 里还有 `<img src=\"/photos/…\">`（整值换不到）⟹ exit 7、一个字节都不写
 *   ⑤ 拒收的反向对照：对照表漏了一个还被引用的路径 ⟹ 同样 exit 7、不写（删了就是裂图）
 *   ⑥ stdin 不是对照表 / 地址不是 https ⟹ exit 5、不写
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.resolve(__dirname, 'library-photos.js');
const LIB = 'https://uploads.example.test/owner-1';

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log(`  ✅ ${name}`); } catch (e) { fail += 1; console.log(`  ❌ ${name}\n     ${e.message}`); }
}
function die(msg) { console.log(`💥 跑不起来: ${msg}`); process.exit(2); }

if (!fs.existsSync(SCRIPT)) die(`${SCRIPT} 不在`);

const OWNER_SLOT = 'https://uploads.example.test/owner-1/1a2b3c4d5_my-van.jpg';
const PARTNER_LOGO = 'https://partner.example.com/logo.png';

/** 一个两种语言的站仓。返回目录。 */
function fixture({ blogImg = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lib-photos-'));
  const w = (rel, body) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), typeof body === 'string' ? body : JSON.stringify(body, null, 2) + '\n');
  };
  w('site/brand.json', { name: { en: 'Maple' }, logoUrl: '/logo.png', logoHasWordmark: false });
  w('site/en/pages/home.json', {
    slug: 'home',
    blocks: [
      { id: 'h', type: 'hero', data: { headline: 'Hi', image: { imageUrl: '/photos/home-hero.jpg', alt: 'van' } } },
      // 老板在搬之前已经换掉的槽：值是图库里他自己那张，它原来的本地文件 home-feature.jpg 还在磁盘上。
      { id: 'f', type: 'features', data: { items: [{ title: 'A', imageUrl: OWNER_SLOT }] } },
      { id: 'r', type: 'reviews', data: { platforms: [{ name: 'Partner', logoUrl: PARTNER_LOGO }] } },
    ],
  });
  // 紧凑写法（不是 2 空格缩进）：换完之后格式也不许变。
  w('site/fr/pages/home.json', '{"slug":"home","blocks":[{"id":"h","type":"hero","data":{"image":{"imageUrl":"/photos/home-hero.jpg"}}}]}\n');
  w('site/en/services.json', { items: [{ name: 'Brakes', imageUrl: '/photos/services-brakes.jpg' }] });
  if (blogImg) {
    w('site/en/blog/tips.json', { slug: 'tips', content: '<p>Look:</p><img src="/photos/home-hero.jpg" alt="">' });
  }
  w('public/photos/home-hero.jpg', 'JPEG-hero');
  w('public/photos/home-feature.jpg', 'JPEG-feature');
  w('public/photos/services-brakes.jpg', 'JPEG-brakes');
  w('public/logo.png', 'PNG-logo');
  w('public/images/grid-pattern.svg', '<svg/>');
  return dir;
}

function run(dir, mode, stdin) {
  const r = spawnSync(process.execPath, [SCRIPT, mode], { cwd: dir, input: stdin === undefined ? '' : stdin, encoding: 'utf8' });
  let json = null;
  try { json = JSON.parse(r.stdout.trim().split('\n').pop()); } catch (e) { /* 没打 JSON */ }
  return { code: r.status, json, stderr: r.stderr };
}

/** 目录里每个文件的字节（相对路径 → 内容）。 */
function snapshot(dir) {
  const m = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else m[path.relative(dir, p)] = fs.readFileSync(p, 'utf8');
    }
  };
  walk(dir);
  return m;
}

const MAPPING = {
  '/photos/home-hero.jpg': `${LIB}/site-1-home-hero.jpg`,
  '/photos/services-brakes.jpg': `${LIB}/site-1-services-brakes.jpg`,
  '/logo.png': `${LIB}/site-1-logo.png`,
};

console.log('══ #1716 library-photos.js ══');

{
  const dir = fixture();
  check('① list = 原样还在的三处引用（hero · 服务 · logo）；老板换掉的那个槽（home-feature）不在', () => {
    const r = run(dir, 'list');
    assert.strictEqual(r.code, 0, r.stderr);
    assert.deepStrictEqual(r.json, {
      ok: true,
      files: [
        { ref: '/logo.png', path: 'public/logo.png' },
        { ref: '/photos/home-hero.jpg', path: 'public/photos/home-hero.jpg' },
        { ref: '/photos/services-brakes.jpg', path: 'public/photos/services-brakes.jpg' },
      ],
      touches: ['site/brand.json', 'site/en/pages/home.json', 'site/en/services.json', 'site/fr/pages/home.json'],
    });
  });
  const listed = run(dir, 'list').json;

  const before = snapshot(dir);
  const r = run(dir, 'apply', JSON.stringify(MAPPING));
  const after = snapshot(dir);
  check('② apply 成功，报告改了四份文件（两种语言的首页 · 服务清单 · brand.json）', () => {
    assert.strictEqual(r.code, 0, r.stderr);
    assert.deepStrictEqual(r.json.changed.slice().sort(),
      ['site/brand.json', 'site/en/pages/home.json', 'site/en/services.json', 'site/fr/pages/home.json']);
  });
  check('② apply 改的每一份都在 list 报的 touches 里（worker 的干净检查和回退只管 touches，漏一份就回退不干净）', () => {
    for (const f of r.json.changed) assert.ok(listed.touches.includes(f), `${f} 不在 touches ${JSON.stringify(listed.touches)} 里`);
  });
  check('② 每份文件 = 原文里只把那几段换掉，其余字节逐字不变（含 fr 那份的紧凑格式）', () => {
    for (const f of r.json.changed) {
      let want = before[f];
      for (const [ref, url] of Object.entries(MAPPING)) want = want.split(JSON.stringify(ref)).join(JSON.stringify(url));
      assert.strictEqual(after[f], want, f);
      assert.notStrictEqual(after[f], before[f], `${f} 没变`);
    }
  });
  check('② 换完的值：hero（两种语言）· 服务 · logo 都是图库地址；老板那个槽、别人家的 logo 一个字节不动', () => {
    const en = JSON.parse(after['site/en/pages/home.json']);
    const fr = JSON.parse(after['site/fr/pages/home.json']);
    assert.strictEqual(en.blocks[0].data.image.imageUrl, `${LIB}/site-1-home-hero.jpg`);
    assert.strictEqual(fr.blocks[0].data.image.imageUrl, `${LIB}/site-1-home-hero.jpg`);
    assert.strictEqual(JSON.parse(after['site/en/services.json']).items[0].imageUrl, `${LIB}/site-1-services-brakes.jpg`);
    assert.strictEqual(JSON.parse(after['site/brand.json']).logoUrl, `${LIB}/site-1-logo.png`);
    assert.strictEqual(en.blocks[1].data.items[0].imageUrl, OWNER_SLOT);
    assert.strictEqual(en.blocks[2].data.platforms[0].logoUrl, PARTNER_LOGO);
  });
  check('③ public/photos/ 下三张（含没被引用的 home-feature）和 public/logo.png 都删了；别的 public/ 文件还在', () => {
    assert.deepStrictEqual(r.json.removed, ['public/logo.png', 'public/photos/home-feature.jpg', 'public/photos/home-hero.jpg', 'public/photos/services-brakes.jpg']);
    for (const f of r.json.removed) assert.ok(!fs.existsSync(path.join(dir, f)), `${f} 还在`);
    assert.ok(!fs.existsSync(path.join(dir, 'public/photos')), 'public/photos 空目录还在');
    assert.ok(fs.existsSync(path.join(dir, 'public/images/grid-pattern.svg')));
  });
  check('③ 再跑一次 list ⟹ 空（站里已经没有本地照片引用）', () => {
    const again = run(dir, 'list');
    assert.strictEqual(again.code, 0);
    assert.deepStrictEqual(again.json.files, []);
  });
}

{
  const dir = fixture({ blogImg: true });
  const before = snapshot(dir);
  const r = run(dir, 'apply', JSON.stringify(MAPPING));
  check('④ 博客正文 HTML 里还有 <img src="/photos/home-hero.jpg"> ⟹ exit 7，点名那个文件，一个字节都没写', () => {
    assert.strictEqual(r.code, 7, r.stderr);
    assert.strictEqual(r.json.ok, false);
    assert.ok(r.json.message.includes('site/en/blog/tips.json'), r.json.message);
    assert.deepStrictEqual(snapshot(dir), before);
  });
}

{
  const dir = fixture();
  const before = snapshot(dir);
  const partial = { ...MAPPING };
  delete partial['/photos/services-brakes.jpg'];
  const r = run(dir, 'apply', JSON.stringify(partial));
  check('⑤ 对照表漏了还被引用的 /photos/services-brakes.jpg ⟹ exit 7，一个字节都没写（删了它服务页就是裂图）', () => {
    assert.strictEqual(r.code, 7, r.stderr);
    assert.ok(r.json.message.includes('/photos/services-brakes.jpg'), r.json.message);
    assert.deepStrictEqual(snapshot(dir), before);
  });
}

{
  const dir = fixture();
  const before = snapshot(dir);
  const cases = [
    ['不是 JSON', 'nope'],
    ['是数组', '[]'],
    ['键不是本地路径', JSON.stringify({ '/images/x.jpg': `${LIB}/x.jpg` })],
    ['键想跳出目录', JSON.stringify({ '/photos/../site/brand.json': `${LIB}/x.jpg` })],
    ['地址不是 https', JSON.stringify({ '/logo.png': 'http://uploads.example.test/x.png' })],
  ];
  for (const [name, stdin] of cases) {
    check(`⑥ ${name} ⟹ exit 5，不写`, () => {
      const r = run(dir, 'apply', stdin);
      assert.strictEqual(r.code, 5, r.stderr);
      assert.deepStrictEqual(snapshot(dir), before);
    });
  }
}

console.log(`\n${fail === 0 ? '✅' : '❌'} #1716 library-photos：${pass} 通过 · ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
