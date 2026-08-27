'use strict';

/**
 * image-urls.js — AI 聊天编辑器写进站点配置的那个图片地址，是**别人给它的**吗？（#1195）
 *
 *   const { collectAllowedImageUrls, imageUrlRejection, attachedImagesNote } = require('./lib/image-urls.js');
 *   const allowed = collectAllowedImageUrls({ siteDir, images, message, conversationHistory });
 *   const why = imageUrlRejection(parsedJson, allowed);   // null = 放行；字符串 = 拒，这句话直接回给模型
 *
 * ── 为什么要有它 ────────────────────────────────────────────────────────────────────────────────
 * #1195 起因是「老板附了照片，AI 看得见却用不上」。查那个站（`site-194f1f41`，德馨金融）的时候
 * 撞见了同一个病的**另一半**，而且它已经上线在一个真付费客户的站上：
 *
 *     关于我们页 <img src>  https://uploads.ai1stsite.app/ab2ae88c-…/profile-photo.jpg   → 404
 *     同一页的 logo         https://uploads.ai1stsite.app/ab2ae88c-…/c250d3d41_Email_Signature_Logo.png → 200
 *
 * 两个地址同一个域名、同一个用户目录，一个活一个死。判据在文件名上：上传这条路给的文件名
 * **必然**带一段 9 位十六进制前缀（`manager/uploads.go` 的 `uuidShort + "_" + normalizeFilename(...)`）。
 * `profile-photo.jpg` 没有那个前缀 ⟹ R2 上从来没有这个对象 ⟹ 它是模型**照着域名的样子编出来的**。
 * 老板看到的就是那句「这个图片是坏的」。
 *
 * 🔴 这跟 `editable-files.js` 治的是同一个毛病，甚至是同一个站：那次模型编出了一个不存在的
 *    themeId（`luxury-dark`），这次编出了一个不存在的图片地址。**模型会把「看起来该长这样」当成
 *    「它存在」**，而两次的失败方向都是静默的 —— 构建绿、同步绿、commit + push 绿、老板收到
 *    「已完成」，坏的东西直接躺在线上站点里。
 *
 * ── 判据：这个地址是【谁给的】，不是它长得对不对 ──────────────────────────────────────────────
 * 放行的来源只有四类，全都是「有人真的给过这个字符串」：
 *   ① 这条消息的附件（`images[].url`，manager 从 R2 拿到的真地址）
 *   ② 老板自己在消息正文里贴的
 *   ③ 老板在**之前的对话**里说过的（#1194 把聊天历史接上之后这一类才有内容；今天恒空，留着不会错）
 *      🔴 只收 `role === 'user'` 那些条目。整份 stringify 会把**模型自己上一轮提议的**地址也收进来
 *      （"我可以用 Unsplash 这张 …"），下一轮它就成了"有人给过的" —— 一条把编造洗白成合法的通道，
 *      而且方向恰好是本票要治的那一支。判据始终是「**有人**给过」，模型自己不是那个人。
 *   ④ 这个站自己的文件里**已经是一张图**的（`site/**.json` 里的图片位置）—— 这一类让
 *      「把首页那张图挪到关于页」照常能做
 *      🔴 判的是**图片位置**，不是文件原文（#1199 ②改的就是这里）。扫原文的话，模型上一轮写在
 *      任何文本字段里的任何一个地址，这一轮都成了「有人给过的」—— 跟 ③ 那条洗白通道同一个形状，
 *      只是绕道磁盘走了一圈。站里的 .json 大半是模型自己写的，所以这一类的口径必须是
 *      「它**已经是这个站上的一张图**」，而不是「这个字符串在这个站的某个文件里出现过」。
 *
 * ── 「一张图」有哪些位置（#1199 ①）───────────────────────────────────────────────────────────
 * 两类，判定和放行名单**共用同一个函数**（`collectImagePositions`）：
 *   · 图片字段：`IMAGE_FIELDS` 上的值 —— 模板按 `<img src={…}>` 画
 *   · HTML 字符串里的图：博客正文按 HTML 渲染（`BlogPostPage.tsx:56`），`blog/*.json` 又是可写的
 *     ⟹ 同一个编造地址换到这一面照样画成一张裂图，而它此前完全不在射程内
 *
 * 🔴 **不用「这个 URL 取得到吗」当判据。** 那要发网络请求：慢、会因为一次抖动把好地址判死，
 *    而且它对「取得到、但根本不是老板给的那张」完全无话可说 —— 而那正是 Unsplash 那一支的形状。
 * 🔴 相对路径（`/photos/hero.jpg`）不在射程内：它们由 `create-site.js` 生成、跟着站一起构建，
 *    不是外链，编不出祸来。判的是 `http(s):`（**斜杠数不限**，#1207：`http:/h/x` 浏览器照样取）·
 *    协议相对 `//host/…`（#1209 起**前导那段 `/` `\` 有两个以上就算**：`///h` · `/\h` · `\\h` 归一化
 *    之后都是它，逐种真 chromium 量过）· `data:` 三种（#1199 ③：
 *    后两种此前连问都没被问到，而 `//images.unsplash.com/…` 浏览器按 https 取得回来，
 *    产物上就是一张真的、没人给过的图）。
 *
 * ── 拒绝的方向是有意的 ────────────────────────────────────────────────────────────────────────
 *   · 误拒（老板给过、这里没认出来）⟹ 模型当场拿到一句点名的错误，同一轮里改口去问老板。吵，但安全。
 *   · 误放（模型编的地址落盘）      ⟹ 没有任何人会知道，直到老板自己看见一张裂图。静，而且已经发生过。
 */

// 会被画成 <img src> 的字段名。判据不是这份手抄清单，而是 `image-urls.test.js` 里那道
// 两向守卫：它从 `src/components/**` 现读一遍，多一个少一个都当场红。
const IMAGE_FIELDS = ['imageUrl', 'logoUrl'];

// ── 一个「图片地址」长什么样 ──────────────────────────────────────────────────────────────────
// 🔴 三种形态**共用一个源串**，因为它要在两处被问到，而两份实现必然分叉（#1199 ③ 就是这么来的：
//    抠地址的那把尺子认 `http(s)://`，判定的那把也认 `http(s)://`，于是 `//host/…` 与 `data:…`
//    在两边同时消失 —— 前者浏览器按 https 取，产物上是一张真的、没人给过的图）。
//   · `URL_RE`      在**自由文本**里找（老板打的字、之前的对话）→ 全局
//   · `ADDR_HEAD_RE` 问**一个值**「它是不是一个要被追责的图片地址」→ 锚在开头
// 🔴 单斜杠的站内相对路径（`/photos/hero.jpg`）**不在**这三种里：它由 create-site 生成、跟着站
//    一起构建，编不出祸来。挡住它的是**斜杠个数**那一维（`//` 这一支要求两个，`/photos/…` 只有一个）；
//    而 `//photos/hero.jpg` 这种单标签主机由 `isImageAddress` 的「主机含不含点」挡住（#1210 起，
//    此前是这条正则里一个只认 ASCII 的字面先行断言）。
//
// 🔴 **`http(s):` 后面的斜杠数不限（`\/*`，#1207）。** 原来写死两个斜杠，于是 `http:/host/x.jpg`
//    地址**抠出来了却不进入判定** —— 不是"判成放行"，是连问都不问，正是 `imageUrlRejection` 里
//    那段注释自己写着的失败形状。一个字符的差别就让 #1204 新收的六种写法全部失效。
//    判据是真 chromium 去不去取（#1207 自己起一台 HTTP 服务器看它收没收到那条请求，一维一格单量），
//    四种斜杠数 × 两条通道（`<img src>` / CSS `url()`）**八格全部真发了请求**：
//      `http://h/x` ✅ · `http:/h/x` ✅ · `http:h/x` ✅ · `http:///h/x` ✅
//    WHATWG 把它们全部归一化成 `http://h/x`（`new URL('http:/h/x').href` 可复算）。
// 🔴 **放宽斜杠数【没有】把站内相对路径吃进来。**
//    📌 #1207 这里原来写着「分界线是**有没有 scheme**」—— **#1209 起那句话是假的**：`///host.com/x`
//    一个 scheme 都没有，却是个真的跨主机地址（真 chromium 上 `<img src>` / `<td background>` /
//    CSS `url()` 三条路都发了请求）。今天的分界线是**两条合起来**：前导那段 `/` `\` 有几个（一个 =
//    本站路径，两个以上 = 跨主机），外加「后面跟不跟 `域名.`」。所以 `/photos/hero.jpg` 靠前一条留在
//    射程外，`//photos/hero.jpg` 与 `/\photos/hero.jpg` 靠后一条（`photos` 后面是 `/` 不是 `.`，
//    单标签主机按 #1199 的设计不进射程）。归一化那一层写在 `canonicalAddress` 上面，两向都有格子
//    钉着（#1207 AC2 · #1209 AC4）。
//
// 🔴 **「后面跟不跟【域名.】」这半条 #1210 起【不在这条正则里】了。** 它原来写的是
//    `(?=[\w-]+\.)` —— 一个**字面**先行断言，只认 ASCII 字母加 ASCII 点，而浏览器认的是
//    WHATWG 归一化之后的主机。两把尺在五种主机写法上给出相反答案，五种在 `origin/main` 上全部
//    放行而真 chromium 全部跨主机取了图（`//evil%2Eexample.com` · `//evil。example.com`(U+3002) ·
//    `//evil．example.com`(U+FF0E) · `//münchen.example`(原生 IDN) · `//.evil.example.com`(前导点)）。
//    今天这半条搬到了 `isImageAddress`，判据是 `new URL('https:' + 归一化值).host` **含不含点** ——
//    上面五种归一化后分别是 `evil.example.com` ×3 · `xn--mnchen-3ya.example` · `.evil.example.com`，
//    全部含点；而 #1199 划的那条线（单标签主机放行）恰好就是「不含点」：`//photos/hero.jpg` → `photos`、
//    `///localhost:8080/x.png` → `localhost:8080`，两个都不含点。**一条判据同时管住两向**，不是两条。
// 🔴 **这里留下的 `(?![/\\])` 不是那半条的残余，它管的是【斜杠个数】那一维。** 少了它，
//    `///编造域名` 不经 `canonicalAddress` 也能直接命中 `//` 这一支 ⟹ #1209 那一层归一化当场变成
//    冗余、它那两把反向刀恒绿（同一个陷阱写在 `canonicalAddress` 上面的 ③ 里）。判据是那两刀还翻不翻面。
const ADDR_HEAD = '(?:https?:\\/*|\\/\\/(?![/\\\\])|data:[\\w.+-]+\\/[\\w.+-]+[;,])';
// 🔴 排除类里那三段 Unicode 是承重的（#1199 ④）：中文句子**没有空格**，标点是唯一的边界。
//    只排 ASCII 标点的话，「你用这张 https://example.com/a.jpg，谢谢」会被抠成
//    `https://example.com/a.jpg，谢谢` —— 于是老板给过的那个地址从来没真正进过放行名单，
//    模型照抄**干净**地址写入反而被拒，还被告知「这个地址没人给过你」。而中文句尾必有标点
//    ⟹ 对中文老板是**系统性**的误拒，而中文正是 #1195 那位老板的语言。
//      　-〿  CJK 标点（。、，；：！？「」『』〈〉《》【】…）
//      ＀-￯  全角形（），！？；：等）—— 全角汉字不在这段里，IDN 域名不受影响
//      ‘-‟  弯引号  ·  … 省略号
const ADDR_TAIL = '[^\\s"\'`<>)\\]\\u3000-\\u303f\\uff00-\\uffef\\u2018-\\u201f\\u2026]+';
const URL_RE = new RegExp(ADDR_HEAD + ADDR_TAIL, 'gi');
const ADDR_HEAD_RE = new RegExp('^' + ADDR_HEAD, 'i');
// 英文句子里标点跟在地址后面同样会被粘上（`…a.jpg.` / `…a.jpg,`），而英文有空格所以只脏在**末尾**
// —— 上面那个排除类治不了它（`.` 和 `,` 在 URL 里是合法字符，不能整类排掉）。这里只削尾巴。
const TRAILING_PUNCT_RE = /[.,;:!?]+$/;

