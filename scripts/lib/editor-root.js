'use strict';

// editor-root.js —— 编辑器的外壳三样（#1405）：布局 / 顶栏形态 / 页脚形态；#1681 加 Page 面板「Business info」四样：
//    网站名字 / 电话 / 邮箱 / 地址（都住在站根那一份 `brand.json`）。
// 📌 #1425（T3）：原来还有第四样「公告条文字」（`topbarMessage` / `topbarLink` → navigation.json 的 `topbar`），
//    随公告条那个区退役；navigation.json 里已有的 `topbar` 段不删，只是编辑器不再读写它（PM 2026-10-02 裁定 ②）。
//
// 它们在 Puck 里是 **root 字段**（整页一份，不是块列表里的一项），存盘时各回各家 —— 不进页面 JSON。
// 这份文件管三件事，全是纯 node（在站自己的容器里跑，`scripts/write-editor-save.js` 调它）：
//   · §ROOT_FIELDS    分派表：哪个字段住在哪个文件的哪个键上、是整站一份还是按语言一份
//   · §readRootValues 从站级文件读出每个字段的现值（往返守卫与写盘前的「写完以后」都用它）
//   · §planRootWrite  判 + 算出要写的字节，**不落盘**（落盘归 `lib/page-write.js` §commitWrites，
//                     跟页面那一半一起、在所有校验都过了之后）
//
// ── 分派表（住在 `lib/editor-root-fields.js`，浏览器那一侧也读它；票正文做什么 4）──────────────────
//   layout                     → site/page-layout.json 的 layoutId（它的第一个写入者就是这里）
//   headerShape / footerShape  → site/theme.json 的 regionLayout.header / .footer（#1086 那个既有的按站覆盖，
//                                不另造覆盖层；theme.json 其他键一个字节不动）
//   brandName                  → site/brand.json 的 name[<这次存盘的语言>]（#1681；键里的 '{locale}' 在 §resolveKey 换掉）
//   email                      → site/brand.json 的 email
//   phone / address            → site/brand.json 的 locations[0].phone / .address（只管第一家门店）
//   headerOptions / footerOptions → site/theme.json 的 regionOptions.header / .footer（#1738：底色 + 旋钮，一个对象；
//                                空对象 = 删掉那个键）
//   logoUrl                    → site/brand.json 的 logoUrl（#1759；空串 = 删掉，顶栏画名字）
//   headerButtons              → <语言>/navigation.json 的 header.buttons（#1787，`[{label, href}]`，0–3 颗；
//                                每颗名字和链接都不许空，判据在 `header-buttons.js` §headerButtonsProblem）
//   headerTopbar               → <语言>/navigation.json 的 header.topbarLinks（#1780，`[{label, href}]`；没写过读成电话 + 邮箱两项，
//                                能不能存由 `topbar-links.js` §topbarLinksProblem 说）
//   headerLinks                → <语言>/navigation.json 的 header.links（#1781，菜单 `[{label, href}]`，href 是字符串或电话 / 邮箱引用；
//                                每一项要有名字和链接，§checkShape）
//   siteTitle / siteDescription / seoMode → <语言>/seo.json 的同名键（#1945，首页的搜索结果标题 / 描述 / 模式）：标题清空 ⟹ 这一格
//                                不写、原值不动；描述清空 ⟹ 删键；模式只有 "custom"，别的值（编辑器发 '' = Automatic）⟹ 删键
// 🔴 那张表是唯一的一份：读、写、往返守卫都照它走。少一行 ⟹ 那个字段改了不落盘，守卫点名它
//    （`scripts/editor-root.test.js` ①）。
//
// ── 存盘前拦下构建会拒收的组合（做什么 6）──────────────────────────────────────────────────────
// 📌 #1425（T3）：这里原来拦两种组合（带 topbar 区 + 顶栏透明浮层；带 topbar 区 + 某种语言没有公告文字），
//    跟 `sync-config.js` 那两道 exit 1 同一条规则。公告条那个区、透明浮层顶栏都退役了，规则一起删；
//    剩下的是「布局自己钉了页脚形态时不许改页脚形态」（§planRootWrite）。

