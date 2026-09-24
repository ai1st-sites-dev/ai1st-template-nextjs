#!/usr/bin/env node
/**
 * editor-shared.test.js — #1406：站级共用块在编辑器里改字 / 挪位置 / 删除，三件各写对文件。
 *
 *   node scripts/editor-shared.test.js     （由 `npm run test:scripts` 自动发现）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 走的是真链路的每一段，只少了浏览器和网络：
 *   底稿    `lib/editor-page.js` §editorBaseline（manager 经 docker exec 调的就是它）
 *   编辑器  `lib/editor-convert.js` §pageToPuck → 改 Puck Data → §puckToPage + §puckSharedChanges（EditorApp 存盘那两步）
 *   写盘    `scripts/write-editor-save.js`（worker 在站容器里跑的那个脚本，stdin 同形）
 *   重建    `scripts/sync-config.js`（构建里归一化页面的那一步），从它写出的 config-data.ts 读每一页的块
 *
 * 夹具：仓里那条 skipAI 建站路造一个三语真站（en 默认 + fr + zh），每种语言各放一份块库：
 *   promo     visibility ["about"]，home 页 `ref` 它                    → 在 2 页（about 靠 visibility，home 靠 ref）
 *   badge     不写 visibility，home / about / services 三页 `ref` 它   → 在 3 页（只靠 ref）
 *   onlyvis   visibility ["home", "contact"]，没有页 ref 它            → home 上只靠 visibility
 *   everywhere visibility ["*"]                                        → 所有页面，不许删
 *   strvis    visibility "about"（字符串，构建当没写），没有页 ref 它    → 哪一页都不在
 *
 * 「守卫真会红」在本文件里自己跑（反向对照：把「删除只拿掉 ref、不动 visibility」当实现跑一遍），不靠人手改代码。
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');
const crypto = require('crypto');

const NEXT = path.resolve(__dirname, '..');

let pass = 0; let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const check = (cond, m, detail) => (cond ? ok(m) : bad(detail ? `${m} —— ${detail}` : m));
function die(msg) { console.log(`💥 ${msg}`); process.exit(2); }

const temps = [];
process.on('exit', () => { for (const t of temps) fs.rmSync(t, { recursive: true, force: true }); });

let convert; let editorSchema; let catalogLib; let manifestLib;
try {
  convert = require('./lib/editor-convert.js');
  ({ editorSchema } = require('./lib/editor-schema.js'));
  catalogLib = require('./lib/block-catalog.js');
  manifestLib = require('./lib/block-manifest.js');
} catch (e) {
  die(`加载不起来：${e.message}`);
}
let schema;
try {
  schema = editorSchema();
} catch (e) {
  die(`算不出编辑器 schema：${e.message}`);
}
const manifests = manifestLib.loadManifests();
const sample = (type) => catalogLib.sampleDataFor(manifests.get(type));
const LOCALES = ['en', 'fr', 'zh'];

// ── 夹具 ─────────────────────────────────────────────────────────────────────────────────────
function makeTemplate() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'editor-shared-'));
  temps.push(root);
  const work = path.join(root, 'nextjs');
  cp.execSync(`cp -a --no-dereference "${NEXT}" "${work}"`, { stdio: 'pipe' });
  for (const junk of ['out', '.next', '.out-backup', '.out-temp', 'site', 'node_modules']) {
    fs.rmSync(path.join(work, junk), { recursive: true, force: true });
  }
  fs.symlinkSync(path.join(NEXT, 'node_modules'), path.join(work, 'node_modules'));
  const r = cp.spawnSync(process.execPath, [path.join(work, 'scripts', 'create-site.js')], {
    input: JSON.stringify({ siteId: 'shtest01', companyName: 'Northside Auto Care', industry: 'auto repair', location: 'Toronto', skipAI: true, language: 'en', secondaryLocales: ['fr', 'zh'] }),
    cwd: work, encoding: 'utf8', env: { ...process.env, ANTHROPIC_API_KEY: undefined }, timeout: 180000,
  });
  if (!fs.existsSync(path.join(work, 'site', 'zh', 'pages', 'home.json'))) die(`夹具立不起来（rc=${r.status}）\n${(r.stderr || '').slice(-600)}`);
  const site = path.join(work, 'site');
  for (const loc of LOCALES) {
    const dir = path.join(site, loc);
    for (const s of ['home', 'about', 'services', 'contact']) {
      if (!fs.existsSync(path.join(dir, 'pages', `${s}.json`))) die(`夹具里 ${loc} 没有 ${s} 页`);
    }
    fs.mkdirSync(path.join(dir, 'blocks'), { recursive: true });
    writeJSON(path.join(dir, 'blocks', 'site-blocks.json'), {
      promo: { type: 'cta-banner', data: { ...sample('cta-banner'), headline: `Promo ${loc}` }, visibility: ['about'] },
      badge: { type: 'text-block', data: { ...sample('text-block'), headline: `Badge ${loc}` } },
      onlyvis: { type: 'cta-banner', data: { ...sample('cta-banner'), headline: `Only vis ${loc}` }, visibility: ['home', 'contact'], weight: 25 },
      everywhere: { type: 'text-block', data: { ...sample('text-block'), headline: `Everywhere ${loc}` }, visibility: ['*'], weight: 5 },
      strvis: { type: 'text-block', data: { ...sample('text-block'), headline: `String vis ${loc}` }, visibility: 'about' },
    });
    const addRefs = (slug, refs) => {
      const p = path.join(dir, 'pages', `${slug}.json`);
      const page = readJSON(p);
      page.blocks.splice(1, 0, ...refs.map((ref) => ({ ref })));
      writeJSON(p, page);
    };
    addRefs('home', ['promo', 'badge']);
    addRefs('about', ['badge']);
    addRefs('services', ['badge']);
  }
  // 站仓是一个 git 仓（worker 按 files 列表 `git add`）；这里用它判「哪几份文件变了」。
  cp.execSync('git init -q && git add -A && git -c user.email=t@t -c user.name=t commit -qm fixture', { cwd: site });
  return work;
}

function readJSON(p) { return JSON.parse(fs.readFileSync(p, 'utf-8')); }
function writeJSON(p, v) { fs.writeFileSync(p, `${JSON.stringify(v, null, 2)}\n`); }

const TEMPLATE = makeTemplate();
const SITE = path.join(TEMPLATE, 'site');
const editorPage = require(path.join(TEMPLATE, 'scripts', 'lib', 'editor-page.js'));

function reset() { cp.execSync('git checkout -q -- . && git clean -qfd', { cwd: SITE }); }
function changed() {
  return cp.execSync('git status --porcelain', { cwd: SITE, encoding: 'utf8' }).split('\n').filter(Boolean).map((l) => l.slice(3)).sort();
}
const md5 = (p) => crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex');

/** 打开编辑器：底稿 → Puck Data（跟 EditorApp 收到 baseline 之后同一步）。 */
function open(slug, locale = 'en') {
  const b = editorPage.editorBaseline({ rootDir: TEMPLATE, page: slug, locale });
  if (!b.ok) die(`底稿取不到（${slug}/${locale}）：${b.reason} ${b.message}`);
  const initial = convert.pageToPuck({ raw: b.raw, blocks: b.blocks, located: b.located, schema, weights: b.weights, siteBlocks: b.siteBlocks });
  return { b, initial: JSON.parse(JSON.stringify(initial)), data: JSON.parse(JSON.stringify(initial)) };
}