// ── 一个【值】在被问「它是不是个图片地址」之前，浏览器会先把它变成什么（#1209）─────────────────
// 🔴 上面那把尺子问的是「它长什么样」。而浏览器**在解析之前**先动了两下手，两下都能让一个
//    真的跨主机地址从这把尺子底下走过去（三种都在 origin/main 上放行过，不是回退）：
//
//   ⓪ **首尾的 C0 控制字符与空格整个剥掉**（这才是 WHATWG「基本 URL 解析器」的**第一步**，#1210）。
//      ⟹ `\x01http://evil/x.png` · `\x01///evil/x.png` 浏览器取的是剥掉之后那个地址，而这里原来
//      用的是 JS 的 `.trim()` —— 它剥空白，**不剥** `\x01`–`\x08` / `\x0e`–`\x1f`。三种都在
//      `origin/main` 上放行过。
//      🔴 **只剥【首尾】，不剥中间**：`//evil\x01.example.com/x.png` 浏览器根本不去取（C0 在主机里
//         是解析错误），收它就是凭空造的误拒 —— 下面那格阴性对照钉的就是它。
//      🔴 剥的这一类**比 `.trim()` 窄**：`﻿` / ` ` 这些 `.trim()` 会剥、这里不剥，因为
//         WHATWG 也不剥（`﻿http://…` 浏览器不当地址）。窄的那一侧才是对的。
//   ① **TAB / LF / CR 整个删掉**（WHATWG「基本 URL 解析器」的**第二步**，不限于 scheme 里；
//      📌 #1209 这句原来写的是「第一步」——那是 ⓪ 那一步，写错会让下一个人以为 C0 已经在射程里，
//      而 #1210 之前它确实不在）。
//      ⟹ `ht<LF>tp://evil/x.png` 这把尺子看不出是个地址，浏览器取的是 `http://evil/x.png`。
//      实测三种（LF / TAB / CR）在 `<img src>` 与 `<td background>` 上都真发了请求。
//      🔴 **空格不在其中**：`ht tp://…` 浏览器不当地址（探针里那格阴性对照就是它）。所以这里
//         只剔这三个字符，不敢写 `\s` —— 写宽一格就会把「插空格」那种误拒进来。
//
//   ② **前导那一段 `/` `\` 是不是「跨主机」，看的是【几个】而不是【哪一种】**：两个以上（`///`
//      `////` `/\` `\\` `\/` …）→ 归一化成 `//host`，是个跨主机地址；**正好一个**（`/x` 或 `\x`）
//      → 本站相对路径。原来 `//` 那一支的先行断言要求紧跟「域名.」，于是第三个字符是 `/` 时
//      整支落空 —— 连问都不问。
//      🔴 **单个反斜杠不是洞**：`\evil.example.com/x.png` 真 chromium 取的是**本站**
//         `https://<本站>/evil.example.com/x.png`，`new URL` 两把尺（chromium / node）读数一致。
//         所以判据是「前导斜杠段 ≥ 2」，**不是**「有没有反斜杠」—— 按后者写会把它误拒。
//      🔴 站内相对路径靠**同一条**分界线留在射程外，不是靠另加一条例外：`/photos/hero.jpg` 只有
//         一个斜杠；`//photos/hero.jpg` 与 `/\photos/hero.jpg` 归一化后都是 `//photos/…`，而
//         `photos` 后面是 `/` 不是 `.` ⟹ 先行断言把它挡住（单标签主机按 #1199 的设计不进射程）。
//
//   ③ scheme 后面那一段也认反斜杠：`http:\\h/x` 浏览器取 `http://h/x`。这一格**今天就在射程内**
//      （`https?:\/*` 零斜杠就匹配），归一化在这里的作用是让「老板给过的那张写成这样」不被误拒。
//      🔴 **这里只把反斜杠换成正斜杠，不动斜杠的【个数】** —— 个数那一维归 `ADDR_HEAD` 的
//         `https?:\/*` 和 `addressForms` 自己那条正则管（#1207）。在这里顺手收成两个斜杠是**冗余**，
//         而冗余的代价不是多写几行：#1207 那三把反向刀（切 `\/*` / 切 `addressForms` 的正则）会
//         **全部恒绿** —— 本票初版就是这么写的，一跑三格全不翻面，那三条覆盖面从此没人在守。
//
// 🔴 **这一层【只】作用在「一个值」上，没有加到 URL_RE（在老板打的字里找地址）那一侧。**
//    那两处共用 `ADDR_HEAD` 一个源串的纪律没破：这不是第二把「地址长什么样」的尺子，是把值先
//    还原成浏览器真去取的那个地址。自由文本那侧不能这么做 —— 把一段话里的换行整个剔掉会把两行
//    粘成一个假地址，而 `\\` 在散文里是常见字符（Windows 路径），收进放行名单是**误放**方向。
//    代价写在明处：老板**自己打字**打出 `///host/x.png` 时它不进放行名单，模型照抄会被拒。
//    那是误拒方向（吵但安全），而老板手打的地址现实里是 `https://` 那一种。
const URL_STRIP_RE = /[\t\n\r]/g;
// 步骤 ⓪：首尾的 C0 与空格。🔴 **不是 `.trim()`** —— 它剥不掉 `\x01`；也**不是 `\s`** —— 那会把
// ` ` / `﻿` 也剥掉，而浏览器不剥（写宽一格就是凭空造误拒，跟 URL_STRIP_RE 那条同一个形状）。
//
// 🔴🔴 而它**不能用正则**,这一行是 r1 被退回的那一处(QA3 反向终审)。r1 写的是
// `/^[\x00-\x20]+|[\x00-\x20]+$/g`,而**任何 `$` 锚定的尾部剥法在「值中间有一长串空白」上都是
// 平方级**:引擎从那段空白的每一个起点贪婪吃到底、发现后面不是结尾、再回溯。同一道闸
// (`imageUrlRejection`,一个 `imageUrl` 字段),输入 `"https://…/a" + N 个空格 + "b.jpg"`,
// 我自己重量的读数(与 QA3 同一形状;绝对值因机器负载不同,阶数相同):
//
//	N        main 的 .trim()   r1 那把 /^…|…$/g   拆成两个 replace(`/^…/`+`/…$/`)   下面这个扫描
//	10000    0.025 ms          118.8 ms           116.9 ms                          0.120 ms
//	50000    0.033 ms          2956.6 ms          3105.7 ms                         0.010 ms
//	100000   0.062 ms          11832.9 ms         11769.7 ms                        0.018 ms
//
// ⟹ **「拆成两个 replace」不是修法**(第三列与第二列同阶)—— 慢的是尾部那个 `$`,不是那个 `|`。
// 触发面是真的:这道闸跑在 edit-site 服务端,一个页面/博客 JSON 的 `imageUrl` / `logoUrl`、或一个
// `<img src>` 属性值里塞一段空白就够,整个值原样流到这里,Node 进程卡住几十秒。
//
// 所以两端都用**不回溯**的扫描。它与上面那两种正则写法在边界值上逐个相同(空串 / 全空白 / 全 C0 /
// 首尾 C0 / `\x7f` 前缀 / 中间空白 / 只有一端 / `\x21` 与 NBSP 不该剥 —— 14 格逐个比过字符串)。
// 📌 上界是 `0x20` **含**,与 `[\x00-\x20]` 逐字相同;`\x7f`(DEL)不在内,浏览器也不剥它。
function stripUrlEdges(v) {
  const s = String(v);
  let i = 0;
  let j = s.length;
  while (i < j && s.charCodeAt(i) <= 0x20) i += 1;
  while (j > i && s.charCodeAt(j - 1) <= 0x20) j -= 1;
  return i === 0 && j === s.length ? s : s.slice(i, j);
}
const LEADING_SLASHES_RE = /^[/\\]+/;
// 主机那一维（#1210）。`m[1]` = scheme + 前导斜杠段（原样留着，**斜杠个数不归这一层管**，见上 ③），
// `m[2]` = 主机那一段（到第一个 `/` `\` `?` `#` 为止），后面的路径/查询/片段原样接回去。
const HOST_HEAD_RE = /^(https?:[/\\]*|\/\/)([^/\\?#]*)/i;
/** 浏览器真正会去连的那个主机（含端口）。取不到 ⟹ null —— 那种值浏览器也去不了。 */
function hostOf(s) {
  const t = String(s);
  // 用它**自己的** scheme 去解析：`http://h:80/x` 与 `//h:443/x` 各自的默认端口才会被正确吃掉。
  const abs = /^https?:/i.test(t) ? t : (t.startsWith('//') ? `https:${t}` : null);
  if (abs === null) return null;
  try { return new URL(abs).host || null; } catch (e) { return null; }
}
/**
 * 把值里那一段主机换成浏览器归一化之后的样子（#1210）。IDN → punycode、`%2E` / U+3002 / U+FF0E → `.`、
 * 大小写收平、userinfo 丢掉（`//给过的域名@evil.example.com/x` 真正连的是 `evil.example.com`）。
 * 🔴 **只动主机那一段**：斜杠个数、路径、查询一律原样 —— 在这里顺手归一化斜杠数是冗余，
 *    而冗余会让 #1207 那三把反向刀恒绿（同一个陷阱写在上面 ③ 里）。
 */
function canonicalHost(s) {
  const m = String(s).match(HOST_HEAD_RE);
  if (!m || !m[2]) return s;
  const h = hostOf(s);
  return h ? m[1] + h + String(s).slice(m[0].length) : s;
}
/** 前导斜杠段与 scheme 后那段反斜杠（#1207 / #1209 那一层，主机不归它管）。 */
function canonicalSlashes(s) {
  const scheme = s.match(/^(https?):([/\\]*)/i);
  if (scheme) {
    if (!scheme[2].includes('\\')) return s;   // 没有反斜杠 ⟹ 这一维不归我管，原样交回去（见上 ③）
    return `${scheme[1]}:${'/'.repeat(scheme[2].length)}${s.slice(scheme[0].length)}`;
  }
  const run = s.match(LEADING_SLASHES_RE);
  if (run && run[0].length >= 2) return `//${s.slice(run[0].length)}`;
  return s;
}
function canonicalAddress(v) {
  return canonicalHost(canonicalSlashes(stripUrlEdges(v).replace(URL_STRIP_RE, '')));
}

/**
 * 这个值，是一个**这道闸要追责的图片地址**吗？（#1210 把 `//` 那一支的主机判据从字面先行断言
 * 换成了 WHATWG 的 `.host`，见 `ADDR_HEAD` 上面那两段。）
 *
 * 三支：`http(s):`（斜杠数不限）· `data:` —— 这两支不看主机；`//host/…` —— **看主机含不含点**。
 * 🔴 含不含点这条线就是 #1199 划的「单标签主机不进射程」：`//photos/hero.jpg` → `photos`、
 *    `///localhost:8080/x.png` → `localhost:8080`，两个都不含点 ⟹ 放行，不是漏掉的洞。
 * 🔴 主机解析不出来（`//evil^example.com/x`）⟹ **false**。方向是有意的：浏览器对这种值同样
 *    不发请求，判成"要追责"就是凭空造的误拒。
 */
function isImageAddress(v) {
  const s = canonicalAddress(v);
  if (!ADDR_HEAD_RE.test(s)) return false;
  if (!s.startsWith('//')) return true;       // http(s): 与 data: 两支：主机不是它们的判据
  const h = hostOf(s);
  return h !== null && h.includes('.');
}

// HTML 字符串里画出来的图（#1199 ① 起，#1204 扩到下面这张表）。博客正文是**唯一**一个把配置里的
// 字符串当 HTML 渲染的面（`src/components/pages/BlogPostPage.tsx:56` 的 `dangerouslySetInnerHTML`；
// 全仓 9 处 `dangerouslySetInnerHTML` 里另外 8 处画的是 JSON-LD 和内联脚本，不吃配置字符串）。
// 而 `blog/*.json` 是可写的（`editable-files.js:99`）⟹ 同一个编造地址换到这一面就画成一张裂图。
//
// 🔴 **今天收的是下面这张表 + CSS 的 `url()` 两条路，不是「HTML 里所有能画图的写法」。**
//    #1199 这里是两条各自写死的正则（`<img src>` 与 `style="…url(…)"`），措辞写成「两种机制都收」——
//    读起来像收全了，而实际上另有八种写法整整放行了一轮（#1204 在已 ship 的字节上枚举出来的）。
//    表驱动是有意的：再冒出一种写法时有地方可加，而不是再写一条正则。
//
// 🔴 **每一行的判据是「真浏览器去不去取那张图」，不是规范怎么写的**（#1204 在 chromium 上逐格量过，
//    自己那台 HTTP 服务器收没收到那条请求）。两个反直觉的读数就是这么来的：
//      · `<input src>` **不写** `type="image"` 时浏览器**不取** —— 但这里照收，因为多收一格的代价是
//        「老板给过的地址照样放行」（误拒方向对这一格根本不成立），而漏收一格是静默的。
//      · `<iframe src>` 浏览器**会取**，这里**不收**：它装的是一份文档不是一张图，而博客正文里嵌
//        YouTube / 地图是常事 ⟹ 收它会把老板没打过字的正常嵌入整份拒掉。`<a href>` 同理不收
//        （实测浏览器压根不取）。
//   🔴 **表里还剩两格误拒是有代价的，明写在这里**（#1204 r1 写过一句「iframe 是唯一一格」——
//      那句话是错的，QA1 复算时点出来了）：`<object data>` 与 `<embed src>` 装的也可能是一份 PDF
//      而不是图，实测这两种挂 PDF 时 `origin/main` 放行、这份字节拒。**仍然收**，理由是这道检查的
//      判据从来不是「它是不是一张图」而是「这个地址有人给过吗」：没人给过的地址不存在，挂上去就是
//      一块坏掉的嵌入，跟一张裂图是同一个后果。代价写在明处：老板没打过字的第三方 PDF 会被整份拒掉。
//      📌 那句回执原来写着「is an image URL」（也就是拒一份 PDF 时说的是假话）—— **#1207 改掉了它**，
//      现在说的是「这个**地址**没人给过你」。措辞与它的读者是谁，写在 `imageUrlRejection` 上面。
const IMAGE_ATTRS = {
  img: ['src', 'srcset'],
  // `<picture><source srcset>`。**只收 `srcset`**：`<video><source src>` 装的是视频，不是图。
  source: ['srcset'],
  video: ['poster'],
  // SVG 的 `<image href>`（`xlink:href` 是它的老写法）；而**裸 `<image src>`** 会被 HTML 解析器
  // 当成 `<img>` 画出来 —— 实测真去取了。
  image: ['href', 'xlink:href', 'src'],
  input: ['src'],
  object: ['data'],
  embed: ['src'],
  // ── `background` 属性（#1207）───────────────────────────────────────────────────────────────
  // 🔴 它是**被废弃**的 HTML，但浏览器照样画 —— 而这一族**不需要模型犯错**，只要它写一张老式表格。
  //    QA1 在 #1204 r3 用真 chromium 扫 500 格随机语料，48 格是这一族。
  // 🔴 成员是**量出来的**，不是按规范抄的（#1207 自己起一台 HTTP 服务器，一个标签一页单量，
  //    看它收没收到那条请求）：下面这八个全部 ✅ 真去取了，而 `<div background>` ❌ 不取
  //    ⟹ **不收 `div`**。那个 ❌ 同时是这台探针的反向对照：它证明这把尺分得开取与不取，
  //    不是"什么都说取"。想再加一个标签，先照这条路量一次，别照规范加。
  body: ['background'],
  table: ['background'],
  thead: ['background'],
  tbody: ['background'],
  tfoot: ['background'],
  tr: ['background'],
  td: ['background'],
  th: ['background'],
  // 🔴 这两个是 #1209 补的，同一族、同一条量法（页面 https + sink 明文 http，一个标签一页单量）：
  //    `<col background>` ✅ · `<colgroup background>` ✅ 真去取了。#1207 那轮把这一族表外 19 个
  //    标签逐个量过就漏了这两个 —— 老式表格里 `<colgroup>` 本来就会出现。反向对照仍是上面那个
  //    `<div background>` ❌：它证明这把尺分得开取与不取。
  col: ['background'],
  colgroup: ['background'],
};
// 🔴 这些属性装的是**一串**候选（`a.jpg 1x, b.jpg 2x`），不是一个地址。整串当一个地址判 = 只判了
//    第一个，把编造地址挪到第二个候选就溜过去了（#1204 AC2）。
const SRCSET_ATTRS = new Set(['srcset']);

// 标签体（`<img` 之后到这个标签结束之间那一段）由 `scanTags` 手写扫出来，**不是正则**。
// 🔴 四条边界各自付过账，全写在这里，别把它改回一条正则（#1204 r2 / r3）：
//   ① 属性值里允许出现 `>`（`<img src="a.jpg" alt="a>b">`）⟹ 不能拿第一个 `>` 当结尾。
//   ② **标签没有收尾的 `>`**（`…<img src="…"` 正好在正文末尾）浏览器照样把那张图取回来 —— 实测取了。
//      而闸看到的是 `blog/*.json` 的 `content` 一个字段，**字段尾就是字符串尾** ⟹ 这个形状是可达的。
//   ③ **引号没闭合**（`<img src="…> <span class="x">`）浏览器把属性值一直读到下一个引号，
//      于是它发出的请求打在那个编造的域名上（路径被改了形）—— 实测请求真发出去了。
//   ④ **只有 `=` 之后（可以隔空白）的那个引号才开一段属性值**。落在属性名位置上的引号，HTML 解析器
//      只当它是名字里的一个垃圾字符，标签照样在下一个 `>` 结束、后面的正文照常解析。
//   ①②③ 里 ② ③ 是 #1204 r1 引入的回退：`origin/main` 那两条正则本来拦得住，r1 的正则要求
//   标签必须闭合、引号必须成对，于是这三格从「拒」翻成「放行」（QA1 在 r1 抓的，方向是误放）。
//   现在照浏览器的做法收：**引号没闭合就吃到字符串尾，标签没闭合就到字符串尾结束**。
//   ④ 是 #1204 r2 引入的回退（QA1 在 r2 抓的，方向同样是误放）：r2 对**任何**引号都跳到配对的
//   那个引号，于是一个标签里的引号数是**奇数**时（`<a title='Joe's Bakery'>` —— 一个普通的英文
//   所有格撇号就够了），它会一路跳到后面某个图片属性的开引号上，把**整份正文剩下的部分**吞成一个
//   标签体 ⟹ 后面每一个画图的属性都抠不出来。实测浏览器把那些图**照取不误**。
//   🔴 分界线是引号落在哪，不是「main 拒而这里放行就算漏」：引号落在**值**位置时（`<div class="card>`）
//   浏览器自己也把后面吞掉、那条请求根本不发 ⟹ 那一格放行是把 `origin/main` 的误报修掉了，别改回去。
//
// 🔴 **一条残留边界，明写在这里（#1204 r2 实测出来的，不是推的）**：字段尾**不是**文档尾 ——
//    博客正文是塞进 `<article>` 里画的，后面还有 tags / footer 那一堆带引号的属性。所以
//    「引号在这个字段里一次都没闭合」时，浏览器把**模板后面那一截**也当成地址的一部分取回来
//    （实测请求路径是 `…/a.png%3C/article%3E%3Cfooter%3E%3Cdiv%20class=`）。
//    ⟹ 这一格如果地址**是编造的**，这里拒，对；如果地址**是老板给过的**，这里放行，而浏览器
//    取到的是被粘了模板尾巴的另一个地址 —— 产物上仍是一张裂图。**那一格放行是有意的**：
//    粘上去的是什么取决于模板，这个函数看不到；而这属于「模型吐了残缺 HTML」，不是本票要治的
//    「这个地址有人给过吗」。`origin/main` 在这一格的行为完全相同（它连这个形状都抠不出来）。
//    要治它得让这道检查兼做 HTML 校验，那是另一件事。
const HTML_TAG_NAME_RE = /<([a-zA-Z][\w:-]*)/g;
// 🔴 最后那一支是**不带引号**的属性值，它的边界只有空白和 `>`（#1204 r3）。
//    原来那个字符类还排掉了 `"` `'` 反引号 `=`，于是 `<div style=background-image:url('…')>`
//    只抠到 `background-image:url(` —— `url()` 不完整，那张图整个看不见。**浏览器会去取它**
//    （真 chromium 上量到的，DPR 1/2 都发了请求），而 `origin/main` / r1 / r2 在这一格也一样瞎
//    ⟹ 这不是本轮的回退，是本票主题（「还有哪种画法闸看不见」）里剩下的一格。
//    收成 `[^\s>]+` 就是 HTML 解析器自己的「属性值(不带引号)」状态：只有空白和 `>` 结束它，
//    引号和 `=` 落在里面只是普通字符。
const HTML_ATTR_RE = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|"([^"]*)$|'([^']*)$|([^\s>]+))/g;