const fs = require('fs');
const path = require('path');

const pageLayoutLib = require('./page-layout');
const siteRegions = require('./site-regions');
const { pickableShapesOf } = require('../region-layout');
const { regionOptionsProblems, cleanRegionOptions, effectiveRegionKnobs } = require('./region-options');

const { ROOT_FIELDS } = require('./editor-root-fields');
const { topbarLinksOf, topbarLinksProblem } = require('./topbar-links');
const { isButtonRef, socialPairs, BUTTON_SOURCES, refProblemsAt } = require('./item-sources');
const { hrefAllowed } = require('./href-allowed');
const { headerButtonsProblem } = require('./header-buttons');
const { isMenuRef, menuItemProblem, childrenProblem } = require('./nav-editor');

/** 老板在编辑器里可能收到的拒收码。worker 把它原样换成状态栏那句话（`blocks_task.go`）。 */
const REFUSED = 11;

class RootWriteError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}
const refuse = (msg) => { throw new RootWriteError(REFUSED, msg); };
const bad = (msg) => { throw new RootWriteError(5, msg); };

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** #1681 —— 分派表 `key` 里的语言占位符（`editor-root-fields.js` 只放它，解析在这里）。 */
const LOCALE_SLOT = '{locale}';
const BRAND_FIELDS = ['brandName', 'email', 'phone', 'address'];
const REGION_OPTION_FIELDS = ['headerOptions', 'footerOptions'];
/** #1785 —— 一个站最多几条社交链接（面板那头也按它停「+ Add」；写盘这头再挡一次）。 */
const MAX_SOCIAL_LINKS = 12;
/** #1785 —— 平台名的形状（同 Bootstrap Icons 的图标名：小写字母、数字、连字符）。 */
const SOCIAL_PLATFORM_RE = /^[a-z0-9-]{1,30}$/;
/** #1781 —— 菜单最多几项（顶栏一行、手机抽屉一屏；构建那头不限，这里给老板的列表定一个界）。 */
const MENU_MAX = 30;

/**
 * 这个站的默认语言：判据同构建（`sync-config.js` 那段）—— 没有 `site_meta.json` 是扁平老站，默认语言 `en`；
 * 有就取它的 `defaultLocale`。读不出 ⟹ `en`（同构建对扁平站的推断）。
 */
function defaultLocaleOf(siteDir) {
  try {
    const meta = JSON.parse(fs.readFileSync(path.join(siteDir, 'site_meta.json'), 'utf-8'));
    if (meta && typeof meta.defaultLocale === 'string' && meta.defaultLocale) return meta.defaultLocale;
  } catch { /* 扁平站 / 读不出 */ }
  return 'en';
}

/** 键里的 `'{locale}'` → 这次存盘的语言（扁平站传进来的是 ''，换成默认语言）。 */
function resolveKey(key, locale, siteDir) {
  if (!key.includes(LOCALE_SLOT)) return key;
  const l = locale || defaultLocaleOf(siteDir);
  return key.map((k) => (k === LOCALE_SLOT ? l : k));
}

/** 文件在站里的哪儿：整站一份的在 `site/`，按语言一份的在语言目录（扁平站就是 `site/`）。 */
function fileFor(f, siteDir, localeDir) {
  return path.join(f.scope === 'site' ? siteDir : localeDir, f.file);
}

/** 读一份 JSON；不在 ⟹ `null`；坏的 ⟹ 抛（调用方说是哪一份）。 */
function readJson(file) {
  if (!fs.existsSync(file)) return null;
  const text = fs.readFileSync(file, 'utf-8');
  return { doc: JSON.parse(text), trailingNewline: text.endsWith('\n') };
}

/**
 * 每个 root 字段的**现值** —— 站的页面按这个画。形态读的是解析之后的（主题选择单 + `regionLayout` 覆盖），
 * 不是文件里那一格：老板没覆盖过时它就是主题默认，编辑器下拉里显示的也该是它。
 * @param {{ siteDir: string, localeDir: string, layoutsDir?: string }} a
 */