/**
 * 存盘：跟 EditorApp §save 同两步，再把消息交给容器里的脚本（worker 拼的 stdin 同形）。
 * `conv` 可以换成一份被改坏的实现（反向对照）。
 */
function save(slug, o, { moved = [], locale = 'en', conv = convert } = {}) {
  const json = conv.puckToPage({ raw: o.b.raw, data: o.data, initial: o.initial, schema, slug, moved });
  const shared = conv.puckSharedChanges({ data: o.data, initial: o.initial, siteBlocks: o.b.siteBlocks, schema, slug, own: o.own });
  const pageChanged = !convert.deepEqual(json, o.b.raw);
  const input = {};
  if (pageChanged) input.page = json;
  if (Object.keys(shared).length) input.shared = shared;
  const loc = { page: slug, locale, ...(pageChanged ? { baseHash: o.b.hash } : {}) };
  const r = cp.spawnSync(process.execPath, [path.join(TEMPLATE, 'scripts', 'write-editor-save.js'), JSON.stringify(loc)], {
    cwd: TEMPLATE, input: JSON.stringify(input), encoding: 'utf8', timeout: 60000,
  });
  let last = null;
  try { last = JSON.parse((r.stdout || '').trim().split('\n').pop()); } catch { last = null; }
  return { status: r.status, stderr: r.stderr, last, input };
}

/** 重建（构建归一化页面那一步），回 { <locale>: { <slug>: [块 id…] } }。 */
function rebuild() {
  const r = cp.spawnSync(process.execPath, [path.join(TEMPLATE, 'scripts', 'sync-config.js')], { cwd: TEMPLATE, encoding: 'utf8', timeout: 180000 });
  if (r.status !== 0) return { error: (r.stdout + r.stderr).slice(-600) };
  const txt = fs.readFileSync(path.join(TEMPLATE, 'src', 'lib', 'config-data.ts'), 'utf-8');
  const m = txt.match(/^export const pagesByLocale = (.*);$/m);
  if (!m) return { error: 'config-data.ts 里找不到 pagesByLocale' };
  const out = {};
  for (const [loc, pages] of Object.entries(JSON.parse(m[1]))) {
    out[loc] = {};
    for (const p of pages) out[loc][p.slug] = p.blocks.map((b) => b.id);
  }
  return out;
}