/**
 * `text[i]` 上这个引号，是**开一段属性值**的那种吗？往回看：跳过空白之后必须正好是 `=`（边界 ④）。
 * 🔴 只往回看一格（外加空白），不需要认整个标签的语法：HTML 的「属性值开始」状态就只由前面那个
 *    `=` 决定，而落在属性名位置上的引号解析器只当它是名字里的一个字符。
 */
function quoteOpensValue(text, i) {
  let k = i - 1;
  while (k >= 0 && /\s/.test(text[k])) k -= 1;
  return text[k] === '=';
}

/**
 * 一段 HTML 里的每个标签，拆成 `{ tag, body }`。手写扫描，理由在上面那四条边界里。
 * 🔴 正则只用来找标签**名**；标签体靠往前走，遇到**值位置**的引号就跳到配对的那个引号
 *    （找不到就到字符串尾）。属性名位置上的引号不跳 —— 跳了就会把后面整份正文吞掉（边界 ④）。
 */
function scanTags(text) {
  // 🔴 每次照 source 新建一个：全局正则的 `lastIndex` 是**状态**，共用那一个会让两次调用互相干扰。
  const nameRe = new RegExp(HTML_TAG_NAME_RE.source, 'g');
  const out = [];
  let m;
  while ((m = nameRe.exec(text)) !== null) {
    let j = m.index + m[0].length;
    const start = j;
    while (j < text.length) {
      const c = text[j];
      if (c === '>') break;
      if ((c === '"' || c === "'") && quoteOpensValue(text, j)) {
        const close = text.indexOf(c, j + 1);
        if (close === -1) { j = text.length; break; }   // 引号没闭合 ⟹ 吃到尾（边界 ③）
        j = close + 1;
        continue;
      }
      j += 1;
    }
    out.push({ tag: m[1].toLowerCase(), body: text.slice(start, j) });
    nameRe.lastIndex = j;      // 从这个标签之后接着找，别在标签体里面再找一次
  }
  return out;
}
// 🔴 `url()` 只在 `style=` 属性和 `<style>` 元素**里面**认。整段文本里认的话，一篇讲 CSS 的博客里
//    一行 `background-image: url(https://example.com/a.png)` 的代码示例（`<pre><code>` 里）会被当成
//    一张图而整份拒收 —— 那一格有守卫钉着。`<style>` 元素实测真的会去取那张图。
// 🔴 收尾的 `</style>` 是**可选**的：少了它浏览器照样在字符串尾自己闭合、照样去取那张图
//    —— 跟上面边界 ②③ 同一个形状（#1204 r2 一起收的）。
//
// 🔴🔴 **下面这三趟是手写扫描，不是正则（#1208 换掉的就是这个）。** 原来那三条
//    `/<style\b[^>]*>([\s\S]*?)(?:<\/style>|$)/` · `/\burl\(\s*(?:"…"|'…'|[^)\s]*)\s*\)/` ·
//    `/@font-face\s*\{[^}]*\}/` 在**病态输入**上都是二次的，而这道闸**同步**跑在 `edit-site.js:688`
//    落盘之前 ⟹ 真触发一次，老板那次「让 AI 改一下」就多等几秒、且没有任何反馈。
//    `blog/*.json` 的正文是模型写的、长度**没有上界**，所以这条路今天的上界靠「模型一般不会那么写」
//    兜着，不是靠代码兜着。实测（`origin/main` 那份字节 `4956fe75289a`，N 翻倍时间 ×4 ⟹ 二次）：
//      <style> 无闭合 + N 个 `url(`       N=10000 → 1048 ms    N=20000 → 3708 ms
//      N 个 `@font-face{` 无闭合           N=10000 → 1338 ms    N=20000 → 5940 ms
//      N 个 `url("`（引号一个都没闭合）      N=10000 → 1371 ms
//      N 个 `<style`（连 `>` 都没有）        N=10000 →  733 ms   ← 这一格是 `[^>]*` 的回溯，不在票正文那张表上
//    📌 同一条 `pushCss` 也被 `style=` **属性**喂 ⟹ 不经 `<style>` 元素也到得了（实测同样 ×4）。
//
// 🔴 病根是**回溯**，不是「认 `<style>` 这件事」：三条正则里的字符类各自都装不下它后面要找的那个
//    字符（`[^>]*` 装不下 `>`、`[^)\s]*` 装不下 `)`、`[^}]*` 装不下 `}`）⟹ 它们只可能停在**第一个**
//    那个字符上，「一格一格退回来重试」在这里**永远配不上**。那 N×N 次尝试全是白做的，
//    所以换成扫描是**恒等变换**，不是取舍。
// 🔴 **不是**「给输入长度设个上限」：那把「病态输入慢」换成「长正文里的图整段不看」，方向是**误放**（静默）。
// 🔴 改这三个函数前先读它们各自 🔴 那一句「为什么这一行不能删」——三趟扫描的线性都不是免费的：
//    要么靠**单调游标**（只往前走 ⟹ 每个字符最多被看常数次），要么靠**配不上就收工**（后面没有配对
//    字符了，任何起点都配不成 ⟹ 停下是恒等变换）。哪一趟靠哪一条，写在那一趟上面。
// 🔴🔴 **空白有两个集合，因为「空白」在这两趟里问的不是同一个问题（#1218 量出来的）。**
//    两趟各要什么，判据是**真浏览器发不发那条请求**（三个引擎 × 两条写法 × `\s` 全部 25 个字符，
//    表在下面 CSS_WS_CHARS 那段）。别把它们并回一个集合 —— 并成宽的，`url()` 那趟就误拒；
//    并成窄的，`@font-face` 那趟就误拒。两个方向都实测过，读数在 #1218。
//
// ── 宽的这个（25 个，逐字符等于 `\s`）只给 `stripFontFaces` 用 ────────────────────────────────
// 🔴 `@font-face` 那趟要的就是宽：那一趟在问「这段像不像一个 @font-face 块」，而**只要它像**，
//    里面那个地址就一定不是图 —— 浏览器要么把它当字体取（那不是图），要么整条 at-rule 当成
//    不认识的规则整块丢掉（那就一条请求都不发）。两种下场都不是「画出一张图」⟹ 剔掉整块永远安全。
//    实测（#1218，三个引擎一致）：`@font-face<C>{src:url(X)}` 里 C 取那 25 个字符，
//    只有 CSS 认的那 5 个会真去取 X（当字体取），另外 20 个一条请求都不发。
//    ⟹ 收窄这一个的后果是**误拒**：`@font-face<NBSP>{…}` 不再被当成 font-face 块，
//    里面那个 `.woff2` 就被当成图去查、老板整份编辑被拒 —— 正是 #1204 r2 收掉的那个毛病。
//    (#1208 第一版把它写成 6 个 ASCII 的，QA1/QA2 各自实测抓到的就是这一格。)
// 🔴 它同时被两道守卫钉着（image-urls.test.js §四）：一道在 **BMP 全集 65536 个码位**上钉
//    「这个集合逐字符等于 `\s`」，一道是拿掉 NBSP 的单变量反向臂。改这一行（哪怕只少一个字符）
//    那两格当场红。
const WS_CHARS = ' \t\n\r\f\v\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';
const WS_SET = new Set(WS_CHARS);
const isWs = (c) => WS_SET.has(c);

