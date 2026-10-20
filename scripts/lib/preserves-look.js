'use strict';
// #1918 (SiteAsData T4b-4) —— `preservesLook: true` 的机器尺子（设计文档 §8.4）：一条迁移「前」「后」各渲一次，
// 无头 Chromium 比块的结构 + 9 个 computed style，样子变了就红。命令行入口是 `scripts/preserves-look.js`（CI 跑它）。
//
//   「前」：下载这条迁移自报的 `fromBuild` 那份 release 的 template.tar.gz，用**包里的** site.js 渲旧形状。
//           🔴 不能用「上一份 release」：那份包里已经带着这条迁移了，渲出来的「前」等于「后」，尺子恒绿。
//   「后」：当前树渲迁移后的内容。
//   块代码：真块两边各用各自那份 `blocks/`；假块（自检那几格）「前」用包里的 `site.js bundle --blocks-dir <v1>`，
//           「后」用当前树的 `--blocks-dir <v2>`。块目录必须放在那棵树里面、跟 scripts/ 同一层深度 —— 块的 Section.tsx
//           用 `../../scripts/lib/…` 引脚本，放在树外 bundle 解析不了。
//
// 判据的顺序（一条迁移只落一个结论）：
//   基准不对   渲染之前判：「前」那一侧这个块的 `migrations.js` 已经有同一个键 ⟹ 那份包已经含这条迁移，不渲、不比。
//              📌 不能用「前后相等」判：前后相等正是一条诚实迁移该有的样子。
//   拿不到包   跳过、单独计数（不许当成通过）。🔴 只认「release not found」，而且要先过一次阳性对照（`gh release list` 读得到）：
//              没有 token 时 gh 对私有库的任何 tag 也回「release not found」。认证 / 网络 / 解包失败一律抛 `InstrumentError`
//              （仪器坏了，CLI 读成 rc=2「跑不起来」）—— 不然 token 一坏，自检和每条真迁移都安静地变成「跳过」、rc=0。
//   前渲不出   包里的 site.js 跑不起来，或渲完页面里**找不到那个块的根元素**（SectionRenderer 对不认识的类型静默 return null，
//              render 照样 rc=0 —— 这一条就是为那个形态写的）。后渲不出同理。
//   样子变了   结构不同，或两个取样点（块根 + 第一个含文本的元素）上 9 个属性有一个不同。
const cp = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const TEMPLATE_DIR = path.resolve(__dirname, '..', '..');
const FIXTURE_SITE = path.join(TEMPLATE_DIR, 'scripts', 'fixtures', 'site-fixtures', 'site-0448c807.json');
// 设计文档 §8.5 那一组。flex 顺序、响应式断点不在射程里（票面「全绿能漏什么」）。文字内容也不比：标题换成另一段字照样绿，
// 只有取样点上的字整段没了才红（#1918 r3，QA1 实测）。外壳区（header / footer）整个量不了，见 §regionVerdict。
const PROPS = ['color', 'background-color', 'font-family', 'font-size', 'font-weight', 'padding', 'margin', 'border-radius', 'display'];
const TAG_RE = /^build-[0-9a-f]{12}$/;
const STEP_RE = /^(\d+)→(\d+)$/;
const TYPE_STEP_RE = /^([a-z0-9-]+)→([a-z0-9-]+)$/;
const VIEWPORT = { width: 1280, height: 800 };

const clone = (v) => JSON.parse(JSON.stringify(v));
/** 子进程输出里最能说明问题的那一行：先找 `Error:` 那一行（Node 抛错时最后一行是版本号，没用），没有就取最后一行。 */
const firstLine = (s) => {
  const lines = String(s || '').split('\n').map((l) => l.trim()).filter(Boolean);
  return lines.find((l) => /\bError\b:/.test(l)) || lines[lines.length - 1] || '';
};

/** 一条迁移「前」那一侧的块类型：同类型 `n→n+1` 就是它自己，跨类型 `a→b` 是 a。 */
function oldTypeOf(type, key) {
  const t = key.match(TYPE_STEP_RE);
  return STEP_RE.test(key) || !t ? type : t[1];
}