/** 删完重建之后「这一页上又出现了这个块」—— 这正是 visibility 那条路要防的失败形态。回问题清单（空 = 没回来）。 */
function cameBack(built, locale, slug, id) {
  if (built.error) return [`重建失败：${built.error}`];
  const ids = (built[locale] && built[locale][slug]) || [];
  return ids.includes(id) ? [`共用块 ${id} 在重建之后又回到了 ${locale}/${slug} 上（visibility 还列着这一页）`] : [];
}

const idsOf = (d) => d.content.map((c) => c.props.id);
const itemOf = (d, id) => d.content.find((c) => c.props.id === id);
const sb = (loc = 'en') => readJSON(path.join(SITE, loc, 'blocks', 'site-blocks.json'));
const page = (slug, loc = 'en') => readJSON(path.join(SITE, loc, 'pages', `${slug}.json`));

// ══ ① 底稿：refs / slugs 跟构建的两条来路对得上 ═══════════════════════════════════════════════
console.log('① 底稿里的 refs / slugs');
{
  reset();
  const { b } = open('home');
  check(JSON.stringify(b.refs) === JSON.stringify({ badge: ['about', 'home', 'services'], promo: ['home'] }), 'refs = 每个共用块被哪几页 ref（读全部页面现算）', JSON.stringify(b.refs));
  check(Array.isArray(b.slugs) && ['home', 'about', 'services', 'contact', 'quote'].every((s) => b.slugs.includes(s)), 'slugs = 这种语言的全部页面', JSON.stringify(b.slugs));
  // 子目录页面也算进去（PM 三审「技术须知」：走 readPagesRecursive，slug 取路径定的那个）
  fs.mkdirSync(path.join(SITE, 'en', 'pages', 'services'), { recursive: true });
  writeJSON(path.join(SITE, 'en', 'pages', 'services', 'brakes.json'), { slug: 'whatever', title: 'Brakes', blocks: [{ ref: 'badge' }] });
  const { b: b2 } = open('home');
  check(JSON.stringify(b2.refs.badge) === JSON.stringify(['about', 'home', 'services', 'services/brakes']), '子目录页面的 ref 按路径定的 slug 计入', JSON.stringify(b2.refs.badge));
  reset();
}

// ══ ② 画布：共用块认得出来；N 的三种算法 ══════════════════════════════════════════════════════
console.log('② 共用块在画布上 · 在 N 个页面上');
{
  reset();
  const { b, data } = open('home');
  const shared = data.content.filter((c) => c.props._src.shared).map((c) => c.props._src.shared).sort();
  check(JSON.stringify(shared) === JSON.stringify(['badge', 'everywhere', 'onlyvis', 'promo']), 'home 上的共用块：两条 ref + 两个按 visibility 注入的', shared.join(' '));
  check(!data.content.some((c) => c.props.id === 'strvis'), '字符串 visibility 的块不在画布上（跟构建一样当没写）');
  check(data.content.filter((c) => c.props._src.shared).every((c) => !c.props._src.locked), '共用块都不锁');
  const reach = (id, lib = b.siteBlocks, refs = b.refs) => convert.sharedReach({ siteBlocks: lib, refs, slugs: b.slugs, id });
  check(reach('promo').pages === 2 && !reach('promo').all, 'visibility ["about"] + home 页 ref → N = 2（不是 1）', JSON.stringify(reach('promo')));
  check(reach('badge').pages === 3, '不写 visibility、被 3 页 ref → N = 3（不是 0）', JSON.stringify(reach('badge')));
  check(reach('everywhere').all === true, 'visibility ["*"] → 「所有页面」，不数', JSON.stringify(reach('everywhere')));
  check(reach('strvis').pages === 0, '字符串 visibility → 只数 ref（这里 0）', JSON.stringify(reach('strvis')));
  const ghost = { ...b.siteBlocks, onlyvis: { ...b.siteBlocks.onlyvis, visibility: ['home', 'contact', 'no-such-page'] } };
  check(reach('onlyvis', ghost).pages === 2, 'visibility 里写了不存在的页不算（构建也丢掉它）', JSON.stringify(reach('onlyvis', ghost)));
  // 在别的页加一条 ref、存盘、回到这一页 → N 加一。编辑器里不能「新加一个共用块」（本票不做），
  // 所以直接改页面文件模拟「别处给 contact 加了一条 ref」。
  const cpage = page('contact');
  cpage.blocks.splice(1, 0, { ref: 'badge' });
  writeJSON(path.join(SITE, 'en', 'pages', 'contact.json'), cpage);
  const { b: b3 } = open('home');
  check(reach('badge', b3.siteBlocks, b3.refs).pages === 4, '别的页多 ref 一次之后重新打开 → N 加一（3 → 4）', JSON.stringify(b3.refs.badge));
  reset();
}

