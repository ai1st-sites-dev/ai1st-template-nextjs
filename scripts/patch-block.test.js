// #1351 —— scripts/patch-block.js 的测试。
//
// 这个脚本在站自己的容器里跑、直接改磁盘上的页面 JSON，所以这里测的方式也是「真建一棵目录树、
// 真跑一次、再把文件读回来」，不 mock 文件系统：要守的性质本来就是「磁盘上那份文件变成了什么」。
//
// 🔴 每一格都配一条反向对照，因为这一族的错法是**静默**的：块没被改到 / 改错了一个 /
//    顺带把别的块挪了位置 —— 三种都不会报错，构建全绿，只有页面长得不对。

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const NEXT = path.resolve(__dirname, '..');
const SCRIPT = path.join(NEXT, 'scripts', 'patch-block.js');

let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };

const blocks = require(path.join(NEXT, 'scripts', 'blocks.js'));

// ── 夹具：一棵最小的站目录树 ────────────────────────────────────────────────────────────────────
//
// `scripts` / `src` / `blocks` 用软链指回本仓 —— 脚本要 require 的是**容器里那份 blocks.js**，
// 而在测试里「容器里那份」就是这一份。
function makeSite(pages, siteBlocks) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pb-'));
  for (const d of ['scripts', 'src', 'blocks']) fs.symlinkSync(path.join(NEXT, d), path.join(root, d));
  fs.mkdirSync(path.join(root, 'site', 'pages'), { recursive: true });
  for (const [slug, page] of Object.entries(pages)) {
    const p = path.join(root, 'site', 'pages', `${slug}.json`);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, `${JSON.stringify(page, null, 2)}\n`);
  }
  if (siteBlocks) {
    fs.mkdirSync(path.join(root, 'site', 'blocks'), { recursive: true });
    fs.writeFileSync(path.join(root, 'site', 'blocks', 'site-blocks.json'),
      `${JSON.stringify(siteBlocks, null, 2)}\n`);
  }
  return root;
}