// ── 窄的这个（5 个，CSS 规范的空白）只给 `cssUrlValues` 用 ─────────────────────────────────────
// 🔴 `url()` 那趟要的是窄：那一趟在问「这个 `url(…)` 到底会不会取到一个地址」，而这件事
//    **浏览器只按 CSS 那 5 个空白算**。宽了就误拒 —— `url(<NBSP>"编造.png")` 浏览器一条请求
//    都不发（那是个 bad-url-token），而按宽集合去读会把 `编造.png` 抠出来当图查、拒掉老板整份编辑。
//    这不是 #1208 引入的：它换掉的那两条老正则里写的就是 `\s*`，`origin/main` 一直是这个行为。
//
// 🔴🔴 **这 5 个是量出来的，不是抄规范抄来的**（#1218 AC1；那份 playwright 脚本逐字贴在 #1218 的
//    `**DEV → QA1/QA2**` 留言里，
//    任何人可复算）。判据是 `page.on('request')` —— 请求发出那一刻就记，不看渲染、
//    不看响应；每格路径唯一所以读不到缓存。`\s` 那 25 个字符 × 两条写法 × 三个引擎，
//    **150 格（25 × 2 × 3）结论完全一致**：
//        C =                                    url(C"…png")   @font-faceC{src:url(…woff2)}
//        U+0020 空格 · U+0009 \t · U+000A \n
//        U+000D \r · U+000C \f    ← CSS 的 5 个        取             取（当字体）
//        另外 20 个（U+000B \v · U+00A0 · U+1680 ·
//        U+2000–U+200A · U+2028 · U+2029 ·
//        U+202F · U+205F · U+3000 · U+FEFF）              一条都不发     一条都不发
//    阳性对照 = 上面 U+0020 那一行本身（每个 引擎×写法 的格子都必须取）；
//    阴性对照 = C 换成字母 `X`（六格全不发）；另有 C 整个去掉那一格（六格全取）。
//    引擎版本（`browser.version()` 现取）：chromium 147.0.7727.15 · firefox 148.0.2 · webkit 26.4（playwright 1.59.1）。
//
// 🔴 **将来哪个引擎变了，要重测的就是这一段。** 前提写在明处：上面那 20 个字符，
//    三个引擎今天都不去取 —— 所以我们不看它们后面那个地址。哪天有一个引擎开始取了，
//    这一行就必须跟着回到宽的（否则那一格变成误放，而误放是静默的）。
// 🔴 有一格守卫在 **BMP 全集 65536 个码位**上钉着「`url(C"…")` 抠得到 ⟺ C 在这 5 个里」
//    （image-urls.test.js §四），再加**四格**单变量反向臂：这一行多一个码位 / 少一个码位 /
//    `skipWs` 换回宽的 `isWs` / `wsRe` 换回 `/\s/`（最后那格钉的是「两处同一个集合」）。
const CSS_WS_CHARS = ' \t\n\r\f';
const CSS_WS_SET = new Set(CSS_WS_CHARS);
const isCssWs = (c) => CSS_WS_SET.has(c);
const WORD_CHAR_RE = /\w/;