// ══ ③ 改内容 → 块库变、页面不变 ═══════════════════════════════════════════════════════════════
console.log('③ 改内容');
{
  reset();
  const o = open('home');
  itemOf(o.data, 'promo').props.headline = 'Spring promo 1406';
  itemOf(o.data, 'onlyvis').props.headline = 'Only vis 1406';
  const r = save('home', o);
  check(r.status === 0, '存盘 rc=0', `${r.status} ${r.stderr}`);
  check(!r.input.page, '页面没改 ⟹ 不带页面（只带 shared）', JSON.stringify(Object.keys(r.input)));
  check(JSON.stringify(changed()) === JSON.stringify(['en/blocks/site-blocks.json']), '只有 en 的 site-blocks.json 变了', changed().join(' '));
  const lib = sb();
  check(lib.promo.data.headline === 'Spring promo 1406' && lib.onlyvis.data.headline === 'Only vis 1406', '两个共用块的字写进了块库');
  check(JSON.stringify(lib.promo.visibility) === JSON.stringify(['about']) && lib.everywhere.data.headline === 'Everywhere en', '别的键 / 别的块一个字节没动');
  const built = rebuild();
  check(!built.error && built.en.about.includes('promo'), '重建：about 页照样有 promo', built.error);
  // 不改就存 → 什么都不交
  reset();
  const o2 = open('home');
  const r2 = save('home', o2);
  check(Object.keys(r2.input).length === 0, '一个字没改 ⟹ 这次存盘什么都不交', JSON.stringify(r2.input));
  reset();
}

// ══ ④ 挪位置 → 页面 ref + weight 变、块库不变 ═════════════════════════════════════════════════
console.log('④ 挪位置');
{
  // (a) 按 visibility 注进来的 onlyvis 拖到最前 → 这一页新加一条 {ref: onlyvis}
  reset();
  const o = open('home');
  const at = idsOf(o.data).indexOf('onlyvis');
  const [it] = o.data.content.splice(at, 1);
  o.data.content.unshift(it);
  const canvas = idsOf(o.data);
  const r = save('home', o, { moved: ['onlyvis'] });
  check(r.status === 0 && !r.input.shared, '存盘 rc=0，不带 shared', `${r.status} ${r.stderr} ${JSON.stringify(r.input.shared)}`);
  check(JSON.stringify(changed()) === JSON.stringify(['en/pages/home.json']), '只有 home.json 变了，块库一个字节没动', changed().join(' '));
  const refEntry = page('home').blocks.find((e) => e.ref === 'onlyvis');
  check(!!refEntry && typeof refEntry.weight === 'number', '注进来的块被拖过 → 页面 JSON 多了 {ref, weight}', JSON.stringify(refEntry));
  const built = rebuild();
  check(!built.error && JSON.stringify(built.en.home) === JSON.stringify(canvas), '重建之后 home 的顺序 = 画布顺序', `${built.error || built.en.home.join(' ')} ≠ ${canvas.join(' ')}`);
  // (b) 没拖它、只拖别的块 → 它不写成 ref（仍是锚点）
  reset();
  const o2 = open('home');
  const hero = o2.data.content.shift();
  o2.data.content.push(hero);
  const canvas2 = idsOf(o2.data);
  save('home', o2, { moved: ['home-hero-0'] });
  check(!page('home').blocks.some((e) => e.ref === 'onlyvis' || e.ref === 'everywhere'), '没被拖过的注入块不写成 ref（撤掉 visibility 仍对这一页有效）');
  const built2 = rebuild();
  check(!built2.error && JSON.stringify(built2.en.home) === JSON.stringify(canvas2), '重建顺序仍 = 画布顺序（注入块当锚点）', `${built2.error || built2.en.home.join(' ')} ≠ ${canvas2.join(' ')}`);
  // (c) 已有的 {ref: badge} 挪位置 → 它的 weight 变
  reset();
  const o3 = open('home');
  const bi = idsOf(o3.data).indexOf('badge');
  const [bb] = o3.data.content.splice(bi, 1);
  o3.data.content.push(bb);
  const canvas3 = idsOf(o3.data);
  save('home', o3, { moved: ['badge'] });
  check(JSON.stringify(changed()) === JSON.stringify(['en/pages/home.json']), '挪 {ref} 条目：只有 home.json 变了', changed().join(' '));
  const built3 = rebuild();
  check(!built3.error && JSON.stringify(built3.en.home) === JSON.stringify(canvas3), '重建之后 badge 在最后 = 画布顺序', `${built3.error || built3.en.home.join(' ')} ≠ ${canvas3.join(' ')}`);
  reset();
}