/**
 * 基准不对：「前」那一侧块代码里这个块的 `migrations.js` 已经有同一个键。回 `null`（没有）或一句理由。
 * 读不出那份 `migrations.js` 也算基准不对（判不了「它含不含」就不能拿它当「前」）。
 */
function baselineConflict(beforeBlocksDir, oldType, key) {
  const file = path.join(beforeBlocksDir, oldType, 'migrations.js');
  if (!fs.existsSync(file)) return null;
  let table;
  try {
    delete require.cache[require.resolve(file)];
    // eslint-disable-next-line global-require, import/no-dynamic-require
    table = require(file);
  } catch (e) {
    return `「前」那一侧的 ${oldType}/migrations.js 读不出来（${firstLine(e && e.message)}）`;
  }
  if (table && typeof table === 'object' && Object.prototype.hasOwnProperty.call(table, key)) {
    return `「前」那一侧的 ${oldType}/migrations.js 已经有 ${JSON.stringify(key)} —— 这份块代码里已经带着这条迁移`;
  }
  return null;
}

/** 迁移后的那一块（版本号由这里写上，同 block-migrations.js §migrateBlock）。 */
function migratedBlock(block, key, step) {
  const next = step.migrate(clone(block));
  if (!next || typeof next !== 'object' || Array.isArray(next)) throw new Error(`迁移 ${key} 没有返回一个对象`);
  const m = key.match(STEP_RE);
  return m ? { ...next, schemaVersion: Number(m[2]) } : next;
}

/** 夹具站，首页只留这一块（「前」「后」用同一份站，只换这一块）。 */
function siteWith(block) {
  const c = JSON.parse(fs.readFileSync(FIXTURE_SITE, 'utf-8'));
  c['en/pages/home.json'] = { ...c['en/pages/home.json'], blocks: [block] };
  return c;
}

/** 仪器坏了（gh 认证 / 网络 / 解包失败）—— 不是「拿不到包」，不许落进跳过那一栏。CLI 读成 rc=2。 */
class InstrumentError extends Error {}

function run(cmd, args, opts) {
  const r = cp.spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
  return { status: r.error ? -1 : r.status, stdout: r.stdout || '', out: `${r.stdout || ''}${r.stderr || ''}${r.error ? r.error.message : ''}` };
}

/** 一次跑用的工作区：下载的包按 tag 缓存，打过的 bundle 按（树, 块目录）缓存，跑完 `cleanup()` 全删。 */
class Workspace {
  constructor({ repo = process.env.GITHUB_REPOSITORY || 'webisca/ai1st', log = () => {}, env } = {}) {
    this.repo = repo;
    this.log = log;
    this.env = env; // gh 子进程用的环境（自检「假 token」那一格换掉 GH_TOKEN）；不给就继承
    this.reachable = false;
    this.dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preserves-look-'));
    this.packages = new Map();
    this.bundles = new Map();
    this.cleanups = [];
  }

  cleanup() {
    for (const d of this.cleanups.reverse()) fs.rmSync(d, { recursive: true, force: true });
    fs.rmSync(this.dir, { recursive: true, force: true });
  }

  /** gh 把原因写在第一行（第二行是「Try authenticating with…」这类提示），所以 `why` 取第一行。 */
  gh(args) {
    const r = run('gh', args, this.env ? { env: this.env } : {});
    return { ...r, why: String(r.out).split('\n').map((l) => l.trim()).find(Boolean) || '' };
  }

  /** 阳性对照：`gh release list` 读得到这个库，才能把「release not found」当真。读不到 ⟹ 抛 InstrumentError。回解析好的列表。 */
  releaseList(limit) {
    const r = this.gh(['release', 'list', '-R', this.repo, '--limit', String(limit), '--json', 'tagName,createdAt']);
    if (r.status !== 0) throw new InstrumentError(`gh release list 读不到 ${this.repo}（认证 / 网络？）：${r.why}`);
    let list;
    try { list = JSON.parse(r.stdout); } catch { throw new InstrumentError(`gh release list 的输出不是 JSON：${firstLine(r.out)}`); }
    if (!Array.isArray(list)) throw new InstrumentError(`gh release list 的输出不是数组：${firstLine(r.out)}`);
    this.reachable = true;
    return list;
  }