function readRootValues({ siteDir, localeDir, locale, layoutsDir }) {
  const { regions } = siteRegions.resolveSiteRegionLayout(siteDir);
  return {
    layout: pageLayoutLib.resolveSiteLayout(siteDir, layoutsDir).layoutId,
    headerShape: regions.header.shape,
    footerShape: regions.footer.shape,
    // #1738 —— 存下的底色 + 旋钮（清洗过的；没存 = {}）。
    headerOptions: regions.header.options || {},
    footerOptions: regions.footer.options || {},
    ...readBrandValues(siteDir, locale),
    ...readHeaderButtons(localeDir),
    ...readSeoValues(localeDir),
  };
}

/**
 * #1945 —— 首页的搜索结果三样（这种语言的 `seo.json`）。读不出 ⟹ 一个都不回（同 §readBrandValues：不回空值去盖构建时那份）。
 * `seoMode` 读成 `'custom'` 或 `''`（Automatic），跟编辑器发回来的值同一个形状。
 */
function readSeoValues(localeDir) {
  let seo;
  try {
    seo = JSON.parse(fs.readFileSync(path.join(localeDir, 'seo.json'), 'utf-8'));
  } catch {
    return {};
  }
  if (!isObj(seo)) return {};
  const str = (v) => (typeof v === 'string' ? v : '');
  return { siteTitle: str(seo.siteTitle), siteDescription: str(seo.siteDescription), seoMode: seo.seoMode === 'custom' ? 'custom' : '' };
}

/**
 * #1759 —— `{label, href}`：label 按字符串取（不是字符串 = ''）。
 * #1779 —— href 是字符串，或电话 / 邮箱引用（`{source: "phone"}` …，§isButtonRef，原样带过去）；别的形状 = ''。
 */
function buttonOf(v) {
  const o = isObj(v) ? v : {};
  const href = typeof o.href === 'string' ? o.href : isButtonRef(o.href) ? { ...o.href } : '';
  return { label: typeof o.label === 'string' ? o.label : '', href };
}

/**
 * #1787 —— 顶栏按钮的现值（这种语言的 `navigation.json` 的 `header.buttons`）。没写 / 不是数组 ⟹ 空列表（编辑器那头就是「没有按钮」）。
 * navigation.json 不在 / 读不出 ⟹ 一个都不回（同 §readBrandValues：不回空值去盖构建时那份）。
 */
function readHeaderButtons(localeDir) {
  let nav;
  try {
    nav = JSON.parse(fs.readFileSync(path.join(localeDir, 'navigation.json'), 'utf-8'));
  } catch {
    return {};
  }
  const h = isObj(nav) && isObj(nav.header) ? nav.header : {};
  // #1781 —— 菜单原样（每项 `{label, href}`，href 是字符串或引用）；形状不对的那一项跳过（编辑器那头不画它，存盘也就不带它）。
  //    `header.links` 不在（还没构建过的站）⟹ 不回这一格（同上：不回空值去盖构建时那份）。
  //    #1783 —— 下拉（`children`）同一条：形状对的子项原样回（`description` 是字符串才带），一个都不剩 ⟹ 不带 `children`。
  const okLink = (l) => isObj(l) && typeof l.label === 'string' && (typeof l.href === 'string' || isMenuRef(l.href));
  const linkOf = (l) => ({ label: l.label, href: typeof l.href === 'string' ? l.href : { ...l.href } });
  const links = Array.isArray(h.links)
    ? { headerLinks: h.links.filter(okLink).map((l) => {
      const kids = Array.isArray(l.children)
        ? l.children.filter(okLink).map((c) => (typeof c.description === 'string' ? { ...linkOf(c), description: c.description } : linkOf(c)))
        : [];
      return kids.length ? { ...linkOf(l), children: kids } : linkOf(l);
    }) }
    : {};
  // #1780 —— 顶栏上面那一行：没写过 ⟹ 今天的样子（电话 + 邮箱），编辑器那头显示的就是页面上画的那两项。
  return { headerButtons: (Array.isArray(h.buttons) ? h.buttons : []).map(buttonOf), headerTopbar: topbarLinksOf(h.topbarLinks), ...links };
}