// 🔴🔴 **小写只能小写 ASCII** —— 下面三趟都拿 `low` 当 `text`/`css` 的**索引尺**
//    (`low.indexOf(…)` 的下标去 `slice(text)`），所以那把尺**不许改变长度**。
//    `String.prototype.toLowerCase` 会:`U+0130`(İ，土耳其语大写点 I）小写成**两个**码位
//    ⟹ 从它往后每个下标错一格。BMP 里这样的字符只有它一个，但它就是一个，而且不是病态输入:
//    一条浏览器一定会去取的 `background-image` 声明，只要同一个 `<style>` 里前面出现过一个 `İ`,
//    闸就完全看不见它（QA1 实测；`create-site` 有 `--language`，土耳其语正文里 `İ` 是常用字）。
//    🔴 只小写 A-Z 同时也是**跟老正则那个 `i` 标记等价**的做法:非 unicode 模式的正则做
//       大小写归一时，码位 ≥128 而大写形式 <128 的字符**不归一**(所以 `K` U+212A 不匹配 `k`）
//       ⟹ 老正则也只在 ASCII 上不分大小写。有一格守卫钉着「长度不变」。
//    🔴 **两条分支，都逐字等价于「只小写 A-Z」，分开只为省时间：**
//      · 整串都是 ASCII（没有码位 ≥ 0x80）⟹ `toLowerCase()` 就**是**「只小写 A-Z」：
//        ASCII 里只有 A-Z 有小写映射，一个字符换一个字符，长度不可能变。
//      · 只要有一个非 ASCII 字符 ⟹ 走 `replace`，它按构造只动 A-Z。
//    📌 为什么值得多这一条分支（墙钟，9 个真 prod 站仓的 408 份真站 JSON 全跑一遍，5 遍取最小）：
//        改前 origin/main（裸 toLowerCase）            43.9 ms
//        只用 replace（本票第一版）                     59.9 ms   ← 比改前**慢** 16 ms
//        本版（ASCII 走 toLowerCase，其余走 replace）    36.5 ms   ← 比改前**快** 7 ms
//      非 ASCII 那一支反而更快，是因为 `toLowerCase()` 对非 ASCII 串要进 ICU，而 `replace`
//      在一串「本来就没有大写字母」的正文上几乎不做事。⟹ 这条分支不是为了好看，是它把
//      本票在**真实路径**上的代价从「慢 16 ms」变成「快 7 ms」。
const NON_ASCII_RE = /[^\x00-\x7f]/;
const asciiLower = (s) => (NON_ASCII_RE.test(s) ? s.replace(/[A-Z]+/g, (m) => m.toLowerCase()) : s.toLowerCase());

/**
 * `<style …>` 的元素体，一段一个。收尾的 `</style>` 可选（少了就到字符串尾）。
 * 老正则：`/<style\b[^>]*>([\s\S]*?)(?:<\/style>|$)/gi`。
 *
 * 🔴 **`if (gt === -1) break;` 那一行是承重的**（它就是这一趟的线性）：没有它，`<style` 重复 N 遍
 *    而整串一个 `>` 都没有时，每个起点都要重新扫一遍剩下的串 ⟹ 又是二次。停下是恒等变换：
 *    `i` 之后没有 `>`，那 `i` 之后的每个起点也都配不上（它要的 `>` 只会更靠后）。
 */