  /** `{ dir }`（解开的包）或 `{ missing: 理由 }`（只有 release 真不存在）；其余失败抛 InstrumentError。 */
  fetchPackage(tag) {
    if (this.packages.has(tag)) return this.packages.get(tag);
    let res;
    if (!TAG_RE.test(String(tag))) res = { missing: `fromBuild ${JSON.stringify(tag)} 不是 build-<sha12> 的形状` };
    else {
      const dl = path.join(this.dir, `${tag}-dl`);
      fs.mkdirSync(dl);
      const t0 = Date.now();
      try {
        const r = this.gh(['release', 'download', tag, '-R', this.repo, '-p', 'template.tar.gz', '-D', dl]);
        if (r.status !== 0) {
          if (!/release not found/.test(r.out)) throw new InstrumentError(`gh release download ${tag}：${r.why}`);
          if (!this.reachable) this.releaseList(1);
          res = { missing: `gh release download ${tag}：${r.why}` };
        } else {
          const dir = path.join(this.dir, tag);
          fs.mkdirSync(dir);
          const x = run('tar', ['-xzf', path.join(dl, 'template.tar.gz'), '-C', dir]);
          if (x.status !== 0) throw new InstrumentError(`${tag} 的 template.tar.gz 解不开：${firstLine(x.out)}`);
          res = { dir };
          this.log(`  · 下载 + 解开 ${tag}（${((Date.now() - t0) / 1000).toFixed(1)} s）`);
        }
      } finally {
        fs.rmSync(dl, { recursive: true, force: true });
      }
    }
    this.packages.set(tag, res);
    return res;
  }

