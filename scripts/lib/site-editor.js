'use strict';
// #1801 (SiteAsData T1) —— 编辑器搬进 dashboard 之后，manager spawn 的那几条模板命令的实现（`scripts/site.js` 只是分发壳）：
//
//   editorData({ content, geo, locale, page, cacheDir })   ← `GET /api/sites/:id/editor`（geo = `sites.geo`）
//       今天 `~editor` 页在 Next 服务端算的那四样（SiteData、editorSchema、iconTables、页面底稿 …，`src/lib/editor-props.ts`）
//       + 画布 `<head>` 要的两份按站算的样式（theme.css / custom.css，derive-core 现算）+ site.css 的缓存键。
//   save({ content, changes, keep })                  ← `POST /api/sites/:id/content {baseVersion, changes}`
//       今天 `write-editor-save.js` 的内存版：判与算用的是同一组函数（planPageWrite / planRootWrite / … / commitWrites），
//       只是「写盘」写进一份私有临时目录、再整份读回成 content；返回前并进 `contentPatchesOf`（菜单同步 + custom.css）。
//   theme({ content, themeId, tweaks, presets, colorScheme }) ← 换主题 / Customize 的 Apply（执行器 `kind=theme`，#1873）
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
/** content 里一份 .json：对象原样，字符串 parse 一次（不是 JSON ⟹ undefined）。 */
const parsedEntry = (content, rel) => { const v = content[rel]; if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch { return undefined; } };
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
 * `sites.geo`（manager 经 `--geo` 递来；#1976 起是一组 `[{address, lat, lng, …}]`，老的单个对象当一项）按地址并进各地点：
 * 规矩同 `site.js` §render 的 `--geo`（`lib/locations.js` §mergeGeo；查坐标那会儿的地址已经不是现在的 ⟹ 对不上 ⟹ 不用）。
 * 没给 / 一个都对不上 ⟹ content 原样（content 里自带的 `locations[i].geo` 照用）。contact 块「没有 geo 地图那一格不渲染」（`contact-facts.js`）。
 */
function withGeo(content, geo) {
  if (!geo || typeof geo !== 'object' || !Object.prototype.hasOwnProperty.call(content, 'brand.json')) return content;
  const raw = content['brand.json'];
  const brand = typeof raw === 'string' ? JSON.parse(raw) : raw;
  const merged = require('./locations').mergeGeo(brand, geo);
  return merged === brand ? content : { ...content, 'brand.json': merged };
}

/**
 * `{ content: null }` 原样回 `{ content: null }`（还没存过内容的站，#1796 形状 (a)）—— 编辑页据此说「Nothing to edit yet」。
 * 否则 `{ props, styles: { themeCss, customCss }, siteCssKey, locale, page }`。页面 / 语言不存在 ⟹ throw `bad`。
 */