/**
 * #1681 —— Business info 四样的现值（`site/brand.json`）。`brand.json` 不在 / 读不出 ⟹ 一个都不回（不回 ''：
 * 编辑器那头拿到 '' 会把构建时那份真值盖掉，见 EditorApp §openRoot）。
 * 名字的读法同 `src/lib/config.ts` §getBrandName（这种语言 → 默认语言 → 第一个）；老站 `name` 是字符串时就是它。
 */
function readBrandValues(siteDir, locale) {
  let brand;
  try {
    brand = JSON.parse(fs.readFileSync(path.join(siteDir, 'brand.json'), 'utf-8'));
  } catch {
    return {};
  }
  if (!isObj(brand)) return {};
  const str = (v) => (typeof v === 'string' ? v : '');
  let brandName = '';
  if (typeof brand.name === 'string') brandName = brand.name;
  else if (isObj(brand.name)) {
    const def = defaultLocaleOf(siteDir);
    const n = brand.name;
    brandName = str(n[locale || def] ?? n[def] ?? Object.values(n)[0]);
  }
  const loc = Array.isArray(brand.locations) && isObj(brand.locations[0]) ? brand.locations[0] : {};
  // #1759 —— logo 也住在 brand.json（顶栏读的就是它，`shell-data.js`）。
  // #1785 —— 社交链接：两种老形状（数组 / 对象）都读成数组 `[{platform, url}]`（同 item-sources.js §socialPairs）。
  const socialLinks = socialPairs(brand.socialLinks).map(([platform, url]) => ({ platform: platform.toLowerCase(), url }));
  return { brandName, email: str(brand.email), phone: str(loc.phone), address: str(loc.address), logoUrl: str(brand.logoUrl), socialLinks };
}

