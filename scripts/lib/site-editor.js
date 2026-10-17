'use strict';
// #1801 (SiteAsData T1) —— 编辑器搬进 dashboard 之后，manager spawn 的那几条模板命令的实现（`scripts/site.js` 只是分发壳）：
//
//   editorData({ content, geo, locale, page, cacheDir })   ← `GET /api/sites/:id/editor`（geo = `sites.geo`）
//       今天 `~editor` 页在 Next 服务端算的那四样（SiteData、editorSchema、iconTables、页面底稿 …，`src/lib/editor-props.ts`）
//       + 画布 `<head>` 要的两份按站算的样式（theme.css / custom.css，derive-core 现算）+ site.css 的缓存键。
//   save({ content, changes, keep })                  ← `POST /api/sites/:id/content {baseVersion, changes}`
//       今天 `write-editor-save.js` 的内存版：判与算用的是同一组函数（planPageWrite / planRootWrite / … / commitWrites），
//       只是「写盘」写进一份私有临时目录、再整份读回成 content；返回前并进 `contentPatchesOf`（菜单同步 + custom.css）。
//   siteCss({ content, cacheDir })                     ← `GET /api/sites/:id/site.css`
//   geocode({ address })                               ← 保存改了地址之后，manager 异步写 `sites.geo`
//
// 📌 为什么铺一份临时目录而不是把那几个库改成读内存：理由同 derive-core.js 文件头（它们全按目录读站，编辑器、AI 改站、
//    构建都调；铺目录的风险小一个量级）。每次调用一份目录，跑完删。
// 🔴 content 的形状 = 「库里一行 JSON」：键 = site/ 下的相对路径，JSON 文件的值是解析后的对象（`export-site-json.js`）。
//    铺盘写的字节 = `JSON.stringify(v, null, 2) + '\n'`，跟导出那一侧逐字节相同 ⟹ 页面的 baseHash 在 editor-data 和 save
//    两次铺盘之间是同一个数（同一份 content 铺两次，哈希相同）。
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

class SiteEditorError extends Error {
  /**
   * `code`：给 manager 判 HTTP 状态用（refused = 422 给老板看的那句话 · bad = 400 · stale = 409）。
   * `field`：`bad` 的一种 —— 这一笔里有编辑器改不了的字段，值是那个字段名（manager 原样回给编辑页，编辑页说
   * 「Couldn't save: <field> isn't something the editor can change.」）。
   */
  constructor(code, message, field) {
    super(message);
    this.code = code;
    if (field) this.field = field;
  }
}

// 编辑器一笔存盘里认的键（`saveFields(plan)` 的形状，EditorApp.tsx §saveFields + dashboard `host.ts` §saveFieldsFrom）。
const CHANGE_KEYS = new Set(['page', 'locale', 'json', 'baseHash', 'root', 'shared', 'forms', 'nav', 'summary']);

/** 白名单外的字段：先看这一笔的顶层，再看 root 那一份（root 的字段表住 editor-root.js §ROOT_FIELDS）。没有 ⟹ null。 */
function unknownChangeField(changes) {
  for (const k of Object.keys(changes)) if (!CHANGE_KEYS.has(k)) return k;
  if (isObj(changes.root)) {
    const known = new Set(require('./editor-root.js').ROOT_FIELDS.map((f) => f.field));
    for (const k of Object.keys(changes.root)) if (!known.has(k)) return `root.${k}`;
  }
  return null;
}

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const contentText = (v) => (typeof v === 'string' ? v : `${JSON.stringify(v, null, 2)}\n`);

/** content 铺进 `<临时目录>/site/`。返回 `{ dir, siteDir }`；调用方负责删 `dir`。 */
function materialize(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-editor-'));
  const siteDir = path.join(dir, 'site');
  fs.mkdirSync(siteDir);
  for (const [rel, value] of Object.entries(content)) {
    const f = path.join(siteDir, rel);
    if (path.isAbsolute(rel) || path.relative(siteDir, f).startsWith('..')) {
      fs.rmSync(dir, { recursive: true, force: true });
      throw new SiteEditorError('bad', `content 里的路径跑出了站目录：${rel}`);
    }
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, contentText(value));
  }
  return { dir, siteDir };
}