  /** 最新的、解包后 site.js 认 `--blocks-dir` 的那份 release（假块那几格的「前」）。`{ tag, dir }` 或 `{ missing }`；仪器坏了抛 InstrumentError。 */
  latestBlocksDirPackage(maxTries = 3) {
    const list = this.releaseList(30);
    const tags = list.filter((x) => TAG_RE.test(x.tagName)).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).map((x) => x.tagName);
    const why = [];
    for (const tag of tags.slice(0, maxTries)) {
      const p = this.fetchPackage(tag);
      if (p.missing) { why.push(p.missing); continue; }
      if (fs.readFileSync(path.join(p.dir, 'scripts', 'site.js'), 'utf-8').includes('blocks-dir')) return { tag, dir: p.dir };
      why.push(`${tag} 的 site.js 不认 --blocks-dir`);
    }
    return { missing: `最新 ${Math.min(tags.length, maxTries)} 份 release 里没有能用的：${why.join('；') || '一份都没有'}` };
  }

  /** 在 `tree` 里拼一份块目录：那棵树自己的 `blocks/` 整份 + `fakes`（`{ 块名: 源目录 }`）。回目录路径。 */
  blocksDirIn(tree, fakes, variant) {
    const dir = fs.mkdtempSync(path.join(tree, 'tmp-1918-blocks-'));
    this.cleanups.push(dir);
    const real = path.join(tree, 'blocks');
    for (const e of fs.readdirSync(real, { withFileTypes: true })) {
      if (e.isDirectory()) fs.cpSync(path.join(real, e.name), path.join(dir, e.name), { recursive: true });
    }
    for (const [name, src] of Object.entries(fakes)) fs.cpSync(src, path.join(dir, name), { recursive: true });
    if (variant) variant(dir);
    return dir;
  }

  /**
   * 用 `tree` 自己的 site.js 打一份 bundle。`blocksDir` 给了 ⟹ 先用那棵树的 build-blocks.js 生成注册表，再 `--blocks-dir --registry`。
   * `ignoreBlocksDir`：打包时不传那一对（= 不认 `--blocks-dir` 的老 site.js 会打出来的那份），render 照样带环境变量 —— 自检「前渲不出」用。
   * 回 `{ bundleDir, env }` 或 `{ error }`。
   */
  bundle(tree, blocksDir, { ignoreBlocksDir = false } = {}) {
    const k = `${tree}\0${blocksDir || ''}\0${ignoreBlocksDir}`;
    if (this.bundles.has(k)) return this.bundles.get(k);
    let res;
    const env = { ...process.env };
    delete env.AI1ST_BLOCKS_DIR;
    delete env.AI1ST_REGISTRY_PATH;
    const args = [path.join(tree, 'scripts', 'site.js'), 'bundle'];
    if (blocksDir) {
      const gen = fs.mkdtempSync(path.join(this.dir, 'gen-'));
      const g = run(process.execPath, [path.join(tree, 'scripts', 'block-build', 'build-blocks.js'), '--blocks-dir', blocksDir, '--out', gen], { cwd: tree, env });
      if (g.status !== 0) res = { error: `build-blocks.js --blocks-dir 跑不出来（rc=${g.status}）：${firstLine(g.out)}` };
      env.AI1ST_BLOCKS_DIR = blocksDir;
      env.AI1ST_REGISTRY_PATH = path.join(gen, 'registry.generated.ts');
      if (!ignoreBlocksDir) args.push('--blocks-dir', blocksDir, '--registry', env.AI1ST_REGISTRY_PATH);
    }
    if (!res) {
      const bundleDir = fs.mkdtempSync(path.join(tree, 'render', '.tmp-1918-'));
      this.cleanups.push(bundleDir);
      const b = run(process.execPath, [...args, '--out-dir', bundleDir], { cwd: tree, env: { ...process.env, AI1ST_BLOCKS_DIR: '', AI1ST_REGISTRY_PATH: '' } });
      res = b.status === 0 ? { bundleDir, env } : { error: `site.js bundle 跑不出来（rc=${b.status}）：${firstLine(b.out)}` };
    }
    this.bundles.set(k, res);
    return res;
  }

  /** 渲一份站 ⟹ `{ out }`（站文件 + `_platform/` 在同一个目录）或 `{ error }`。 */
  render(tree, content, { blocksDir, ignoreBlocksDir } = {}) {
    const b = this.bundle(tree, blocksDir, { ignoreBlocksDir });
    if (b.error) return b;
    const site = path.join(fs.mkdtempSync(path.join(this.dir, 'site-')), 'site.json');
    fs.writeFileSync(site, JSON.stringify(content));
    const out = fs.mkdtempSync(path.join(this.dir, 'out-'));
    const r = run(process.execPath, [path.join(tree, 'scripts', 'site.js'), 'render', '--site', site, '--out', out,
      '--bundle-dir', b.bundleDir, '--target', 'preview', '--platform-out', out], { cwd: tree, env: b.env });
    if (r.status !== 0) return { error: `site.js render 跑不出来（rc=${r.status}）：${firstLine(r.out)}` };
    return { out };
  }
}

/** 本机静态服务，按 R2 的摆法（站文件在根、`/_platform/*` 是平台文件 —— 这里两样在同一个目录）。 */
function serve(dir) {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg' };
  const srv = http.createServer((req, res) => {
    const url = decodeURIComponent((req.url || '/').split('?')[0]);
    const f = path.join(dir, url.endsWith('/') ? `${url}index.html` : url);
    if (!f.startsWith(dir) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' });
    res.end(fs.readFileSync(f));
  });
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve(srv)));
}

/** 浏览器里量一块：`null`（页面里没有这一块）或 `{ structure, points: { 块根, 第一个含文本的元素 } }`。 */
async function measure(browser, dir, blockId) {
  const srv = await serve(dir);
  const page = await browser.newPage({ viewport: VIEWPORT });
  try {
    const origin = `http://127.0.0.1:${srv.address().port}`;
    // 站外的（Google 字体那一行 @import 之类）一律不放：它们只会让 load 等网络，而比的两边是同一份主题。
    await page.route('**/*', (route) => (route.request().url().startsWith(origin) ? route.continue() : route.abort()));
    await page.goto(`${origin}/`, { waitUntil: 'load' });
    return await page.evaluate(({ id, props }) => {
      const root = document.querySelector(`[data-block-id="${CSS.escape(id)}"]`);
      if (!root) return null;
      const shape = (el) => el.tagName.toLowerCase() + (el.children.length ? `(${[...el.children].map(shape).join(',')})` : '');
      const where = (el) => {
        const parts = [];
        for (let e = el; e && e !== root; e = e.parentElement) parts.unshift(`${e.tagName.toLowerCase()}:nth-child(${[...e.parentElement.children].indexOf(e) + 1})`);
        return ['块根', ...parts].join(' > ');
      };
      const styles = (el) => { const cs = getComputedStyle(el); return Object.fromEntries(props.map((p) => [p, cs.getPropertyValue(p)])); };
      const text = [root, ...root.querySelectorAll('*')].find((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));
      return {
        structure: shape(root),
        points: {
          [`块根 <${root.tagName.toLowerCase()}>`]: styles(root),
          '第一个含文本的元素': text ? { where: where(text), ...styles(text) } : null,
        },
      };
    }, { id: blockId, props: PROPS });
  } finally {
    await page.close();
    await new Promise((r) => srv.close(r));
  }
}