// ══ ⑤ 删除：三种来路 + 删完重建不回来 ═════════════════════════════════════════════════════════
console.log('⑤ 删除');
function remove(o, id) { o.data.content = o.data.content.filter((c) => c.props.id !== id); }
{
  // (a) 只在 visibility（onlyvis 列了 home，没有 ref）
  reset();
  const o = open('home');
  remove(o, 'onlyvis');
  const r = save('home', o);
  check(r.status === 0 && JSON.stringify(r.input.shared) === JSON.stringify({ onlyvis: { unlist: true } }), '只在 visibility → shared 带 unlist', `${r.status} ${JSON.stringify(r.input.shared)} ${r.stderr}`);
  const lib = sb();
  check(JSON.stringify(lib.onlyvis.visibility) === JSON.stringify(['contact']), 'site-blocks.json 里 onlyvis 的 visibility 少了 home', JSON.stringify(lib.onlyvis.visibility));
  check(!!lib.onlyvis.type && lib.onlyvis.data.headline === 'Only vis en', '块本身还在块库里');
  const built = rebuild();
  const back = cameBack(built, 'en', 'home', 'onlyvis');
  check(back.length === 0, '删完重建：home 上 0 命中 onlyvis', back.join(' '));
  check(!built.error && built.en.contact.includes('onlyvis'), '别的页（contact）还看得见它');
  // 全站都删完：最后一页也删掉 → visibility 变成空数组，块留着
  const oc = open('contact');
  remove(oc, 'onlyvis');
  save('contact', oc);
  const lib2 = sb();
  check(JSON.stringify(lib2.onlyvis.visibility) === JSON.stringify([]) && !!lib2.onlyvis.data, '最后一页也删掉 → visibility = []，块留在块库里', JSON.stringify(lib2.onlyvis));

  // (b) 只靠 ref（badge 没有 visibility）
  reset();
  const o2 = open('home');
  remove(o2, 'badge');
  const r2 = save('home', o2);
  check(r2.status === 0 && !r2.input.shared, '只靠 ref → 不带 shared', JSON.stringify(r2.input.shared));
  check(!page('home').blocks.some((e) => e.ref === 'badge'), 'home.json 里的 {ref: badge} 没了');
  const diff = cp.execSync('git diff -- en/blocks/site-blocks.json', { cwd: SITE, encoding: 'utf8' });
  check(diff === '', 'site-blocks.json 的 git diff 为空', diff.slice(0, 200));
  const built2 = rebuild();
  check(cameBack(built2, 'en', 'home', 'badge').length === 0 && built2.en.about.includes('badge') && built2.en.services.includes('badge'),
    '重建：home 上没了，about / services 照样有', built2.error || JSON.stringify({ home: built2.en.home, about: built2.en.about }));

  // (c) 两条都有：promo 的 visibility 列了 about、about 再 ref 它一次
  reset();
  const ap = page('about');
  ap.blocks.push({ ref: 'promo' });
  writeJSON(path.join(SITE, 'en', 'pages', 'about.json'), ap);
  cp.execSync('git -c user.email=t@t -c user.name=t commit -qam both', { cwd: SITE });
  const o3 = open('about');
  remove(o3, 'promo');
  const r3 = save('about', o3);
  check(r3.status === 0 && JSON.stringify(r3.input.shared) === JSON.stringify({ promo: { unlist: true } }), '两条都有 → shared 带 unlist', JSON.stringify(r3.input.shared));
  check(!page('about').blocks.some((e) => e.ref === 'promo'), '而且 about.json 里的 ref 也拿掉了');
  check(JSON.stringify(sb().promo.visibility) === JSON.stringify([]), 'promo 的 visibility 少了 about', JSON.stringify(sb().promo.visibility));
  const built3 = rebuild();
  check(cameBack(built3, 'en', 'about', 'promo').length === 0 && built3.en.home.includes('promo'), '重建：about 上 0 命中，home（靠 ref）照样有', built3.error);
  cp.execSync('git reset -q --hard HEAD~1', { cwd: SITE });
  reset();
}

// ══ ⑥ "*" 的块删不掉；改内容 / 挪位置照常 ═════════════════════════════════════════════════════
console.log('⑥ "*" 的块');
{
  reset();
  const { b } = open('home');
  check(convert.sharedRemovable(b.siteBlocks, 'everywhere') === false && convert.sharedRemovable(b.siteBlocks, 'onlyvis') === true, '编辑器判它不能删（删除按钮据此关掉）');
  const o = open('home');
  remove(o, 'everywhere');
  let threw = null;
  try { save('home', o); } catch (e) { threw = e.message; }
  check(!!threw, '真删了也存不出去（编辑器那一侧抛错）', threw || '没抛');
  // 脚本那一侧也拒（绕过编辑器直接送一条 unlist）
  const r = cp.spawnSync(process.execPath, [path.join(TEMPLATE, 'scripts', 'write-editor-save.js'), JSON.stringify({ page: 'home', locale: 'en' })], {
    cwd: TEMPLATE, input: JSON.stringify({ shared: { everywhere: { unlist: true } } }), encoding: 'utf8',
  });
  const last = (() => { try { return JSON.parse(r.stdout.trim().split('\n').pop()); } catch { return null; } })();
  check(r.status === 11 && last && last.ok === false && /every page/.test(last.message), '脚本 exit 11，拒收那句话在 stdout（worker 原样进状态栏）', `${r.status} ${r.stdout}`);
  check(changed().length === 0, '一个字节都没写', changed().join(' '));
  // 改内容 + 挪位置照常
  const o2 = open('home');
  itemOf(o2.data, 'everywhere').props.headline = 'Everywhere 1406';
  const ei = idsOf(o2.data).indexOf('everywhere');
  const [ev] = o2.data.content.splice(ei, 1);
  o2.data.content.push(ev);
  const r2 = save('home', o2, { moved: ['everywhere'] });
  check(r2.status === 0, '改内容 + 挪位置存盘 rc=0', r2.stderr);
  check(sb().everywhere.data.headline === 'Everywhere 1406' && JSON.stringify(sb().everywhere.visibility) === JSON.stringify(['*']), '字写进块库，visibility 仍是 ["*"]', JSON.stringify(sb().everywhere.visibility));
  check(page('home').blocks.some((e) => e.ref === 'everywhere'), '挪过 → home 多一条 {ref: everywhere}');
  reset();
}