function styleElementBodies(text) {
  const low = asciiLower(text);
  const n = text.length;
  const out = [];
  let i = 0;
  while (i < n) {
    const at = low.indexOf('<style', i);
    if (at === -1) break;
    i = at + 6;
    // `\b` —— 后面紧跟单词字符就不是这个标签（`<styles>`）；到字符串尾也算边界。
    if (text[i] !== undefined && WORD_CHAR_RE.test(text[i])) continue;
    const gt = text.indexOf('>', i);
    if (gt === -1) break;
    const close = low.indexOf('</style>', gt + 1);
    out.push(text.slice(gt + 1, close === -1 ? n : close));
    if (close === -1) break;
    i = close + 8;
  }
  return out;
}

/**
 * 一段 CSS 里 `url(…)` 的值，一个一个。
 * 老正则：`/\burl\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi`（三条分支的先后顺序在这里照搬）。
 * 🔴 **只有那几个 `\s` 不照搬**：#1218 起这一趟按 CSS 那 5 个空白算，不按 `\s` 的 25 个 ——
 *    理由（三个引擎的读数）写在 `CSS_WS_CHARS` 上面那段。老正则那 25 个是**误拒**方向。
 *
 * 🔴 **三个游标 `nextClose` / `nextWs` / `wsEndAt` 是承重的**（它们就是这一趟的线性）：它们只往前走，
 *    落到当前位置后面时才重新找一次 ⟹ 整趟的 `indexOf` / 空白扫描加起来是 O(串长)，不是每个起点一次。
 *    🔴 特别是 `wsEndAt` 那一格缓存：`e` 是单调的，而**同一段空白会被连续多个起点问到**
 *    （`url(` 重复 N 遍、后面跟一长段空白再跟一个非 `)`）—— 不缓存就是 N × 那段空白 = 二次。
 */
function cssUrlValues(css) {
  const n = css.length;
  const low = asciiLower(css);
  const out = [];
  // 🔴 这一趟用的是**窄**那个集合 `CSS_WS_SET`（CSS 的 5 个），不是上面那个 25 个的 `WS_SET`
  //    —— 为什么，写在 `CSS_WS_CHARS` 上面那段（#1218 三个引擎的读数）。
  // 🔴 下面 `firstWs` 用这条正则算出 `e`，而 `skipWs` 用 `CSS_WS_SET` 去消费同一个 `e`
  //    ⟹ **两处必须是同一个集合**，不一致就是 #1208 第一版那个洞。所以这条正则不手写，
  //    直接从 `CSS_WS_CHARS` 那一个字符串拼出来：一处定义、两处使用，没有第二份可以走偏。
  // 🔴 往 `CSS_WS_CHARS` 里加字符时注意：它是直接塞进字符类的，`]` / `\\` / `^` / `-` 会改变
  //    这条正则的意思（`]` 直接让 `new RegExp` 抛错）。今天那 5 个都不是这几个，所以不加转义
  //    （加了就是一段永远走不到的代码）。真要加别的字符，先在这里转义。
  const wsRe = new RegExp(`[${CSS_WS_CHARS}]`, 'g');
  let nextClose = css.indexOf(')');
  if (nextClose === -1) nextClose = n;
  let nextWs = -1;
  let wsEndAt = -1;
  let wsEndVal = -1;
  const firstClose = (from) => {
    if (nextClose < from) { const j = css.indexOf(')', from); nextClose = j === -1 ? n : j; }
    return nextClose;
  };
  const firstWs = (from) => {
    if (nextWs < from) { wsRe.lastIndex = from; const m = wsRe.exec(css); nextWs = m ? m.index : n; }
    return nextWs;
  };
  const skipWs = (from) => { let k = from; while (k < n && isCssWs(css[k])) k += 1; return k; };
  // 只给单调的 `e` 用（见上面 🔴）。别把另外两处也接到它上面：那两处的实参不单调，缓存会来回颠。
  const skipWsAtE = (e) => { if (wsEndAt !== e) { wsEndAt = e; wsEndVal = skipWs(e); } return wsEndVal; };
  let i = 0;
  while (i < n) {
    const at = low.indexOf('url(', i);
    if (at === -1) break;
    i = at + 4;
    if (at > 0 && WORD_CHAR_RE.test(css[at - 1])) continue;      // `\b`
    const p = skipWs(i);                                          // 老正则里 `url(` 之后那个 `\s*`
    const q = css[p];
    if (q === '"' || q === "'") {
      const c = css.indexOf(q, p + 1);
      if (c !== -1) {
        const k = skipWs(c + 1);
        if (css[k] === ')') { out.push(css.slice(p + 1, c)); i = k + 1; continue; }
      }
      // 引号那一支配不上 ⟹ 落回「不带引号」那一支（老正则的 alternation 就是这个顺序）。
    }
    // 不带引号：`[^)\s]*` 只可能停在第一个 `)` 或空白上，退回来重试永远配不上。
    const e = Math.min(firstClose(p), firstWs(p));
    const k = skipWsAtE(e);
    if (css[k] === ')') { out.push(css.slice(p, e)); i = k + 1; }
  }
  return out;
}

// 🔴 `@font-face` 里的 `url()` 装的是**字体**，不是图 —— 整块先剔掉再找地址。
//    这是 #1204 r1 造出来的一个误拒：`origin/main` 只看 `style=` 属性、看不到 `<style>` 元素，
//    所以一篇用了 webfont 的博客在 main 上放行、在 r1 上被**整份**拒掉，而模型收到的原话还说
//    那个 `.woff2` 「is an image URL」（那句措辞 #1207 改掉了；这一格的修法是剔掉整块，跟措辞无关）。
//    两位 QA 都报了这一条（QA1 非阻断① / QA2 还剩什么①）。
//    📌 它不是绕过通道：`@font-face` 注册的是字体，浏览器不会把它画成一张图。
/**
 * 老正则：`/@font-face\s*\{[^}]*\}/gi`，`.replace(…, '')`。
 * 🔴 **`if (end === -1) break;` 那一行是承重的**（它就是这一趟的线性；这里没有 `}` 的游标）：
 *    没有它，`@font-face{` 重复 N 遍而整串一个 `}` 都没有时，每个起点都要重新扫一遍剩下的串。
 *    停下是恒等变换：`p` 之后没有 `}`，那后面每个起点也都配不上。
 */
function stripFontFaces(css) {
  const n = css.length;
  const low = asciiLower(css);
  let out = '';
  let cut = 0;
  let i = 0;
  while (i < n) {
    const at = low.indexOf('@font-face', i);
    if (at === -1) break;
    i = at + 10;
    let p = i;
    // 🔴 这里是 `isWs`（宽，25 个）而 `cssUrlValues` 里是 `isCssWs`（窄，5 个）—— **这个不对称是有意的**，
    //    理由和三个引擎的读数写在 `WS_CHARS` / `CSS_WS_CHARS` 上面那两段（#1218）。别把它「统一」掉。
    while (p < n && isWs(css[p])) p += 1;      // 老正则里的 `\s*`
    if (css[p] !== '{') continue;
    const end = css.indexOf('}', p + 1);
    if (end === -1) break;
    out += css.slice(cut, at);
    cut = end + 1;
    i = end + 1;
  }
  return cut === 0 ? css : out + css.slice(cut);
}