async function editorData({ content: input, geo, locale, page, themeId, cacheDir, buildVersion = '', uiFlags }) {
  if (input === null || input === undefined) return { content: null };
  if (!isObj(input)) throw new SiteEditorError('bad', 'content 必须是对象（键 = site/ 下的相对路径）');
  if (Object.keys(input).length === 0) return { content: null };
  // #1874 —— 只读画布按 `?theme=` 画：content 在内存里先穿上那一套（§dressContent，跟 Apply 同一个函数），不写库。
  const id = tryOnTheme(themeId);
  // #1838 —— 读的时候内存里全量迁（只跑 `preservesLook: true` 的），不落库。页面的 baseHash 因此是迁过那份的哈希 ——
  //    §save 先迁这一笔碰到的文件、再比 baseHash，两边才对得上。
  const content = require('./block-migrations').migrateInMemory(withGeo(id ? dressContent(input, { themeId: id }) : input, geo));
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
    // #1839 —— 打开编辑器要弹的两种窗（整站算，不只这一页）：样子会变的待升级块、冻结过而老板还没点 OK 的块（`uiFlags` = sites.ui_flags）。
    const pending = require('./block-changes').pendingChangesOf(input, undefined, { uiFlags });
    return {
      locale: loc,
      page: slug,
      props: r.props,
      pendingUpgrades: pending.upgrades,
      pendingRetired: pending.retired,
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
async function siteCss({ content, themeId, cacheDir, buildVersion = '' }) {
  if (!isObj(content) || Object.keys(content).length === 0) throw new SiteEditorError('bad', 'this website has no content');
  if (tryOnTheme(themeId)) {
    // #1874 —— 试穿那一套的 site.css：主色直接取那套主题的 `primary['500']`，不套站上 custom.css 的色相旋转（设计文档 §5.5）；
    //    文字方向还是这个站的（主语言推，同 derive-core §dir）。同一个 `siteCssKey` 缓存 ⟹ 跟图册按主题编的那份共用。
    const meta = parsedEntry(content, 'site_meta.json');
    const dir = require('./text-dir.js').dirForLocale(isObj(meta) && typeof meta.defaultLocale === 'string' ? meta.defaultLocale : 'en');
    const { buildSiteCssCached } = require('./derive-core');
    const r = await buildSiteCssCached({ brand: { colors: require('../themes.js').themes[themeId].colors }, rootDir: ROOT, dir, purge: false, customHtml: [], buildVersion, cacheDir });
    return { key: r.key, cached: Boolean(r.cached), css: r.css };
  }
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

// #1838 —— `root` 里落在 `<语言>/navigation.json` 的那几个字段（`editor-root.js` 文件头那张分派表）。🔴 白名单，不是「凡是
//    header 开头的」：`headerShape` / `headerOptions` / `footerShape` / `footerOptions` 落在 `theme.json`，不算碰了 navigation.json。
const ROOT_FIELDS_IN_NAVIGATION = ['headerButtons', 'headerTopbar', 'headerLinks'];

/**
 * #1838 —— 这一笔编辑器存盘会碰到 content 的哪几份文件（只算块住的那几种：页面 / 共用块 / navigation.json），按 `changes` 事先判：
 *   带 `json` ⟹ 那一页 · 带 `shared` ⟹ `blocks/site-blocks.json` · `root` 里有 §ROOT_FIELDS_IN_NAVIGATION ⟹ `navigation.json`
 *   · 带 `nav` ⟹ 它点名的那几页（`editor-nav.js` §planNavWrite 写的是别的页的 navLabel / navOrder，不写 navigation.json）
 * 回 site/ 下的相对路径（content 里真有的那几份）。
 */
function touchedFilesOf({ changes, target, siteDir, slug, pageFiles }) {
  const out = [];
  const rel = (abs) => path.relative(siteDir, abs).split(path.sep).join('/');
  const add = (abs) => { if (abs && fs.existsSync(abs)) out.push(rel(abs)); };
  const bySlug = new Map();
  if (changes.json || isObj(changes.nav)) {
    const pagesDir = path.join(target.localeDir, 'pages');
    try { if (fs.existsSync(pagesDir)) pageFiles.readPagesRecursive(pagesDir, '', [], bySlug); } catch { /* 读不出来由 planPageWrite 报 */ }
  }
  if (changes.json) add(bySlug.get(slug));
  if (isObj(changes.nav)) for (const s of Object.keys(changes.nav)) add(bySlug.get(s));
  if (changes.shared) add(path.join(target.localeDir, 'blocks', 'site-blocks.json'));
  if (ROOT_FIELDS_IN_NAVIGATION.some((f) => Object.prototype.hasOwnProperty.call(changes.root || {}, f))) {
    add(path.join(target.localeDir, 'navigation.json'));
  }
  return [...new Set(out)];
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
 *   `addressChanged` 第一家门店的地址变了 ⟹ 新地址（不进这一笔；manager 不读它 —— 写 content 时自己比地址、排 geocode，
 *                    manager/site_content.go §afterSiteContentWrite）
 * 拒收（给老板看的那句话）⟹ throw `refused`；页面在别处改过（只在不 keep 时可能）⟹ throw `stale`；形状不对 ⟹ `bad`。
 */
async function save({ content, changes, keep = false, migrate = [] }) {
  if (!isObj(content) || Object.keys(content).length === 0) throw new SiteEditorError('bad', 'this website has no content');
  if (!isObj(changes)) throw new SiteEditorError('bad', 'changes 必须是一个对象');
  const unknown = unknownChangeField(changes);
  if (unknown) throw new SiteEditorError('bad', `changes 里有编辑器改不了的字段：${JSON.stringify(unknown)}`, unknown);
  const slug = typeof changes.page === 'string' ? changes.page : '';
  const localeIn = typeof changes.locale === 'string' ? changes.locale : '';
  const obj = (v) => (isObj(v) ? v : null);
  let json = obj(changes.json);
  const root = obj(changes.root) || {};
  let shared = obj(changes.shared);
  const forms = obj(changes.forms);
  const nav = obj(changes.nav);
  const hasRoot = Object.keys(root).length > 0;
  // #1839 —— 只点了 Update（手上没有别的改动）的那一笔只带 `migrate`。
  if (!json && !hasRoot && !shared && !forms && !nav && !migrate.length) throw new SiteEditorError('bad', '这次存盘既没有页面、也没有 root 字段、也没有共用块、也没有表单、也没有菜单');
  // #1833 —— Custom HTML 入库前整理一次（`lib/custom-html.js`：闭合、去外壳、整理到不动点、≤ 64 KB、不收 `<plaintext>`），在算页面哈希之前 —— 编辑器拿到的
  //    baseHash 就是落盘那份字节的。页面里每一块 custom-html；共用块改动里带 `html` 的那份 data（块库里只有
  //    custom-html 有它；`css` 是 r5 删掉的槽，老内容里还可能带着，照旧限长）。超了 64 KB / 含 `<plaintext>` ⟹ `bad`（manager 回 400 + 那句话，编辑页原样说给老板）。
  {
    const ch = require('./custom-html.js');
    try {
      if (json) json = ch.tidyCustomHtmlInPage(json);
      if (shared) {
        shared = Object.fromEntries(Object.entries(shared).map(([id, c]) => [id,
          isObj(c) && isObj(c.data) && (typeof c.data.html === 'string' || typeof c.data.css === 'string') ? { ...c, data: ch.tidyCustomHtmlData(c.data) } : c]));
      }
    } catch (e) {
      if (e instanceof ch.CustomHtmlError) throw new SiteEditorError('bad', e.message);
      throw e;
    }
  }

  const blocks = require('../blocks.js');
  const pageFiles = require('./page-files.js');
  const siteShape = require('./site-shape.js');
  const pageWrite = require('./page-write.js');
  const editorRoot = require('./editor-root.js');
  const sharedWrite = require('./shared-blocks-write.js');
  const formsWrite = require('./forms-write.js');
  const editorNav = require('./editor-nav.js');
  const { editorSource } = require('./editor-page.js');
  const { contentPatchesOf, locationFactFilesChanged } = require('./derive-core');

  const { dir, siteDir } = materialize(content);
  try {
    let target;
    const writes = [];
    let pageHash = '';
    let s = null;
    // #1838 —— 迁过之后的「这一笔之前」：盖号拿它当 prev（不然刚迁到 v2 的块又被盖回 1）。
    let before = content;
    try {
      target = pageWrite.resolveTarget(dir, siteShape, localeIn);
      // #1838 —— 顺序定死：这一笔碰到的文件先迁（§contentPatchesOf 的 touchedFiles，只跑 preservesLook: true）→ 再套 changes
      //    → 最后盖号。反过来，迁移会把老板刚改的新字段用旧值盖掉。碰到哪几份按 changes 事先判（§touchedFilesOf），
      //    因为迁移要在套之前。迁过的那几份写回临时目录，下面的 baseHash 比的就是迁过那份（editor-data 也是迁过才算的哈希）。
      const touched = touchedFilesOf({ changes: { json, shared, nav, root }, target, siteDir, slug, pageFiles });
      if (touched.length) {
        const patches = contentPatchesOf(content, { touchedFiles: touched });
        const migrated = {};
        for (const rel of touched) if (Object.prototype.hasOwnProperty.call(patches, rel)) migrated[rel] = patches[rel];
        for (const [rel, v] of Object.entries(migrated)) fs.writeFileSync(path.join(siteDir, rel), contentText(v));
        before = { ...content, ...migrated };
      }
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
    // 菜单同步 + custom.css（derive-core §contentPatchesOf，设计文档 §5.3：并进同一笔，渲染不回写库）。补丁直接是对象 / 字符串（#1838）。
    // #1976 —— 这一笔改到 brand.json / seo.json ⟹ 老站的营业时间 / 评分在这一笔里搬进 locations[0]（§locationFactFilesChanged）。
    const patches = contentPatchesOf(next, { touchedFiles: locationFactFilesChanged(content, next) });
    for (const [rel, value] of Object.entries(patches)) {
      if (value === null) delete next[rel];
      else next[rel] = value;
    }
    // #1839 —— 老板点了 Update：那几块（只迁还待升级的）整条链迁到新版，号写成新号。在套完这一笔之后迁 —— 待升级的块在画布里是锁住的，
    //    这一笔里它还是旧形状（页面 JSON 整份交来），先迁再套就被旧形状盖回去了。盖号对带号的块不动，所以它不会被盖回旧号。
    let upgraded = [];
    if (migrate.length) {
      const m = require('./block-changes').migrateBlocks(next, migrate);
      next = m.content;
      upgraded = m.migrated;
    }
    // #1838 —— 最后盖号：画布新插的块（`puckToPage` 不带号）盖当前号，老块继承迁过之后的号。
    next = require('./stamp-schema-versions').stampSchemaVersions(before, next);
    next = Object.fromEntries(Object.keys(next).sort().map((k) => [k, next[k]]));

    const files = Object.keys({ ...content, ...next }).filter((k) => JSON.stringify(content[k]) !== JSON.stringify(next[k])).sort();
    // #1941 —— 跟 AI 那条路（site-edit.js §validate）同一个判据：这一笔改到的文件里，块的 schemaVersion 只收整数。
    const badVersions = require('./content-blocks').schemaVersionProblems(next, files);
    if (badVersions.length) throw new SiteEditorError('refused', `Not saved — ${badVersions.join('; ')}.`);
    const after = editorSource(dir, target.locale, slug, siteDir);
    const addr = addressOf(next);
    return {
      content: next,
      summary: upgraded.length ? upgradeSummary(upgraded) : typeof changes.summary === 'string' ? changes.summary.slice(0, 500) : '',
      ...(upgraded.length ? { upgraded, reason: `upgrade-${upgraded[0].type}` } : {}),
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

/** #1839 —— 升级那一笔的版本说明（票正文「做什么 2 ④」原话）：一种块一句，几种块拼一句。 */
function upgradeSummary(upgraded) {
  const labels = [...new Set(upgraded.map((u) => u.label))];
  if (labels.length === 1) return `Updated the ${labels[0]} block to its latest version`;
  return `Updated the ${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]} blocks to their latest versions`;
}

/**
 * #1873（SiteAsData T3c-2）—— 换主题 / Customize 的 Apply：`site.js theme`，manager 执行器 `kind=theme` spawn。
 *
 * theme.json + brand.json 按 `dress-site-in-theme.js` §dressContentInTheme 算（worker §themeWriteCommand 的内存版），
 * 再并进 `contentPatchesOf`（custom.css 按新的 tweaks 重算；菜单同步顺带）—— 跟 save 同一个形状：一笔里的全部文件。
 *
 * 返回 `{ content, summary, files }`：
 *   `summary` 换了主题 = `Changed the theme to <主题名>`（名字 = 注册表 label 的「—」前半，弹窗卡片上那个）；
 *             只调颜色（没给 themeId）= `Adjusted the theme colors`（设计文档 §4.2：Customize 不记成换主题）
 * 主题不在注册表里 / 站没有 brand.json ⟹ `bad`。
 */
async function theme({ content, themeId, tweaks, presets, colorScheme }) {
  if (!isObj(content) || Object.keys(content).length === 0) throw new SiteEditorError('bad', 'this website has no content');
  if (themeId !== undefined && (typeof themeId !== 'string' || !require('../theme-sheet.js').SHEET_NAME_OK.test(themeId))) {
    throw new SiteEditorError('bad', `--theme 不是一个主题 id：${JSON.stringify(themeId)}`);
  }
  if (tweaks !== undefined && !isObj(tweaks)) throw new SiteEditorError('bad', '--tweaks 必须是一个对象');
  if (presets !== undefined && !isObj(presets)) throw new SiteEditorError('bad', '--presets 必须是一个对象');
  if (!themeId && tweaks === undefined && presets === undefined && !colorScheme) {
    throw new SiteEditorError('bad', '这一笔什么都没换：要给 --theme、--tweaks、--presets、--color-scheme 至少一样');
  }
  const next = require('./stamp-schema-versions').stampSchemaVersions(content, dressContent(content, { themeId, tweaks, presets, colorScheme }));
  const files = Object.keys({ ...content, ...next }).filter((k) => JSON.stringify(content[k]) !== JSON.stringify(next[k])).sort();
  let summary = 'Adjusted the theme colors';
  if (themeId) {
    const label = String(require('../themes.js').themes[themeId].label || themeId);
    summary = `Changed the theme to ${label.split('—')[0].trim() || themeId}`;
  }
  return { content: next, summary, files };
}

/**
 * content 在内存里换上一套主题 / 一组微调之后的样子：theme.json + brand.json 按 `dress-site-in-theme.js` §dressContentInTheme 算
 * （worker §themeWriteCommand 的内存版），再并进 `contentPatchesOf`（custom.css 按新的 tweaks 重算；菜单同步顺带）。
 * 两个调用方：§theme（Apply，写库那一笔）和 #1874 的试穿（§themeCss / §editorData 的 `themeId`，只算不存）——
 * 一处实现，试穿看到的就是 Apply 会写下的那一份。主题不在注册表里 / 站没有 brand.json ⟹ `bad`。
 */
function dressContent(content, change) {
  const { dressContentInTheme } = require('./dress-site-in-theme.js');
  const { contentPatchesOf } = require('./derive-core');
  let dressed;
  try {
    dressed = dressContentInTheme({ theme: content['theme.json'], brand: content['brand.json'] }, change);
  } catch (e) {
    throw new SiteEditorError('bad', e.message);
  }
  let next = { ...content, 'theme.json': dressed.theme, 'brand.json': dressed.brand };
  // #1838 —— 补丁直接是对象 / 字符串。换装只碰 theme.json / brand.json ⟹ 块不迁，只盖号（§theme）。
  // #1976 —— 碰了 brand.json ⟹ 营业时间 / 评分照规矩落盘（`touchedFiles` 只含 brand.json / seo.json，不触发块迁移）。
  const patches = contentPatchesOf(next, { touchedFiles: require('./derive-core').locationFactFilesChanged(content, next) });
  for (const [rel, value] of Object.entries(patches)) {
    if (value === null) delete next[rel];
    else next[rel] = value;
  }
  return Object.fromEntries(Object.keys(next).sort().map((k) => [k, next[k]]));
}

/** #1874 —— 试穿要的主题 id：格式不对 / 不在注册表里 ⟹ `bad`（不给 = undefined，照站自己的那一套）。 */
function tryOnTheme(themeId) {
  if (themeId === undefined) return undefined;
  if (typeof themeId !== 'string' || !require('../theme-sheet.js').SHEET_NAME_OK.test(themeId)
    || !Object.prototype.hasOwnProperty.call(require('../themes.js').themes, themeId)) {
    throw new SiteEditorError('bad', `--theme 不是注册表里的主题：${JSON.stringify(themeId)}`);
  }
  return themeId;
}

/**
 * #1874（SiteAsData T3c-3）—— 试穿的 theme.css：content 在内存里穿上那一套（§dressContent，跟 Apply 同一个函数）再派生，
 * 只交出 theme.css（字体、settings 变量、主题表）。不给 themeId ⟹ 站自己的那一份。`{ css }`。
 * 🔴 派生顺带编 site.css：给 cacheDir 时按键命中就不编 Sass（同 §editorData）。
 */
async function themeCss({ content, themeId, cacheDir, buildVersion = '' }) {
  if (!isObj(content) || Object.keys(content).length === 0) throw new SiteEditorError('bad', 'this website has no content');
  const id = tryOnTheme(themeId);
  const dressed = id ? dressContent(content, { themeId: id }) : content;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'theme-css-'));
  try {
    const { deriveSite } = require('./derive-core');
    await quietly(() => deriveSite({ content: dressed, outDir: dir, cacheDir, purge: false, buildVersion, siteLabel: 'site' }));
    return { css: fs.readFileSync(path.join(dir, 'theme.css'), 'utf-8') };
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

module.exports = { SiteEditorError, editorData, save, theme, themeCss, siteCss, geocode, materialize, readTree, withGeo, touchedFilesOf };
