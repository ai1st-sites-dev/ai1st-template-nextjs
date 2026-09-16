import type { Metadata } from 'next';
import './globals.css';
import { brand, getSeo, getBrandName, defaultLocale, siteId, leadApi } from '@/lib/config';
import { RADIUS, SHADOW, DENSITY, BUTTON_SHAPE } from '@/lib/themeSettings';

const seo = getSeo(defaultLocale);
// TICKET-136: layout.tsx is a server component with no locale prop — use the
// default-locale brand name for the site-wide baseline metadata (per-page
// metadata builders in lib/metadata.ts already pass locale through).
const defaultBrandName = getBrandName(defaultLocale);

function buildFaviconSvg(): string {
  const letter = (defaultBrandName || 'X').charAt(0).toUpperCase();
  const bg = brand.colors.primary[500] || '#6366f1';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="${bg}"/><text x="16" y="23" text-anchor="middle" fill="white" font-family="system-ui,sans-serif" font-size="20" font-weight="bold">${letter}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// 🔴 #1002 —— `buildCssVariables()` 不在这里了。配色 / 字体族 / 风格设定以前是这个文件拼出来、
// 用一段 inline <style> 烤进每一页 HTML 的；现在它们住在 `/theme.css` 里（生成器是
// `scripts/theme-css.js`，由 `scripts/sync-config.js` 在每次构建时写出 `public/theme.css`）。
// 声明的内容和顺序逐字没变，所以搬家不改变任何一个 computed style。
//
// 为什么要搬：只要主题的值烤在 HTML 里，换一次主题就得重写每一页的 HTML —— 也就是必须重建。
// 搬进一个**文件名固定**的样式表之后，换主题就是替换那一个文件的内容，HTML 一个字节都不用动。
//
// 同一个理由带走了字体表的 <link>（`brand.fonts.googleFontsUrl`）：它的地址随主题变。它现在是
// theme.css 的第一行 `@import`。下面两条 preconnect 留着 —— 它们跟主题无关，永远是这两个地址。

// #925 — WHICH PARENT PAGE IS ALLOWED TO RECOLOUR THIS SITE.
//
// The dashboard's "change theme" modal previews a theme by postMessaging the palette into this
// page while it sits in the preview iframe. That listener must accept messages from our dashboard
// and from nobody else, so it needs to know our dashboard's origin at BUILD time — and a static
// export has exactly one channel for that: what sync-config.js bakes into config-data.ts.
//
// 🔴 We do not invent a new field for it: `leadApi` is already baked into every site (268b) and
// its value is `appBaseUrl` — the dashboard's own origin (`deploy/config/manager.*.json`:
// appdev.ai1st.site / app.ai1st.site / apptest.ai1st.site). So the trusted origin is that URL's
// origin, compared with `===`. No wildcard, no suffix matching, no `includes` — the pitfalls of a
// `*.ai1st.site` whitelist do not exist here because there is no pattern to get wrong.
//
// 📌 The cost of deriving it from leadApi rather than declaring it: if the API host is ever split
// off from the dashboard host, this origin stops matching and theme preview stops working. That
// direction is safe — the listener refuses the message, the dashboard's handshake times out, and
// the modal falls back to thumbnails ("applies after Apply"). It never trusts the wrong parent.
// 📌 Empty leadApi (local template dev) ⟹ no listener is emitted at all, same fail-closed end.
const previewTrustedOrigin = (() => {
  try {
    return leadApi ? new URL(leadApi).origin : '';
  } catch {
    return '';
  }
})();

// #925 — the inbound half of the iframe conversation. Kept as its own script tag: the outbound
// navigation script below is deliberately untouched (its `postMessage(…, "*")` is a known separate
// problem, #925 PM note D — fixing it is another ticket, and "it is already *" is not a reason to
// write this half loosely).
//
// Protocol (all four names namespaced `ai1st:theme-preview*`):
//   in  ai1st:theme-preview-ping   → answer, change nothing. Lets the modal find out whether this
//                                    build can preview at all before the owner clicks anything.
//   in  ai1st:theme-preview        → { theme: { colors: {primary,accent}, fontSans, fontHeading,
//                                                googleFontsUrl } }
//                                    paint it, then answer.
//   in  ai1st:theme-preview-reset  → drop the paint (Cancel), then answer.
//   out ai1st:theme-preview-ack    → the answer. Its ABSENCE within the modal's timeout is what
//                                    tells the modal this site was built before this code existed.
//
// #978 阶段 0 加了第二条通道，它自己的三个名字（`…-css*`）和自己的 ack：
//   in  ai1st:theme-preview-css-ping → answer, change nothing. 顺带把这一页有哪些 block 报上去。
//   in  ai1st:theme-preview-css      → { css: "<一段 CSS 文本>" } 注入它，然后答。
//   out ai1st:theme-preview-css-ack  → { blocks:[{type,role}…], ignored:[type…], refused:bool }
//   （清掉走的还是 `ai1st:theme-preview-reset` —— 一个 Cancel 收两条通道，不再多一个名字。）
//
// #1123 —— 试穿要连**画法**一起换，所以 `ai1st:theme-preview` 多认一个字段，并多一条出站消息：
//   in  ai1st:theme-preview          → 多一个 { sheet: "<主题 id>" }（可选）。有它就去取那套主题
//                                      自己的画法表，取到了就**顶掉** /theme.css；没有这个字段
//                                      （老 dashboard）行为逐字不变。
//   out ai1st:theme-preview-sheet    → { sheet, ok, reason } —— 取表这件事是异步的，答不进上面那个
//                                      同步的 ack 里，所以单独一条。它也是这条链唯一可等的信号。
//
// #1318 —— 几何搬去 public/shapes.css 之后，sheet 那条路只带得动**皮**了（表里已经没有排版）。
// 所以 ai1st:theme-preview 再多认一个字段：
//   in  ai1st:theme-preview          → 多一个 { shapes: { "<块类型>": "<画法名>", … } }（可选）。
//                                      收到就当场写到每个块根的 data-shape 上，/shapes.css 是无条件
//                                      加载的平台表，所以排版当场就换、不用重建。
//   🔴 它的答复走**已有的那条同步 ack**（ai1st:theme-preview-ack），不另开一条：换 data-shape 是
//      同步的 DOM 写入，没有 sheet 那条路的异步（那条要 fetch 一份表回来才知道成没成）。
//   🔴 没有这个字段（老 dashboard）就一个属性都不碰，行为逐字回到本票之前。
//   🔴 Cancel（ai1st:theme-preview-reset）把每个块根还原成它原来那个值 —— 原来没有这个属性的就把
//      属性摘掉，不是写一个空串：空串会让 [data-shape=""] 这种选择器有机会命中。
//
// 🔴 为什么必须是【新名字】而不是给 `ai1st:theme-preview` 加字段（PM 在 #978 r1 量的）：下面那个
// 监听器只对**不认识的类型**才不回话。沿用旧名字的话，老构建照样回 ack、弹窗以为版式预览成功了，
// 而屏幕上只有颜色变了 —— UI 在说假话。新名字让老构建自然不认识 ⟹ 弹窗等不到回话，诚实地说
// 「这个站要重建一次才能预览版式」。
//
// ── #978 版式那一半的四条理由（写在这里而不是脚本里面：脚本是个模板字符串，反引号进不去）──
//
// 🔴 ① 注入的 CSS 自带一行 `main{display:flex;flex-direction:column}`，不靠发的人记得带上。
// block 全在 `<main class="flex-1">` 里面（`SiteShell.tsx:46` 的 `case 'content'` —— #1000 之后外壳按
// 区渲染，而外壳区不带 `data-block`，所以「block 全在 main 里面」这条仍然成立），而它是普通块级容器 ⟹ `order` 对它的
// 子元素不生效。PM 在真产物上量过（1280×900、四个 block）：只注入 order，四个 y 坐标
// `0 · 740 · 1343 · 1799` 一个都没动；先补那一行再注入 ⟹ `2074 · 0 · 603 · 1059`。
// 另一种写法 `main{display:contents}` 同样有效（他两种都量了，都不改变原页面），但它把 main 的盒子整个
// 去掉、`flex-1` 跟着失效，内容很短的页面页脚可能不再被顶到底部 —— 能不去掉盒子就不去掉（作者定）。
// 四个页面入口（首页 / `[...slug]` / blog / blog 详情）全部经 `SiteShell`，补一次就够。
//
// 🔴 ② 「这个 essential 还看得见吗」判据是**它画不画得出盒子**（`getClientRects().length`），不是它自己的
// computed display。后者对「祖先被藏了」按构造失明：父元素 `display:none` 时，子元素自己的 computed
// display 仍然是 `block` —— 而藏掉整块 block 恰恰是最容易写出来的那种规则。
// （同一个洞在 `scripts/theme-css-invariants.mjs:150` 那条不变量里也在，那是 #991 的面，本票没碰。）
//
// 🔴 ③ 挡下隐藏 essential 的判据是**量出来的后果**（这条规则命中了那个元素或它的某个祖先），不是拿正则去
// 猜选择器长什么样。所以按角色写的 `[data-role="essential"]{display:none}`（契约 §3 点名的那一条）和按类型
// 写的 `[data-block="contact-info"]{display:none}`（契约没写、而这是发的人真会写的那种）一起被盖住。
// 摘的是我们自己那张表里的那条 display 声明，站点本来的样式一个字都不碰。
//
// 🔴 ④ 注入之前先量一次。本来就画不出盒子的那些（站点自己的响应式隐藏等）不是我们造成的，也不该报成
// 「我们挡下了一条规则」。少了这一臂，读数就从"我们让谁不见了"变成"注入之后谁不见了"。
//
// 📌 `st` 是**现在注入着的那份 CSS 的性质**（挡下了哪几块 / 是不是整份没要），每一次回话都带上它，ping
// 也带。发的人会反复 ping（它得知道预览框有没有换页、有没有重载），要是 ping 的回话把这两个数报成空的，
// 弹窗上那句提示会在下一次 ping 时自己消失，而那条被挡下的规则还在。
// 📌 摘不掉的那种（例如整块 block 被藏、而 essential 是它的子元素）⟹ 整份不要。essential 不许被藏是
// 硬的，「只生效一半」比「没生效」更难解释。
// 📌 脚本里一条注释都不留：它是内联进**每一个站的每一页**的字节。#925 那一半也是这个规矩。
//
// 🔴 #1084 —— 那段算字色的算术在这里【复制】了一份，而正本是 `scripts/lib/button-ink.js`。
// 为什么必须复制：这段脚本是内联进站产物里在**浏览器**跑的字节，它 require 不到任何东西；而 dashboard
// 与 templates/nextjs 是两个包，也没法共享一个模块。
// 为什么必须有这一份（不是「顺手也加上」）：不加，换装弹窗预览里的按钮仍是兜底的白字，而 Apply
// 之后站上是算出来的深字 —— 预览与构建就不是同一件事了。守着这条一致性的是
// `tests/e2e/specs/925-theme-preview-postmessage-contract.spec.ts`（它在真浏览器里对真 `next build`
// 的产物量 `--color-primary-*`：预览消息一到就换色、Cancel 原样还回去）。
// 📌 那份 spec 今天**量不到这三个变量**（它读的是 `--color-primary-500/700` / `--color-accent-500` /
//    `--font-sans` 四个）⟹ 它不会因为少了这一份而变红。所以这一份的理由不是「让那格绿」，是那格
//    描述的那件事本身；而钉住两份算术不分叉的是 `scripts/lib/button-ink.test.js` 第 ④ 格。
// 🔴 两份不许分叉，而管这件事的**不是**这条注释：`scripts/lib/button-ink.test.js` 把这段脚本从本文件
// 的源码里抠出来在 node 里跑，拿 110 套注册表配色逐套跟正本对答案。
// 🔴 #1084 r3 —— 轮廓按钮那一档要按**它真正被画在上面的那块底**选（正本 `button-ink.js` ③a/③b）。
// 构建时那一侧从主题表的字节里解；这里没有那份字节（预览换的是 `--color-*`，表还是页面上原来那张），
// 所以改成**从真 DOM 量**：`.services-list__item` 优先、其次 `.services-list`，取第一个真的画了底的
// （computed 是 `rgba(...,0)` 的不算 —— QA2 在真机上量到 `__item` 常常是透明的，拿透明去算出来的是
// 页面上不存在的配对）。页面上没有 services-list 时落回白底，而那时这个变量在这一页上不画任何东西。
// 🔴 量之前必须先把颜色那一半写进覆盖元素（见 `paint` 里那次中途 `s.textContent=`）：那块底本身就是
// `var(--color-primary-N)`，不先生效就会拿**上一套**配色的颜色去定这一套的档位。
// 📌 只认 6 位十六进制：上面那个颜色循环接受 3~8 位，而这段算术假定 6 位。认不出的形状**不产出**这三个
// 变量，于是页面落回 globals.css 里的兜底值 = 本票之前的行为，而不是产出一个错的字色。
// 🔴 这里的 `CR()` 判的是 **blended**：先把字色朝底色掺 0.06（= `theme-contrast.js` 的 `PAINT_BLEND`，
//    模拟抗锯齿），再算对比度。**不是**裸对比度 —— 两者在这批配色上差 0.2–0.33，够把一整格从合格翻成
//    不合格。那个 0.06 在这里是**抄来的字面值**（浏览器里 require 不到那个模块），钉住它不漂的同样是
//    `scripts/lib/button-ink.test.js` 第 ④ 格：它拿 110 套配色逐套跟正本对答案，正本改了尺而这里没改
//    的话，那一格当场红。
//
// 🔴 Why an override <style> element and not writing on document.documentElement.style: Cancel has
// to restore EXACTLY what the site had, and what it had is not always the registry's palette — an
// AI edit can change brand.json's colours. Emptying an override element restores the original
// `:root` block byte for byte, with no snapshot to get wrong. Same rule for the font: a second
// <link> that we add and remove, never the site's own one.
// 🔴 #1129 —— 这条通道送来的那段 CSS 是【换掉】这个站自己的 `/custom.css`，不是叠在它上面。
//
// Customize 面板发的就是 `scripts/tweaks.js` 的 `buildCustomCss()` 产物 —— 也就是 Apply 之后
// 会被写进 `site/custom.css` 并 `cp` 成 `out/custom.css` 的同一份字节（`worker/main.go` §processThemeTask
// 的 swap：Apply 不重建，就是换这一个文件）。所以要让「预览看到的 == Apply 之后页面上的」，
// 预览必须把页面上现有的那份 `/custom.css` 先【停掉】。
//
// 🔴 不停它的后果（#1129 重现步骤，两种站各实测过一次）：`buildCustomCss` 只为「算出来跟
// 主题不一样」的变量写行，把一组选择清回 Theme default 之后它返回空串 ⟹ 注入的 `<style>`
// 一行也不声明 ⟹ 压在下面的、上一次 Apply 烤出来的 `custom.css` 透上来 ⟹ 预览停在上一次
// 那个颜色，而 Apply 之后页面变成这个站自己的底色。
//
// 🔴 为什么是【停掉那张表】而不是【把基准值一起塞进来】（#1129 正文点名的那个「明显的修法」）：
// dashboard 手里是【今天】的注册表，而换过装的站页面上那组颜色来自它 repo 里【换主题那一天】
// 冻进去的 `site/theme.css`（`sync-config.js` §theme.css 来源 ①，逐字节拷，不重新生成）。两份实测
// 就是不一样的，所以塞今天的基准会在那批站上造出反方向的假话。停表不需要知道基准是什么：
// 页面自己的 `/theme.css` 就是那个基准，把压在它上面的那层拿走它自然透出来。
// 附带好处：字体那一组的 `@import`、以及将来 custom.css 里多出来的任何东西，都不用在这里枚举一遍。
//
// 🔴 失败方向：找不到那条 `<link>` 就什么都不停（= 本票之前的行为），不是「拿不准就把页面
// 扔到没样式」。而 #1002 之前建的站根本没有这条 link，也就没有那一层陈字节可透 ⟹ 它们本来就没病。
//
// 🔴 `refused` 那一支要把它【开回来】：那一支的意思是「你那段 CSS 我整份不要」，而整份不要就包括
// 不拿走这个站自己的微调。Cancel（`ai1st:theme-preview-reset`）同理。
//
// 🔴 #1129 —— 停掉那张表之后，注入的这一段必须自己带上字体表的 `@import`，而 CSS 规定 `@import`
// 只能出现在样式表**最前面** —— 排在 `main{…}` 后面浏览器整条丢掉。所以 `MAIN_FLEX` 不再无条件拼在
// 最前，改成拼在开头那几行 `@import`（和空行）之后。
//
// 🔴 这不是顺手加的一条：**不加它，本票的修法会在另一维上造出同一个病。** 实测（探针在真产物上量，
// 站 b 的 landed = palette+corners+fonts 三组都选着）：注入的那张表里 `CSSImportRule` **0 条**，
// 两条规则都是 `CSSStyleRule`。改动之前这不显形，因为页面自己那份 `custom.css` 里有同一条 `@import`、
// 而它是好的；停掉那张表之后那条也没了 ⟹ 只改配色（字体那一组原样留着）时，预览会退回兜底字体，
// 而 Apply 之后站上是那对字体。判据用「这一页声明了哪些 @import 地址」，preview 与 Apply 两侧取一次比。
// 📌 边界：只搬**开头连续那几行**。`buildCustomCss` 产出的 `@import` 恒在第一行（那个函数的注释里
// 写着它必须在最前），所以这条对我们自己的产物是完全的；夹在中间的 `@import` 照旧被丢掉 —— 那是
// CSS 自己的规则，不是这里该纠正的事。
//
// 📌 射程说在明处：Apply 与换主题都【不重建】（#1002），所以已经存在的站，页面里内联的还是旧脚本
// —— 它们要到下一次**真构建**（内容编辑 / 部署）才拿到这一份。这与 #978 / #1002 / #1084 每一次
// 改这段脚本时一样。判据（拿一个站的产物问一句，回 1 就是新的）：
//   curl -s <站的预览地址>/ | grep -c "u.pathname==='/custom.css'"
// 面板要不要在「这个站还是旧脚本」时改口说一句，是**用户可见文案**、且要给 ack 加一个能力位 ——
// 那是本票 scope 之外的一件事，留在票上交作者定夺（#1129 交接留言里那条）。
// 🔴 下面这一整段是一个**模板字面量**（一直到 §`})();`;` 那一行）。里面一个反引号都不许出现，
//    注释里也不许 —— 一个反引号就把这个字符串在那儿截断，之后的文字变成 TypeScript 代码，
//    `next build` 当场报 `Expected ';', got 'ident'`。引用标识符请用「」。
//    #1351 r3 在这里踩过一次：注释里写了 `data-role` 这样的反引号，站的构建整个红掉，
//    而 tsc（只看 dashboard）、npm run test:scripts、以及那份从源文件里抠字节的 Playwright
//    spec 三样都看不见它 —— 唯一会红的是 `npm run build` 和 CI 的 region-layouts / theme-css。
function buildThemePreviewScript(trustedOrigin: string): string {
  return `(function(){
if(window.parent===window)return;
var T=${JSON.stringify(trustedOrigin)};
var s=null,f=null,c=null,ow=null,owq=false,h=null,hSeq=0;
// #1318 —— 试穿期间每个块根原来的 data-shape（没有就记 null），Cancel 按它还原。
var shapeWas=null;
// #1123 r2 —— 上一次 paint() 有没有把【风格设定那 15 个变量】全都补齐。paintSheet 停用
// /theme.css 的前置条件就是它（理由写在 sheetEl 上面那段和 paint 里）。默认 false：
// 没 paint 过就来一条只带 sheet 的消息时，失败方向是「画法不换」，不是「页面掉一半变量」。
var setFull=false;
function els(){
  if(!s){s=document.createElement('style');s.id='ai1st-theme-preview';document.head.appendChild(s);}
  if(!f){f=document.createElement('link');f.id='ai1st-theme-preview-font';f.rel='stylesheet';document.head.appendChild(f);}
}
function cssEl(){
  if(!c){c=document.createElement('style');c.id='ai1st-theme-preview-css';document.head.appendChild(c);}
  return c;
}
function ownCss(){
  if(owq){return ow;}
  owq=true;
  var ls=document.querySelectorAll('link[rel="stylesheet"]'),i,u;
  for(i=0;i<ls.length;i++){
    try{u=new URL(ls[i].href,document.baseURI);}catch(e){continue;}
    if(u.pathname==='/custom.css'){ow=ls[i];break;}
  }
  return ow;
}
function ownCssOff(off){var l=ownCss();if(l){l.disabled=!!off;}}
// ── #1123 —— 试穿那套主题【自己的画法表】，而且是【顶掉】不是【叠加】 ─────────────────────────
//
// 🔴 为什么不能沿用上面那个 cssEl()：它是 appendChild，也就是**叠加**。后来的样式表只压得过它自己
// 声明了的属性，A 表声明了而 B 表没声明的原样留在页面上。PM 在 #1123 上量过 83 份表：每份 996–1308
// 条声明，并集 1835、交集 693，**83/83 份都小于并集** ⟹ 把 B 叠在 A 上得到的是 A ∪ B，那个东西
// 不属于任何一套主题。而本票的 AC2 要的正是「试穿所见 = Apply 所得」。
//
// 🔴 所以 /theme.css 那条 <link> 在试穿期间被 disabled，画法由这一份顶上。而停用它是有代价的：
// theme.css 的 「:root」 里除了配色和两个字体变量，还有**风格设定那 15 个**（--radius-* 5 个 ·
// --shadow-* 4 个 · --section-* 5 个 · --radius-button）。停掉之后这些得有人补，否则它们落回
// globals.css 的平台默认值 —— 那是一个**不属于任何一套主题**的样子。
//
// 🔴 r1 这里写的是「paint() 产出的是完整的一组…所以停掉也没事」。**那句话是假的，QA1 量出来了**：
// paint() 的档位分支只认字符串档位名，而池里 80 套主题的 settings 是数值 ⟹ 15 个里只出得来
// --radius-button 一个，页头 logo 的圆角因此变成 globals.css 的 8px（试穿那套是 44px、站自己那套
// 是 20px）。r2 的修法有两半：① paint() 改成吃平台用 settingsToCssVars 算好的那份（见那边）；
// ② **这里不再靠一句注释，而是靠一个前置条件**：paint() 把「15 个补齐了吗」记在 setFull 上，
// 下面 paintSheet 只有在它为 true 时才 disabled /theme.css。
//
// ⟹ 两条失败路径都指向同一个方向：**取不到表**或**补不齐那 15 个变量**，都不停用 /theme.css，
// 结果是「画法没换」，不是「页面掉一半变量」。字体表由那个 <link id=ai1st-theme-preview-font> 顶上。
//
// 🔴 插在 /custom.css 【之前】，不是 head 末尾：Apply 之后真实的层序是
// base.css → theme.css → custom.css，微调排最后所以它赢。插在末尾的话画法表会反过来压掉微调 ——
// 那就又不等于 Apply 了。📌 说在明处：「:root」 那一半（上面那个 s）**仍然**在 custom.css 之后，
// 那是 #1067 就有的既有代价（标 Current 的卡因此干脆不发消息），本票不动它。
function sheetEl(){
  if(!h){
    h=document.createElement('style');h.id='ai1st-theme-preview-sheet';
    var cu=document.querySelector('link[rel="stylesheet"][href="/custom.css"]');
    if(cu&&cu.parentNode){cu.parentNode.insertBefore(h,cu);}else{document.head.appendChild(h);}
  }
  return h;
}
function siteSheetLink(){return document.querySelector('link[rel="stylesheet"][href="/theme.css"]');}
function dropSheet(){
  if(h){h.textContent='';}
  var l=siteSheetLink();if(l){l.disabled=false;}
}
// id 只认 slug —— 它会被拼进一个路径。判据与 scripts/theme-sheet.js 的 SHEET_NAME_OK 同形。
var SHEET_ID_OK=/^[a-z0-9][a-z0-9-]*$/;
// 🔴 **每一条结局都要么换掉表、要么把表撤干净** —— 这是「有表的 A → 没表的退役 R」那条路唯一的
// 保险。少了撤的那一支，页面会停在 A 的画法 + R 的颜色上：一个不属于任何一套主题的组合，比不改还错。
// 📌 撤这件事放在**结局**里，不放在开头：放开头的话每次成功切换都会有一段「没有画法表」的白板期
//    （先撤、再等 fetch、再贴）。放结局 ⟹ 只有取不到表的那次会短暂留着上一套的画法，而它随即被撤掉。
function paintSheet(id){
  var seq=++hSeq;
  var name=typeof id==='string'?id:'';
  if(!name||!SHEET_ID_OK.test(name)){dropSheet();tell(seq,name,false,'not an id');return;}
  if(typeof fetch!=='function'){dropSheet();tell(seq,name,false,'no fetch');return;}
  fetch('/themes/'+name+'.css',{cache:'force-cache'}).then(function(r){
    if(!r.ok)throw new Error('HTTP '+r.status);
    return r.text();
  }).then(function(text){
    // 🔴 回来晚的那一份丢掉，而且【什么都不做】。连点两张卡时两次 fetch 可以乱序返回，而页面最终
    // 该是后点那张 —— 先到先贴的话最终样子由网络快慢决定，那正是这种缺陷最难复现的形态。
    if(seq!==hSeq)return;
    if(!text){dropSheet();tell(seq,name,false,'empty');return;}
    // 🔴 #1123 r2 —— 停用 /theme.css 的前置条件：paint() 这一轮把风格设定那 15 个变量补齐了。
    // 补不齐就【不停用】，也不贴表 —— 贴了表而不停用 /theme.css 会得到 A ∪ B（sheetEl 上面那段
    // 量过 83 份表：并集 1835、83/83 份都小于它），那个东西不属于任何一套主题，比不换更错。
    if(!setFull){dropSheet();tell(seq,name,false,'settings incomplete');return;}
    sheetEl().textContent=text;
    var l=siteSheetLink();if(l){l.disabled=true;}
    tell(seq,name,true,'');
  })['catch'](function(err){
    if(seq!==hSeq)return;
    dropSheet();
    tell(seq,name,false,String((err&&err.message)||err));
  });
}
// ── #1318 —— 画法：当场改 data-shape ─────────────────────────────────────────────────────────────
//
// 🔴 这段注释里不许出现反引号 —— 它住在 buildThemePreviewScript 那个模板字符串里面，一个反引号
//    就把模板提前收尾，整个文件语法错、next build 当场死（同族坑见下面 #1129 那段）。
//
// 🔴 **只写属性，不注 CSS。** /shapes.css 是平台表、无条件加载（layout 里那条 link 上写了理由），
//    这个站的产物里已经有全部 50 个 (block, shape) 对的规则 ⟹ 换一个属性值就是换一副排版，
//    不用 fetch、不用重建。这也是它跟 paintSheet（要去取另一套主题的表回来）不同形的原因。
//
// 🔴 **第一次试穿时把原值整批记下来，之后每次试穿都从【原值】起算，不从上一次试穿的结果起算。**
//    从上一次起算的话，连点两张卡之后 Cancel 会还原到中间那一套 —— 而中间那一套不属于任何一次
//    用户操作。记的是 null（本来就没有这个属性）还是字符串，两种都要能还原。
//
// 🔴 值要过一遍形状判据再进 DOM（跟 SHEET_ID_OK 同形，理由也一样：它会被拼进选择器去匹配）。
//    选择单里没有这个块、或者值不合形状 ⟹ **把属性摘掉**，让这个块落回 base.css 的地板 ——
//    跟「写一个查不到的画法名」相比，摘掉是能看出来的，而写一个假名字是静默塌陷。
var SHAPE_OK=/^[a-z0-9][a-z0-9-]*$/;
function shapeRoots(){return document.querySelectorAll('[data-block]');}
function rememberShapes(){
  if(shapeWas)return;
  shapeWas=[];
  var ns=shapeRoots(),i;
  for(i=0;i<ns.length;i++){shapeWas.push([ns[i],ns[i].getAttribute('data-shape')]);}
}
function restoreShapes(){
  if(!shapeWas)return;
  var i;
  for(i=0;i<shapeWas.length;i++){
    if(shapeWas[i][1]===null){shapeWas[i][0].removeAttribute('data-shape');}
    else{shapeWas[i][0].setAttribute('data-shape',shapeWas[i][1]);}
  }
  shapeWas=null;
}
function paintShapes(map){
  if(!map||typeof map!=='object'){restoreShapes();return;}
  rememberShapes();
  var ns=shapeRoots(),i,t,v;
  for(i=0;i<ns.length;i++){
    t=ns[i].getAttribute('data-block');
    v=Object.prototype.hasOwnProperty.call(map,t)?map[t]:null;
    if(typeof v==='string'&&SHAPE_OK.test(v)){ns[i].setAttribute('data-shape',v);}
    else{ns[i].removeAttribute('data-shape');}
  }
}
function tell(seq,name,ok,reason){
  if(seq!==hSeq)return;
  try{window.parent.postMessage({type:'ai1st:theme-preview-sheet',sheet:name,ok:ok,reason:reason},T);}catch(err){}
}
function paint(t){
  els();
  var out=[],g=['primary','accent'],i,k,sh;
  for(i=0;i<g.length;i++){
    sh=(t&&t.colors&&t.colors[g[i]])||{};
    for(k in sh){
      if(Object.prototype.hasOwnProperty.call(sh,k)&&/^[0-9]{2,3}$/.test(k)&&typeof sh[k]==='string'&&/^#[0-9a-fA-F]{3,8}$/.test(sh[k])){
        out.push('--color-'+g[i]+'-'+k+':'+sh[k]+';');
      }
    }
  }
  // #1084 r3 —— 先把颜色那一半贴上去再往下走。下面算轮廓按钮那一档要**从真 DOM 量它坐着的那块底**，
  // 而那块底自己就是 var(--color-primary-N)：不先让被预览的这套配色生效，量到的是上一套的颜色。
  s.textContent=out.length?(':root{'+out.join('')+'}'):'';
  var pk=(t&&t.colors&&t.colors.primary)||{},p5=pk['500'];
  if(typeof p5==='string'&&/^#[0-9a-fA-F]{6}$/.test(p5)){
    var BY=function(h){return [1,3,5].map(function(j){return parseInt(h.substr(j,2),16);});};
    var LU=function(r){var v=r.map(function(b){var c=b/255;return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4);});return 0.2126*v[0]+0.7152*v[1]+0.0722*v[2];};
    var CR=function(ih,gh){var i=BY(ih),g=BY(gh),p=i.map(function(v,k){return Math.round(v+(g[k]-v)*0.06);}),x=LU(p),y=LU(g);return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05);};
    var ok=function(h){return typeof h==='string'&&/^#[0-9a-fA-F]{6}$/.test(h);};
    var inkOn=function(h){return CR('#ffffff',h)>=4.5?'#ffffff':(CR('#000000',h)>=4.5?'#000000':'');};
    // #1091 —— 先选底（500 起朝深，取第一个「压在它上面的那个字色」过线的档），再按那块底选字。
    var BL=['500','600','700','800','900'],bs='',q;
    for(q=0;q<BL.length;q++){if(ok(pk[BL[q]])&&inkOn(pk[BL[q]])){bs=BL[q];break;}}
    if(!bs){bs='500';}
    var ink=inkOn(pk[bs])||'#ffffff';
    // #1091 —— hover 从 base 的下一档起朝远离字色的方向走；base 自己永远不在候选里（AC3：两者不同色）。
    // #1100 —— 方向按【亮度】判，不按「跟纯黑相等」判：门限是白与纯黑给出相同对比度的那个亮度
    //          （正本 button-ink.js 的 INK_DARK_BELOW）。纯黑/纯白的答案与上一版逐字相同，而
    //          gray-900(#111827) 这种深字上一版会判反 —— accent 按钮的字就是它。
    // #1100 —— 而这一段现在是个函数：primary 和 accent 两个按钮走同一把梯子，写两遍必然分叉。
    var DK=function(h){return LU(BY(h))<Math.sqrt(0.05*1.05)-0.05;};
    var HOV=function(pp,ik,bb){
      var ns=Object.keys(pp).filter(function(k){return /^[0-9]{2,3}$/.test(k)&&ok(pp[k]);}),
          d=DK(ik),bn2=Number(bb),z,
          by=ns.filter(function(k){return d?Number(k)<bn2:Number(k)>bn2;})
               .sort(function(a,b){return d?Number(b)-Number(a):Number(a)-Number(b);}),
          ot=ns.filter(function(k){return d?Number(k)>bn2:Number(k)<bn2;})
               .sort(function(a,b){return d?Number(a)-Number(b):Number(b)-Number(a);});
      for(z=0;z<by.length;z++){if(CR(ik,pp[by[z]])>=4.5){return by[z];}}
      return by.length?by[0]:(ot.length?ot[0]:bb);
    };
    var hv=HOV(pk,ink,bs),ol='';
    // #1100 —— accent 按钮 hover 那一档：同一把梯子，字是 globals.css 写死的 text-gray-900，
    //          起点是它的静止态 bg-accent-400。accent 那一组解不出来时不产出这个变量（页面落回兜底）。
    var ak=(t&&t.colors&&t.colors.accent)||{},ah=ok(ak['400'])?HOV(ak,'#111827','400'):'';
    var gnd='#ffffff',sel=['.services-list__item','.services-list'],el,mm;
    for(q=0;q<sel.length;q++){
      try{el=document.querySelector(sel[q]);}catch(e){el=null;}
      if(!el){continue;}
      mm=String((getComputedStyle(el)||{}).backgroundColor||'').match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([0-9.]+))?\)/);
      if(mm&&(mm[4]===undefined||parseFloat(mm[4])>0)){gnd='#'+[1,2,3].map(function(z){return ('0'+Number(mm[z]).toString(16)).slice(-2);}).join('');break;}
    }
    var OL=['500','600','400','700','300','800','200','900','100','50'];
    for(q=0;q<OL.length;q++){if(ok(pk[OL[q]])&&CR(pk[OL[q]],gnd)>=4.5){ol=OL[q];break;}}
    if(!ol){ol='500';}
    out.push('--btn-primary-bg:var(--color-primary-'+bs+');');
    out.push('--btn-primary-ink:'+ink+';');
    if(hv){out.push('--btn-primary-hover:var(--color-primary-'+hv+');');}
    if(ol){out.push('--btn-outline-ink:var(--color-primary-'+ol+');');}
    if(ah){out.push('--btn-accent-hover:var(--color-accent-'+ah+');');}
  }
  if(t&&typeof t.fontSans==='string'&&!/[;{}<>]/.test(t.fontSans)){out.push('--font-sans:'+t.fontSans+';');}
  if(t&&typeof t.fontHeading==='string'&&!/[;{}<>]/.test(t.fontHeading)){out.push('--font-heading:'+t.fontHeading+';');}
  // #961 — 风格设定的四组。校验方式比颜色和字体那几条更严：这里【不接受任意字符串】，
  // 只认 S 这张表里的档位名 / 只认 S 派生出来的变量名，值要么来自表本身、要么过一道字符白名单
  // ⟹ 拼进 <style> 的字符永远在我们自己的字符集里。
  // S 是构建时从 src/lib/themeSettings.ts 原样塞进来的同一张表，所以预览和构建不会对不上。
  var S=${JSON.stringify({ radius: RADIUS, shadow: SHADOW, density: DENSITY, buttonShape: BUTTON_SHAPE })};
  var grp=[['radius','--radius-'],['shadow','--shadow-'],['density','--section-']];
  // ── #1123 r2 —— 这 15 个变量名是【派生】出来的，不是手打的清单 ────────────────────────────
  // 数值形状与档位形状产出的变量名逐个相同（scripts/theme-settings.js 的头注写着这条契约，
  // 实测 110 套主题产出的 15 个名字与这里派生出来的集合完全一致）。派生 ⟹ 表里加一档时这里跟着走。
  var SETN={},t0,vs0;
  for(i=0;i<grp.length;i++){
    var tb0=S[grp[i][0]];
    for(t0 in tb0){
      if(!Object.prototype.hasOwnProperty.call(tb0,t0)){continue;}
      vs0=tb0[t0];
      for(k in vs0){if(Object.prototype.hasOwnProperty.call(vs0,k)){SETN[grp[i][1]+k]=1;}}
    }
  }
  SETN['--radius-button']=1;
  var SETN_N=0;for(k in SETN){if(Object.prototype.hasOwnProperty.call(SETN,k)){SETN_N++;}}
  // 值的字符白名单。数值形状产出的最复杂的一条是
  //   --shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.14), 0 4px 6px -4px rgb(0 0 0 / 0.14);
  // 这个集合放得下它，也放得下档位表里的 rem/px/9999px；分号、花括号、尖括号、引号、反斜杠一个都不收。
  var SETV=/^[a-zA-Z0-9 .,%#()\/-]+$/;
  // ── #1123 r2 —— 风格设定由【平台算好发过来】，站这边只校验、不重算 ──────────────────────────
  //
  // 🔴 为什么改成这样（QA1 在 #1123 第 1 轮量出来的）：下面那个 grp 循环只认**档位名字符串**
  // （'subtle'/'sharp'/'round' 这种），而池里 80 套主题的 settings 是**数值**
  // （{radius:22, density:1.2, shadowStrength:0.1, buttonShape:'pill'}）⟹ 三个分支一个都不进，
  // 15 个变量里只出得来 --radius-button 那一个。而 paintSheet 会把 /theme.css 停掉，
  // 于是另外 14 个落回 globals.css 的平台默认值 —— 实测页头 logo 的圆角变成 8px，
  // 既不是试穿那套的 44px、也不是这个站自己那套的 20px，**不属于任何一套主题**。
  //
  // 🔴 翻译器只有一份：scripts/theme-settings.js 的 settingsToCssVars（两种形状都吃，判据是
  // radius 是不是数字）。dashboard 已经把**那一份**送进浏览器了（vite 的 ai1st-tweaks-engine 垫片，
  // CustomizeModal 用的就是它）⟹ 这里不重写一遍公式：重写一遍就是第二份真相，而它分叉时两边都不会红。
  // 站这边做的是**校验**：名字必须在上面派生出来的集合里，值必须过字符白名单。
  var sc=t&&t.settingsCss,scN=0;
  if(Object.prototype.toString.call(sc)==='[object Array]'){
    for(i=0;i<sc.length;i++){
      var dec=typeof sc[i]==='string'?sc[i]:'',ci=dec.indexOf(':');
      if(ci<1){continue;}
      var nm=dec.slice(0,ci).replace(/^\s+|\s+$/g,''),vl=dec.slice(ci+1).replace(/;\s*$/,'').replace(/^\s+|\s+$/g,'');
      if(!Object.prototype.hasOwnProperty.call(SETN,nm)){continue;}
      if(!vl||!SETV.test(vl)){continue;}
      out.push(nm+':'+vl+';');
      scN++;
    }
  }
  // 老 dashboard（不发 settingsCss）落回档位名那条路 —— 那 30 套退役主题走的就是它，
  // 而它们本来也没有画法表 ⟹ /theme.css 不会被停用，这条路的读数与本票之前逐字相同。
  if(!scN){
    for(i=0;i<grp.length;i++){
      var tok=t&&t[grp[i][0]],tbl=S[grp[i][0]];
      if(typeof tok==='string'&&Object.prototype.hasOwnProperty.call(tbl,tok)){
        var vs=tbl[tok];
        for(k in vs){if(Object.prototype.hasOwnProperty.call(vs,k)){out.push(grp[i][1]+k+':'+vs[k]+';');scN++;}}
      }
    }
    if(t&&typeof t.buttonShape==='string'&&Object.prototype.hasOwnProperty.call(S.buttonShape,t.buttonShape)){
      out.push('--radius-button:'+S.buttonShape[t.buttonShape]+';');scN++;
    }
  }
  // 🔴 这个数是 paintSheet 停不停用 /theme.css 的**前置条件**，见那边那段。
  setFull=(scN>=SETN_N);
  s.textContent=out.length?(':root{'+out.join('')+'}'):'';
  if(t&&typeof t.googleFontsUrl==='string'&&/^https:\\/\\/fonts\\.googleapis\\.com\\//.test(t.googleFontsUrl)){f.href=t.googleFontsUrl;}
  else{f.removeAttribute('href');}
}
// 🔴 #1129 + #1123 合并形态：这一行上【两张票各自的撤回动作都要在】。Cancel 是两条预览通道
// 共用的一个名字（ai1st:theme-preview-reset），而两张票各自停用了页面上的一张表 ——
// #1123 停 /theme.css（画法），#1129 停 /custom.css（微调）。少了任一个 ownCssOff/dropSheet，
// Cancel 之后页面就停在「少一层样式」的状态上，而那两个元素互不相干（两次 disabled=false 各管一个），
// 所以这里的先后无所谓。没被用过的那条通道上它是 no-op（h 为 null / 那张表本来就没被停）。
// 🔴 这段注释里不许出现反引号：它住在 buildThemePreviewScript 那个**模板字符串**里面，一个反引号
// 就把模板提前收尾 ⟹ 整个文件语法错、next build 当场死。我第一版就是这么红的（同族坑见上面 #1129
// 那段里 hoistImports 的 split 那一处）。
function clear(){if(s){s.textContent='';}if(f){f.removeAttribute('href');}if(c){c.textContent='';}hSeq++;dropSheet();restoreShapes();ownCssOff(false);st={ignored:[],refused:false};}
var MAIN_FLEX='main{display:flex;flex-direction:column}';
var st={ignored:[],refused:false};
function blockList(){
  var out=[],ns=document.querySelectorAll('[data-block]'),i;
  for(i=0;i<ns.length;i++){out.push({type:ns[i].getAttribute('data-block'),role:ns[i].getAttribute('data-role')||''});}
  return out;
}
function unseen(){
  var out=[],ns=document.querySelectorAll('[data-role="essential"]'),i;
  for(i=0;i<ns.length;i++){if(ns[i].getClientRects().length===0){out.push(ns[i]);}}
  return out;
}
function nameOf(el){
  var n=el;
  while(n&&n!==document.body){if(n.getAttribute&&n.getAttribute('data-block')){return n.getAttribute('data-block');}n=n.parentNode;}
  return '?';
}
function chainMatches(el,sel){
  var n=el;
  while(n&&n.nodeType===1){try{if(n.matches(sel))return true;}catch(err){return false;}if(n===document.body)break;n=n.parentNode;}
  return false;
}
function unhide(els){
  var names=[],sheet=c&&c.sheet;
  if(!sheet)return names;
  function scan(rules){
    for(var j=0;j<rules.length;j++){
      var r=rules[j];
      if(r.cssRules&&r.cssRules.length){scan(r.cssRules);continue;}
      if(!r.selectorText||!r.style)continue;
      if((r.style.getPropertyValue('display')||'').replace(/\\s/g,'')!=='none')continue;
      for(var k=0;k<els.length;k++){
        if(chainMatches(els[k],r.selectorText)){
          r.style.removeProperty('display');
          var nm=nameOf(els[k]);
          if(names.indexOf(nm)<0)names.push(nm);
        }
      }
    }
  }
  scan(sheet.cssRules);
  return names;
}
function hoistImports(text){
  var ls=String(text).split('\\n'),n=0;
  while(n<ls.length&&/^\\s*(@import\\b|$)/.test(ls[n])){n++;}
  var head=ls.slice(0,n).join('\\n');
  return (head?head+'\\n':'')+MAIN_FLEX+'\\n'+ls.slice(n).join('\\n');
}
function paintCss(text){
  var el=cssEl(),i,k,newly=[],now,still=[],before;
  ownCssOff(true);
  before=unseen();
  el.textContent=hoistImports(text);
  now=unseen();
  for(i=0;i<now.length;i++){if(before.indexOf(now[i])<0){newly.push(now[i]);}}
  if(newly.length===0){st={ignored:[],refused:false};return;}
  var ignored=unhide(newly);
  now=unseen();
  for(i=0;i<now.length;i++){if(before.indexOf(now[i])<0){still.push(nameOf(now[i]));}}
  if(still.length){
    el.textContent='';
    ownCssOff(false);
    for(k=0;k<still.length;k++){if(ignored.indexOf(still[k])<0)ignored.push(still[k]);}
    st={ignored:ignored,refused:true};
    return;
  }
  st={ignored:ignored,refused:false};
}
// ── #1349 —— 点选检查器的站侧那一半 ────────────────────────────────────────────────────────────
//
// 契约（消息名、字段、方向）写在 docs/reference/block-preview-messages.md，那份文档跟这段代码是
// 同一次改动 —— 面板那一侧照它写，后面三张票（形态下拉 / 显隐排序 / 文字直改）只往上加消息。
//
// 🔴 它住在 buildThemePreviewScript 里面，所以自动继承了本脚本第一行那个 window.parent===window
// 早退 —— 这正是 AC4 要的那条性质：直接打开的站（真实访客）连这段代码都不会执行，点块没有任何反应、
// 不加类、一条 postMessage 都不发。写成一段独立的 script 标签就得把那个早退再抄一遍，而抄漏的方向
// 是静默的（访客点一下自己的网站，页面上出现一个蓝框）。
//
// 🔴 D4 那条「形态零 JS」不管这一段：它是**预览通道**，不是块的画法。真实访客拿到的页面里，块怎么
// 排仍然全部由 public/shapes.css 决定，这段代码在那儿从不执行。
//
// 🔴 编辑模式是【面板说了算】，不是这边自己开。默认关，收到 ai1st:block-mode 才开。理由是关着的时候
// 这段代码必须对预览**一点影响都没有** —— 老板在预览里点导航、点 FAQ、填表单都是真要发生的事，而开着
// 的时候每一次 click 都被 preventDefault 掉（见 onClick 那段）。两种行为差得这么远，不能由这边猜。
var bOn=false,bSel=null,bStyle=null;
function bCss(){
  if(bStyle)return bStyle;
  bStyle=document.createElement('style');
  bStyle.id='ai1st-block-inspect';
  // 🔴 outline 而不是 border/box-shadow：outline 不占盒子、不参与布局 ⟹ 开编辑模式不会把页面推歪，
  // 而「点一下预览，版面跳一下」正是老板会当成 bug 报上来的那种事。outline-offset 取负数让框画在
  // 块里面，免得相邻两块的框叠在一起。
  bStyle.textContent='[data-block].ai1st-blk-hi{outline:3px solid #2563eb;outline-offset:-3px}'
    +'[data-block].ai1st-blk-hover{outline:2px dashed rgba(37,99,235,.6);outline-offset:-2px}';
  document.head.appendChild(bStyle);
  return bStyle;
}
function bRootOf(el){
  var n=el;
  while(n&&n.nodeType===1){
    if(n.getAttribute&&n.getAttribute('data-block')!==null)return n;
    if(n===document.body)break;
    n=n.parentNode;
  }
  return null;
}
function bById(id){
  var ns=document.querySelectorAll('[data-block]'),i;
  for(i=0;i<ns.length;i++){if(ns[i].getAttribute('data-block-id')===id)return ns[i];}
  return null;
}
function bPaint(el){
  var ns=document.querySelectorAll('[data-block]'),i;
  for(i=0;i<ns.length;i++){ns[i].className=String(ns[i].className||'').split(' ')
    .filter(function(x){return x&&x!=='ai1st-blk-hi'&&x!=='ai1st-blk-hover';}).join(' ');}
  bSel=el||null;
  if(el){bCss();el.className=(el.className?el.className+' ':'')+'ai1st-blk-hi';}
}
// 一个块「说了什么」—— 面板右侧那三行读的就是它。
// 🔴 消息信封那个 type 字段是九条既有消息定下来的形状（layout.tsx 从 #925 起就是它），所以**块的
// 类型不能也叫 type**。它叫 block，跟它在 DOM 上的属性名 data-block 一样 —— 票正文把两者都写成
// type，那个形状在一个对象里落不下来。
// 🔴 id 为 null = 「现在什么都没选中」。另起一条 -deselected 消息也行，但面板那边就要把两种消息
// 合成同一个状态，而漏接一条的方向是静默的（面板停在上一次选中的块上）。
function bInfo(el){
  var has=[],a,i;
  if(el){
    a=el.attributes;
    for(i=0;i<a.length;i++){if(a[i].name.indexOf('data-has-')===0)has.push(a[i].name.slice(9));}
    has.sort();
  }
  // #1351 —— 多带一个 role（「data-role」，essential / lead / optional）。面板拿它来决定隐藏
  // 一个块时要不要多说一句（AC7：essential 的块被藏起来，它承载的正文会从被抓取的页面上消失）。
  // 🔴 **从 DOM 上取，不让面板自己查一张表**：「data-role」 的唯一来源是 「block-roles.json」
  //    （「blockAttrs.ts」 读它），而且页面 JSON 可以逐块覆盖 —— 面板那边再抄一张类型→角色的表，
  //    读到的是**类型的默认值**，不是这一块真正的角色，而两者不一致时是静默的。
  // #1351 —— 这一页是谁。站级共用块（blocks/site-blocks.json）在好几页上叫同一个 id，
  // 不带页面的话面板只能让服务器按文件名顺序挑第一个 —— 老板在 A 页点隐藏、改的是 B 页，
  // 而两页都照样建得出来，没有任何东西会红。
  // 🔴 读的是 SiteShell 写在 §main 上的那两个属性，不是从 location 反推：把 URL 还原成页面名
  //    是 src/app/[...slug]/page.tsx §resolveSlug 那一套（语言前缀 / blog / 默认语言的重定向桩），
  //    在这里再写一遍就是第二份实现，而分叉的样子正是「改了另一页的同名块」——两边都绿。
  // 🔴 老站（本票之前的字节）没有这两个属性 ⟹ 这里回 null ⟹ 面板不带 page 去问，
  //    行为跟本票之前逐字一样。不造猜出来的值。
  var mn=document.querySelector('main[data-page]');
  return {type:'ai1st:block-selected',
    id:el?(el.getAttribute('data-block-id')||null):null,
    block:el?el.getAttribute('data-block'):null,
    shape:el?(el.getAttribute('data-shape')||null):null,
    role:el?(el.getAttribute('data-role')||null):null,
    page:mn?(mn.getAttribute('data-page')||null):null,
    locale:mn?(mn.getAttribute('data-locale')||null):null,
    has:has};
}
function bSay(el){try{window.parent.postMessage(bInfo(el),T);}catch(err){}}
// 🔴 capture 阶段 + preventDefault + stopPropagation，三个一起，而且只在编辑模式里。
// 点中的很可能是块【里面】的一个链接或按钮（AC 末条点名的就是 hero 的 CTA）：
//   · 不 preventDefault → iframe 当场跳页，老板选个块把预览跳走了；
//   · 不 stopPropagation → 站自己的 React 处理器照跑（FAQ 展开、轮播翻页、表单提交）；
//   · 不用 capture → 上面两件事里有一半在冒泡到 document 之前就已经发生了。
// 选中的是**块根**（bRootOf 往上找最近的 [data-block]），所以点块里任何地方都选中这一块。
function bClick(ev){
  if(!bOn)return;
  ev.preventDefault();
  ev.stopPropagation();
  var el=bRootOf(ev.target);
  bPaint(el);
  bSay(el);
}
function bOver(ev){
  if(!bOn||!bStyle)return;
  var el=bRootOf(ev.target),ns=document.querySelectorAll('.ai1st-blk-hover'),i;
  for(i=0;i<ns.length;i++){ns[i].className=String(ns[i].className||'').split(' ')
    .filter(function(x){return x&&x!=='ai1st-blk-hover';}).join(' ');}
  if(el&&el!==bSel){el.className=(el.className?el.className+' ':'')+'ai1st-blk-hover';}
}
// ── #1351 —— 预览里的「先看效果，还没保存」──────────────────────────────────────────────────────
//
// 面板上按「隐藏」或「上移」时，改动**还没写进页面 JSON**。这几条消息让老板当场看见结果；点保存才
// 走 PATCH → worker 改文件 → commit → 重建（那时 iframe 整个重载，下面这些痕迹随之消失）。
// 不保存就离开（关编辑模式 / 换选中的块 / 离开页面）⟹ 面板发 ai1st:block-preview-reset，全部还原。
//
// 🔴 **隐藏用行内 style + !important，不用 [hidden] 属性。** 票正文 v1 那半句（「[hidden] 不许主题皮
//    覆盖，lint 已拒 display」）两半都不成立，PM 2026-09-16 的技术裁定一推翻了它，我自己又量了一遍：
//    「scripts/theme-css-lint.js」 §BLOCK_DISPLAY 的白名单是
//    「block / flow-root / flex / inline-flex / grid / inline-grid / inline-block / none」 八个值 ——
//    lint **不拒** display，只收窄它的值。所以主题皮在 「[data-block]」 上写一条 「display:flex」 是
//    合法的，而它盖过 「[hidden]」 那个来自浏览器自带样式表的 「display:none」 ⟹ 老板点了隐藏、块还在。
//    行内样式的优先级高于任何作者样式表规则，「!important」 再挡住带 !important 的那一条。
//
// 🔴 **还原要记「原来是什么」，不是「设成空」。** 块自己可能本来就带行内 display（主题图册、某些
//    section 组件会写），直接 「style.display=''」 会把它抹掉 —— 而那是一个**不保存也回不去**的改动。
//    所以第一次动它的时候把原值（含 priority）抄下来，还原时原样写回去。
//
// 🔴 **上移下移换的是 DOM 位置，而且只在同一个父节点里换。** 块可能分在不同 Region（顶栏 / 内容 /
//    页脚），跨父节点搬会把一个内容块塞进页脚里 —— 预览里看着像成功，保存之后按 weight 排出来的却
//    是另一回事。找不到同父的邻居就什么都不做（面板那边到头的按钮本来就是灰的）。
var bPrevHide=[],bPrevMove=[];
function bFindHide(el){var i;for(i=0;i<bPrevHide.length;i++){if(bPrevHide[i][0]===el)return bPrevHide[i];}return null;}
function bPreviewHide(id,hide){
  var el=bById(id);
  if(!el)return;
  if(!bFindHide(el)){
    // 原值抄一次就够 —— 之后来回切也只还原到最初那个。
    bPrevHide.push([el,el.style.display,el.style.getPropertyPriority('display')]);
  }
  if(hide)el.style.setProperty('display','none','important');
  else{
    var rec=bFindHide(el);
    if(rec)el.style.setProperty('display',rec[1],rec[2]);
    else el.style.removeProperty('display');
  }
}
function bPreviewMove(id,dir){
  var el=bById(id);
  if(!el||!el.parentNode)return;
  var sibs=[],n=el.parentNode.firstChild;
  while(n){if(n.nodeType===1&&n.getAttribute&&n.getAttribute('data-block')!==null)sibs.push(n);n=n.nextSibling;}
  var at=sibs.indexOf(el);
  if(at===-1)return;
  var to=dir==='up'?at-1:at+1;
  if(to<0||to>=sibs.length)return;
  // 还原用的底稿：第一次动一个块之前，记下它当时的父节点和下一个兄弟。
  if(!bPrevMove.length){
    var all=document.querySelectorAll('[data-block]'),i;
    for(i=0;i<all.length;i++)bPrevMove.push([all[i],all[i].parentNode,all[i].nextSibling]);
  }
  var other=sibs[to];
  if(dir==='up')el.parentNode.insertBefore(el,other);
  else el.parentNode.insertBefore(other,el);
}
function bPreviewReset(){
  var i,rec;
  for(i=0;i<bPrevHide.length;i++){
    rec=bPrevHide[i];
    if(rec[1])rec[0].style.setProperty('display',rec[1],rec[2]);
    else rec[0].style.removeProperty('display');
  }
  bPrevHide=[];
  // 🔴 倒着放回去：insertBefore(el, next) 要求 next 还在它原来的位置上，而前面的元素回位会把后面的
  //    挤走。从最后一个往前放，每一步的参照点都已经归位了。
  for(i=bPrevMove.length-1;i>=0;i--){
    rec=bPrevMove[i];
    if(rec[1])rec[1].insertBefore(rec[0],rec[2]);
  }
  bPrevMove=[];
}
function bMode(on){
  bOn=!!on;
  if(bOn){bCss();}
  // 🔴 关编辑模式 = 那一轮没保存的改动作废。面板也会发一条 preview-reset，但它可能因为组件已经卸载
  //    而发不出来（老板直接离开页面、或者 iframe 正在重载）—— 而「预览里躺着一个没保存的改动」是
  //    静默的：老板下次回来看见的不是他的网站。两边各做一次，多做一次的代价是零（都是幂等的）。
  else{bPaint(null);bPreviewReset();}
}
document.addEventListener('click',bClick,true);
document.addEventListener('mouseover',bOver,true);
window.addEventListener('message',function(e){
  if(e.origin!==T)return;
  var d=e.data;
  if(!d||typeof d!=='object')return;
  if(d.type==='ai1st:theme-preview-css'||d.type==='ai1st:theme-preview-css-ping'){
    if(d.type==='ai1st:theme-preview-css'){paintCss(typeof d.css==='string'?d.css:'');}
    try{window.parent.postMessage({type:'ai1st:theme-preview-css-ack',blocks:blockList(),
      ignored:st.ignored,refused:st.refused,applied:!!(c&&c.textContent)},T);}catch(err){}
    return;
  }
  if(d.type==='ai1st:theme-preview'){
    paint(d.theme);
    // #1123 —— 没有 sheet 字段（老 dashboard）就整个不碰画法，行为逐字回到本票之前。
    if(Object.prototype.hasOwnProperty.call(d,'sheet')){paintSheet(d.sheet);}
    // #1318 —— 画法跟着换。同上一条：没有这个字段（老 dashboard）就整个不碰 data-shape。
    if(Object.prototype.hasOwnProperty.call(d,'shapes')){paintShapes(d.shapes);}
  }
  else if(d.type==='ai1st:theme-preview-reset'){clear();}
  // #1349 —— 块那一组。放在 theme-preview 那几条**后面**、在最后那个兜底 return 之前，所以
  // theme-preview 那组一个字节都没动（它们的 ack 仍然只由下面那一行发）。
  else if(d.type==='ai1st:block-ping'){
    // 老模板判据的另一半：这条 ack 就是「这个站的产物带着本票这段脚本」。面板 2 秒收不到就灰掉
    // 编辑开关（AC3）。🔴 不能靠版本号 —— 站仓里没有任何东西写着模板版本，而 Apply/换主题都不重建
    // （#1002），所以「这个站是什么时候建的」跟「它的产物里有没有这段代码」不是一回事。
    try{window.parent.postMessage({type:'ai1st:block-ack'},T);}catch(err){}
    return;
  }
  else if(d.type==='ai1st:block-mode'){bMode(d.on);return;}
  else if(d.type==='ai1st:block-highlight'){
    var bt=typeof d.id==='string'?bById(d.id):null;
    bPaint(bt);
    if(bt&&d.scroll)bt.scrollIntoView({block:'center'});
    return;
  }
  else if(d.type==='ai1st:block-clear'){bPaint(null);return;}
  // #1351 —— 「还没保存」的三条。放在这里而不是和上面那几条混在一起，是因为它们**改页面的样子**，
  // 而上面那几条只画框；两组的还原责任也不同（画框的框由 bPaint 管，这三条由 bPreviewReset 管）。
  else if(d.type==='ai1st:block-preview-hidden'){
    if(typeof d.id==='string')bPreviewHide(d.id,!!d.hidden);
    return;
  }
  else if(d.type==='ai1st:block-preview-move'){
    if(typeof d.id==='string'&&(d.dir==='up'||d.dir==='down'))bPreviewMove(d.id,d.dir);
    return;
  }
  else if(d.type==='ai1st:block-preview-reset'){bPreviewReset();return;}
  else if(d.type==='ai1st:block-scroll'){
    var bs=typeof d.id==='string'?bById(d.id):null;
    if(bs)bs.scrollIntoView({block:'center'});
    return;
  }
  else if(d.type!=='ai1st:theme-preview-ping'){return;}
  try{window.parent.postMessage({type:'ai1st:theme-preview-ack'},T);}catch(err){}
});
})();`;
}

// ── #1327 —— 服务页那条吸顶导航条【自己多高】，写给 CSS 看 ───────────────────────────────────────
//
// `.services-list__item { scroll-margin-top }` 是「点了服务导航里的一个服务之后，那一项要往下让多远
// 才不会被吸顶条盖住」。它原来是一个常数 `6rem`，而条的高度**不是常数**：
//
//   · 服务多一个就可能多一行 —— 8 个服务的夹具上（`theme-css-invariants-all-sheets.sh` 建的那个
//     skipAI 演示站，siteId `themecss1`，/services 页放 8 个服务，2026-09-15 现取），条在 375 是
//     320px、在 1280 是 208px；
//   · 主题表也搬得动它 —— `.services-nav` / `.services-nav__link` 都是契约 §1 的 hook，`padding` 和
//     `font-` 都在 §2 的属性表里。同一个站同样 8 个服务同样 1280，只换主题表写得动的那三条声明
//     （`.services-nav{padding:16px 24px}` + `.services-nav__link{padding:2px 8px;font-size:11px}`），
//     条从 208px 变 110px（375 上同时从 320px 变 274px）。
//
// 🔴 上面这几个像素数会变，而本段的论点一点都不靠它们。那个夹具穿哪张表是轮换挑的
// （`scripts/themes.js` §pickThemeForIndustry），主题池一动，同一份配方就读出另一组数 —— 这几行
// 先后写过 500/208、298/162、320/208，每一组都是「8 个服务」。这正是论点本身：条有多高不是「8 个
// 服务」的属性。要一个永远现取的读数，看 `scripts/theme-css-invariants.mjs` 的检查 ⑩ —— 它把当场
// 那条的高度打进读数行。
//
// ⟹ 没有任何一个 CSS 长度对两个宽度都成立，globals.css 连它的**上界**都写不出来（「服务数 × 行高」
// 也不行，行高归主题）。实测的后果是：那行标题 `h2.services-list__title` 在 375 和 1280 上都被盖掉
// 25px，而它自己就只有 25px 高 —— 两个宽度各 100%，用户点进去看见的是别的服务的正文。
//
// 所以这个数在浏览器里量一次，写进 `--services-nav-scroll-margin`。
//
// 🔴 量的是 `getComputedStyle(bar).top`，不是 `getBoundingClientRect().top`。条是 `position: sticky`：
// 页面在顶上时它的 rect.top 是它在文档流里的位置，而**跳过去之后**它会停在 sticky 的那个 `top`（今天
// globals.css 写的是 73px，页头的高度）。要让位的是后者。
//
// 🔴 取不到就不写这个变量，而不是写 0：CSS 那边的兜底是 `6rem`，也就是本票之前的行为。失败方向是
// 「跟以前一样」，不是「一点都不让位」。没有 JS 的浏览器同理。
//
// 🔴 ResizeObserver 盯的是条自己，不是窗口：条变高的原因不止一个（窗口宽度、字体换成真字体之后重新
// 换行、主题预览当场换了一张表），而这三件事都会让它的盒子变，窗口 resize 只覆盖第一件。没有
// ResizeObserver 的浏览器退回 `resize` + `load` 两个事件。
//
// 🔴 这段脚本一个文档只执行一次，而用户到达服务页的路不止一条（#1327 第二轮，QA3 量出来的）：
// 站内点页头的 Services 属于客户端跳转 —— App Router 只换掉 `{children}`，layout 一直活着，所以
// 这段脚本【不会】重跑。第一轮交付在那条路上：变量从没被写过，`scroll-margin-top` 落回 `6rem`，
// 标题在 375 和 1280 上又被整行盖住（2026-09-15 在上面那个夹具上把这份 layout.tsx 单独换回第一轮
// 那份现取：item 297/558 与 185/485、标题两个宽度各 25/25，而同一份产物【直开】仍然是 0）。跳走再
// 跳回还多一个形态：ResizeObserver 盯的是【当时那个】条的节点，跳页后那个节点已经被换掉，观察静默
// 失效 —— 回来之后把窗口从 1280 拖到 375，条变成 320px 而变量停在 297px（实测 covered 96/558、
// 标题 12/25；同一次里【不离开页面】只把窗口拖窄的对照写的是 409px）。
//
// 所以这段脚本现在跟的是【条自己的生死】，不是文档的加载：MutationObserver 看着 body，条一换人就
// 重新量一次、并且把 ResizeObserver 挪到新条上。条不在了就把变量摘掉 —— 摘掉之后 CSS 落回 `6rem`，
// 也就是本票之前的行为，跟「取不到就不写」是同一个失败方向。
//
// 🔴 MutationObserver 的回调只做一次 querySelector 和一次身份比较，真正要量的时候才碰 offsetHeight
// （那一下会强制排版）：水合期间 body 底下的改动是成批的，回调按帧合并一次，条没换就什么都不做。
function buildServicesNavOffsetScript(): string {
  return `(function(){
var SEL='.services-nav',NAME='--services-nav-scroll-margin',GAP=16;
var root=document.documentElement,bar=null,ro=null,queued=false;
function measure(){
  if(!bar)return;
  var top=parseFloat(getComputedStyle(bar).top);
  if(!isFinite(top))return;
  root.style.setProperty(NAME,(top+bar.offsetHeight+GAP)+'px');
}
function sync(){
  queued=false;
  var next=document.querySelector(SEL);
  if(next===bar)return;
  bar=next;
  if(ro){ro.disconnect();if(bar)ro.observe(bar);}
  if(bar)measure();else root.style.removeProperty(NAME);
}
function schedule(){
  if(queued)return;
  queued=true;
  if(window.requestAnimationFrame)requestAnimationFrame(sync);else setTimeout(sync,0);
}
if(window.ResizeObserver)ro=new ResizeObserver(measure);
else window.addEventListener('resize',measure);
// The bar is normally already parsed when this runs (this script is emitted after the page's
// content), and a parser-blocking inline script also waits for the stylesheets - so the first
// reading is taken here, not a tick later.
sync();
// The bar comes and goes with client-side navigation, and it can also arrive later than this script
// on a document where it is rendered below. Both are the same question - "is the bar on the page
// the one we are watching?" - so both are answered here rather than by waiting for DOMContentLoaded.
if(window.MutationObserver)new MutationObserver(schedule).observe(document.body,{childList:true,subtree:true});
else document.addEventListener('DOMContentLoaded',sync);
window.addEventListener('load',function(){sync();measure();});
})();`;
}

export const metadata: Metadata = {
  title: {
    default: seo.siteTitle,
    template: `%s | ${defaultBrandName}`,
  },
  description: seo.siteDescription,
  keywords: seo.keywords,
  metadataBase: new URL(seo.domain),
  alternates: {
    canonical: '/',
  },
  openGraph: {
    title: seo.siteTitle,
    description: seo.siteDescription,
    url: seo.domain,
    siteName: defaultBrandName,
    locale: seo.locale,
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: seo.siteTitle,
    description: seo.siteDescription,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-video-preview': -1,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  verification: seo.verification,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang={seo.locale.split('_')[0]}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* #1001 — the floor, and it is UNCONDITIONAL on purpose. The arm base.css exists for is
            "neutral markup with NO theme sheet" (an old site rebuilding on dev, or phase 2 having
            moved a block before some sheet caught up), so gating it on the theme would take the
            fallback away in exactly the case it is the fallback for. It is one <link> and one
            request for sites that render the old markup, where its rules select nothing.
            🔴 It goes BEFORE the theme link and both are unlayered: same specificity (both files
            select single classes), so the later one wins — that ordering IS the mechanism by which
            a theme overrides the floor. See public/base.css's header. */}
        <link rel="stylesheet" href="/base.css" />
        {/* #1318 — 形态层（`public/shapes.css`）。一个块**怎么排**住在这一份平台文件里，按
            `[data-block="<类型>"][data-shape="<画法>"]` 点名；主题表从此只剩皮（契约 v3 把几何那
            一族从 §2 拿掉了）。
            🔴 位置是承重的：在 base.css **之后**（它要盖掉地板的单栏兜底），在 theme.css **之前**
            （皮排在后面，所以间距 / 圆角 / 颜色仍然由主题说了算）。它的选择器是两个属性 = 特异度
            0-2-0，比两侧那些单类名规则（0-1-0）都高 —— 所以「几何归形态层」不靠加载次序，靠特异度，
            主题表就算再写一行几何也压不过它（而契约已经不许它写了）。
            🔴 无条件加载，理由跟 base.css 那条逐字相同：老站（还没有 data-shape 的产物）上它的选择器
            一条都选不中，代价是一个请求；而要是按「这个站有没有 shape」去 gate，恰恰在兜底最需要
            它的那一格把兜底拿掉了。 */}
        <link rel="stylesheet" href="/shapes.css" />
        {/* #1002 — 皮和微调，两个固定路径，无条件加载。
            · /theme.css   主题的全部：字体表的 @import、配色 / 字体族 / 风格设定的 :root、以及
              这个站的形态样式表（#991 的 public/themes/<name>.css，它的字节被贴进这份文件）。
              换主题 = 换掉这个文件的内容，**文件名不变** ⟹ HTML 不用重写 ⟹ 不用重建。
            · /custom.css  这个站自己的微调（#1006）。换主题时它一个字节都不动，所以「换了主题
              微调还在」是结构上自动成立的，不需要任何把微调套回去的逻辑。它排在最后，所以它赢。
            🔴 两份都排在 globals.css 打包出来的那个 <link> 之后（Next 把自己的样式表放在 <head>
            最前面），主题层因此不用 `!important` 就能压过它 —— 契约禁止 !important，这是它能禁的原因。
            🔴 它们生成在 public/ 而不是 src/：Tailwind 的 content glob 扫 src/，样式表落进去不会被
            编译、只会被**扫**，里面每个词都会变成候选 class 名。 */}
        <link rel="stylesheet" href="/theme.css" />
        <link rel="stylesheet" href="/custom.css" />
        {brand.logoUrl ? (
          <link rel="icon" href={brand.logoUrl} />
        ) : (
          /* #1176 — 这里曾经在 SVG 图标旁边多写一行 `<link rel="icon" sizes="any">`，指着 /favicon.ico，
             而模板里从来没有那个文件（`find templates/nextjs -iname 'favicon*'` = 0）。所以它只在
             「一个 logo 都没拿到」时输出，而它输出的时候必然是 404 —— 每页一条。实测（`brand.logoUrl`
             为空的 dexin.ca 站配置，32 页）：删之前 31 页各带一条 404，删之后 0 条，而同一分支里这个
             SVG 图标仍然在那 31 页上。删掉它对任何一维都不是回退：现代浏览器读的就是这个 SVG，只认
             .ico 的老浏览器今天拿到的也是「没有图标」。要给老浏览器补一个真的 .ico 是新功能，不是修
             死链，另开票。（少的那 1 页是 `blog/_.html` —— 空博客的 `__next_error__` 占位页，它整页
             一个 `rel="icon"` 都没有。） */
          <link rel="icon" type="image/svg+xml" href={buildFaviconSvg()} />
        )}
      </head>
      <body className="flex min-h-screen flex-col font-sans">
        {/* TICKET-131: when this page is embedded in an iframe (dashboard
            PreviewPanel), notify the parent on every navigation so the URL bar
            stays in sync. Standalone production users (window.parent === window)
            short-circuit immediately — script is a no-op for them. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){if(window.parent===window)return;function n(){try{window.parent.postMessage({type:"ai1st:nav",path:window.location.pathname+window.location.search+window.location.hash},"*");}catch(e){}}n();var p=history.pushState;history.pushState=function(){p.apply(this,arguments);n();};var r=history.replaceState;history.replaceState=function(){r.apply(this,arguments);n();};window.addEventListener("popstate",n);})();`,
          }}
        />
        {/* #925: theme preview listener — only emitted when we know our dashboard's origin
            (see previewTrustedOrigin). Absent ⟹ the modal's handshake times out and it says so. */}
        {previewTrustedOrigin && (
          <script
            dangerouslySetInnerHTML={{ __html: buildThemePreviewScript(previewTrustedOrigin) }}
          />
        )}
        {children}
        {/* #1327: how far a service has to sit below the sticky services-nav bar is the bar's own
            height, which is not a constant (see buildServicesNavOffsetScript). This script measures
            it into `--services-nav-scroll-margin`; globals.css falls back to the old `6rem` when it
            has not run. 🔴 AFTER {children} on purpose — a parser-blocking inline script here runs
            with the bar already parsed AND with the stylesheets applied, so the very first reading
            is a real one; before {children} it would have to wait for DOMContentLoaded. It is a
            no-op on every page that has no services-nav block, and it keeps watching: this layout
            survives client-side navigation, so the script measures again whenever the bar itself is
            swapped out or removed. */}
        <script dangerouslySetInnerHTML={{ __html: buildServicesNavOffsetScript() }} />
        {/* TICKET-273: AI chat widget. Always injected (siteId+leadApi from 268); the widget self-gates
            at runtime via /api/chat/widget-config, so toggling chat_enabled off deactivates it on the
            next load with no rebuild. Absent leadApi/siteId (dev) → skipped. */}
        {siteId && leadApi && (
          <script async src={`${leadApi.replace(/\/$/, '')}/widget.js?site=${siteId}`} />
        )}
      </body>
    </html>
  );
}
