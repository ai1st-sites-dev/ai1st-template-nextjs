// #1351 —— scripts/patch-block.js 的测试。
//
// 这个脚本在站自己的容器里跑、直接改磁盘上的页面 JSON，所以这里测的方式也是「真建一棵目录树、
// 真跑一次、再把文件读回来」，不 mock 文件系统：要守的性质本来就是「磁盘上那份文件变成了什么」。
//
// 🔴 每一格都配一条反向对照，因为这一族的错法是**静默**的：块没被藏起来 / 藏错了一个 /
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
  return out[0].blocks.filter((b) => !b.hidden).map((b) => b.id || b.type);
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

// ── ① 新 blocks 形状：隐藏 / 放回来 ─────────────────────────────────────────────────────────────
console.log('\n── ① 新 blocks 形状：隐藏 / 放回来');
{
  const root = makeSite(PAGE_NEW);
  const before = rendered(root, 'home');

  const r = run(root, { page: 'home', blockId: 'home-testimonials' }, { hidden: true });
  if (r.code !== 0) bad(`隐藏失败 rc=${r.code}: ${r.err}`);
  else if (readPage(root, 'home').blocks[2].hidden !== true) bad('页面 JSON 里没写上 hidden:true');
  else if (rendered(root, 'home').includes('home-testimonials')) bad('写上了 hidden 但它还是被建出来了');
  else ok('隐藏：页面 JSON 写上 hidden:true，建出来的页面上没有它');

  // 🔴 反向对照：放回来之后，那个键要**从文件里消失**，不是写成 false。
  //    留一个 `hidden:false` 在文件里，跟从没藏过的站就不是同一份字节了（同 theme.json 那条收敛规矩）。
  const r2 = run(root, { page: 'home', blockId: 'home-testimonials' }, { hidden: null });
  const back = readPage(root, 'home').blocks[2];
  if (r2.code !== 0) bad(`放回来失败 rc=${r2.code}: ${r2.err}`);
  else if (Object.prototype.hasOwnProperty.call(back, 'hidden')) bad(`放回来之后 hidden 键还在: ${JSON.stringify(back.hidden)}`);
  else if (JSON.stringify(rendered(root, 'home')) !== JSON.stringify(before)) bad('放回来之后顺序跟原来不一样了');
  else ok('放回来：hidden 键从文件里删掉，顺序跟动手之前逐块相同');

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

    // 🔴 AC3 正臂：拿回带的新下标对**同一块**再发一次 —— 被藏起来的要是它，不是它原来那个下标上的邻居。
    const r2 = run(root, { page: 'home', index: got.index }, { hidden: true });
    const hiddenType = (readPage(root, 'home').sections.find((s) => s.hidden === true) || {}).type;
    if (r2.code === 0 && hiddenType === 'features-grid') ok('AC3 正臂: 用回带的下标再发一次，藏起来的是同一块（features-grid）');
    else bad(`AC3 正臂读数不对: rc=${r2.code} · 被藏的是 ${hiddenType}`);
  }

  // 🔴 AC3 反向臂：改用 `blocks.js` 现算的那个 id 发同一次请求。那个 id 结尾是数组下标，挪过一次
  //    就已经指着别人了 —— 这一路必须给出**跟正臂不一样的读数**，否则说明定位根本没换过。
  const root2 = makeSite(PAGE_OLD);
  run(root2, { page: 'home', index: 1 }, null, 'down');
  const computed = blocks.pageWithBlocks(JSON.parse(JSON.stringify(PAGE_OLD.home))).blocks[1].id;
  const r3 = run(root2, { page: 'home', blockId: computed }, { hidden: true });
  const anyHidden = readPage(root2, 'home').sections.some((s) => s.hidden === true);
  if (r3.code === 5 && !anyHidden) ok(`AC3 反向臂: 拿现算 id（${computed}）发同一次 → 退 5、一个块都没被藏（跟正臂读数不同）`);
  else bad(`AC3 反向臂读数不对: rc=${r3.code} · 有块被藏=${anyHidden}`);
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

  const r = run(root, { page: 'home', blockId: 'our-team' }, { hidden: true });
  const homeNow = readPage(root, 'home');
  const refEntry = homeNow.blocks.find((b) => b.ref === 'our-team');

  if (r.code !== 0) bad(`隐藏失败 rc=${r.code}: ${r.err}`);
  else if (!refEntry || refEntry.hidden !== true) bad(`没补出带 hidden 的 ref 条目: ${JSON.stringify(homeNow.blocks)}`);
  else if (rendered(root, 'home').includes('our-team')) bad('补了条目但它还是被建出来了');
  else ok('这一页补出一个带 hidden 的 {ref} 条目，建出来的首页上没有它');

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
    ['slug 里带 ..', { page: '../../etc/passwd', blockId: 'home-hero' }, { hidden: true }, '', 5],
    ['slug 是绝对路径', { page: '/etc/passwd', blockId: 'home-hero' }, { hidden: true }, '', 5],
    ['patch 想改 id', { page: 'home', blockId: 'home-hero' }, { id: 'x' }, '', 5],
    ['patch 想改 type', { page: 'home', blockId: 'home-hero' }, { type: 'x' }, '', 5],
    ['patch 键名不像标识符', { page: 'home', blockId: 'home-hero' }, { 'a b': 1 }, '', 5],
    ['patch 和 move 同时给', { page: 'home', blockId: 'home-hero' }, { hidden: true }, 'down', 5],
    ['两个都没给', { page: 'home', blockId: 'home-hero' }, null, '', 5],
    ['move 值不认识', { page: 'home', blockId: 'home-hero' }, null, 'sideways', 5],
    ['找不到那一页', { page: 'nope', blockId: 'home-hero' }, { hidden: true }, '', 4],
    ['找不到那个块', { page: 'home', blockId: 'no-such-block' }, { hidden: true }, '', 3],
    ['老形状没给 index', { page: 'home', blockId: 'home-hero' }, { hidden: true }, '', 0],
  ];
  let wrong = 0;
  for (const [name, loc, p, mv, want] of cases) {
    const got = run(root, loc, p, mv);
    if (got.code !== want) { bad(`${name}: 期望 rc=${want}，实际 rc=${got.code}（${got.err.split('\n')[0]}）`); wrong += 1; }
  }
  if (!wrong) ok(`${cases.length} 种参数各自的退出码都对上了`);

  // 🔴 反向对照：上面那些被拒的调用，**一个字节都不许写进文件**。
  //    最后一格是合法的（它会写），所以这里比的是「除了那一次之外没有别的写入」——
  //    也就是文件现在只多了 home-hero 的 hidden，别的一处没变。
  const now = JSON.parse(fs.readFileSync(path.join(root, 'site', 'pages', 'home.json'), 'utf-8'));
  const expect = JSON.parse(snapshot);
  expect.blocks[0].hidden = true;
  if (JSON.stringify(now) === JSON.stringify(expect)) ok('反向对照: 被拒的那些调用一个字节都没写进文件');
  else bad(`被拒的调用动了文件: ${JSON.stringify(now.blocks)}`);
}

console.log(`\n══ ${pass} 过 / ${fail} 败 ══`);
process.exit(fail ? 1 : 0);