/** 目录整份读回成 content（键排序，跟 `export-site-json.js to-json` 同一个形状）。 */
function readTree(siteDir) {
  const out = {};
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(siteDir, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r);
      else {
        const text = fs.readFileSync(path.join(siteDir, r), 'utf-8');
        out[r] = r.endsWith('.json') ? JSON.parse(text) : text;
      }
    }
  };
  walk('');
  return Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]]));
}

/** derive-core 的日志走 stdout（老脚本的习惯）；这几条命令的 stdout 是给 manager 读的那一行 JSON ⟹ 改道 stderr。 */
async function quietly(fn) {
  const log = console.log;
  console.log = (...a) => console.error(...a);
  try {
    return await fn();
  } finally {
    console.log = log;
  }
}

// ── editor-props.ts 的现打包 ──────────────────────────────────────────────────────────────────────────────
// 那份文件是 TS、用 `@/` 别名，Node 直接 require 不动它 ⟹ esbuild 在内存里打一份 CommonJS，挂在 `scripts/` 下面一个
// 不存在的文件名上编译（`Module._compile`）：
//   · node_modules 里的包一律留在包外（`packages: 'external'`），由 Node 从模板树解析。
//   · `scripts/` 下的 CommonJS 一律留在包外、改写成相对 `scripts/` 的路径：它们按自己的 `__dirname` 找 blocks/、主题表，
//     打进包里就找错地方（`lib/icons.js` 文件头记过这个坑，#1409；#1802 §render-bundle 同一个分法）。
// 一个进程只打一次（manager 每次 spawn 一个新进程 ⟹ 每次 editor-data 打一次，实测量级见交接）。
let editorPropsFn = null;
async function loadEditorProps() {
  if (editorPropsFn) return editorPropsFn;
  const esbuild = require('esbuild');
  const scriptsDir = path.join(ROOT, 'scripts') + path.sep;
  const host = path.join(ROOT, 'scripts', '.editor-props.bundle.cjs');
  const r = await esbuild.build({
    entryPoints: [path.join(ROOT, 'src', 'lib', 'editor-props.ts')],
    bundle: true,
    write: false,
    format: 'cjs',
    platform: 'node',
    target: ['node20'],
    jsx: 'automatic',
    tsconfig: path.join(ROOT, 'tsconfig.json'),
    packages: 'external',
    logLevel: 'silent',
    plugins: [{
      name: 'scripts-stay-outside',
      setup(b) {
        b.onResolve({ filter: /.*/ }, async (args) => {
          if (args.pluginData === 'inner' || args.kind === 'entry-point') return null;
          if (!args.path.startsWith('.') && !args.path.startsWith('/') && !args.path.startsWith('@/') && !args.path.startsWith('@template/')) return null;
          const res = await b.resolve(args.path, { resolveDir: args.resolveDir, kind: args.kind, importer: args.importer, pluginData: 'inner' });
          if (res.errors.length || res.external || !res.path.startsWith(scriptsDir) || !/\.(c?js|json)$/.test(res.path)) return null;
          return { path: `./${path.relative(path.dirname(host), res.path).split(path.sep).join('/')}`, external: true };
        });
      },
    }],
  });
  const Module = require('module');
  const m = new Module(host, module);
  m.filename = host;
  m.paths = Module._nodeModulePaths(path.dirname(host));
  m._compile(r.outputFiles[0].text, host);
  editorPropsFn = m.exports.editorProps;
  return editorPropsFn;
}

/**
 * `sites.geo`（`{lat, lng, address}`，manager 经 `--geo` 递来）并进第一家门店：地址跟 `brand.locations[0].address` 一样才并
 * （查坐标那会儿的地址已经不是现在的 ⟹ 不用；规矩同 `site.js` §render 的 `--geo`，设计文档 §4.1 / §5.1）。没给 / 对不上 ⟹
 * content 原样（T3a 之前 content 里自带的 `locations[0].geo` 照用）。contact 块「没有 geo 地图那一格不渲染」（`contact-facts.js`）。
 */
