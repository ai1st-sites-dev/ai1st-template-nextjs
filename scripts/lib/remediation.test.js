#!/usr/bin/env node
/**
 * remediation.test.js — #1108：报错里「那你去做 X」那几句话，说的是今天真能做的事吗？
 *
 *   node scripts/lib/remediation.test.js     （由 `npm run test:scripts` 自动发现）
 *   退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * ── 这份测试真正守的那一条 ────────────────────────────────────────────────────────────────────
 * 本票要治的缺陷是「产品的报错在建议一个产品自己禁止的动作」。修法的承重性质**不是**「那句话现在
 * 是对的」——那种对法明天就会过期（#1104 正在把 `navigation.json` 的 topbar 开出来）。承重的是
 * **那句话由白名单算出来**：同一份代码，在「写得进」和「写不进」两个世界里各说各的真话。
 *
 * 所以 ② 那一格是两臂对照：同一个 `remediation.js`，一臂配放行的白名单、一臂配拒绝的，
 * 句子必须**不同**。少了这一格，把那两句话写死成任何一边都能让这份测试全绿。
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const mod = require('./remediation.js');
const { howToAddTopbar, howToChangePageLayout } = mod;

let pass = 0, fail = 0;
const ok = (m) => { pass++; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail++; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };

if (typeof howToAddTopbar !== 'function' || typeof howToChangePageLayout !== 'function') {
  die('remediation.js 没导出 howToAddTopbar / howToChangePageLayout');
}

const NEXTJS = path.join(__dirname, '..', '..');            // templates/nextjs
const REPO = path.join(NEXTJS, '..', '..');                 // 仓根

/** 造一棵只有 `lib/` 的临时树：remediation.js 的副本 + 一个指定行为的假白名单。 */
function treeWith(editableFilesSrc) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remediation-'));
  fs.mkdirSync(path.join(dir, 'lib'));
  fs.copyFileSync(path.join(__dirname, 'remediation.js'), path.join(dir, 'lib', 'remediation.js'));
  // 🔴 #1138 —— `remediation.js` 现在顶层 require 了 `./site-shape.js`（它要拿这个站的形状去问
  //    白名单）。这棵树少了它，被测的那份副本**加载不起来**，②③ 会当场死掉 —— 那是响的失败，
  //    比"少了一维静默不判"好，所以那个 require 有意不是 try/catch 的。这里把它一起拷过来。
  fs.copyFileSync(path.join(__dirname, 'site-shape.js'), path.join(dir, 'lib', 'site-shape.js'));
  fs.writeFileSync(path.join(dir, 'lib', 'editable-files.js'), editableFilesSrc);
  return dir;
}
/**
 * 一个带 navigation.json 的假站。
 *
 * 🔴 #1138 —— 给了 `locale` 就**必须**同时写 `site_meta.json`，否则这个夹具自相矛盾：`site/en/`
 *    躺在那儿，而「多语言还是扁平」的唯一判据是 `site_meta.json` 在不在（`lib/site-shape.js`
 *    文件头），所以 `readSiteShape` 会把它读成**扁平站**。改之前这不要紧（`remediation.js` 问白名单
 *    时不带形状），#1138 把形状递进去之后就要紧了：`en/navigation.json` 在一个"扁平站"上会被
 *    #1109 那个分支拒掉 ⟹ ① 与 ⑧ 从「AI 编辑器写得进」那一支翻到「写不进」那一支。
 *    🔴 而**两格都仍然是绿的**（① 只断言 `viaProduct` 是 true/false 之一；⑧ 长句支 1089–1170
 *    字符照旧 ≤2000）—— 也就是说这个夹具会静默把两个读数换成另一道题的答案。
 *    多语言站在真世界里永远有 `site_meta.json`（`create-site.js` 的每一条路都写它），夹具跟上。
 * 📌 同一棵树可以调多次（⑧ 就造 22 个语言），所以这里是**累加**进 locales，不是覆盖。
 */
function siteWithNav(dir, locale) {
  const site = path.join(dir, 'site');
  const d = locale ? path.join(site, locale) : site;   // locale=null ⟹ 扁平站（不写 site_meta.json）
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'navigation.json'), JSON.stringify({
    header: { links: [{ label: 'Home', href: '/' }], cta: { label: 'Book', href: '/contact' } },
    footer: { description: 'd', columns: [{ title: 'Q', links: [] }], copyright: 'c' },
  }, null, 2));
  if (locale) {
    const metaPath = path.join(site, 'site_meta.json');
    let meta = { siteId: 'remediationtest', defaultLocale: locale, locales: [] };
    try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')); } catch (e) { /* 第一次，用上面那份 */ }
    if (!Array.isArray(meta.locales)) meta.locales = [];
    if (!meta.locales.includes(locale)) meta.locales.push(locale);
    fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  }
  return site;
}

// ── ① 交付这一版的真读数:这个仓今天的白名单说什么,那句话就说什么 ──────────────────────────────
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remediation-live-'));
  const siteDir = siteWithNav(dir, 'en');
  const r = howToAddTopbar({ siteDir, locale: 'en' });
  if (r.viaProduct === true || r.viaProduct === false) {
    ok(`① 拿这个仓真实的白名单问出了一个答案（viaProduct=${r.viaProduct}）`);
  } else {
    bad(`① 问不到白名单（viaProduct=${r.viaProduct}）—— 那句话会退回中性说法，先修 require`);
  }
  // 无论哪个世界，这句话都必须给出一个**今天真能做的动作**，而不是只说"不行"。
  if (/手改|让 AI 编辑器/.test(r.sentence)) ok('① 句子里给了一个今天真能做的动作');
  else bad(`① 句子只说了不行、没给能做的事：${r.sentence}`);
  // 🔴 #1087 r3 那条教训：不许把人指到一个不存在的后台去。
  if (/设置页|settings|picker|换装弹窗/i.test(r.sentence)) {
    bad(`① 句子把人指到了一个后台界面 —— 顶栏文案今天没有那种界面：${r.sentence}`);
  } else ok('① 句子没有把人指到一个不存在的后台界面');
  fs.rmSync(dir, { recursive: true, force: true });
}