// ── HTML 实体（#1210）───────────────────────────────────────────────────────────────────────────
// 🔴 **只在这一侧解一次，判定那一侧不解。** 博客正文是按 HTML 渲染的（`BlogPostPage.tsx:56`），
//    HTML 解析器**在把属性值交给 URL 解析器之前**先解实体 ⟹ `&#x2F;&#x2F;&#x2F;evil…` ·
//    `&sol;&sol;evil…` · `http&#58;//…` · `&#104;ttp://…` 四种在 `origin/main` 上全部放行，而浏览器
//    真去取了。判定那一侧（`imageUrl` 这类 JSON 字段，模板按 `<img src={…}>` 用 JS 赋属性）**不解**
//    实体 —— 在那边解就是凭空造出来的误拒，下面那格阴性对照钉的就是它。
//
// 🔴 **这条修法是【两向】的，而反向那一半今天就在误拒。** 合法 HTML 里 `&` 本来就该写成 `&amp;`：
//    老板给 `https://uploads.ai1stsite.app/a.jpg?x=1&y=2`，模型按规范写成 `…?x=1&amp;y=2`，
//    `origin/main` 上**拒**（实测）。解一次实体顺手把它修好。
//
// 🔴 **`<style>` 元素里【不】解** —— 它是 raw text 元素，HTML 解析器不在里面解实体。只有属性值解
//    （`style="…"` 也是属性值 ⟹ 它那条 CSS 走解完之后的串）。所以解实体这一下挂在属性值上，
//    不挂在 `pushCss` 上。
//
// 🔴 **具名实体必须带分号，数字实体分号可选。** 浏览器对具名实体在属性值里本来就有「后面跟着
//    `=` 或字母数字就不当引用」这条特例；这里直接要求分号，是为了别把 `?a=1&amp=2` 这种**合法**
//    查询串解坏 —— 那是误拒方向。数字实体（`&#47` / `&#x2F`）浏览器照解，这里跟着解。
// 🔴 表里只收**映到 ASCII 单字符**的那些：URL 里能起作用的就这些，多抄一个整表既不承重也会漂。
const NAMED_ENTITIES = {
  Tab: '\t', NewLine: '\n',
  excl: '!', quot: '"', QUOT: '"', num: '#', dollar: '$', percnt: '%', amp: '&', AMP: '&',
  apos: "'", lpar: '(', rpar: ')', ast: '*', midast: '*', plus: '+', comma: ',', period: '.',
  sol: '/', colon: ':', semi: ';', lt: '<', LT: '<', equals: '=', gt: '>', GT: '>', quest: '?',
  commat: '@', lsqb: '[', lbrack: '[', bsol: '\\', rsqb: ']', rbrack: ']', Hat: '^',
  lowbar: '_', UnderBar: '_', grave: '`', DiacriticalGrave: '`', lcub: '{', lbrace: '{',
  verbar: '|', vert: '|', VerticalLine: '|', rcub: '}', rbrace: '}',
};
// 🔴 **`&nbsp;` / `&NonBreakingSpace;` 有意不在表里** —— 它们映到 U+00A0，不是 ASCII，正好踩了上面那条口径。
// 收了它反而造出一格误拒：解成 U+00A0 之后上游那两次 JS `.trim()` 会把它剥掉（JS 的 trim 认 U+00A0），
// 于是 `&nbsp;http://…` 进了判定 —— 而 WHATWG 只剥 C0 与空格、**不剥** U+00A0，浏览器压根不把它当地址。
// 🔴 `&Tab;` / `&NewLine;` 留着，因为它们相反：解出来是 TAB / LF，而那两个正是 `URL_STRIP_RE` 要整个删掉的
// （WHATWG 第二步）—— 浏览器对 `ht&Tab;tp://…` 真的会去取。
const ENTITY_RE = /&(?:#([0-9]+);?|#[xX]([0-9a-fA-F]+);?|([a-zA-Z][a-zA-Z0-9]*);)/g;
/**
 * HTML 属性值里的实体解一次（**只一次** —— `&amp;#x2F;` 浏览器也只解成 `&#x2F;`，不再解第二遍）。
 * 认不出来的原样留着：解不动的东西照原样交给下游，方向上既不多拒也不多放。
 */
function decodeEntities(v) {
  return String(v).replace(ENTITY_RE, (whole, dec, hex, name) => {
    if (dec !== undefined || hex !== undefined) {
      const cp = parseInt(dec !== undefined ? dec : hex, dec !== undefined ? 10 : 16);
      if (!Number.isFinite(cp) || cp < 1 || cp > 0x10ffff) return whole;
      try { return String.fromCodePoint(cp); } catch (e) { return whole; }
    }
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, name) ? NAMED_ENTITIES[name] : whole;
  });
}

/** 一条匹配里第一个真的捕到东西的组（从 `from` 开始数）。`''` 也算捕到，只有 undefined 不算。 */
const firstGroup = (m, from) => {
  for (let i = from || 1; i < m.length; i += 1) if (m[i] !== undefined) return m[i];
  return '';
};

/** 任意文本里出现过的图片地址（http(s):// · 协议相对 //host/… · data:）。 */
function extractUrls(text) {
  if (typeof text !== 'string' || !text) return [];
  return (text.match(URL_RE) || [])
    .map((u) => u.replace(TRAILING_PUNCT_RE, ''))
    // 🔴 `//` 那一支的主机判据现在是 `isImageAddress`（#1210），不再是正则里的字面先行断言 ——
    //    所以抠出来之后还得再问一次，否则老板打的字里一个 `//然后` 也会进放行名单（误放方向）。
    //    两侧问的是**同一个**函数，共用源串那条纪律没破。
    .filter((u) => u && isImageAddress(u));
}

/**
 * `srcset` 那一串候选拆成一个个地址（`a.jpg 1x, b.jpg 2x` → `a.jpg` · `b.jpg`）。
 *
 * 🔴 不能直接 `split(',')`：`data:image/png;base64,AAAA` 自己就带着逗号，一拆就碎成两半，
 *    于是那个 data: 图的地址**谁都不是**，判定拿不到它。按 HTML 规范那条走法来：先吃掉一段
 *    非空白当地址；地址自己以逗号结尾 ⟹ 这个候选没有描述符；否则往后跳过描述符直到逗号。
 */
function splitSrcset(value) {
  const s = String(value);
  const out = [];
  let i = 0;
  while (i < s.length) {
    while (i < s.length && (/\s/.test(s[i]) || s[i] === ',')) i += 1;
    if (i >= s.length) break;
    const start = i;
    while (i < s.length && !/\s/.test(s[i])) i += 1;
    let url = s.slice(start, i);
    if (url.endsWith(',')) {
      url = url.replace(/,+$/, '');
    } else {
      let depth = 0;
      while (i < s.length) {
        const c = s[i];
        if (c === '(') depth += 1;
        else if (c === ')') { if (depth > 0) depth -= 1; }
        else if (c === ',' && depth === 0) { i += 1; break; }
        i += 1;
      }
    }
    if (url) out.push(url);
  }
  return out;
}

/**
 * 一段 HTML 里真的会被画成图片的那些地址。两条路：
 *   ① `IMAGE_ATTRS` 那张表上的属性（`<img src|srcset>` · `<source srcset>` · `<video poster>` ·
 *      `<image href|xlink:href|src>` · `<input src>` · `<object data>` · `<embed src>`）
 *   ② CSS 的 `url()` —— 只在 `style=` 属性和 `<style>` 元素里面认
 */
function extractHtmlImageUrls(text) {
  if (typeof text !== 'string' || !text) return [];
  const out = [];
  const push = (v) => { const t = String(v).trim(); if (t) out.push(t); };
  const pushCss = (css) => {
    for (const u of cssUrlValues(stripFontFaces(String(css)))) push(u);
  };
  for (const { tag, body } of scanTags(text)) {
    const wanted = IMAGE_ATTRS[tag] || null;
    for (const am of body.matchAll(HTML_ATTR_RE)) {
      const name = am[1].toLowerCase();
      // 🔴 实体只在这里解一次（属性值这一层），见 `decodeEntities` 上面那几段。
      const value = decodeEntities(firstGroup(am, 2));
      // `style=` 在任何标签上都认（表里那几个标签之外的 <div style> 照样画得出图）。
      if (name === 'style') { pushCss(value); continue; }
      if (!wanted || !wanted.includes(name)) continue;
      if (SRCSET_ATTRS.has(name)) for (const u of splitSrcset(value)) push(u);
      else push(value);
    }
  }
  for (const body of styleElementBodies(text)) pushCss(body);
  return out;
}

/**
 * 这份 JSON 里每一个**图片位置**上的地址。两类位置，缺一不可：
 *   ① 图片字段（`IMAGE_FIELDS`）的值 —— 模板按 `<img src={…}>` 画出来的
 *   ② 任意字符串值里的 HTML 图片 —— 博客正文按 HTML 渲染（见 `IMAGE_ATTRS` 上面那段）
 *
 * 🔴 这一个函数被问两次，而且**必须是同一个答案**：
 *   · 「这次写入里有没有没人给过的图？」（`imageUrlRejection`）
 *   · 「这个站上已经有哪些图？」（`collectAllowedImageUrls` 的第 ④ 类来源）
 * 两边同一份口径，「站上已经有的图可以挪到别处」才不会顺手变成「模型上一轮写下的任何东西都算数」。
 */
function collectImagePositions(node, out) {
  const acc = out || [];
  if (typeof node === 'string') {
    for (const u of extractHtmlImageUrls(node)) acc.push(u);
    return acc;
  }
  if (Array.isArray(node)) {
    for (const v of node) collectImagePositions(v, acc);
    return acc;
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (IMAGE_FIELDS.includes(k) && typeof v === 'string') acc.push(v.trim());
      else collectImagePositions(v, acc);
    }
  }
  return acc;
}

/**
 * 同一个地址的几种写法。协议相对 `//h/p` 跟 `https://h/p` 指的是同一张图，
 * 而老板打字/附件给的必然是带协议那一种 ⟹ 不认这层等价的话，模型把它写成 `//h/p` 会被误拒。
 *
 * 🔴 **斜杠数也是同一张图（#1207）**：`http:/h/p` · `http:h/p` · `http:///h/p` 浏览器取的都是
 *    `http://h/p`（真 chromium 上四种斜杠数 × 两条通道八格全部发了请求，读数在 `ADDR_HEAD` 上面）。
 *    所以老板给过 `http://h/p`、模型少打一个斜杠时**不该**被判成「没人给过你」—— 那是误拒。
 * 🔴 **它不跨 scheme**：归一化只动斜杠数，`https://h/p` 与 `http://h/p` 仍然是两个地址
 *    （今天也是这样：只有老板给的是协议相对 `//h/p` 时两种协议才都放行）。
 *    这一层等价只在「老板真给过那个地址」时起作用，编造的地址归一化之后照样谁都不是。
 */