// 跑一次，回 { code, out, err }。**不抛** —— 退出码本身就是被测的东西。
function run(root, locator, patch, move) {
  try {
    const out = execFileSync('node', [SCRIPT, JSON.stringify(locator), patch ? JSON.stringify(patch) : '', move || ''],
      { cwd: root, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, out: out.trim(), err: '' };
  } catch (e) {
    return { code: e.status, out: (e.stdout || '').trim(), err: (e.stderr || '').trim() };
  }
}

const readPage = (root, slug) => JSON.parse(fs.readFileSync(path.join(root, 'site', 'pages', `${slug}.json`), 'utf-8'));

// 这一页**建出来**是什么顺序 —— 用构建时那个函数算，不在这里重写一遍排序规矩。
function rendered(root, slug) {
  const page = readPage(root, slug);
  let sb = {};
  const p = path.join(root, 'site', 'blocks', 'site-blocks.json');
  if (fs.existsSync(p)) sb = JSON.parse(fs.readFileSync(p, 'utf-8'));
  const out = blocks.normalizeLocalePages([page], sb, 'en', {});
  return out[0].blocks.map((b) => b.id || b.type);
}

const PAGE_NEW = {
  home: {
    slug: 'home',
    blocks: [
      { id: 'home-hero', type: 'hero', role: 'lead', region: 'content', weight: 0, data: {} },
      { id: 'home-features', type: 'features-grid', role: 'optional', region: 'content', weight: 10, data: {} },
      { id: 'home-testimonials', type: 'testimonials', role: 'optional', region: 'content', weight: 20, data: {} },
    ],
  },
};
const PAGE_OLD = {
  home: {
    slug: 'home',
    sections: [
      { type: 'hero', data: {} },
      { type: 'features-grid', data: {} },
      { type: 'testimonials', data: {} },
    ],
  },
};

// ── ① 新 blocks 形状：改块自己的一个属性 / 把它删掉 ──────────────────────────────────────────────
// 📌 #1411 之前这一节量的是「隐藏 / 放回来」（`hidden`，已退役）。拿 `shape` 当样本：它跟 `hidden`
//    走的是同一条 JSON merge patch 路径（写什么设什么，`null` 删键），而且不动顺序。
console.log('\n── ① 新 blocks 形状：改一个属性 / 删掉它');
{
  const root = makeSite(PAGE_NEW);
  const before = rendered(root, 'home');

  const r = run(root, { page: 'home', blockId: 'home-testimonials' }, { shape: 'grid-3' });
  if (r.code !== 0) bad(`改属性失败 rc=${r.code}: ${r.err}`);
  else if (readPage(root, 'home').blocks[2].shape !== 'grid-3') bad('页面 JSON 里没写上 shape');
  else if (JSON.stringify(rendered(root, 'home')) !== JSON.stringify(before)) bad('改一个属性却动了顺序');
  else ok('改属性：页面 JSON 写上 shape，建出来的顺序逐块不变');

  // 🔴 反向对照：写 null 之后，那个键要**从文件里消失**，不是写成空串 / false。
  const r2 = run(root, { page: 'home', blockId: 'home-testimonials' }, { shape: null });
  const back = readPage(root, 'home').blocks[2];
  if (r2.code !== 0) bad(`删键失败 rc=${r2.code}: ${r2.err}`);
  else if (Object.prototype.hasOwnProperty.call(back, 'shape')) bad(`写 null 之后 shape 键还在: ${JSON.stringify(back.shape)}`);
  else if (JSON.stringify(rendered(root, 'home')) !== JSON.stringify(before)) bad('删键之后顺序跟原来不一样了');
  else ok('删键：shape 键从文件里删掉，顺序跟动手之前逐块相同');

  // 🔴 反向对照：别的块一个字节没动。
  const now = readPage(root, 'home');
  const same = JSON.stringify([now.blocks[0], now.blocks[1]]) === JSON.stringify([PAGE_NEW.home.blocks[0], PAGE_NEW.home.blocks[1]]);
  if (same) ok('反向对照: 同一页上另外两个块逐字节没动');
  else bad(`别的块被动了: ${JSON.stringify(now.blocks.slice(0, 2))}`);
}

// ── ② 新形状：上移下移 = 换权重，数组位置不动 ───────────────────────────────────────────────────
console.log('\n── ② 新形状：上移下移换的是权重，到头了不许越界');
{
  const root = makeSite(PAGE_NEW);
  const r = run(root, { page: 'home', blockId: 'home-features' }, null, 'down');
  const after = readPage(root, 'home');
  if (r.code !== 0) bad(`下移失败 rc=${r.code}: ${r.err}`);
  else if (JSON.stringify(rendered(root, 'home')) !== JSON.stringify(['home-hero', 'home-testimonials', 'home-features'])) {
    bad(`下移之后顺序不对: ${rendered(root, 'home').join(' ')}`);
  } else if (after.blocks.map((b) => b.id).join(' ') !== 'home-hero home-features home-testimonials') {
    bad('新形状不该动数组位置（id 写在文件里，靠权重排）');
  } else ok('下移：两块权重互换，数组位置一个字节没动，建出来的顺序跟着变');

  // 🔴 反向对照：到头了要拒绝，而且文件不许被动过。
  const snapshot = fs.readFileSync(path.join(root, 'site', 'pages', 'home.json'), 'utf-8');
  const r2 = run(root, { page: 'home', blockId: 'home-features' }, null, 'down');
  const r3 = run(root, { page: 'home', blockId: 'home-hero' }, null, 'up');
  const untouched = fs.readFileSync(path.join(root, 'site', 'pages', 'home.json'), 'utf-8') === snapshot;
  if (r2.code === 6 && r3.code === 6 && untouched) ok('到头了：下移最后一个 / 上移第一个都退 6，文件逐字节没动');
  else bad(`越界没挡住: down rc=${r2.code} · up rc=${r3.code} · 文件没动=${untouched}`);
}

// ── ③ 老 sections 形状：换数组位置 + 回带新下标（AC3）────────────────────────────────────────────
console.log('\n── ③ 老 sections 形状：按下标定位，挪完回带新下标');
{
  const root = makeSite(PAGE_OLD);
  const r = run(root, { page: 'home', index: 1 }, null, 'down');
  if (r.code !== 0) { bad(`下移失败 rc=${r.code}: ${r.err}`); } else {
    const got = JSON.parse(r.out);
    const types = readPage(root, 'home').sections.map((s) => s.type);
    if (types.join(' ') !== 'hero testimonials features-grid') bad(`数组没换位置: ${types.join(' ')}`);
    else if (got.index !== 2) bad(`回带的新下标不对: ${got.index}`);
    else if (got.blockId !== '') bad(`老形状不该编一个 id 回来: ${JSON.stringify(got.blockId)}`);
    else ok('下移：数组换了位置，回带新下标 2，不编 id');

    // 🔴 AC3 正臂：拿回带的新下标对**同一块**再发一次 —— 被改的要是它，不是它原来那个下标上的邻居。
    const r2 = run(root, { page: 'home', index: got.index }, { shape: 'grid-3' });
    const hitType = (readPage(root, 'home').sections.find((s) => s.shape === 'grid-3') || {}).type;
    if (r2.code === 0 && hitType === 'features-grid') ok('AC3 正臂: 用回带的下标再发一次，改到的是同一块（features-grid）');
    else bad(`AC3 正臂读数不对: rc=${r2.code} · 被改的是 ${hitType}`);
  }

  // 🔴 AC3 反向臂：改用 `blocks.js` 现算的那个 id 发同一次请求。那个 id 结尾是数组下标，挪过一次
  //    就已经指着别人了 —— 这一路必须给出**跟正臂不一样的读数**，否则说明定位根本没换过。
  const root2 = makeSite(PAGE_OLD);
  run(root2, { page: 'home', index: 1 }, null, 'down');
  const computed = blocks.pageWithBlocks(JSON.parse(JSON.stringify(PAGE_OLD.home))).blocks[1].id;
  const r3 = run(root2, { page: 'home', blockId: computed }, { shape: 'grid-3' });
  const anyHit = readPage(root2, 'home').sections.some((s) => s.shape === 'grid-3');
  if (r3.code === 5 && !anyHit) ok(`AC3 反向臂: 拿现算 id（${computed}）发同一次 → 退 5、一个块都没被改（跟正臂读数不同）`);
  else bad(`AC3 反向臂读数不对: rc=${r3.code} · 有块被改=${anyHit}`);
}

// ── ④ visibility 命中而这一页没有条目的站级块（AC5②）──────────────────────────────────────────
console.log('\n── ④ 站级块靠 visibility 进来的那条路：补条目、别的页不动');
{
  const SB = {
    'our-team': { type: 'team-grid', role: 'optional', region: 'content', visibility: ['home', 'about'], data: {} },
    'our-awards': { type: 'awards-certifications', role: 'optional', region: 'content', visibility: ['home', 'about'], data: {} },
  };
  const pages = {
    home: { slug: 'home', blocks: [{ id: 'home-hero', type: 'hero', role: 'lead', region: 'content', weight: 0, data: {} }] },
    about: { slug: 'about', blocks: [{ id: 'about-hero', type: 'hero', role: 'lead', region: 'content', weight: 0, data: {} }] },
  };
  const root = makeSite(pages, SB);
  const aboutBefore = rendered(root, 'about');
  const sbPath = path.join(root, 'site', 'blocks', 'site-blocks.json');
  const sbBefore = fs.readFileSync(sbPath, 'utf-8');

  const r = run(root, { page: 'home', blockId: 'our-team' }, { shape: 'band-left' });
  const homeNow = readPage(root, 'home');
  const refEntry = homeNow.blocks.find((b) => b.ref === 'our-team');

  if (r.code !== 0) bad(`改属性失败 rc=${r.code}: ${r.err}`);
  else if (!refEntry || refEntry.shape !== 'band-left') bad(`没补出带 shape 的 ref 条目: ${JSON.stringify(homeNow.blocks)}`);
  else ok('这一页补出一个带 shape 的 {ref} 条目');

  // 🔴 反向对照一：**别的页一个字都不许受影响**。这是「只改本页那一份」的整个用途。
  if (JSON.stringify(rendered(root, 'about')) === JSON.stringify(aboutBefore)) {
    ok(`反向对照: about 页逐块不变（${aboutBefore.join(' ')}）`);
  } else bad(`about 页被连累了: ${aboutBefore.join(' ')} → ${rendered(root, 'about').join(' ')}`);

  // 🔴 反向对照二：站级块库本身逐字节不变。
  if (fs.readFileSync(sbPath, 'utf-8') === sbBefore) ok('反向对照: site-blocks.json 逐字节没动');
  else bad('site-blocks.json 被改了');

  // 🔴 反向对照三：**这一页另一个站级块的位置不许漂**。补条目会让数组变长，而没写 weight 的
  //    站级块的位置是「追加进来时那个序号 × 10」算的 —— 只补一条的话 our-awards 会跟 our-team
  //    撞在同一个权重上再按原始次序分先后，两块对调。这一格就是量它。
  const order = blocks.normalizeLocalePages([readPage(root, 'home')], SB, 'en', {})[0].blocks.map((b) => b.id);
  if (JSON.stringify(order) === JSON.stringify(['home-hero', 'our-team', 'our-awards'])) {
    ok('反向对照: 同一页另一个站级块的位置没漂（our-team 仍在 our-awards 前面）');
  } else bad(`同一页的块被挪了: ${order.join(' ')}`);
}

// ── ⑤ 参数与安全 ───────────────────────────────────────────────────────────────────────────────
console.log('\n── ⑤ 参数与安全：路径、键名、换块');
{
  const root = makeSite(PAGE_NEW);
  const snapshot = fs.readFileSync(path.join(root, 'site', 'pages', 'home.json'), 'utf-8');
  const cases = [
    ['slug 里带 ..', { page: '../../etc/passwd', blockId: 'home-hero' }, { shape: 'grid-3' }, '', 5],
    ['slug 是绝对路径', { page: '/etc/passwd', blockId: 'home-hero' }, { shape: 'grid-3' }, '', 5],
    ['patch 想改 id', { page: 'home', blockId: 'home-hero' }, { id: 'x' }, '', 5],
    ['patch 想改 type', { page: 'home', blockId: 'home-hero' }, { type: 'x' }, '', 5],
    ['patch 键名不像标识符', { page: 'home', blockId: 'home-hero' }, { 'a b': 1 }, '', 5],
    ['patch 和 move 同时给', { page: 'home', blockId: 'home-hero' }, { shape: 'grid-3' }, 'down', 5],
    ['两个都没给', { page: 'home', blockId: 'home-hero' }, null, '', 5],
    ['move 值不认识', { page: 'home', blockId: 'home-hero' }, null, 'sideways', 5],
    ['找不到那一页', { page: 'nope', blockId: 'home-hero' }, { shape: 'grid-3' }, '', 4],
    ['找不到那个块', { page: 'home', blockId: 'no-such-block' }, { shape: 'grid-3' }, '', 3],
    ['老形状没给 index', { page: 'home', blockId: 'home-hero' }, { shape: 'grid-3' }, '', 0],
  ];
  let wrong = 0;
  for (const [name, loc, p, mv, want] of cases) {
    const got = run(root, loc, p, mv);
    if (got.code !== want) { bad(`${name}: 期望 rc=${want}，实际 rc=${got.code}（${got.err.split('\n')[0]}）`); wrong += 1; }
  }
  if (!wrong) ok(`${cases.length} 种参数各自的退出码都对上了`);

  // 🔴 反向对照：上面那些被拒的调用，**一个字节都不许写进文件**。
  //    最后一格是合法的（它会写），所以这里比的是「除了那一次之外没有别的写入」——
  //    也就是文件现在只多了 home-hero 的 shape，别的一处没变。
  const now = JSON.parse(fs.readFileSync(path.join(root, 'site', 'pages', 'home.json'), 'utf-8'));
  const expect = JSON.parse(snapshot);
  expect.blocks[0].shape = 'grid-3';
  if (JSON.stringify(now) === JSON.stringify(expect)) ok('反向对照: 被拒的那些调用一个字节都没写进文件');
  else bad(`被拒的调用动了文件: ${JSON.stringify(now.blocks)}`);
}

// 📌 原来这里是 ⑥（藏起来的块不占一格：找邻居跳过 `hidden` 的块）。`hidden` 由 #1411 退役，每一块都画得
//    出来，邻居就是紧挨着的那一块 —— ② 量的就是它。编号不重排。

// ── ⑦ #1352 文字直改：`patch.data` 是一张「路径 → 新的字」的表 ──────────────────────────────────
//
// 🔴 每一格都配一条反向对照，因为这一族的错法同样是**静默**的：写到了别的字段上 / 整份 data 被换掉 /
//    写进了一个 ref 条目（那种改动重建完页面一个字不变，而调用方收到的是 rc=0）。
console.log('\n── ⑦ #1352 文字直改：patch.data 那张路径表');
{
  const withText = () => ({
    home: {
      slug: 'home',
      blocks: [
        {
          id: 'home-hero',
          type: 'hero',
          role: 'lead',
          region: 'content',
          weight: 0,
          data: {
            headline: 'Old headline',
            subheadline: 'Old sub',
            ctaPrimary: { label: 'Old button', href: '/contact' },
            imageUrl: '/a.png',
          },
        },
        {
          id: 'home-cards',
          type: 'card-group',
          role: 'optional',
          region: 'content',
          weight: 10,
          data: { items: [{ title: 'A' }, { title: 'B' }, { title: 'C' }] },
        },
      ],
    },
  });

  // ① 顶层一行字。
  {
    const root = makeSite(withText());
    const r = run(root, { page: 'home', blockId: 'home-hero' }, { data: { headline: 'New headline' } });
    const hero = readPage(root, 'home').blocks[0];
    if (r.code === 0 && hero.data.headline === 'New headline') {
      ok('顶层槽位：headline 改掉了');
    } else bad(`顶层槽位读数不对: rc=${r.code} ${r.err} · headline=${JSON.stringify(hero.data.headline)}`);
    // 反向对照：同一个块别的字段一个都没动 —— 「整份 data 被换掉」是这条路最容易犯的错。
    if (hero.data.subheadline === 'Old sub' && hero.data.ctaPrimary.href === '/contact'
      && hero.data.imageUrl === '/a.png') {
      ok('反向对照: 这个块别的内容一个字都没动（不是整份 data 被换掉）');
    } else bad(`别的内容被动了: ${JSON.stringify(hero.data)}`);
  }

  // ② 子字段（按钮上那行字）。
  {
    const root = makeSite(withText());
    const r = run(root, { page: 'home', blockId: 'home-hero' }, { data: { 'ctaPrimary.label': 'Book now' } });
    const cta = readPage(root, 'home').blocks[0].data.ctaPrimary;
    if (r.code === 0 && cta.label === 'Book now' && cta.href === '/contact') {
      ok('子字段：ctaPrimary.label 改掉了，href 没动');
    } else bad(`子字段读数不对: rc=${r.code} ${r.err} · ${JSON.stringify(cta)}`);
  }

  // ③ 列表项里的一条。
  {
    const root = makeSite(withText());
    const r = run(root, { page: 'home', blockId: 'home-cards' }, { data: { 'items.1.title': 'Middle' } });
    const items = readPage(root, 'home').blocks[1].data.items;
    if (r.code === 0 && items[1].title === 'Middle' && items[0].title === 'A' && items[2].title === 'C') {
      ok('列表项：items.1.title 改掉了，另外两项没动');
    } else bad(`列表项读数不对: rc=${r.code} ${r.err} · ${JSON.stringify(items)}`);
  }

  // ④ 叶子可以新建（组件无条件渲染一个 data-slot，而这个字段数据里还没有）。
  {
    const root = makeSite(withText());
    const r = run(root, { page: 'home', blockId: 'home-hero' }, { data: { 'ctaPrimary.title': 'Tooltip' } });
    const cta = readPage(root, 'home').blocks[0].data.ctaPrimary;
    if (r.code === 0 && cta.title === 'Tooltip') ok('叶子那一格允许新建（父容器已经在）');
    else bad(`新建叶子读数不对: rc=${r.code} ${r.err} · ${JSON.stringify(cta)}`);
  }

  // ⑤ 拒的那几种，每一种一格，并且证明文件一个字节没动。
  {
    const cases = [
      ['父容器不在', { data: { 'nothingHere.title': 'x' } }, 3],
      ['列表越界', { data: { 'items.9.title': 'x' } }, 3],
      ['路径里有不像标识符的一段', { data: { 'items.1.ti tle': 'x' } }, 3],
      ['新值不是字符串', { data: { headline: 42 } }, 3],
      ['新值超过 500 字', { data: { headline: 'x'.repeat(501) } }, 3],
      ['data 不是一张表', { data: 'nope' }, 5],
      ['现在放的不是一串字（改的是一个对象）', { data: { ctaPrimary: 'x' } }, 3],
    ];
    let good = 0;
    let untouched = 0;
    for (const [what, patch, want] of cases) {
      const root = makeSite(withText());
      const before = fs.readFileSync(path.join(root, 'site', 'pages', 'home.json'));
      const target = Object.keys(patch.data || {})[0] === 'items.9.title'
        || String(Object.keys(patch.data || {})[0]).startsWith('items.') ? 'home-cards' : 'home-hero';
      const r = run(root, { page: 'home', blockId: target }, patch);
      if (r.code === want) good += 1;
      else bad(`${what}: 期望 rc=${want}，实际 rc=${r.code} ${r.err}`);
      if (Buffer.compare(before, fs.readFileSync(path.join(root, 'site', 'pages', 'home.json'))) === 0) untouched += 1;
      else bad(`${what}: 被拒了，文件却动了`);
    }
    if (good === cases.length) ok(`${cases.length} 种拒法的退出码都对上了`);
    if (untouched === cases.length) ok('反向对照: 被拒的那些调用一个字节都没写进文件');
  }

  // ⑥ 站级共用块（`{ref}` 条目）当场拒 —— 这一格挡的是「保存成功、页面一个字不变」那种假象。
  {
    const root = makeSite({
      home: { slug: 'home', blocks: [{ ref: 'our-team', weight: 0 }] },
    }, { 'our-team': { type: 'team-grid', data: { headline: 'The team' } } });
    const before = fs.readFileSync(path.join(root, 'site', 'pages', 'home.json'));
    const r = run(root, { page: 'home', blockId: 'our-team' }, { data: { headline: 'New' } });
    const after = fs.readFileSync(path.join(root, 'site', 'pages', 'home.json'));
    if (r.code === 8 && Buffer.compare(before, after) === 0) {
      ok('站级共用块的 ref 条目：rc=8，文件一个字节没动');
    } else bad(`ref 条目读数不对: rc=${r.code} ${r.err}`);
    // 反向对照：证明这个夹具本身是能改的 —— 同一个块换成改形态就成功。
    const r2 = run(root, { page: 'home', blockId: 'our-team' }, { shape: 'band-left' });
    if (r2.code === 0) ok('反向对照: 同一条 ref 条目改 shape 照样成功（rc=8 不是夹具本身不成立）');
    else bad(`反向对照失败: 改 shape 也不行 rc=${r2.code} ${r2.err}`);
  }

  // ⑦ 老 sections 形状同样走得通（票里 AC7）。
  {
    const root = makeSite({
      home: {
        slug: 'home',
        sections: [
          { type: 'hero', data: { headline: 'Old' } },
          { type: 'features-grid', data: {} },
        ],
      },
    });
    const r = run(root, { page: 'home', index: 0 }, { data: { headline: 'New on legacy' } });
    const page = readPage(root, 'home');
    if (r.code === 0 && page.sections[0].data.headline === 'New on legacy') {
      ok('老 sections 形状：按下标定位，文字改掉了');
    } else bad(`老形状读数不对: rc=${r.code} ${r.err} · ${JSON.stringify(page.sections[0].data)}`);
    if (page.sections[1].data && Object.keys(page.sections[1].data).length === 0) {
      ok('反向对照: 同一页另一个块没被碰');
    } else bad('老形状: 另一个块被动了');
  }

  // ⑧ 字里带 HTML —— 存的是一串字，不是一个标签（票里最后一条 AC 的存储侧那一半）。
  {
    const root = makeSite(withText());
    const evil = '<img src=x onerror="alert(1)">';
    const r = run(root, { page: 'home', blockId: 'home-hero' }, { data: { headline: evil } });
    const raw = fs.readFileSync(path.join(root, 'site', 'pages', 'home.json'), 'utf-8');
    const back = JSON.parse(raw).blocks[0].data.headline;
    if (r.code === 0 && back === evil && raw.includes('\\u003c') === false) {
      ok(`带 HTML 的字原样存成一个字符串（${JSON.stringify(back).slice(0, 40)}…）`);
    } else bad(`带 HTML 的字读数不对: rc=${r.code} · ${JSON.stringify(back)}`);
  }
}

console.log(`\n══ ${pass} 过 / ${fail} 败 ══`);
process.exit(fail ? 1 : 0);
