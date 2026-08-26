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

// HTML 字符串里画出来的图（#1199 ①）。博客正文是**唯一**一个把配置里的字符串当 HTML 渲染的面
// （`src/components/pages/BlogPostPage.tsx:56` 的 `dangerouslySetInnerHTML`；全仓 9 处
// `dangerouslySetInnerHTML` 里另外 8 处画的是 JSON-LD 和内联脚本，不吃配置字符串）。
// 而 `blog/*.json` 是可写的（`editable-files.js:99`）⟹ 同一个编造地址换到这一面就画成一张裂图。
// 两种机制都收：`<img src>` 和 `style="…url(…)"`。
// 🔴 `url()` 只在 `style=` 属性**里面**认。整段文本里认的话，一篇讲 CSS 的博客里一行
//    `background-image: url(https://example.com/a.png)` 的代码示例会被当成一张图而整份拒收。
const HTML_IMG_SRC_RE = /<img\b[^>]*?\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
const HTML_STYLE_ATTR_RE = /\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
const CSS_URL_RE = /\burl\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/gi;

const firstGroup = (m) => {
  for (let i = 1; i < m.length; i += 1) if (m[i] !== undefined) return m[i];
  return '';
};

/** 任意文本里出现过的图片地址（http(s):// · 协议相对 //host/… · data:）。 */
function extractUrls(text) {
  if (typeof text !== 'string' || !text) return [];
  return (text.match(URL_RE) || [])
    .map((u) => u.replace(TRAILING_PUNCT_RE, ''))
    .filter(Boolean);
}

/** 一段 HTML 里真的会被画成图片的那些地址：`<img src>` + `style="…url(…)"`。 */
function extractHtmlImageUrls(text) {
  if (typeof text !== 'string' || !text) return [];
  const out = [];
  for (const m of text.matchAll(HTML_IMG_SRC_RE)) {
    const v = firstGroup(m).trim();
    if (v) out.push(v);
  }
  for (const sm of text.matchAll(HTML_STYLE_ATTR_RE)) {
    const style = firstGroup(sm);
    for (const um of String(style).matchAll(CSS_URL_RE)) {
      const v = firstGroup(um).trim();
      if (v) out.push(v);
    }
  }
  return out;
}

/**
 * 这份 JSON 里每一个**图片位置**上的地址。两类位置，缺一不可：
 *   ① 图片字段（`IMAGE_FIELDS`）的值 —— 模板按 `<img src={…}>` 画出来的
 *   ② 任意字符串值里的 HTML 图片 —— 博客正文按 HTML 渲染（见 HTML_IMG_SRC_RE 上面那段）
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
  extractHtmlImageUrls,
  collectImagePositions,
  collectAllowedImageUrls,
  imageUrlRejection,
  attachedImagesNote,
};