// ══ ⑦ 字符串 visibility 跟构建一致 ═══════════════════════════════════════════════════════════
console.log('⑦ 字符串 visibility');
{
  reset();
  const o = open('about');
  check(!idsOf(o.data).includes('strvis'), '编辑器：about 页不显示 strvis');
  const built = rebuild();
  check(!built.error && !built.en.about.includes('strvis'), '构建：about 页也没有 strvis（两边一致）', built.error);
  // 在 about 上改个字存盘 → 磁盘上仍是那个字符串
  itemOf(o.data, 'badge').props.headline = 'Badge 1406';
  const r = save('about', o);
  check(r.status === 0 && sb().strvis.visibility === 'about', '存盘之后磁盘上仍是 "about" 这个字符串', JSON.stringify(sb().strvis.visibility));
  reset();
}

// ══ ⑧ 多语言：只写当前语言那一份 ═════════════════════════════════════════════════════════════
console.log('⑧ 多语言');
{
  reset();
  const before = Object.fromEntries(['fr', 'zh'].map((l) => [l, md5(path.join(SITE, l, 'blocks', 'site-blocks.json'))]));
  const o = open('home', 'en');
  remove(o, 'onlyvis');
  itemOf(o.data, 'promo').props.headline = 'Promo en 1406';
  const r = save('home', o, { locale: 'en' });
  check(r.status === 0, '在 en 删一个 + 改一个 rc=0', r.stderr);
  check(JSON.stringify(changed()) === JSON.stringify(['en/blocks/site-blocks.json', 'en/pages/home.json']), '只动了 en 的两份文件', changed().join(' '));
  for (const l of ['fr', 'zh']) {
    const diff = cp.execSync(`git diff -- ${l}/`, { cwd: SITE, encoding: 'utf8' });
    check(diff === '' && md5(path.join(SITE, l, 'blocks', 'site-blocks.json')) === before[l], `${l}/ 的 git diff 为空`, diff.slice(0, 200));
  }
  reset();
}