// ── ② 承重那一格:两臂对照 —— 白名单放行 vs 拒绝,同一份代码必须说【不同】的话 ────────────────
{
  const PERMISSIVE = "'use strict';\nmodule.exports = { writeRejection: () => null };\n";
  const STRICT = "'use strict';\nmodule.exports = { writeRejection: () => 'nope: not edited here' };\n";
  const results = {};
  for (const [name, src] of [['放行', PERMISSIVE], ['拒绝', STRICT]]) {
    const dir = treeWith(src);
    const siteDir = siteWithNav(dir, 'en');
    // eslint-disable-next-line global-require
    const copy = require(path.join(dir, 'lib', 'remediation.js'));
    results[name] = copy.howToAddTopbar({ siteDir, locale: 'en' });
    fs.rmSync(dir, { recursive: true, force: true });
  }
  if (results['放行'].viaProduct === true) ok('② 白名单放行时 viaProduct=true');
  else bad(`② 白名单放行时却说 viaProduct=${results['放行'].viaProduct}`);
  if (results['拒绝'].viaProduct === false) ok('② 白名单拒绝时 viaProduct=false');
  else bad(`② 白名单拒绝时却说 viaProduct=${results['拒绝'].viaProduct}`);
  if (results['放行'].sentence !== results['拒绝'].sentence) {
    ok('② 两臂句子不同 ⟹ 这句话真的是【算出来】的，不是写死的');
  } else {
    bad(`② 两臂句子逐字相同 ⟹ 它是写死的，明天 #1104 落地就变成假话：${results['放行'].sentence}`);
  }
  if (/让 AI 编辑器/.test(results['放行'].sentence)) ok('② 放行那臂让人去用 AI 编辑器');
  else bad(`② 放行那臂没提 AI 编辑器：${results['放行'].sentence}`);
  if (/现在还加不了/.test(results['拒绝'].sentence)) ok('② 拒绝那臂明写「现在还加不了」');
  else bad(`② 拒绝那臂没有明写还做不到：${results['拒绝'].sentence}`);
}

// ── ③ 问不到白名单时:不许替它选一个答案 ───────────────────────────────────────────────────────
{
  const dir = treeWith("throw new Error('boom');\n");
  const siteDir = siteWithNav(dir, 'en');
  const copy = require(path.join(dir, 'lib', 'remediation.js'));
  const r = copy.howToAddTopbar({ siteDir, locale: 'en' });
  if (r.viaProduct === null) ok('③ 读不到那个判断模块 ⟹ viaProduct=null（"没问到"不是一个答案）');
  else bad(`③ 读不到判断模块却给了 viaProduct=${r.viaProduct} —— 那是一句没人查过的话`);
  if (/没问出来|没问到/.test(r.sentence)) ok('③ 句子里说明了这次没问到');
  else bad(`③ 句子没说明这次没问到：${r.sentence}`);
  if (/手改/.test(r.sentence)) ok('③ 仍然给了一个今天真能做的动作（手改站仓）');
  else bad(`③ 没给能做的事：${r.sentence}`);
  fs.rmSync(dir, { recursive: true, force: true });
}

// ── ④ navigation.json 读不出来时也要说人话 ────────────────────────────────────────────────────
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remediation-nonav-'));
  const r = howToAddTopbar({ siteDir: path.join(dir, 'site'), locale: 'en' });
  if (/读不出来/.test(r.sentence)) ok('④ navigation.json 不在时说的是「读不出来，先补好这个文件」');
  else bad(`④ 文件不在时那句话不对：${r.sentence}`);
  fs.rmSync(dir, { recursive: true, force: true });
}

