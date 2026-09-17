// #1351 —— scripts/lib/block-scope.js 的测试：「让 AI 改这一块」那一轮，别的块一个字节都不许动。
//
// 🔴 这一族的错法是静默的：模型顺手把隔壁那块的文字也改了，写入照样落盘、同步照样过、commit 照样
//    推出去，老板收到一句「Done」，而他只要求改一块。所以每一格都配反向对照 —— 只测「越界会被拒」
//    的话，一个**什么都拒**的实现也全绿，而那种实现会让这个按钮整个不能用。

const { blockScopeRejection, scopeFromInput } = require('./block-scope');

let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };

const PAGE = {
  slug: 'home',
  blocks: [
    { id: 'home-hero', type: 'hero', role: 'lead', region: 'content', weight: 0, data: { headline: 'Hi' } },
    { id: 'home-features', type: 'features-grid', role: 'optional', region: 'content', weight: 10, data: { headline: 'F' } },
    { ref: 'our-team', weight: 20 },
  ],
};
const SCOPE = { pagePath: 'en/pages/home.json', blockId: 'home-features' };
const reader = (files) => (p) => (Object.prototype.hasOwnProperty.call(files, p) ? files[p] : null);
const FILES = { 'en/pages/home.json': JSON.stringify(PAGE, null, 2) };
const clone = () => JSON.parse(JSON.stringify(PAGE));

// ── ① 只改那一块 ⟹ 放行 ────────────────────────────────────────────────────────────────────────
console.log('\n── ① 只改被点名那一块 ⟹ 放行');
{
  const next = clone();
  next.blocks[1].data.headline = '改过的标题';
  const r = blockScopeRejection('en/pages/home.json', next, SCOPE, reader(FILES));
  if (r === null) ok('只改 home-features 的正文 ⟹ 放行（回 null）');
  else bad(`正常的一次改动被拒了: ${r}`);

  // 🔴 反向对照：一个字都没改也放行。模型常常先原样写一遍再改，拒掉它等于白烧一轮。
  const same = clone();
  if (blockScopeRejection('en/pages/home.json', same, SCOPE, reader(FILES)) === null) {
    ok('反向对照: 内容一个字节没变 ⟹ 也放行');
  } else bad('没改动的写入被拒了');
}

// ── ② 动了别的块 ⟹ 拒 ──────────────────────────────────────────────────────────────────────────
console.log('\n── ② 动了别的块 ⟹ 整笔拒掉');
{
  const next = clone();
  next.blocks[1].data.headline = '改过的标题';
  next.blocks[0].data.headline = '顺手改的';
  const r = blockScopeRejection('en/pages/home.json', next, SCOPE, reader(FILES));
  if (r && r.includes('home-hero')) ok('顺手改了 home-hero ⟹ 拒，并在话里点名 home-hero');
  else bad(`越界没被拒，或者没点名: ${r}`);

  // 增删块也算越界 —— 这张票只给「改一块」，加块删块是别的入口的事。
  const added = clone();
  added.blocks.push({ id: 'x', type: 'divider', role: 'optional', region: 'content', weight: 30, data: {} });
  const r2 = blockScopeRejection('en/pages/home.json', added, SCOPE, reader(FILES));
  const removed = clone();
  removed.blocks.splice(0, 1);
  const r3 = blockScopeRejection('en/pages/home.json', removed, SCOPE, reader(FILES));
  if (r2 && r3) ok('加一块 / 删一块都被拒');
  else bad(`增删没被拒: 加=${r2} 删=${r3}`);

  // 🔴 换身份：把被点名那一块的 id / type 改掉。逐条比那一格对它是**盲**的（它就是「允许变」的
  //    那一条），而放过去等于允许把这一块整个换成别的东西。
  for (const key of ['id', 'type']) {
    const swapped = clone();
    swapped.blocks[1][key] = 'something-else';
    const rr = blockScopeRejection('en/pages/home.json', swapped, SCOPE, reader(FILES));
    if (rr && rr.includes(`"${key}"`)) ok(`把被点名那一块的 ${key} 改掉 ⟹ 拒`);
    else bad(`改 ${key} 没被拒: ${rr}`);
  }
}

// ── ③ 写别的文件 ⟹ 拒；站级块库是唯一例外 ───────────────────────────────────────────────────────
console.log('\n── ③ 只许写那一页，站级块库是唯一例外');
{
  const r = blockScopeRejection('en/pages/about.json', { slug: 'about', blocks: [] }, SCOPE, reader(FILES));
  if (r && r.includes('en/pages/about.json')) ok('写另一页 ⟹ 拒，并说出你只能写哪一页');
  else bad(`写别的页没被拒: ${r}`);

  const r2 = blockScopeRejection('en/services.json', [{ name: 'x' }], SCOPE, reader(FILES));
  if (r2) ok('写站里别的配置文件 ⟹ 拒');
  else bad('写 services.json 没被拒');

  // 站级块：被点名的那个块是一条 `{ref}`，它的正文住在块库里 —— 不放这个文件的话，
  // 「让 AI 改这一块」对跨页复用的块整个不能用。
  const LIB_PATH = 'en/blocks/site-blocks.json';
  const LIB = {
    'our-team': { type: 'team-grid', role: 'optional', region: 'content', visibility: ['home'], data: { headline: 'Team' } },
    'our-awards': { type: 'awards-certifications', role: 'optional', region: 'content', visibility: ['home'], data: {} },
  };
  const libFiles = { [LIB_PATH]: JSON.stringify(LIB, null, 2) };
  const refScope = { pagePath: 'en/pages/home.json', blockId: 'our-team' };

  const okLib = JSON.parse(JSON.stringify(LIB));
  okLib['our-team'].data.headline = '新标题';
  if (blockScopeRejection(LIB_PATH, okLib, refScope, reader(libFiles)) === null) {
    ok('改站级块库里被点名的那一个条目 ⟹ 放行');
  } else bad('改被点名的站级块被拒了');

  // 🔴 反向对照：同一个文件里动了**别的**条目 ⟹ 拒。少了这一格，上面那一格等于「块库随便写」。
  const badLib = JSON.parse(JSON.stringify(LIB));
  badLib['our-team'].data.headline = '新标题';
  badLib['our-awards'].data = { headline: '顺手改的' };
  const rr = blockScopeRejection(LIB_PATH, badLib, refScope, reader(libFiles));
  if (rr && rr.includes('our-awards')) ok('块库里顺手改了另一个条目 ⟹ 拒，并点名 our-awards');
  else bad(`块库越界没被拒: ${rr}`);
}