function withGeo(content, geo) {
  if (!isObj(geo) || !Object.prototype.hasOwnProperty.call(content, 'brand.json')) return content;
  const raw = content['brand.json'];
  const brand = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const loc = isObj(brand) && Array.isArray(brand.locations) ? brand.locations[0] : null;
  if (!isObj(loc) || typeof geo.address !== 'string' || geo.address !== loc.address || !Number.isFinite(geo.lat) || !Number.isFinite(geo.lng)) return content;
  return { ...content, 'brand.json': { ...brand, locations: [{ ...loc, geo: { lat: geo.lat, lng: geo.lng } }, ...brand.locations.slice(1)] } };
}

/**
 * `{ content: null }` 原样回 `{ content: null }`（还没存过内容的站，#1796 形状 (a)）—— 编辑页据此说「Nothing to edit yet」。
 * 否则 `{ props, styles: { themeCss, customCss }, siteCssKey, locale, page }`。页面 / 语言不存在 ⟹ throw `bad`。
 */
async function editorData({ content: input, geo, locale, page, cacheDir, buildVersion = '' }) {
  if (input === null || input === undefined) return { content: null };
  if (!isObj(input)) throw new SiteEditorError('bad', 'content 必须是对象（键 = site/ 下的相对路径）');
  if (Object.keys(input).length === 0) return { content: null };
  const content = withGeo(input, geo);
  const { dir, siteDir } = materialize(content);
  try {
    // 派生一遍：页面要的那份站点数据（同发布构建的 config）+ theme.css / custom.css + site.css（按键缓存，命中不编 Sass）。
    // 画布不剪 site.css（`purge: false`）：老板会拖新块进来，剪过的那份少掉新块要的规则（derive-core 文件头 §purge）。
    const { deriveSite } = require('./derive-core');
    const out = path.join(dir, 'out');
    const derived = await quietly(() => deriveSite({ content, outDir: out, cacheDir, purge: false, buildVersion, siteLabel: 'site' }));
    const site = derived.data;
    const loc = locale || site.defaultLocale;
    const slug = page || 'home';
    const editorProps = await loadEditorProps();
    const r = editorProps({ site, root: ROOT, siteDir, locale: loc, slug });
    if (!r.ok) throw new SiteEditorError('bad', r.reason === 'no-locale' ? `这个网站没有这种语言：${JSON.stringify(loc)}` : `找不到这一页：${JSON.stringify(slug)}`);
    const read = (f) => (fs.existsSync(path.join(out, f)) ? fs.readFileSync(path.join(out, f), 'utf-8') : '');
    // #1415 的底稿形状（raw / blocks / located / weights / hash / root …）：AI 改完、别处改过时宿主拿它递 `ai1st:editor-baseline`，
    // 编辑器那一侧按它决定换不换画布、记不记撤销（同一个函数，原来由 manager `GET /pages` 在容器里调）。
    const baseline = require('./editor-page.js').editorBaseline({ rootDir: ROOT, siteDir, page: slug, locale: loc });
    return {
      locale: loc,
      page: slug,
      props: r.props,
      ...(baseline && baseline.ok ? { baseline } : {}),
      styles: { themeCss: read('theme.css'), customCss: read('custom.css') },
      siteCssKey: derived.siteCss.key,
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * site.css（不剪，画布用）。`{ key, cached, css }` —— `cached` = 这一次命中了 cacheDir 里那份（没编 Sass）。
 */
async function siteCss({ content, cacheDir, buildVersion = '' }) {
  if (!isObj(content) || Object.keys(content).length === 0) throw new SiteEditorError('bad', 'this website has no content');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-css-'));
  try {
    const { deriveSite } = require('./derive-core');
    const derived = await quietly(() => deriveSite({ content, outDir: dir, cacheDir, purge: false, buildVersion, siteLabel: 'site' }));
    return { key: derived.siteCss.key, cached: !!derived.siteCss.cached, css: fs.readFileSync(path.join(dir, 'site.css'), 'utf-8') };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** 第一家门店的地址（`brand.json` 的 `locations[0].address`，同 `geocode.js` §refreshGeoAfterEdit 的判法）。 */
function addressOf(content) {
  const brand = content && content['brand.json'];
  const doc = typeof brand === 'string' ? (() => { try { return JSON.parse(brand); } catch { return null; } })() : brand;
  const loc = doc && Array.isArray(doc.locations) ? doc.locations[0] : null;
  return loc && typeof loc.address === 'string' ? loc.address.trim() : '';
}

/**
 * 一笔编辑器存盘。`changes` = 编辑器 `ai1st:editor-save` 那一份（`saveFields(plan)`）：
 *   `{ page, locale?, json?, baseHash?, root?, shared?, forms?, nav?, summary? }`（五样至少一样，同 write-editor-save.js）
 * `keep`：「Keep my changes」—— 这一笔落在**当前**内容上，页面那一半不比 baseHash（拿当前那份的 hash 顶上）。
 *
 * 返回 `{ content, summary, files, hash?, notice?, shared, addressChanged? }`：
 *   `files`   这一笔写了 content 的哪几个键（含 contentPatchesOf 的补丁）
 *   `hash`    写了页面时，写进去那份页面字节的 sha256（编辑器的下一次 baseHash，同 write-editor-save.js）
 *   `shared`  这一页写完之后的共用块三样（`siteBlocks / refs / slugs`，编辑器「在 N 个页面上」要它，#1406）
 *   `addressChanged` 第一家门店的地址变了 ⟹ 新地址（manager 据此 spawn geocode，不进这一笔）
 * 拒收（给老板看的那句话）⟹ throw `refused`；页面在别处改过（只在不 keep 时可能）⟹ throw `stale`；形状不对 ⟹ `bad`。
 */
async function save({ content, changes, keep = false }) {
  if (!isObj(content) || Object.keys(content).length === 0) throw new SiteEditorError('bad', 'this website has no content');
  if (!isObj(changes)) throw new SiteEditorError('bad', 'changes 必须是一个对象');
  const unknown = unknownChangeField(changes);
  if (unknown) throw new SiteEditorError('bad', `changes 里有编辑器改不了的字段：${JSON.stringify(unknown)}`, unknown);
  const slug = typeof changes.page === 'string' ? changes.page : '';
  const localeIn = typeof changes.locale === 'string' ? changes.locale : '';
  const obj = (v) => (isObj(v) ? v : null);
  const json = obj(changes.json);
  const root = obj(changes.root) || {};
  const shared = obj(changes.shared);
  const forms = obj(changes.forms);
  const nav = obj(changes.nav);
  const hasRoot = Object.keys(root).length > 0;
  if (!json && !hasRoot && !shared && !forms && !nav) throw new SiteEditorError('bad', '这次存盘既没有页面、也没有 root 字段、也没有共用块、也没有表单、也没有菜单');

  const blocks = require('../blocks.js');
  const pageFiles = require('./page-files.js');
  const siteShape = require('./site-shape.js');
  const pageWrite = require('./page-write.js');
  const editorRoot = require('./editor-root.js');
  const sharedWrite = require('./shared-blocks-write.js');
  const formsWrite = require('./forms-write.js');
  const editorNav = require('./editor-nav.js');
  const { editorSource } = require('./editor-page.js');
  const { contentPatchesOf } = require('./derive-core');

  const { dir, siteDir } = materialize(content);
  try {
    let target;
    const writes = [];
    let pageHash = '';
    let s = null;
    try {
      target = pageWrite.resolveTarget(dir, siteShape, localeIn);
      let baseHash = typeof changes.baseHash === 'string' ? changes.baseHash : '';
      if (json && keep) {
        const cur = editorSource(dir, target.locale, slug, siteDir);
        if (!('error' in cur)) baseHash = cur.baseHash;
      }
      // #1406 —— 块库那一半先算（页面那一半的校验要拿写完以后的块库），两半都判过了才一起写。下面这串跟
      // write-editor-save.js 一行一行对应，判据、拒收的话都是那几个库自己的。
      s = shared ? sharedWrite.planSharedWrite({ blocks, pageFiles, target, slug, shared }) : null;
      if (json) {
        const w = pageWrite.planPageWrite({ root: dir, blocks, pageFiles, target, slug, baseHash, next: json, siteBlocks: s ? s.next : undefined });
        pageHash = w.hash;
        writes.push(w);
      }
      if (s) writes.push(s);
      if (forms) writes.push(...formsWrite.planFormsWrite({ target, forms }));
      if (nav) writes.push(...editorNav.planNavWrite({ pageFiles, target, slug, nav }));
      writes.push(...editorRoot.planRootWrite({ siteDir, localeDir: target.localeDir, locale: target.locale, shape: target.shape, root }));
      pageWrite.commitWrites(writes);
    } catch (e) {
      const refused = (e instanceof editorRoot.RootWriteError && e.code === editorRoot.REFUSED)
        || (e instanceof pageWrite.PageWriteError && e.code === pageWrite.REFUSED)
        || (e instanceof sharedWrite.SharedWriteError && e.code === sharedWrite.REFUSED)
        || (e instanceof formsWrite.FormsWriteError && (e.code === formsWrite.REFUSED || e.code === formsWrite.STALE))
        || (e instanceof editorNav.NavWriteError && e.code === editorNav.REFUSED);
      if (refused) throw new SiteEditorError('refused', e.message);
      // 页面那种 10：编辑器打开之后这一页在别处改过（manager 让它落在 baseVersion 那一份上，正常走不到这里）。
      if (e instanceof pageWrite.PageWriteError && e.code === 10) throw new SiteEditorError('stale', e.message);
      if (e && typeof e.code === 'number') throw new SiteEditorError('bad', e.message);
      throw e;
    }

    let next = readTree(siteDir);
    // 菜单同步 + custom.css（derive-core §contentPatchesOf，设计文档 §5.3：并进同一笔，渲染不回写库）。
    // 🔴 T4b：contentPatchesOf 今天回的是**原文字符串**，下面按 .json 再 JSON.parse 一次；T4b 把它改成直接返回对象时，
    //    同 PR 删掉这里的 parse（不删 ⟹ 对一个对象 JSON.parse 当场抛）。
    const patches = contentPatchesOf(next);
    for (const [rel, text] of Object.entries(patches)) {
      if (text === null) delete next[rel];
      else next[rel] = rel.endsWith('.json') ? JSON.parse(text) : text;
    }
    next = Object.fromEntries(Object.keys(next).sort().map((k) => [k, next[k]]));

    const files = Object.keys({ ...content, ...next }).filter((k) => JSON.stringify(content[k]) !== JSON.stringify(next[k])).sort();
    const after = editorSource(dir, target.locale, slug, siteDir);
    const addr = addressOf(next);
    return {
      content: next,
      summary: typeof changes.summary === 'string' ? changes.summary.slice(0, 500) : '',
      files,
      ...(pageHash ? { hash: pageHash } : {}),
      ...(s && s.notice ? { notice: s.notice } : {}),
      ...('error' in after ? {} : { shared: { siteBlocks: after.siteBlocks, refs: after.refs, slugs: after.slugs } }),
      ...(addr !== addressOf(content) ? { addressChanged: addr } : {}),
    };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/** `{ address, lat, lng, city?, street?, postcode? }`；查不到 ⟹ `{ address, lat: null, lng: null }`（manager 据此清掉旧坐标）。 */
async function geocode({ address }) {
  const q = typeof address === 'string' ? address.trim() : '';
  if (!q) return { address: '', lat: null, lng: null };
  const hit = await require('./geocode').geocodeAddress(q, { log: (m) => process.stderr.write(`${m}\n`) });
  return hit ? { address: q, ...hit } : { address: q, lat: null, lng: null };
}

module.exports = { SiteEditorError, editorData, save, siteCss, geocode, materialize, readTree, withGeo };