/** 前后两份读数 ⟹ 不同的地方 `[{ point, prop, before, after }]`（空 = 样子一样）。 */
function compare(before, after) {
  const diffs = [];
  if (before.structure !== after.structure) diffs.push({ point: '结构', prop: '标签树', before: before.structure, after: after.structure });
  for (const point of new Set([...Object.keys(before.points), ...Object.keys(after.points)])) {
    const b = before.points[point];
    const a = after.points[point];
    if (!b || !a) {
      if (b !== a) diffs.push({ point, prop: '有没有', before: b ? '有' : '没有', after: a ? '有' : '没有' });
      continue;
    }
    for (const prop of ['where', ...PROPS]) if (b[prop] !== a[prop]) diffs.push({ point, prop, before: b[prop], after: a[prop] });
  }
  return diffs;
}

/**
 * 比一格：`old`（旧形状的那一块）在「前」那一侧渲，`migratedBlock(old)` 在「后」那一侧渲。
 *   before: { tree, blocksDir?（不给 = 树自己的 blocks/）, ignoreBlocksDir? }   after: { tree, blocksDir? }
 * 回 `{ verdict: 'green' | 'red', reason?, why?, diffs?, rendered, beforeHasRoot? }`；
 * reason ∈ baseline（基准不对）· before-unrenderable · after-unrenderable · look（样子变了）· bad-step（迁移函数自己出错）。
 */
async function compareCell(ws, browser, { old, key, step, before, after }) {
  const oldType = old.type;
  const conflict = baselineConflict(before.blocksDir || path.join(before.tree, 'blocks'), oldType, key);
  if (conflict) return { verdict: 'red', reason: 'baseline', why: conflict, rendered: false };
  let next;
  try { next = migratedBlock(old, key, step); } catch (e) { return { verdict: 'red', reason: 'bad-step', why: firstLine(e && e.message), rendered: false }; }

  const b = ws.render(before.tree, siteWith(old), before);
  if (b.error) return { verdict: 'red', reason: 'before-unrenderable', why: b.error, rendered: true };
  const bm = await measure(browser, b.out, old.id);
  if (!bm) return { verdict: 'red', reason: 'before-unrenderable', why: `「前」那份页面里找不到 data-block-id="${old.id}"（块没画出来）`, rendered: true, beforeHasRoot: false };
  const a = ws.render(after.tree, siteWith(next), after);
  if (a.error) return { verdict: 'red', reason: 'after-unrenderable', why: a.error, rendered: true, beforeHasRoot: true };
  const am = await measure(browser, a.out, next.id);
  if (!am) return { verdict: 'red', reason: 'after-unrenderable', why: `「后」那份页面里找不到 data-block-id="${next.id}"`, rendered: true, beforeHasRoot: true };
  const diffs = compare(bm, am);
  return diffs.length
    ? { verdict: 'red', reason: 'look', why: '样子变了', diffs, rendered: true, beforeHasRoot: true }
    : { verdict: 'green', rendered: true, beforeHasRoot: true };
}

/**
 * 一棵树里的真迁移：`[{ type, key, step }]`（块目录里每个 `migrations.js` 的每一条，形状由 block-migrations.js 当场验）。
 */
function realMigrations(blocksDir) {
  const { loadBlockVersions } = require('./block-migrations');
  const out = [];
  for (const [type, info] of loadBlockVersions(blocksDir)) {
    for (const [key, step] of Object.entries(info.migrations)) out.push({ type, key, step, region: info.region });
  }
  return out;
}

