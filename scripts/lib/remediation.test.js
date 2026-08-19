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
  fs.writeFileSync(path.join(dir, 'lib', 'editable-files.js'), editableFilesSrc);
  return dir;
}
/** 一个带 navigation.json 的假站。 */
function siteWithNav(dir, locale) {
  const d = locale ? path.join(dir, 'site', locale) : path.join(dir, 'site');   // locale=null ⟹ 扁平站
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'navigation.json'), JSON.stringify({
    header: { links: [{ label: 'Home', href: '/' }], cta: { label: 'Book', href: '/contact' } },
    footer: { description: 'd', columns: [{ title: 'Q', links: [] }], copyright: 'c' },
  }, null, 2));
  return path.join(dir, 'site');
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
  const many = ['en', 'zh', 'fr', 'es', 'de', 'it', 'pt', 'ja', 'ko', 'ru', 'ar', 'hi'];
  for (const loc of many) siteWithNav(dir, loc);
  const siteDir = path.join(dir, 'site');

  const lines = topbarBullets({ siteDir, locales: many });
  if (lines.length <= BULLET_CAP + 1) ok(`⑧ 12 个语言只打 ${lines.length} 行（上限 ${BULLET_CAP} + 1 行合并）`);
  else bad(`⑧ 12 个语言打了 ${lines.length} 行 —— 没有上限`);
  // 🔴 行为断言：topbarBullets 打出来的那句，必须就是 howToAddTopbar 对同一个语言的结论 ——
  //    这把「接线经过它」钉成行为，而不是靠 grep 一个函数名。
  {
    const direct = howToAddTopbar({ siteDir, locale: 'en' }).sentence;
    if (lines[0].includes(direct)) ok('⑧ 第一行就是 howToAddTopbar 对 en 的结论 ⟹ 这条链真的接着');
    else bad(`⑧ 第一行跟 howToAddTopbar 的结论不一样：\n    行=${lines[0]}\n    直调=${direct}`);
  }
  const tail = lines[lines.length - 1];
  if (/其余 8 个语言/.test(tail)) ok('⑧ 最后一行说清了其余 8 个语言同理');
  else bad(`⑧ 合并那行不对：${tail}`);

  // edit-site.js 真正的那把尺：整段 stderr 截 2000
  const SLICE = 2000;
  const layoutSentence = howToChangePageLayout({ rootDir: NEXTJS }).sentence;
  const assemble = (ls) => `page layout "with-topbar" 有 topbar 区，但这些语言的 navigation.json 里没有 topbar 内容：${many.join(', ')}\n`
    + ls.map((l) => `  · ${l}`).join('\n') + `\n  · 或者不要 topbar —— ${layoutSentence}`;
  const withCap = assemble(lines);
  if (withCap.length <= SLICE) {
    ok(`⑧ 12 个语言时整段 ${withCap.length} 字符 ≤ ${SLICE} ⟹ 老板看得到最后那条补救办法`);
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

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