// ══ ⑩ 一个标签页存好几次：别处改过的共用块不被抹回去（QA2 r1 的 F）══════════════════════════
// 跟 EditorApp 的真时序走：存盘成功 → `sharedOwnAfter` 推 own → dashboard 重取底稿（新的块库、新的 hash），
// 画布不换（#1415 起不重载 iframe）。
console.log('⑩ 同一个标签页连存几次 · 别处的改动');
{
  const commit = (m) => cp.execSync(`git add -A && git -c user.email=t@t -c user.name=t commit -qm ${JSON.stringify(m)}`, { cwd: SITE });
  const extWrite = (fn) => { const f = path.join(SITE, 'en', 'blocks', 'site-blocks.json'); const lib = readJSON(f); fn(lib); writeJSON(f, lib); commit('ext'); };
  const saveAndRefresh = (o) => {
    const r = save('home', o);
    const files = changed();
    if (r.status === 0) {
      o.own = convert.sharedOwnAfter({ initial: o.initial, own: o.own, changes: r.input.shared || {} });
      const fresh = editorPage.editorBaseline({ rootDir: TEMPLATE, page: 'home', locale: 'en' });
      o.b = { ...o.b, raw: fresh.raw, hash: fresh.hash, siteBlocks: fresh.siteBlocks };
      if (files.length) commit('save');
    }
    return { r, files };
  };
  const heroOf = (d) => d.content.find((c) => !c.props._src.shared && !c.props._src.locked && typeof c.props.headline === 'string');
  const runFG = (external) => {
    reset();
    const head = cp.execSync('git rev-parse HEAD', { cwd: SITE, encoding: 'utf8' }).trim();
    const o = open('home');
    if (external) extWrite((lib) => { lib.promo.data.description = 'EXT-F 1406'; });
    heroOf(o.data).props.headline = 'Hero one 1406';
    const s1 = saveAndRefresh(o);
    heroOf(o.data).props.headline = 'Hero two 1406';
    const s2 = saveAndRefresh(o);
    const out = { s1, s2, desc: sb().promo.data.description };
    cp.execSync(`git reset -q --hard ${head}`, { cwd: SITE });
    return out;
  };
  const F = runFG(true);
  check(F.s1.r.status === 0 && F.s2.r.status === 0, 'F：两次只改 hero 的存盘都 rc=0', `${F.s1.r.stderr} ${F.s2.r.stderr}`);
  check(JSON.stringify(F.s1.files) === JSON.stringify(['en/pages/home.json']) && JSON.stringify(F.s2.files) === JSON.stringify(['en/pages/home.json']),
    'F：别处改过 promo 之后，两次只改 hero 的存盘都只写 home.json', `${F.s1.files.join(' ')} | ${F.s2.files.join(' ')}`);
  check(!F.s2.r.input.shared, 'F：第二次存盘不带 shared', JSON.stringify(F.s2.r.input.shared));
  check(F.desc === 'EXT-F 1406', 'F：别处改的 promo.description 还在（没被抹回打开时那一份）', F.desc);
  const G = runFG(false);
  check(JSON.stringify(G.s1.files) === JSON.stringify(['en/pages/home.json']) && JSON.stringify(G.s2.files) === JSON.stringify(['en/pages/home.json']),
    'G（对照）：不做别处改动，两次都只写 home.json', `${G.s1.files.join(' ')} | ${G.s2.files.join(' ')}`);

  // E：老板改了 promo 的 headline，别处刚改了它的 description → 只交 headline，description 留着别处那句
  reset();
  const head0 = cp.execSync('git rev-parse HEAD', { cwd: SITE, encoding: 'utf8' }).trim();
  const o = open('home');
  extWrite((lib) => { lib.promo.data.description = 'EXT-E 1406'; });
  itemOf(o.data, 'promo').props.headline = 'Promo E 1406';
  const e = saveAndRefresh(o);
  check(JSON.stringify(Object.keys((e.r.input.shared || {}).promo?.data || {})) === JSON.stringify(['headline']), 'E：shared 只带改过的那个字段', JSON.stringify(e.r.input.shared));
  const pe = sb().promo.data;
  check(pe.headline === 'Promo E 1406' && pe.description === 'EXT-E 1406', 'E：headline 写进去，别处改的 description 还在', JSON.stringify(pe));

  // H：同一个标签页里，promo 改过一次、存过；之后别处又改了 promo.headline；老板再只改 hero 存 → 别处那句不被再交一遍盖掉
  extWrite((lib) => { lib.promo.data.headline = 'EXT-H 1406'; });
  heroOf(o.data).props.headline = 'Hero H 1406';
  const h = saveAndRefresh(o);
  check(!h.r.input.shared && JSON.stringify(h.files) === JSON.stringify(['en/pages/home.json']), 'H：存过的共用块字段不在之后每次存盘里重交', `${JSON.stringify(h.r.input.shared)} ${h.files.join(' ')}`);
  check(sb().promo.data.headline === 'EXT-H 1406', 'H：别处后来改的 promo.headline 还在', sb().promo.data.headline);
  // H 的反向对照：不推 own（= 永远跟打开时比）→ 第二次照样把 headline 交出去
  const again = convert.puckSharedChanges({ data: o.data, initial: o.initial, siteBlocks: o.b.siteBlocks, schema, slug: 'home' });
  check(again.promo && again.promo.data && again.promo.data.headline === 'Promo E 1406', 'H 对照：不推 own 的话，存过的字每次都会重交（所以 own 是承重的）', JSON.stringify(again));
  cp.execSync(`git reset -q --hard ${head0}`, { cwd: SITE });
  reset();
}

// ══ ⑨ 守卫真会红：把「删除只从页面 JSON 拿掉 ref、不动 visibility」当成实现跑一遍 ═══════════════
console.log('⑨ 反向对照：删除不动 visibility');
{
  reset();
  const broken = { ...convert, puckSharedChanges: (a) => {
    const out = convert.puckSharedChanges(a);
    for (const k of Object.keys(out)) { delete out[k].unlist; if (!Object.keys(out[k]).length) delete out[k]; }
    return out;
  } };
  const o = open('home');
  remove(o, 'onlyvis');
  save('home', o, { conv: broken });
  const back = cameBack(rebuild(), 'en', 'home', 'onlyvis');
  check(back.length === 1 && /onlyvis/.test(back[0]) && /又回到了 en\/home/.test(back[0]), '改坏的实现 → 删完重建那一格报红，并点名 onlyvis 回来了', back.join(' ') || '没报');
  reset();
}