/**
 * #1918 r3 —— 外壳区（manifest `region: true`：header / footer）的迁移这把尺子量不了：尺子把旧块当页面块放进 `home.json`，
 * 而外壳区的数据住在 `<语言>/navigation.json`，不是页面能写的 `type`（硬塞进去就是「前渲不出：unknown block type header」，
 * 读着像包坏了）。所以它先问「基准不对」（渲染之前判，跟页面块同一个判据），不是 ⟹ 报「量不了」、红：要么进豁免表写理由，要么另造一条量法。
 */
function regionVerdict(beforeBlocksDir, oldType, key) {
  const conflict = baselineConflict(beforeBlocksDir, oldType, key);
  if (conflict) return { verdict: 'red', reason: 'baseline', why: conflict, rendered: false };
  return {
    verdict: 'red', reason: 'unmeasurable', rendered: false,
    why: `${oldType} 是外壳区（manifest region: true，数据住在 <语言>/navigation.json），这把尺子量不了 —— 进豁免表（lib/preserves-look-exempt.json）并写理由`,
  };
}

/** 一条真迁移先怎么分：豁免 / 不比（false）/ 条目写错 / 要比。`exempt` 是 `{ '<块>:<键>': 理由 }`。 */
function classify({ type, key, step }, exempt) {
  const id = `${type}:${key}`;
  if (Object.prototype.hasOwnProperty.call(exempt, id)) return { kind: 'exempt', why: String(exempt[id]) };
  if (!TAG_RE.test(String(step.fromBuild))) {
    return { kind: 'bad-entry', why: `fromBuild ${JSON.stringify(step.fromBuild)} 不是 build-<sha12>（指向这条迁移出现之前的那个 build）` };
  }
  if (step.preservesLook !== true) return { kind: 'not-compared', why: 'preservesLook: false —— 样子本来就要变，由老板点头（T4c），不归这把尺子' };
  return { kind: 'compare' };
}

/**
 * 「前」那份包自己的图册演示数据：旧类型每个形态一块（`{ id, type, shape, schemaVersion, data }`）。
 * 用包里的 block-catalog / demo-content 现算（那份包的数据按构造就是旧形状）。回 `{ blocks }` 或 `{ error }`。
 */
function demoBlocksIn(tree, oldType, key) {
  const m = key.match(STEP_RE);
  const prog = `
    const { blockShapeCatalog } = require('./scripts/lib/block-catalog');
    const { demoDataFor } = require('./scripts/lib/demo-content');
    const { manifests } = blockShapeCatalog();
    const mf = manifests.get(${JSON.stringify(oldType)});
    if (!mf) { console.error('这份包里没有 ${oldType} 这个块'); process.exit(3); }
    const data = demoDataFor(mf);
    process.stdout.write(JSON.stringify({ schemaVersion: mf.schemaVersion, shapes: mf.shapes.map((s) => s.name), data }));`;
  const r = run(process.execPath, ['-e', prog], { cwd: tree, env: { ...process.env, AI1ST_BLOCKS_DIR: '', AI1ST_REGISTRY_PATH: '' } });
  if (r.status !== 0) return { error: `包里的图册数据取不出来（rc=${r.status}）：${firstLine(r.out)}` };
  let d;
  try { d = JSON.parse(r.stdout); } catch { return { error: `包里的图册数据不是 JSON：${firstLine(r.out)}` }; }
  const schemaVersion = m ? Number(m[1]) : (Number.isInteger(d.schemaVersion) ? d.schemaVersion : 1);
  return {
    blocks: d.shapes.map((shape) => ({
      id: `pl-${oldType}-${shape}`, type: oldType, role: 'optional', region: 'content', weight: 100, shape, schemaVersion, data: clone(d.data),
    })),
  };
}

module.exports = {
  InstrumentError, PROPS, TAG_RE, TEMPLATE_DIR, Workspace, baselineConflict, classify, compare, compareCell, demoBlocksIn, measure, migratedBlock,
  oldTypeOf, realMigrations, regionVerdict, siteWith,
};