// ── ④b 老的扁平站:文件在 site/navigation.json,不在 site/en/ 下面 ─────────────────────────────
//
// 🔴 这一格是我自己交付第一版的洞：扁平站在 `sync-config.js` 里 `locales` **仍然是 ['en']`
//    （那段 legacy 分支），而文件住在 `site/navigation.json`。只看 locale 有没有值 ⟹ 在扁平站上
//    算出 `en/navigation.json`，然后那句话让老板去改一个不存在的文件。夹具是 locale 站，所以没红。
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remediation-flat-'));
  const siteDir = siteWithNav(dir, null);          // 扁平：site/navigation.json
  const flat = howToAddTopbar({ siteDir, locale: 'en', flat: true });
  if (/(^|[^/\w])navigation\.json/.test(flat.sentence) && !/en\/navigation\.json/.test(flat.sentence)) {
    ok('④b 扁平站：句子点名 navigation.json，不含 en/navigation.json');
  } else {
    bad(`④b 扁平站上指错了文件：${flat.sentence}`);
  }
  if (!/读不出来/.test(flat.sentence)) ok('④b 而且它真的读到了那份文件（不是走「读不出来」那一支）');
  else bad(`④b 扁平站上把存在的文件当成读不出来：${flat.sentence}`);

  // 反向对照:同一棵扁平树、**不传 flat** ⟹ 必须退化成「读不出来」(证明上面那格判的是 flat 这一维)
  const wrong = howToAddTopbar({ siteDir, locale: 'en' });
  if (/读不出来/.test(wrong.sentence) && /en\/navigation\.json/.test(wrong.sentence)) {
    ok('④b 反向对照：同一棵扁平树不传 flat ⟹ 它去找 en/navigation.json 并报「读不出来」'
      + ' ⟹ 上面那格判的就是这一维');
  } else {
    bad(`④b 反向对照失败：不传 flat 时读数没变 ⟹ 这一格证明不了 flat 在起作用：${wrong.sentence}`);
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

// ── ⑤ 换 page layout:那句话必须说实话,而且库的名单是【读目录】读出来的 ────────────────────────
{
  const r = howToChangePageLayout({ rootDir: NEXTJS });
  if (/手改/.test(r.sentence)) ok('⑤ 给了今天唯一真能走的路（手改站仓的 site/page-layout.json）');
  else bad(`⑤ 没给真能走的路：${r.sentence}`);
  if (/picker|换装弹窗|布局选择器/i.test(r.sentence)) {
    bad(`⑤ 把人指到一个不存在的布局选择器 —— #1087 r3 就是为这个被退回过：${r.sentence}`);
  } else ok('⑤ 没有把人指到一个不存在的布局选择器');
  if (/standard/.test(r.sentence)) ok('⑤ 名单里有 standard');
  else bad(`⑤ 名单里没有 standard：${r.sentence}`);

  // 🔴 阳性对照:名单是读目录读出来的,还是抄了一份写死的?
  //    **在一棵临时树里做,不碰真的 `page-layouts/`** —— 往交付树里写一个探针文件,只要这个进程被
  //    掐掉(前台命令撞超时会被 SIGKILL)就会留在那儿跟着 ship 出去,而 `finally` 那时不跑。
  //    临时树同样证得了「名单是读目录来的」：换一个 rootDir，名单就跟着换。
  {
    const t = fs.mkdtempSync(path.join(os.tmpdir(), 'remediation-layouts-'));
    fs.mkdirSync(path.join(t, 'page-layouts'));
    for (const n of ['aaa-probe', 'zzz-probe']) {
      fs.writeFileSync(path.join(t, 'page-layouts', `${n}.json`), '{"regions":["content"]}');
    }
    const s2 = howToChangePageLayout({ rootDir: t }).sentence;
    fs.rmSync(t, { recursive: true, force: true });
    // 🔴 只看**名单那一段**。整句话里还有一句固定的「这个文件不在就按 standard 走」——
    //    拿整句话去断言「不含 standard」永远失败，而那看起来像「名单是写死的」。
    //    （我第一版就是这么假红的：坏的是断言，不是被测的代码。）
    //    🔴 收尾符必须把**两种句形**都算进去：拒绝那句用 `；` 收尾，放行那句用 `）` 收尾。
    //    只写 `[^；]*` 时，放行句形下会把 `）。` 一起吞进名单里 —— 于是这一格红，而它印的理由是
    //    「那份名单是写死的」**假话**（名单其实跟着目录变了）。抓到它的是「反方向写死成放行」那一臂。
    const listOf = (str) => (str.match(/库里有：([^；）]*)/) || [, ''])[1];
    if (listOf(s2) === 'aaa-probe / zzz-probe') {
      ok('⑤ 阳性对照：换一棵只有两个假布局的树，名单那一段变成 `aaa-probe / zzz-probe`'
        + ' ⟹ 它是读目录来的，不是写死的');
    } else {
      bad(`⑤ 阳性对照失败：换了目录名单没跟着变 ⟹ 那份名单是写死的，加布局时它会过期：`
        + `名单那一段读到「${listOf(s2)}」`);
    }
  }
  // 真的那个目录一个字节都没被这份测试碰过
  {
    const real = fs.readdirSync(path.join(NEXTJS, 'page-layouts')).sort().join(' ');
    if (!/probe/.test(real)) ok(`⑤ 真的 page-layouts/ 没被污染（现在是：${real}）`);
    else bad(`⑤ 真的 page-layouts/ 里有探针残留：${real}`);
  }
}

// ── ⑤b 「换一套顶栏不是透明浮层的主题」——那份名单必须是【构建自己的判据】算出来的 ────────────
//
// 🔴 这一格治的是我自己第一版交付里的假话：那句话教人按 `supports.header !== 'transparent-overlay'`
//    去挑，而 `supports` 装的是**清单**（数组）⟹ 拿数组 `!==` 字符串恒为真，一个主题都排除不掉。
//    实测 110 套里有 20 套解析出来仍然是透明浮层 ⟹ 照那句话挑，五分之一换完还是看不见那条横条。
{
  const { themesWithoutOverlayHeader } = mod;
  if (typeof themesWithoutOverlayHeader !== 'function') die('remediation.js 没导出 themesWithoutOverlayHeader');
  const r = themesWithoutOverlayHeader({ rootDir: path.join(NEXTJS, 'scripts') });

  // 独立复算：不信它的分类，自己拿同一个权威再算一遍
  let indep = null;
  try {
    const { themes, layoutFor } = require(path.join(NEXTJS, 'scripts', 'themes.js'));
    const { resolveRegionLayout } = require(path.join(NEXTJS, 'scripts', 'region-layout.js'));
    indep = { safe: [], overlay: [] };
    for (const id of Object.keys(themes)) {
      const h = resolveRegionLayout(layoutFor(id)).header;
      (h === 'transparent-overlay' ? indep.overlay : indep.safe).push(id);
    }
  } catch (e) { indep = null; }

  if (!indep) {
    bad('⑤b 独立复算跑不起来 —— 这一格的读数一个都不能信');
  } else if (r.safe.length === indep.safe.length && r.overlay.length === indep.overlay.length) {
    ok(`⑤b 独立复算对得上（顶栏安全 ${r.safe.length} 套 · 透明浮层 ${r.overlay.length} 套）`);
  } else {
    bad(`⑤b 独立复算对不上：它说 ${r.safe.length}/${r.overlay.length}，`
      + `我自己算是 ${indep.safe.length}/${indep.overlay.length}`);
  }

  // 🔴 判据不许是空转的：透明浮层那一边必须真的非空，否则「排除掉了」这句话什么都没排除
  if (indep && indep.overlay.length > 0) {
    ok(`⑤b 判据有区分力：确实有 ${indep.overlay.length} 套被排除掉了（不是空转）`);
  } else {
    bad('⑤b 透明浮层那一边是空的 ⟹ 这个判据没排除任何东西，跟旧那句假话等价');
  }

  // 句子里点名的每一套，都必须真的不是透明浮层（旧那句假话在这里会当场露馅）
  const named = (r.sentence.match(/例如 ([^）]*)）/) || [, ''])[1].split(' / ').filter(Boolean);
  const wrong = indep ? named.filter((id) => indep.overlay.includes(id)) : [];
  if (named.length && !wrong.length) ok(`⑤b 句子点名的 ${named.length} 套逐个核过，都不是透明浮层`);
  else bad(`⑤b 句子点名了透明浮层的主题：${wrong.join(', ')}（句子：${r.sentence}）`);

  // 🔴 旧那个判据不许出现在句子里 —— 它是本票要治的那个病本身
  if (!/supports\.header/.test(r.sentence)) ok('⑤b 句子里没有 supports.header 那个恒为真的判据');
  else bad(`⑤b 句子还在教人用 supports.header：${r.sentence}`);

  // 🔴 阳性对照：换一个只有两套主题的假注册表 —— 名单必须跟着换（证明它是算出来的，不是抄的）
  {
    const t = fs.mkdtempSync(path.join(os.tmpdir(), 'remediation-themes-'));
    fs.writeFileSync(path.join(t, 'themes.js'),
      "'use strict';\nmodule.exports = {\n"
      + "  themes: { 'fake-safe': {}, 'fake-overlay': {} },\n"
      + "  layoutFor: (id) => (id === 'fake-overlay' ? { header: 'transparent-overlay' } : { header: 'solid-bar' }),\n"
      + "};\n");
    fs.copyFileSync(path.join(NEXTJS, 'scripts', 'region-layout.js'), path.join(t, 'region-layout.js'));
    const r2 = themesWithoutOverlayHeader({ rootDir: t });
    fs.rmSync(t, { recursive: true, force: true });
    if (r2.safe.join(',') === 'fake-safe' && r2.overlay.join(',') === 'fake-overlay') {
      ok('⑤b 阳性对照：换一个假注册表（一套浮层 / 一套不浮层），分类跟着换 ⟹ 它是算出来的');
    } else {
      bad(`⑤b 阳性对照失败：换了注册表分类没跟着变 ⟹ 那份名单是写死的：`
        + `safe=[${r2.safe}] overlay=[${r2.overlay}]`);
    }
  }
  // 读不到那两个模块时：不许假装算出了一份名单
  {
    const t = fs.mkdtempSync(path.join(os.tmpdir(), 'remediation-nothemes-'));
    const r3 = themesWithoutOverlayHeader({ rootDir: t });
    fs.rmSync(t, { recursive: true, force: true });
    if (r3.viaProduct === null && /列不出/.test(r3.sentence)) {
      ok('⑤b 读不到 themes.js / region-layout.js 时明说「这次列不出是哪些」');
    } else {
      bad(`⑤b 读不到那两个模块却给了一份名单：${r3.sentence}`);
    }
  }
}

// ── ⑥ 「产品里没有任何界面会写 page-layout.json」是一句关于仓库的断言,在仓库上钉住它 ──────────
{
  const { execFileSync } = require('child_process');
  const dirs = ['dashboard/src', 'manager', 'worker'].map((d) => path.join(REPO, d));
  const present = dirs.filter((d) => fs.existsSync(d));
  if (present.length !== dirs.length) {
    console.log(`  ⚠️  ⑥ 跳过：在 ${REPO} 底下找不到 ${dirs.filter((d) => !fs.existsSync(d)).join(' / ')}`
      + ' —— 这**不是**通过，只是这次没在仓里跑（副本树里跑就会这样）');
  } else {
    const count = (pattern) => {
      try {
        const out = execFileSync('grep', ['-rIlE', pattern, ...present], { encoding: 'utf-8' });
        return out.split('\n').filter(Boolean).length;
      } catch (e) {
        return 0;   // grep 没命中时退出码 1
      }
    };
    const writers = count('page-layout\\.json|layoutId');
    const calib = count('themeId');
    if (calib === 0) {
      bad('⑥ 尺子校准失败：连 themeId 都数到 0 —— 这几个 grep 的读数一个都不能信');
    } else if (writers === 0) {
      ok(`⑥ dashboard/src · manager · worker 里 page-layout.json|layoutId 命中 0 个文件`
        + `（同一把尺量 themeId = ${calib} 个文件 ⟹ 这个 0 是真的）`);
    } else {
      bad(`⑥ 有 ${writers} 个文件提到 page-layout.json / layoutId 了 —— 如果产品真做出了改布局的界面，`
        + 'remediation.js 里那句「产品里没有任何界面或工具会写它」就成了假话，回去改措辞');
    }
    // 🔴 反过来的那一半也要钉:透明浮层那条报错把人指到「dashboard 的换装弹窗」，
    //    那是一句**声称某个界面存在**的话 —— 跟 #1087 r3 那个不存在的 layout picker 同一族。
    //    有人把换装弹窗删掉/改名时，这一格必须红，否则那句话会静默变成假话。
    const picker = count('ThemeModal');
    if (picker > 0) {
      ok(`⑥ 换装弹窗确实在（ThemeModal 命中 ${picker} 个文件）—— sync-config 把人指到它是真话`);
    } else {
      bad('⑥ 找不到换装弹窗（ThemeModal 命中 0）—— 而 sync-config 的透明浮层那条报错正把人指到它，'
        + '那句话现在是假的，回去改措辞');
    }
  }
}

// ── ⑧ 补救行的条数有上限 —— 因为这段话会被 edit-site.js 截到 2000 字符再给老板看 ─────────────
//
// 🔴 这一格治的是我自己引入的一个退步：改之前那版是**一行讲完所有语言**，我改成「一个语言一条」
//    更精确，但 `edit-site.js:594` 的 `.slice(0, 2000)` 会在 10 个语言起把后面那条「或者不要
//    topbar」整条切掉（实测约 2035 字符）。⟹ 更精确的写法在这一维上比原来差。
{
  const { topbarBullets, BULLET_CAP } = mod;
  if (typeof topbarBullets !== 'function') die('remediation.js 没导出 topbarBullets');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remediation-cap-'));
  // 🔴 #1127 —— 语言数从 12 提到 22，这是**夹具的标定**，不是行为改动。
  //    为什么必须提：下面那条反向对照要求「上限拿掉之后同一夹具 > 2000 字符」，而每条 bullet 的长度
  //    取决于 `howToAddTopbar()` 走哪一支 —— 白名单说 AI 编辑器**写不进** navigation.json 时是长句
  //    （170 字符），说**写得进**时是短句（77 字符）。#1104 把 navigation.json 变成写得进的 ⟹ 同一个
  //    12 语言夹具从 2461 掉到 **1345**，反向对照失去量程、这一格红（而 CI 的 template-scripts 跑
  //    `npm run test:scripts`，所以那会让 main 红）。
  //
  //    ⟹ 夹具要在**两支上都有量程**，这样两张票的 ship 顺序无所谓。两支各自的实测（同一个
  //    `siteWithNav` 夹具，只改语言数）：
  //
  //      语言数   长句支(170)         短句支(77)
  //        12     2461 ✅             1345 ✗   ← 本票之前
  //        19     3749 ✅             1982 ✗   （差 18 个字符）
  //        20     3933 ✅             2073 ✅  ← 两支都成立的最小值
  //        22     4301 ✅             2255 ✅  ← 取它，留 255 字符余量
  //
  //    取 22 而不是 20：那句话再变短一点（例如 rel 路径缩短）就又会失去量程，而失去量程的样子是
  //    **这一格红**，不是「悄悄变弱」—— 留余量比等它红一次便宜。
  //    📌 带上限那一半在每一格都 ≤ 2000（短句支 717–798 · 长句支 1089–1170），所以加语言不会把
  //       「老板看得到最后那条补救办法」那一格弄红。
  const many = ['en', 'zh', 'fr', 'es', 'de', 'it', 'pt', 'ja', 'ko', 'ru', 'ar', 'hi',
    'nl', 'pl', 'tr', 'sv', 'da', 'fi', 'cs', 'el', 'he', 'th'];
  for (const loc of many) siteWithNav(dir, loc);
  const siteDir = path.join(dir, 'site');

  const lines = topbarBullets({ siteDir, locales: many });
  if (lines.length <= BULLET_CAP + 1) ok(`⑧ ${many.length} 个语言只打 ${lines.length} 行（上限 ${BULLET_CAP} + 1 行合并）`);
  else bad(`⑧ ${many.length} 个语言打了 ${lines.length} 行 —— 没有上限`);
  // 🔴 行为断言：topbarBullets 打出来的那句，必须就是 howToAddTopbar 对同一个语言的结论 ——
  //    这把「接线经过它」钉成行为，而不是靠 grep 一个函数名。
  {
    const direct = howToAddTopbar({ siteDir, locale: 'en' }).sentence;
    if (lines[0].includes(direct)) ok('⑧ 第一行就是 howToAddTopbar 对 en 的结论 ⟹ 这条链真的接着');
    else bad(`⑧ 第一行跟 howToAddTopbar 的结论不一样：\n    行=${lines[0]}\n    直调=${direct}`);
  }
  const tail = lines[lines.length - 1];
  // 🔴 #1127 —— 这个数**现算**，不写死。它原来写的是 `其余 8 个语言`，而 8 = 12 − BULLET_CAP(4)
  //    是从当时的语言数算出来的 ⟹ 改语言数（本票就在改）或改 BULLET_CAP，它就是一格假红：
  //    红的原因跟被测行为毫无关系。
  const restCount = many.length - BULLET_CAP;
  if (tail.includes(`其余 ${restCount} 个语言`)) ok(`⑧ 最后一行说清了其余 ${restCount} 个语言同理（${many.length} − 上限 ${BULLET_CAP} 现算，不写死）`);
  else bad(`⑧ 合并那行不对：期望提到「其余 ${restCount} 个语言」，实际是：${tail}`);

  // edit-site.js 真正的那把尺：整段 stderr 截 2000
  const SLICE = 2000;
  const layoutSentence = howToChangePageLayout({ rootDir: NEXTJS }).sentence;
  const assemble = (ls) => `page layout "with-topbar" 有 topbar 区，但这些语言的 navigation.json 里没有 topbar 内容：${many.join(', ')}\n`
    + ls.map((l) => `  · ${l}`).join('\n') + `\n  · 或者不要 topbar —— ${layoutSentence}`;
  const withCap = assemble(lines);
  if (withCap.length <= SLICE) {
    ok(`⑧ ${many.length} 个语言时整段 ${withCap.length} 字符 ≤ ${SLICE} ⟹ 老板看得到最后那条补救办法`);
  } else {
    bad(`⑧ 整段 ${withCap.length} 字符 > ${SLICE} ⟹ 最后那条补救办法会被 edit-site.js 切掉`);
  }

  // 🔴 反向对照：把上限拿掉，同一个夹具必须超过 2000 —— 否则这一格证明不了"是上限在起作用"
  const noCap = assemble(topbarBullets({ siteDir, locales: many, cap: 999 }));
  if (noCap.length > SLICE) {
    ok(`⑧ 反向对照：上限拿掉后同一夹具 ${noCap.length} 字符 > ${SLICE} ⟹ 撑住这一格的就是那个上限`);
  } else {
    bad(`⑧ 反向对照失败：上限拿掉也只有 ${noCap.length} 字符 ⟹ 这个夹具证明不了上限在起作用，换更多语言`);
  }
  // 截断真的会切掉那条办法吗（拿 edit-site 那把尺直接量，不是推理）
  if (!noCap.slice(0, SLICE).includes('或者不要 topbar')) {
    ok('⑧ 反向对照：无上限那版被 slice(0,2000) 之后，「或者不要 topbar」那条确实不见了');
  } else {
    bad('⑧ 无上限那版截断后那条还在 ⟹ 上面那个 > 2000 的读数跟这条办法没关系');
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

// ── ⑦ 接线:sync-config.js 真的用这几句话(否则模块再对,报错照样在说假话)──────────────────────
{
  const src = fs.readFileSync(path.join(NEXTJS, 'scripts', 'sync-config.js'), 'utf-8');
  const bads = [];
  if (!/require\(['"]\.\/lib\/remediation(\.js)?['"]\)/.test(src)) bads.push('没 require lib/remediation');
  // 🔴 topbar 那句话的接线现在经 `topbarBullets`（它内部调 howToAddTopbar，见 ⑧ 里那条行为断言）——
  //    所以这里钉的是 topbarBullets 那条（下面），不是直调 howToAddTopbar。
  if (/for \(const loc of missing\)/.test(src)) {
    bads.push('补救行又变回裸的逐语言循环了 —— 那条路没有上限，10 个语言起被 edit-site 截断');
  }
  if (!/howToChangePageLayout\(/.test(src)) bads.push('没调 howToChangePageLayout');
  // 🔴 #1138 —— 每一处 howToChangePageLayout 都要把 siteDir 传进去。
  //    说在明处：**今天这个参数不改变任何答案** —— `page-layout.json` 不是按语言存的文件，形状那一维
  //    对它不说话（⑨ 那格量的就是它：两种问法同一个答案）。所以这一格钉的不是一个后果，是一条**纪律**：
  //    「问白名单时不带这个站的形状」正是 #1138 正文 N2 描述的那个形状 —— 拿到的不是错误，是另一道题的
  //    答案，而两个答案碰巧相同的那一天没有任何东西会说话。#1138 给白名单加了一问之后，
  //    `howToAddTopbar` 那条路当场就分歧了（⑨ 的阳性对照是它的读数）。这一条挡的是下一个 REJECT_REASON
  //    落在按语言存的文件上时，这条路静默说出一句真编辑器会拒的建议。
  {
    const calls = src.match(/howToChangePageLayout\(\{[^}]*\}\)/g) || [];
    const noSite = calls.filter((c) => !/siteDir/.test(c));
    if (!calls.length) bads.push('数不出 howToChangePageLayout 的调用点 —— 这条读数不作数（改了写法就来改这条正则）');
    else if (noSite.length) bads.push(`${noSite.length}/${calls.length} 处 howToChangePageLayout 调用没传 siteDir：${noSite.join(' · ')}`);
  }
  // 🔴 扁平站那一维必须真的被传进去，否则老站上那句话指着一个不存在的文件（④b 就是它的读数）
  if (!/flat:\s*isLegacySchema/.test(src)) bads.push('调 howToAddTopbar 时没把 flat: isLegacySchema 传进去');
  // 🔴 旧那两句假话必须消失。只钉「新话在」的话，把旧话留在旁边也照样绿。
  if (/在 navigation\.json 里加 \{ "topbar"/.test(src)) {
    bads.push('还留着旧那句「在 navigation.json 里加 { "topbar"…」——它当时是走不通的那条路');
  }
  if (/· 换一个不带 topbar 区的 page layout，或者换一套顶栏不是透明浮层的主题/.test(src)) {
    bads.push('透明浮层那条报错还留着旧措辞（它的「换 page layout」那一半走不通）');
  }
  if (!/themesWithoutOverlayHeader\(/.test(src)) bads.push('没调 themesWithoutOverlayHeader');
  // 🔴 补救行必须走那个带上限的函数，不能是裸的 `for (const loc of missing)` 逐语言打印
  if (!/topbarBullets\(/.test(src)) bads.push('没调 topbarBullets（补救行会退回无上限，10 个语言起被 edit-site 截断）');
  // 🔴 AC3 扫查抓到的第三处：CSS 契约那条报错以前给裸的 `docs/reference/…`，而这个脚本的 cwd
  //    （平台仓的 templates/nextjs / 站容器的 /app/repo）底下都没有 docs/ ⟹ 那条路两处都走不通。
  if (/'  · docs\/reference\/theme-css-contract\.md says/.test(src)) {
    bads.push('CSS 契约那条又变回裸的 docs/reference/… —— 从这个脚本的 cwd 解析不开');
  }
  // 🔴 旧那个恒为真的判据不许留在报错里（`supports` 是数组，`!==` 一个字符串排除不掉任何主题）
  if (/supports\.header 不是 transparent-overlay/.test(src)) {
    bads.push('还留着「supports.header 不是 transparent-overlay 的那些」——那个判据恒为真，一套都排除不掉');
  }
  if (bads.length === 0) ok('⑦ sync-config.js 接上了这几句话，旧那两句假话也不在了');
  else bads.forEach((b) => bad(`⑦ ${b}`));
}

// ── ⑦b 真跑一次 sync-config，读它自己吐出来的那两行（#1134，来源 #1108）──────────────────────────
//
// 🔴 上面 ⑦ 是**在源码上 grep**，它按构造对一种失效瞎：**字符串还在、那条调用变成不可达**
//    （分支条件改了 / 那段被移到一个走不到的地方 / 报错在它之前就 return 了）。那时 ⑦ 全绿，而
//    老板一句补救办法都拿不到。
// 🔴 #1108 的 QA2 量过升级成真跑的代价并判它值：造一个最小站 + 一次 `sync-config` ——
//    不用 LLM、不用构建。#1134 实测这一格总共 **~0.1 秒**（比 QA2 估的 4 秒还便宜；那 4 秒里
//    大概含了 npm 那一段）。
// 🔴 隔离：一切都在 `mkdtemp` 出来的一次性目录里。绝不在真树上跑 —— `sync-config.js` 读的是
//    `path.resolve(__dirname, '..') + '/site'`，在真树上跑会拿真站的 `site/` 说话，还会重写
//    `src/lib/config-data.ts`（那是共享树上别人正在用的字节）。
// 🔴 **`scripts/` 必须真拷，不许 symlink** —— 这是 #1134 立这一格时踩到的仪器坑，写在明处：
//    `__dirname` 会**穿过 symlink 解到真路径**，于是 `rootDir` 算出来是真树，这一格就跑去读真树的
//    `site/` 了（第一版的读数逐字是 `Site config not found: <真树>/templates/nextjs/site/brand.json`
//    —— 这棵树恰好没有 `site/` 才没造成后果，那是运气，不是判据）。`page-layouts` / `schemas` /
//    `blocks` 是相对 `rootDir` 读的，symlink 对它们是安全的。
console.log('── ⑦b 真跑一次 sync-config：带 topbar 区却没有 topbar 内容 ⟹ rc=1 且两条补救办法都在 stderr 上');
{
  const t = fs.mkdtempSync(path.join(os.tmpdir(), 'remediation-live-sync-'));
  try {
    // scripts 真拷（理由见上面那条 🔴：symlink 会让 __dirname 解到真树）
    require('child_process').execSync(`cp -a "${path.join(NEXTJS, 'scripts')}" "${path.join(t, 'scripts')}"`, { stdio: 'pipe' });
    // 这三块相对 rootDir 读，symlink 安全，也省掉整份拷贝
    for (const d of ['page-layouts', 'schemas', 'blocks']) {
      fs.symlinkSync(path.join(NEXTJS, d), path.join(t, d));
    }
    // 会被写的那两块：真目录（`src/lib/config-data.ts` 与 `public/theme.css` 落在这里）
    fs.mkdirSync(path.join(t, 'src', 'lib'), { recursive: true });
    fs.mkdirSync(path.join(t, 'public'), { recursive: true });
    // 🔴 `scripts/blocks.js` 会 `require('../src/lib/sections/block-roles.json')` —— require 闭包
    //    离开了 scripts/，所以这一块也得在。只拷它，不拷整个 src/（`src/` 里那份 config-data.ts
    //    是**产物**，拷进来只会让这一格读到别人上一次同步的字节）。
    require('child_process').execSync(
      `mkdir -p "${path.join(t, 'src', 'lib', 'sections')}" && `
      + `cp -a "${path.join(NEXTJS, 'src', 'lib', 'sections')}/." "${path.join(t, 'src', 'lib', 'sections')}/"`,
      { stdio: 'pipe' });
    const site = path.join(t, 'site');
    fs.mkdirSync(path.join(site, 'pages'), { recursive: true });
    const shade = (ks, v) => Object.fromEntries(ks.map((k) => [String(k), v]));
    const w = (rel, obj) => fs.writeFileSync(path.join(site, rel), JSON.stringify(obj, null, 2));
    w('page-layout.json', { layoutId: 'with-topbar' });     // ← 这个站要 topbar 区
    w('brand.json', {
      name: 'T', tagline: 't', logoIcon: 'shield-check',
      colors: { primary: shade([50, 100, 200, 300, 400, 500, 600, 700, 800, 900], '#0ea5e9'),
        accent: shade([50, 100, 200, 300, 400, 500, 600], '#f97316') },
      fonts: { heading: ['"Inter"', 'sans-serif'], body: ['"Inter"', 'sans-serif'], googleFontsUrl: '' },
      email: 'a@b.c', locations: [],
    });
    w('seo.json', { domain: 't.example', locale: 'en', metaTitle: 'T', metaDescription: 't', keywords: [] });
    fs.writeFileSync(path.join(site, 'services.json'), '[]');
    // 🔴 navigation.json 里**没有** topbar —— 这一格量的就是这个缺口
    w('navigation.json', { header: { links: [], cta: { label: 'Go', href: '/contact' } },
      footer: { columns: [], copyright: 'c' } });
    w('pages/home.json', { slug: 'home', title: 'Home', description: 'd', navLabel: 'Home', navOrder: 1,
      changeFrequency: 'weekly', priority: 1, blocks: [] });

    const r = require('child_process').spawnSync(process.execPath, [path.join(t, 'scripts', 'sync-config.js')],
      { cwd: t, encoding: 'utf-8', timeout: 120000 });
    const all = `${r.stdout || ''}\n${r.stderr || ''}`;
    r.status === 1
      ? ok(`⑦b 真跑：rc=1（带 topbar 区却没内容 ⟹ 拒绝，不是静默通过）`)
      : bad(`⑦b 真跑：rc=${r.status}，期望 1 —— 这个缺口没被拦住，或者夹具立不起来。输出末尾：`
        + `${all.trim().split('\n').slice(-3).join(' ⏎ ')}`);
    // 那句诊断
    /有 topbar 区，但这些语言的 navigation\.json 里没有 topbar 内容/.test(all)
      ? ok('⑦b 真跑：那句诊断在（点名是哪个缺口）')
      : bad('⑦b 真跑：那句诊断不在 —— 拒的可能是别的原因，这一格量的不是这条路');
    // 🔴 两条补救办法都要真的印出来。这才是 ⑦ 那种静态 grep 证不了的那一半。
    for (const [what, re] of [
      ['topbar 那条', /手改这个站仓里的 site\/navigation\.json/],
      ['换布局那条', /手改这个站仓里的 site\/page-layout\.json/],
    ]) {
      re.test(all)
        ? ok(`⑦b 真跑：${what}补救办法印出来了，而且路径是**从站仓根看**的（带 site/，#1134 item 34）`)
        : bad(`⑦b 真跑：${what}补救办法没印出来（或者路径少了 site/ 那一层）—— `
          + `字符串在源码里而这条调用走不到，正是 ⑦ 看不见的那种失效`);
    }
  } finally {
    try { fs.rmSync(t, { recursive: true, force: true }); } catch { /* 清不掉不该让这一格红 */ }
  }
}

// ── ⑨ 这里问出来的答案，必须跟【真编辑器】对同一条路径的答案相同（#1138）────────────────────────
//
// 🔴 为什么要有这一格。`editorCanWrite` 问的是白名单，而白名单的第二问是「这个文件在**这个站**上
//    有人读吗」—— 它要这个站的形状。形状问不到时那一维**不判**，也就是说：一个调用点忘了递形状，
//    它拿到的不是错误，是**另一道题的答案**。#1138 之前这条路碰巧不产生假建议（#1138 正文 N2 量过：
//    `howToAddTopbar` 问的路径形状本来就对、`howToChangePageLayout` 问的那个文件两种问法都拒）。
//    #1138 给白名单加了「这个语言这个站有没有」这一问之后就开始分歧了：站里只有 `en` 而这里问
//    `fr/navigation.json`，不递形状 ⟹ 这里说「在聊天里让 AI 编辑器加」，而真编辑器当场拒 ——
//    那句话就是 #1108 立这个模块要治的那个病（产品的报错在建议一个产品自己禁止的动作）。
//
// 🔴 判据是**行为**，不是「源码里有没有 readSiteShape 这个词」：下面拿真编辑器那套 ctx
//    （`edit-site.js:425-440` 递的那几个键）独立算一遍，两个答案必须逐条相同。
{
  const { writeRejection } = require('./editable-files.js');
  const { readSiteShape } = require('./site-shape.js');

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'remediation-locale-'));
  const siteDir = siteWithNav(dir, 'en');            // site_meta.json 只列 en
  // 一个**站里没有**的语言目录：升级/误写留下的残留。site_meta.json 不动 ⟹ 这个站仍然只有 en。
  fs.mkdirSync(path.join(siteDir, 'fr'), { recursive: true });
  fs.copyFileSync(path.join(siteDir, 'en', 'navigation.json'), path.join(siteDir, 'fr', 'navigation.json'));
  const shape = readSiteShape(siteDir);
  if (!shape || shape.flat !== false || shape.locales.join(',') !== 'en') {
    die(`⑨ 夹具不对：readSiteShape 读到 ${JSON.stringify(shape)}，要的是 {flat:false, locales:['en']}`);
  }

  /**
   * 真编辑器会怎么答同一条路径 —— ctx 按 `edit-site.js` 的 write_file 原样搭。
   * 🔴 送进去的内容必须跟 `howToAddTopbar` 送的那份**一样**（#1104 之后白名单判的是「这次写入改了
   *    哪几处」）：喂一份别的内容问出来的是另一道题的答案。所以这里照它的做法现搭一份。
   */
  const askRealEditor = (rel) => {
    const full = path.join(siteDir, rel);
    let current = null;
    try { current = JSON.parse(fs.readFileSync(full, 'utf-8')); } catch (e) { current = null; }
    const ctx = { readSiteShape: () => readSiteShape(siteDir) };
    if (current !== null) {
      ctx.content = JSON.stringify({ ...current, topbar: { message: '示例文案', link: { label: '示例', href: '/contact' } } });
      ctx.readCurrent = (p) => { try { return fs.readFileSync(path.join(siteDir, p), 'utf-8'); } catch (e) { return null; } };
    }
    return writeRejection(rel, ctx) === null;
  };

  /** 一组要对账的问题：这里怎么答（viaProduct） vs 真编辑器怎么答。 */
  const askHere = (mod2) => [
    ['en/navigation.json', mod2.howToAddTopbar({ siteDir, locale: 'en' }).viaProduct],
    ['fr/navigation.json', mod2.howToAddTopbar({ siteDir, locale: 'fr' }).viaProduct],
    ['page-layout.json', mod2.howToChangePageLayout({ rootDir: NEXTJS, siteDir }).viaProduct],
  ];

  const rows = askHere(mod).map(([rel, here]) => ({ rel, here, real: askRealEditor(rel) }));
  const mismatch = rows.filter((r) => r.here !== r.real);
  if (mismatch.length === 0) {
    ok(`⑨ ${rows.length} 条路径逐条对账，这里的答案与真编辑器相同（`
      + `${rows.map((r) => `${r.rel}=${r.here}`).join(' · ')}）`);
  } else {
    mismatch.forEach((r) => bad(`⑨ ${r.rel}：这里说 ${r.here}，真编辑器说 ${r.real}`
      + ' —— 那句话在建议一个真编辑器会拒的动作（#1108 要治的那个病）'));
  }

  // 🔴 这一格必须有量程：`fr` 那条得**真的**是真编辑器拒的（否则三条全 true，这一格就是空转的
  //    恒等式，把形状那一维整个拿掉也照样绿）。
  const frReal = rows.find((r) => r.rel === 'fr/navigation.json');
  const enReal = rows.find((r) => r.rel === 'en/navigation.json');
  if (frReal && enReal && frReal.real === false && enReal.real === true) {
    ok('⑨ 这组问题有区分力：同一个站上 en/navigation.json 真编辑器放行、fr/navigation.json 真编辑器拒');
  } else {
    bad(`⑨ 这组问题没有区分力（en=${enReal && enReal.real} · fr=${frReal && frReal.real}）`
      + ' ⟹ 上面那条对账是恒等式，换个夹具让两个答案分开');
  }

  // 🔴 阳性对照：把 `editorCanWrite` 里递形状那一步撤掉（改之前那个样子），上面那条对账必须**红**，
  //    而且红在 `fr/navigation.json` 上。少了这一格，对账那条绿也可能来自「这三条本来就一致」。
  {
    const t = fs.mkdtempSync(path.join(os.tmpdir(), 'remediation-noshape-'));
    require('child_process').execSync(`cp -a "${path.join(NEXTJS, 'scripts')}" "${path.join(t, 'scripts')}"`, { stdio: 'pipe' });
    const copyPath = path.join(t, 'scripts', 'lib', 'remediation.js');
    const src = fs.readFileSync(copyPath, 'utf-8');
    const ANCHOR = '  const ctx = { ...(extraCtx || {}), readSiteShape: () => readSiteShape(siteDir) };\n';
    const n = src.split(ANCHOR).length - 1;
    if (n !== 1) die(`⑨ 阳性对照的锚点在 remediation.js 里出现 ${n} 次（要求正好 1 次）`);
    fs.writeFileSync(copyPath, src.replace(ANCHOR, '  const ctx = { ...(extraCtx || {}) };\n'));
    // eslint-disable-next-line global-require
    const noShape = require(copyPath);
    const bad2 = askHere(noShape).filter(([rel, here]) => here !== askRealEditor(rel)).map(([rel]) => rel);
    fs.rmSync(t, { recursive: true, force: true });
    if (bad2.join(',') === 'fr/navigation.json') {
      ok('⑨ 阳性对照：撤掉递形状那一步，对账在 fr/navigation.json 上分歧 ⟹ 撑住上面那格的就是这一步');
    } else {
      bad(`⑨ 阳性对照失败：撤掉递形状那一步之后分歧的是 [${bad2.join(' · ')}]，期望正好是 fr/navigation.json`
        + ' —— 那上面那条对账证明不了「形状真的被递进去了」');
    }
  }
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