// ══ ⑩ #1427：共用块里的链接过同一道白名单（lib/link-href.js）—— 帽子在 lib/page-write.js §commitWrites ════
console.log('⑩ 共用块的按钮链接：坏的拒、好的收、老数据不炸、新的写入方不用接线');
{
  const BAD = ['javascript:alert(1)', 'vbscript:msgbox(1)', 'data:text/html,<script>alert(1)</script>'];
  const GOOD = ['https://example.com/book', 'mailto:hi@example.com', 'tel:+14165550100', '/contact'];
  const lib = path.join(SITE, 'en', 'blocks', 'site-blocks.json');
  const setButton = (o, href) => { itemOf(o.data, 'promo').props.button = { label: 'Go', href }; };
  const refusedMsg = (r) => (r.last && r.last.ok === false ? String(r.last.message || '') : '');

  for (const href of BAD) {
    reset();
    const before = fs.readFileSync(lib, 'utf-8');
    const o = open('home');
    setButton(o, href);
    const r = save('home', o);
    check(Boolean(r.input.shared && r.input.shared.promo), `${href.split(':')[0]}: 这次存盘真的带着共用块的改动`, JSON.stringify(r.input));
    const msg = refusedMsg(r);
    check(r.status === 11 && /not an address a link can use/.test(msg) && /"Go"/.test(msg),
      `${href.split(':')[0]}: → exit 11、stdout 那一行点名了按钮`, `rc=${r.status} ${JSON.stringify(msg.slice(0, 120))} ${String(r.stderr).slice(0, 160)}`);
    check(fs.readFileSync(lib, 'utf-8') === before && changed().length === 0, `${href.split(':')[0]}: 块库逐字节不变、站仓 git status 为空`, changed().join(' '));
  }

  for (const href of GOOD) {
    reset();
    const o = open('home');
    setButton(o, href);
    const r = save('home', o);
    const got = sb().promo.data.button;
    check(r.status === 0 && got && got.href === href && got.label === 'Go', `合法 ${href} → rc=0、落盘逐字相同`, `rc=${r.status} ${JSON.stringify(got)} ${String(r.stderr).slice(0, 160)}`);
  }

  // 老数据：块库里本来就有一个坏链接（模拟本票之前存进去的）。
  reset();
  const legacy = readJSON(lib);
  legacy.promo.data.button = { label: 'Old', href: 'vbscript:legacy()' };
  writeJSON(lib, legacy);
  {
    const o = open('home');
    itemOf(o.data, 'promo').props.headline = 'Only the headline 1427';
    const r = save('home', o);
    const d = sb().promo.data;
    check(r.status === 0 && d.headline === 'Only the headline 1427' && d.button.href === 'vbscript:legacy()',
      '老数据：只改这个块的标题 → rc=0（老坏链接原样留着）', `rc=${r.status} ${JSON.stringify(d)} ${String(r.stderr).slice(0, 160)}`);
  }
  {
    const before = fs.readFileSync(lib, 'utf-8');
    const o = open('home');
    itemOf(o.data, 'promo').props.button = { label: 'Old', href: 'data:text/html,x' };
    const r = save('home', o);
    const msg = refusedMsg(r);
    check(r.status === 11 && /"Old"/.test(msg) && /CTA/i.test(msg) && fs.readFileSync(lib, 'utf-8') === before,
      '老数据：把那个坏链接改成另一个坏的 → 拒，点名按钮和块，块库不变', `rc=${r.status} ${JSON.stringify(msg.slice(0, 160))}`);
  }
  reset();

  // 🔴 源头帽「按构造覆盖」：一种今天不存在的写入（新文件、新种类），不经任何 plan 函数、直接交给 commitWrites。
  const pw = require(path.join(TEMPLATE, 'scripts', 'lib', 'page-write.js'));
  const fifth = path.join(SITE, 'en', 'blocks', 'footer-promos-1427.json');
  const doc = (href) => `${JSON.stringify({ spring: { type: 'cta-banner', data: { ...sample('cta-banner'), button: { label: 'Go', href } } } }, null, 2)}\n`;
  for (const href of BAD) {
    let err = null;
    try { pw.commitWrites([{ file: fifth, content: doc(href) }]); } catch (e) { err = e; }
    check(err instanceof pw.PageWriteError && err.code === pw.REFUSED && !fs.existsSync(fifth),
      `第五种写入 ${href.split(':')[0]}: → PageWriteError(REFUSED)、文件没落盘`, err ? `${err.code} ${err.message.slice(0, 100)}` : '没抛');
  }
  {
    // 一次交两份：好的页面 + 坏的新文件 ⟹ 两份都不写（所有校验先于所有写入）
    const home = path.join(SITE, 'en', 'pages', 'home.json');
    const hb = fs.readFileSync(home, 'utf-8');
    const pg = readJSON(home); pg.title = 'Would be written 1427';
    let err = null;
    try { pw.commitWrites([{ file: home, content: `${JSON.stringify(pg, null, 2)}\n` }, { file: fifth, content: doc('vbscript:x') }]); } catch (e) { err = e; }
    check(err && err.code === pw.REFUSED && fs.readFileSync(home, 'utf-8') === hb && !fs.existsSync(fifth), '好页面 + 坏的第五种写入一起交 ⟹ 一个字节都不写', err ? err.message.slice(0, 100) : '没抛');
    pw.commitWrites([{ file: fifth, content: doc('/contact') }]);
    check(fs.existsSync(fifth) && readJSON(fifth).spring.data.button.href === '/contact', '第五种写入合法链接 → 照写', '');
  }
  reset();
}

console.log(`\n${fail === 0 ? '✅' : '❌'} ${pass} 过 · ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