/** 形状检查：这一份 root 里只许有分派表里的字段，每个的类型对。 */
function checkShape(root, layouts) {
  if (!isObj(root)) bad('root 必须是一个对象');
  const known = new Set(ROOT_FIELDS.map((f) => f.field));
  for (const k of Object.keys(root)) if (!known.has(k)) bad(`root 里有不认识的字段：${JSON.stringify(k)}`);
  if ('layout' in root && !(typeof root.layout === 'string' && layouts.has(root.layout))) {
    bad(`layout 不在布局库里：${JSON.stringify(root.layout)}（有的是 ${[...layouts.keys()].join(' / ')}）`);
  }
  for (const [field, block] of [['headerShape', 'header'], ['footerShape', 'footer']]) {
    if (!(field in root)) continue;
    const ok = pickableShapesOf(block);
    if (!(typeof root[field] === 'string' && ok.includes(root[field]))) {
      bad(`${field} 不是 blocks/${block}/ 里能挑的形态：${JSON.stringify(root[field])}（有的是 ${ok.join(' / ')}）`);
    }
  }
  // #1738 —— 底色 + 旋钮：一个对象，每一格都得是那个块 manifest 里认的（`region-options.js` §regionOptionsProblems）。
  for (const [field, block] of [['headerOptions', 'header'], ['footerOptions', 'footer']]) {
    if (!(field in root)) continue;
    const problems = regionOptionsProblems(block, root[field]);
    if (problems.length) bad(`${field} 不对：${problems.join(' · ')}`);
  }
  // #1681 —— Business info：都是文字。电话 / 邮箱 / 地址可以清空（用到它们的顶栏那一项 / 按钮自己不画，
  // `item-sources.js` §contactFact）；网站名字不许空 —— 那句话给老板看（拒收码，进状态栏）。
  for (const field of BRAND_FIELDS) {
    if (field in root && typeof root[field] !== 'string') bad(`${field} 必须是字符串：${JSON.stringify(root[field])}`);
  }
  if ('brandName' in root && !root.brandName.trim()) refuse('The website name can\'t be empty. Nothing was changed.');
  // #1759 —— logo：一个地址（空串 = 删掉）。#1787 —— 顶栏按钮：`[{label, href}]`，label 是字符串（链接能不能用由 §commitWrites
  //    那道链接判据说，同页面块的按钮）；href 是字符串，或电话 / 邮箱引用（#1779，§isButtonRef：源不认识、多余的键都拒）。
  if ('logoUrl' in root && typeof root.logoUrl !== 'string') bad(`logoUrl 必须是字符串：${JSON.stringify(root.logoUrl)}`);
  // #1945 —— 搜索结果三样：标题 / 描述是文字；模式是 'custom' 或 ''（Automatic）。标题清空不是错（这一格不写，§planRootWrite）。
  for (const field of ['siteTitle', 'siteDescription']) {
    if (field in root && typeof root[field] !== 'string') bad(`${field} 必须是字符串：${JSON.stringify(root[field])}`);
  }
  if ('seoMode' in root && root.seoMode !== 'custom' && root.seoMode !== '') bad(`seoMode 只能是 "custom" 或 ""：${JSON.stringify(root.seoMode)}`);
  // #1785 —— 社交链接：`[{platform, url}]`；平台名是图标名那种形状；网址空的那一行写盘时去掉，不空就得是网址（https://…）。
  if ('socialLinks' in root) {
    const v = root.socialLinks;
    if (!Array.isArray(v) || v.some((l) => !isObj(l) || Object.keys(l).some((k) => k !== 'platform' && k !== 'url')
      || typeof l.platform !== 'string' || !SOCIAL_PLATFORM_RE.test(l.platform) || typeof l.url !== 'string')) {
      bad(`socialLinks 必须是 [{platform, url}]（platform 是小写的平台名）：${JSON.stringify(v)}`);
    }
    if (v.length > MAX_SOCIAL_LINKS) refuse(`A website can have at most ${MAX_SOCIAL_LINKS} social links. Nothing was changed.`);
    const badUrl = v.find((l) => l.url.trim() && !(/^https?:\/\//i.test(l.url.trim()) && hrefAllowed(l.url.trim())));
    if (badUrl) {
      refuse(`The social link "${badUrl.url.trim().slice(0, 60)}" is not a web address. Use a full address that starts with https://. Nothing was changed.`);
    }
  }
  if ('headerButtons' in root) {
    const list = root.headerButtons;
    const okItem = (v) => isObj(v) && !Object.keys(v).some((k) => k !== 'label' && k !== 'href') && typeof v.label === 'string'
      && (typeof v.href === 'string' || isButtonRef(v.href));
    if (!Array.isArray(list) || !list.every(okItem)) {
      bad(`headerButtons 必须是 [{label: string, href: string | {source: "phone" | "email"}}]：${JSON.stringify(list)}`);
    }
    const problem = headerButtonsProblem(list);
    if (problem) refuse(`${problem} Nothing was changed.`);
  }
  // #1780 —— 顶栏上面那一行：`[{label, href}]`，`href` 是字符串或电话 / 邮箱引用；能不能存跟编辑器 Done 同一句（`topbar-links.js`）。
  if ('headerTopbar' in root) {
    const v = root.headerTopbar;
    const okItem = (it) => isObj(it) && Object.keys(it).every((k) => k === 'label' || k === 'href') && typeof it.label === 'string'
      && (typeof it.href === 'string' || isButtonRef(it.href));
    if (!Array.isArray(v) || !v.every(okItem)) {
      bad(`headerTopbar 必须是 [{label: string, href: string | {source: "phone" | "email", location?}}]：${JSON.stringify(v)}`);
    }
    // 能不能存（至少一项 · 最多三项 …）要看存完以后的版式带不带这一行 ⟹ 在 §planRootWrite 里判（§topbarRefusal）。
  }
  // #1781 —— 菜单：一串 `{label, href}`。形状不对（编辑器发不出来的东西）⟹ 5；没名字 / 名字太长 / 没链接 ⟹ 拒收，话同浏览器那一侧
  //    （`nav-editor.js` §menuItemProblem）。字符串链接能不能用归 §commitWrites 那道链接判据（`link-href.js` 登记了 header.links）。
  if ('headerLinks' in root) {
    const list = root.headerLinks;
    if (!Array.isArray(list)) bad(`headerLinks 必须是数组：${JSON.stringify(list)}`);
    if (list.length > MENU_MAX) refuse(`The menu can have up to ${MENU_MAX} links. Nothing was changed.`);
    const hrefShape = (v, at) => {
      if (isObj(v.href)) {
        const p = refProblemsAt(`${at}.href`, BUTTON_SOURCES, v.href);
        if (p.length) bad(p.join(' · '));
      } else if (typeof v.href !== 'string') {
        bad(`${at}.href 必须是字符串或电话 / 邮箱引用：${JSON.stringify(v.href)}`);
      }
    };
    list.forEach((v, i) => {
      if (!isObj(v) || Object.keys(v).some((k) => k !== 'label' && k !== 'href' && k !== 'children') || typeof v.label !== 'string') {
        bad(`headerLinks[${i}] 必须是 {label: string, href, children?}：${JSON.stringify(v)}`);
      }
      hrefShape(v, `headerLinks[${i}]`);
      // #1783 —— 下拉：`children` 是 `[{label, href, description?}]`。子项再带 `children`（两层）不在这里当形状错 —— 它是老板能做出来的
      //    （AI 写的、或别处带进来的），话同编辑器 Done（下面 §childrenProblem 拒收并说一句）。
      if (v.children === undefined) return;
      if (!Array.isArray(v.children)) bad(`headerLinks[${i}].children 必须是数组：${JSON.stringify(v.children)}`);
      v.children.forEach((c, j) => {
        const at = `headerLinks[${i}].children[${j}]`;
        if (!isObj(c) || Object.keys(c).some((k) => !['label', 'href', 'description', 'children'].includes(k)) || typeof c.label !== 'string') {
          bad(`${at} 必须是 {label: string, href, description?}：${JSON.stringify(c)}`);
        }
        hrefShape(c, at);
      });
    });
    for (const v of list) {
      const why = menuItemProblem(v) || childrenProblem(v);
      if (why) refuse(`${why} Nothing was changed.`);
    }
  }
}

/**
 * #1780 —— 顶栏上面那一行能不能存：跟编辑器 Done（EditorApp §headerContentProblem）同一个判据、同一句话。
 * 「带不带这一行」按**存完以后**的顶栏算：这一笔改了形态 / 旋钮就用这一笔的，没改就用盘上的现值（§readRootValues 同一个来源）。
 */
function topbarRefusal(root, siteDir) {
  if (!('headerTopbar' in root)) return;
  const saved = siteRegions.resolveSiteRegionLayout(siteDir).regions.header;
  const shape = 'headerShape' in root ? root.headerShape : saved.shape;
  const opts = 'headerOptions' in root ? root.headerOptions : saved.options || {};
  const why = topbarLinksProblem(root.headerTopbar, effectiveRegionKnobs('header', shape, opts).topbar === true);
  if (why) refuse(/Nothing was changed\.$/.test(why) ? why : `${why} Nothing was changed.`);
}

/**
 * 写一个键路径。路径上缺的、或形状不对的一层按**下一个键**补：下一个键是数字 ⟹ 那一层得是数组，否则是对象。
 * 🔴 #1681 —— 原来一律「不是对象就换成 {}」，而数组也算「不是对象」⟹ 写 `locations[0].phone` 会把整个
 *    `locations` 换成 `{}`，门店的地址 / 坐标全丢。现在数组按数组走；`locations` 不在或为空时新建第一项。
 */
function setAt(doc, key, value) {
  const clearing = value === null || value === undefined;
  let o = doc;
  for (let i = 0; i < key.length - 1; i += 1) {
    const k = key[i];
    const wantArray = typeof key[i + 1] === 'number';
    if (wantArray ? !Array.isArray(o[k]) : !isObj(o[k])) {
      if (clearing) return; // 要删的那一格本来就不在：不为了删它造出一层（例如一家空门店）
      o[k] = wantArray ? [] : {};
    }
    o = o[k];
  }
  const last = key[key.length - 1];
  if (value === null || value === undefined) delete o[last]; else o[last] = value;
}

/**
 * 判这一份 root 能不能写，能写就回要写的那几份字节（绝对路径 + 内容），**不落盘**。
 *
 * @param {object} a
 * @param {string} a.siteDir     `site/`
 * @param {string} a.localeDir   这次存盘那种语言的目录（扁平站 = `site/`）
 * @param {string} a.locale      那种语言（扁平站传 ''）
 * @param {{ flat: boolean, locales: string[] }} a.shape  `site-shape.js` §readSiteShape
 * @param {object} a.root        只含**改过的**字段（编辑器逐字段比过初值，做什么 7）
 * @param {string} [a.layoutsDir]
 * @returns {{ file: string, content: string }[]}
 * @throws {RootWriteError} code 5 = 形状不对（不是编辑器发得出来的东西）· 11 = 拒收（给老板看的话）
 */
function planRootWrite({ siteDir, localeDir, locale, shape, root, layoutsDir }) {
  const layouts = pageLayoutLib.loadLayouts(layoutsDir);
  checkShape(root, layouts);
  if (Object.keys(root).length === 0) return [];
  topbarRefusal(root, siteDir);

  // ── 写完以后是什么样 ─────────────────────────────────────────────────────────────────────────
  const current = pageLayoutLib.resolveSiteLayout(siteDir, layoutsDir);
  const layoutAfter = 'layout' in root ? layouts.get(root.layout) : current.layout;
  const layoutName = layoutAfter.id;

  // 布局自己钉了页脚形态 ⟹ `regionLayout.footer` 画不出来（做什么 8）。编辑器那边下拉是灰的、不会发它；
  // 这里再挡一次，因为「存进去了、页面没变」正是这一条要防的事。
  if ('footerShape' in root && pageLayoutLib.layoutPinsFooter(layoutAfter)) {
    refuse(`The layout "${layoutName}" comes with its own footer styles, so the footer style can't be `
      + 'changed while it is selected. Nothing was changed.');
  }

  // ── 算出每份文件写完以后的字节（照分派表，同一份文件的几个字段合在一起写）─────────────────────
  const byFile = new Map();
  for (const f of ROOT_FIELDS) {
    if (!(f.field in root)) continue;
    // #1945 —— 标题清空：这一格不写、文件里原值不动（编辑器那头提示 Title is required）。放在取文件之前：
    //    只改了它的一笔连 seo.json 都不该重写。🔴 不是 setAt(…, null)：那是删键，这里要的是原值还在。
    if (f.field === 'siteTitle' && !root.siteTitle.trim()) continue;
    const file = fileFor(f, siteDir, localeDir);
    if (!byFile.has(file)) {
      let cur = null;
      try {
        cur = readJson(file);
      } catch (e) {
        bad(`${path.relative(path.dirname(siteDir), file)} 不是合法 JSON：${e.message}`);
      }
      byFile.set(file, { f, before: cur ? cur.doc : null, doc: cur && isObj(cur.doc) ? JSON.parse(JSON.stringify(cur.doc)) : {}, nl: cur ? cur.trailingNewline : true });
    }
    const entry = byFile.get(file);
    const key = resolveKey(f.key, locale, siteDir);
    // #1681 —— 按语言的那一格（`name[<语言>]`）落在一个还是字符串的老值上（TICKET-136 之前的站）：先照
    // `sync-config.js` 那条把它包成 {默认语言: 原值}，再写这一格 —— 不能把原名字丢掉。
    const slot = f.key.indexOf(LOCALE_SLOT);
    if (slot > 0) {
      let parent = entry.doc;
      for (const k of key.slice(0, slot - 1)) parent = isObj(parent) || Array.isArray(parent) ? parent[k] : undefined;
      const k = key[slot - 1];
      if (isObj(parent) && typeof parent[k] === 'string') parent[k] = { [defaultLocaleOf(siteDir)]: parent[k] };
    }
    // 电话 / 邮箱 / 地址清空 = 删掉那个键：读它们的地方（顶栏 / 按钮 / JsonLd / llms.txt）都按「没有」处理。
    const v = root[f.field];
    if (REGION_OPTION_FIELDS.includes(f.field)) {
      // #1738 —— 空对象 = 删掉那个键；`regionOptions` 删空了也一起删（不留一个 `{}` 在 theme.json 里）。
      const clean = cleanRegionOptions(f.field === 'headerOptions' ? 'header' : 'footer', v);
      const empty = !Object.keys(clean).length;
      setAt(entry.doc, key, empty ? null : clean);
      if (empty && isObj(entry.doc[key[0]]) && !Object.keys(entry.doc[key[0]]).length) delete entry.doc[key[0]];
      continue;
    }
    if (f.field === 'headerButtons') {
      // #1787 —— 整份列表换（顺序就是老板排的顺序）；空列表照写（= 不要按钮）。两头空白去掉。
      setAt(entry.doc, key, v.map((b) => ({ label: b.label.trim(), href: typeof b.href === 'string' ? b.href.trim() : { ...b.href } })));
      continue;
    }
    if (f.field === 'headerTopbar') {
      // #1780 —— 两头空白去掉；引用原样（形状已在 §checkShape 判过）。
      setAt(entry.doc, key, v.map((it) => ({ label: it.label.trim(), href: typeof it.href === 'string' ? it.href.trim() : { ...it.href } })));
      continue;
    }
    if (f.field === 'logoUrl') {
      // 空串 = 删掉（顶栏画名字）。🔴 #1784 r7 —— 不碰 `logoHasWordmark`：r6 在这里「换上新图 ⟹ 置 true」，而 r7 起编辑器里换图只在
      //   Logo 子页的 Image 下，换的那一下把 `headerOptions.logoType` 存成 image（`EditorApp.tsx` §LogoSubPage）⟹ 默认那条判据用不上了。
      //   建站那条（`create-site.js`，老板自己传的 logo 当它自带店名）仍要它定默认，不动。
      setAt(entry.doc, key, v.trim() || null);
      continue;
    }
    if (f.field === 'socialLinks') {
      // #1785 —— 网址空的那一行不存；一条都不剩 = 删掉这个键（顶栏 / 页脚按「没有」处理）。一律写成数组。
      const rows = v.map((l) => ({ platform: l.platform, url: l.url.trim() })).filter((l) => l.url);
      setAt(entry.doc, key, rows.length ? rows : null);
      continue;
    }
    if (f.field === 'headerLinks') {
      // #1781 —— 名字和字符串链接去首尾空格（同按钮）；引用原样。
      //    #1783 —— 子项同样；`description` 去首尾空格，空了就不写这个键；一个子项都没有 ⟹ 不写 `children`。
      const one = (l) => ({ label: l.label.trim(), href: typeof l.href === 'string' ? l.href.trim() : { ...l.href } });
      setAt(entry.doc, key, v.map((l) => {
        const kids = Array.isArray(l.children) ? l.children.map((c) => {
          const d = typeof c.description === 'string' ? c.description.trim() : '';
          return d ? { ...one(c), description: d } : one(c);
        }) : [];
        return kids.length ? { ...one(l), children: kids } : one(l);
      }));
      continue;
    }
    if (f.field === 'siteDescription') {
      // #1945 —— 空 = 删掉这个键（不是存一个空串；`setAt` 只在 null 时删）。同 logoUrl 那条。
      setAt(entry.doc, key, v.trim() ? v : null);
      continue;
    }
    if (f.field === 'seoMode') {
      // #1945 —— 只有 "custom" 落盘；Automatic = 没有这个键（#1938 看到它从 custom 变成没有会排一次重写）。
      setAt(entry.doc, key, v === 'custom' ? 'custom' : null);
      continue;
    }
    setAt(entry.doc, key, BRAND_FIELDS.includes(f.field) && f.field !== 'brandName' && !v.trim() ? null : v);
  }

  const writes = [];
  for (const [file, e] of byFile) {
    // 🔴 写回的格式跟原文件一样：两空格缩进；原文件末尾有没有换行照原样（worker 写 theme.json 带换行）—— 不然 diff 里会多出一行跟这次改动无关的变化。
    writes.push({ file, content: JSON.stringify(e.doc, null, 2) + (e.nl ? '\n' : '') });
  }
  return writes;
}

module.exports = { ROOT_FIELDS, REFUSED, RootWriteError, readRootValues, planRootWrite };