// ── ④ 没收窄时这条路一个字节不变 ────────────────────────────────────────────────────────────────
console.log('\n── ④ 没收窄的普通编辑：这一关必须完全不说话');
{
  const next = clone();
  next.blocks[0].data.headline = '随便改';
  next.blocks[1].data.headline = '也随便改';
  const results = [null, undefined, {}, { pagePath: '' }].map(
    (sc) => blockScopeRejection('en/pages/home.json', next, sc, reader(FILES)),
  );
  if (results.every((r) => r === null)) ok('scope 为空的四种写法都放行 ⟹ 普通编辑这条路逐字节不变');
  else bad(`没收窄时这一关说话了: ${JSON.stringify(results)}`);
}

// ── ⑤ 读不到磁盘上那份 ⟹ 拒，不是放行 ───────────────────────────────────────────────────────────
console.log('\n── ⑤ 比不了的时候走拒绝那一支');
{
  const r1 = blockScopeRejection('en/pages/home.json', clone(), SCOPE, () => null);
  const r2 = blockScopeRejection('en/pages/home.json', clone(), SCOPE, () => '{ 这不是 JSON');
  if (r1 && r2) {
    ok('磁盘上那份不存在 / 读不出来 ⟹ 都拒（放行的话，这一关恰好在文件本来就坏着时闭嘴）');
  } else bad(`比不了的时候放行了: 不存在=${r1} 坏JSON=${r2}`);
}

// ── ⑥ 老 sections 形状按下标收窄 ───────────────────────────────────────────────────────────────
console.log('\n── ⑥ 老 sections 形状：按数组下标收窄');
{
  const OLD = { slug: 'home', sections: [{ type: 'hero', data: { headline: 'A' } }, { type: 'features-grid', data: { headline: 'B' } }] };
  const files = { 'pages/home.json': JSON.stringify(OLD, null, 2) };
  const scope = { pagePath: 'pages/home.json', index: 1 };

  const good = JSON.parse(JSON.stringify(OLD));
  good.sections[1].data.headline = '改过';
  const badOne = JSON.parse(JSON.stringify(OLD));
  badOne.sections[0].data.headline = '改错了';

  const r1 = blockScopeRejection('pages/home.json', good, scope, reader(files));
  const r2 = blockScopeRejection('pages/home.json', badOne, scope, reader(files));
  if (r1 === null && r2) ok('下标 1 那一条可以改，下标 0 那一条被拒');
  else bad(`老形状收窄不对: 改第1条=${r1} 改第0条=${r2}`);
}

// ── ⑦ scopeFromInput：路径算得对吗 ─────────────────────────────────────────────────────────────
console.log('\n── ⑦ scopeFromInput：两种站形状各算一次');
{
  const cases = [
    ['多语言站，指定语言', { page: 'home', blockId: 'x', locale: 'zh' }, { flat: false, locales: ['en', 'zh'] }, 'zh/pages/home.json'],
    ['多语言站，没指定语言', { page: 'home', blockId: 'x' }, { flat: false, locales: ['en', 'zh'] }, 'en/pages/home.json'],
    ['老扁平站', { page: 'home', blockId: 'x' }, { flat: true, locales: [] }, 'pages/home.json'],
    ['嵌套 slug', { page: 'services/plumbing', blockId: 'x' }, { flat: true, locales: [] }, 'pages/services/plumbing.json'],
  ];
  let wrong = 0;
  for (const [name, input, shape, want] of cases) {
    const got = scopeFromInput(input, shape);
    if (!got || got.pagePath !== want) { bad(`${name}: 期望 ${want}，实际 ${got && got.pagePath}`); wrong += 1; }
  }
  if (!wrong) ok(`${cases.length} 种站形状算出来的页面路径都对`);

  // 🔴 反向对照：没带定位 / 读不出站形状 ⟹ 回 null（这一轮退化成普通编辑）。
  //    读不出来时按扁平站猜的话，多语言站上算出来的路径谁都对不上，这一关会把每一次写入都拒掉 ——
  //    方向是拒绝、不是放行，但那个按钮整个不能用，而且没有任何东西会报错。
  const nulls = [
    scopeFromInput({ page: 'home' }, { flat: true, locales: [] }),
    scopeFromInput({ blockId: 'x' }, { flat: true, locales: [] }),
    scopeFromInput({ page: 'home', blockId: 'x' }, null),
    scopeFromInput(null, { flat: true, locales: [] }),
  ];
  if (nulls.every((v) => v === null)) ok('反向对照: 没带定位、或者读不出站形状 ⟹ 不收窄（回 null）');
  else bad(`该回 null 的没回 null: ${JSON.stringify(nulls)}`);
}

console.log(`\n══ ${pass} 过 / ${fail} 败 ══`);
process.exit(fail ? 1 : 0);