function addressForms(u) {
  const forms = new Set([u]);
  // 🔴 归一化那一份（#1209）也算同一张图：`///h/p` · `\\h/p` · `ht<LF>tp://h/p` 浏览器取的都是
  //    老板给过的那个地址 ⟹ 不认这层等价就是误拒。**两份都跑一遍**，所以这个集合是改前那份的
  //    严格超集 —— 放行名单只会变宽，不会有新的误拒，也不会有新的误放（加进来的每一种，浏览器
  //    解析出来都是同一个地址）。
  for (const v of new Set([u, canonicalAddress(u)])) {
    forms.add(v);
    if (v.startsWith('//')) { forms.add('https:' + v); forms.add('http:' + v); }
    else {
      const m = v.match(/^(https?):\/*(.*)$/i);
      if (m) { forms.add(`${m[1].toLowerCase()}://${m[2]}`); forms.add('//' + m[2]); }
    }
  }
  return [...forms];
}

/**
 * 放行名单。四类来源见文件头。
 *
 * @param {object} o
 * @param {string=} o.siteDir              站目录；给了就把它下面所有 .json 里出现过的地址收进来
 * @param {Array=}  o.images               这条消息的附件（`{ url }`）
 * @param {string=} o.message              老板这条消息的正文
 * @param {Array=}  o.conversationHistory  之前的对话（#1194 之前恒空）
 * @param {object=} o.fs                   注入用（测试里不落真盘）；默认 require('fs')
 * @returns {Set<string>}
 */
function collectAllowedImageUrls(o) {
  const opts = o || {};
  const allowed = new Set();
  const add = (u) => { if (typeof u === 'string' && u.trim()) allowed.add(u.trim()); };

  for (const img of opts.images || []) add(img && img.url);
  for (const u of extractUrls(opts.message)) add(u);
  // 🔴 只取老板说过的那些条目。模型自己上一轮的回复不算「有人给过」—— 它在里面提议过的图库
  // 链接如果被收进来，下一轮就成了合法来源（见文件头 ③）。
  // 每条 message 的 content 可能是字符串，也可能是块数组（多模态）——整条 stringify 再抠，
  // 比逐层认形状稳；范围已经被 role 收窄了。
  for (const turn of opts.conversationHistory || []) {
    if (!turn || turn.role !== 'user') continue;
    try { for (const u of extractUrls(JSON.stringify(turn.content))) add(u); }
    catch (e) { /* 抠不出来就少一类来源，不改变「拒」的安全方向 */ }
  }
  if (opts.siteDir) {
    const fsmod = opts.fs || require('fs');
    const pathmod = require('path');
    const walk = (dir, depth) => {
      if (depth > 6) return;
      let entries;
      try { entries = fsmod.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
      for (const e of entries) {
        const full = pathmod.join(dir, e.name);
        if (e.isDirectory()) walk(full, depth + 1);
        else if (e.isFile() && e.name.endsWith('.json')) {
          // 🔴 **parse 之后只取图片位置上的值** —— 不是扫原文抠 URL（#1199 ②）。
          //    扫原文的话，模型上一轮写在**任何文本字段**里的任何一个 http(s) 地址，这一轮都成了
          //    「有人给过的」：它在正文里提一句 Unsplash，下一轮就能把同一个地址写进 imageUrl。
          //    那是一条把编造洗白成合法来源的通道，方向恰好是这道闸要治的那一支 —— 而文件头 ③
          //    为聊天历史立的判据正好否掉它：「判据始终是**有人**给过，模型自己不是那个人」。
          //    站里的 .json 大半是模型自己写的，所以这一类必须收窄到「它已经**是这个站上的一张图**」。
          try { for (const u of collectImagePositions(JSON.parse(fsmod.readFileSync(full, 'utf-8')))) add(u); }
          catch (err) { /* 读不到 / 不是合法 JSON 就少一类来源，不改变「拒」的安全方向 */ }
        }
      }
    };
    walk(opts.siteDir, 0);
  }
  return allowed;
}

/**
 * 这次写入里有没有「谁都没给过」的图片地址？
 *
 * 🔴 **这句话是给【模型】看的回执，老板看不到它（#1207 AC7，整条链现读过一遍）**：
 *    `edit-site.js:688` 拿它当 `{ error }` 返回 → `executeTool` 的返回值 → `JSON.stringify`
 *    → `:1129` 那条 `tool_result` 发回模型。磁盘一个字节没动，模型在同一轮里改口重写。
 *    老板看到的是模型最后那段文字（那一路是 `Changes applied.`），不是这句。
 *    ⟹ 改这句话的读者只有模型。
 *    🔴 **老板看得见的图片文案【不存在】（#1209 更正）。** 这里原来写着「老板可见的那份文案在
 *    `edit-site.js` 的 SYSTEM_PROMPT `## Images` 段里」—— 那句是假的：`## Images`（`edit-site.js:840`）
 *    住在 `SYSTEM_PROMPT` 里，而 `SYSTEM_PROMPT` 唯一的去处是 `:1048` 那个 `system:` 字段，
 *    也就是**发给模型**的，老板一个字看不到。照那句话去改「给老板看的文案」会改错文件。
 *    2026-08-26 逐处找过一遍：dashboard 里跟图片有关的老板可见字符串只有一个
 *    `aria-label="Remove image"`（`ChatPanel.tsx:1155`，删附件那个按钮），没有任何一段讲
 *    「该怎么给图」的说明。⟹ 要给老板写这种文案的话，今天得**新造**一处，本文件里没有它的指路牌。
 *
 * 🔴 **措辞不许预设「它是一张图」（#1207 AC7）**：这道检查的判据从来是「这个地址有人给过吗」，
 *    而表里 `<object data>` / `<embed src>` 装的可能是一份 PDF。原来那句写着 `is an image URL`，
 *    于是模型挂一份第三方 PDF 被拒时收到的理由是一句**假话**（#1195 起四轮里四位 QA 都记过这一条）。
 *    现在说的是「这个**地址**没人给过你」+「你挂在它上面的东西会是坏的」，两种情形都说得通。
 *
 * @param {*} parsed        已经 JSON.parse 过的这次内容
 * @param {Set<string>} allowed
 * @returns {string|null}   null = 放行；字符串 = 拒绝的理由，原样回给模型
 */
function imageUrlRejection(parsed, allowed) {
  const known = allowed || new Set();
  // 🔴 过滤用的是 `isImageAddress`，它里面还是那个 `ADDR_HEAD_RE`、跟抠地址那把尺子同一个源串。
  //    写死 `/^https?:\/\//` 的话 `//host/…` 与 `data:…` **根本不进入判定** —— 不是"判成放行"，
  //    是连问都不问（#1199 ③）。
  // 🔴 `canonicalAddress` 在它里面、在前（#1209 / #1210）：这把尺子问的是「它长什么样」，而浏览器
  //    **在解析之前**先剥首尾 C0、剔掉 TAB/LF/CR、把前导那段 `/` `\` 与**主机**都归一化 —— 不先做
  //    这几下，`///h/x` · `ht<LF>tp://h/x` · `\x01http://h/x` · `//evil。example.com/x` 都是
  //    "连问都不问"（不是"判成放行"），跟 #1199 ③ / #1207 那两次同一个失败形状。
  const used = collectImagePositions(parsed).filter((v) => isImageAddress(v));
  const unknown = [...new Set(used)]
    .filter((u) => !addressForms(u).some((f) => known.has(f)));
  if (unknown.length === 0) return null;
  return 'Refusing this write: '
    + unknown.map((u) => `"${u}"`).join(', ')
    + (unknown.length === 1 ? ' is an address' : ' are addresses')
    + ' nobody gave you — not attached to this message, not typed in the'
    + " owner's message, and not already in this site's files. An address that was not given to you"
    + ' does not exist: whatever you hang on it — a picture, a PDF, an embed — comes out broken on the'
    + " owner's live site. Write only an address you were"
    + ' given verbatim (see "Images" in your instructions). If the owner asked for a picture and attached'
    + ' none, do not put any URL there — leave the field as you found it and ask them to attach the photo.';
}

/**
 * 附件地址要**当文本**发给模型。
 *
 * 🔴 这不是「顺手加点上下文」，是这条修法的承重件：图片是以
 * `{ type:'image', source:{ type:'url', url } }` 发出去的，而模型**看不见那个 url 字符串**
 * —— 实测（#1195，同一个模型 `claude-sonnet-4-6`）：只发图片块再问「你刚收到的图片地址是什么」，
 * 答的是 `NO_URL_AVAILABLE`。所以只在提示词里写一句「你可以用附件的 URL」是**做不到的指令**：
 * 那个 URL 从来没到过模型手里。
 */
function attachedImagesNote(images) {
  const list = images || [];
  if (list.length === 0) return '';
  const lines = list.map((img, i) => {
    const name = img && img.originalFilename ? `${img.originalFilename} — ` : '';
    return `${i + 1}. ${name}${(img && img.url) || ''}`;
  });
  return '\n\n---\nAttached images (these are the public, permanent URLs of the pictures above, in the same'
    + ' order). To put one on the site, copy its URL verbatim into an image field — see "Images" in your'
    + ' instructions:\n' + lines.join('\n');
}

module.exports = {
  IMAGE_FIELDS,
  styleElementBodies,
  cssUrlValues,
  stripFontFaces,
  extractUrls,
  canonicalAddress,
  isImageAddress,
  decodeEntities,
  splitSrcset,
  scanTags,
  extractHtmlImageUrls,
  collectImagePositions,
  collectAllowedImageUrls,
  imageUrlRejection,
  attachedImagesNote,
};
