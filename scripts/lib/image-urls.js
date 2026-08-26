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
 *    不是外链，编不出祸来。判的是 `http(s)://` · 协议相对 `//host/…` · `data:` 三种（#1199 ③：
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
//    一起构建，编不出祸来。`//` 那一支的先行断言（后面必须跟 `域名.`）就是用来把它挡在外面的。
const ADDR_HEAD = '(?:https?:\\/\\/|\\/\\/(?=[\\w-]+\\.)|data:[\\w.+-]+\\/[\\w.+-]+[;,])';
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
//      一块坏掉的嵌入，跟一张裂图是同一个后果。代价写在明处：老板没打过字的第三方 PDF 会被整份拒掉，
//      而模型收到的那句话仍写着「is an image URL」——**那句措辞归作者定**（两位 QA 都记了这一条，
//      都判非阻断；改它要动 #1195/#1199 调过的那段产品文案，不是本票的范围）。
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
const HTML_STYLE_EL_RE = /<style\b[^>]*>([\s\S]*?)(?:<\/style>|$)/gi;
const CSS_URL_RE = /\burl\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi;
// 🔴 `@font-face` 里的 `url()` 装的是**字体**，不是图 —— 整块先剔掉再找地址。
//    这是 #1204 r1 造出来的一个误拒：`origin/main` 只看 `style=` 属性、看不到 `<style>` 元素，
//    所以一篇用了 webfont 的博客在 main 上放行、在 r1 上被**整份**拒掉，而模型收到的原话还说
//    那个 `.woff2` 「is an image URL」。两位 QA 都报了这一条（QA1 非阻断① / QA2 还剩什么①）。
//    📌 它不是绕过通道：`@font-face` 注册的是字体，浏览器不会把它画成一张图。
const CSS_FONT_FACE_RE = /@font-face\s*\{[^}]*\}/gi;

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
    .filter(Boolean);
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
    const noFonts = String(css).replace(CSS_FONT_FACE_RE, '');
    for (const um of noFonts.matchAll(CSS_URL_RE)) push(firstGroup(um));
  };
  for (const { tag, body } of scanTags(text)) {
    const wanted = IMAGE_ATTRS[tag] || null;
    for (const am of body.matchAll(HTML_ATTR_RE)) {
      const name = am[1].toLowerCase();
      const value = firstGroup(am, 2);
      // `style=` 在任何标签上都认（表里那几个标签之外的 <div style> 照样画得出图）。
      if (name === 'style') { pushCss(value); continue; }
      if (!wanted || !wanted.includes(name)) continue;
      if (SRCSET_ATTRS.has(name)) for (const u of splitSrcset(value)) push(u);
      else push(value);
    }
  }
  for (const sm of text.matchAll(HTML_STYLE_EL_RE)) pushCss(sm[1] || '');
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
 */
function addressForms(u) {
  const forms = [u];
  if (u.startsWith('//')) forms.push('https:' + u, 'http:' + u);
  else {
    const m = u.match(/^https?:(\/\/.*)$/i);
    if (m) forms.push(m[1]);
  }
  return forms;
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
 * @param {*} parsed        已经 JSON.parse 过的这次内容
 * @param {Set<string>} allowed
 * @returns {string|null}   null = 放行；字符串 = 拒绝的理由，原样回给模型
 */
function imageUrlRejection(parsed, allowed) {
  const known = allowed || new Set();
  // 🔴 过滤用的是 `ADDR_HEAD_RE`，跟抠地址那把尺子同一个源串。写死 `/^https?:\/\//` 的话
  //    `//host/…` 与 `data:…` **根本不进入判定** —— 不是"判成放行"，是连问都不问（#1199 ③）。
  const used = collectImagePositions(parsed).filter((v) => ADDR_HEAD_RE.test(v));
  const unknown = [...new Set(used)]
    .filter((u) => !addressForms(u).some((f) => known.has(f)));
  if (unknown.length === 0) return null;
  return 'Refusing this write: '
    + unknown.map((u) => `"${u}"`).join(', ')
    + (unknown.length === 1 ? ' is an image URL' : ' are image URLs')
    + ' that nobody gave you — it is not one of the images attached to this message, it is not in the'
    + " owner's message, and it is not already in this site's files. An address that was not given to you"
    + " does not exist: it renders as a broken image on the owner's live site. Write only a URL you were"
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
  extractUrls,
  splitSrcset,
  scanTags,
  extractHtmlImageUrls,
  collectImagePositions,
  collectAllowedImageUrls,
  imageUrlRejection,
  attachedImagesNote,
};
