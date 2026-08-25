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
 *   ④ 这个站自己的文件里已经有的（`site/**.json`）—— 这一类让「把首页那张图挪到关于页」照常能做
 *
 * 🔴 **不用「这个 URL 取得到吗」当判据。** 那要发网络请求：慢、会因为一次抖动把好地址判死，
 *    而且它对「取得到、但根本不是老板给的那张」完全无话可说 —— 而那正是 Unsplash 那一支的形状。
 * 🔴 相对路径（`/photos/hero.jpg`）不在射程内：它们由 `create-site.js` 生成、跟着站一起构建，
 *    不是外链，编不出祸来。只判 `http://` / `https://`。
 *
 * ── 拒绝的方向是有意的 ────────────────────────────────────────────────────────────────────────
 *   · 误拒（老板给过、这里没认出来）⟹ 模型当场拿到一句点名的错误，同一轮里改口去问老板。吵，但安全。
 *   · 误放（模型编的地址落盘）      ⟹ 没有任何人会知道，直到老板自己看见一张裂图。静，而且已经发生过。
 */

// 会被画成 <img src> 的字段名。判据不是这份手抄清单，而是 `image-urls.test.js` 里那道
// 两向守卫：它从 `src/components/**` 现读一遍，多一个少一个都当场红。
const IMAGE_FIELDS = ['imageUrl', 'logoUrl'];

const URL_RE = /https?:\/\/[^\s"'`<>)\]]+/gi;

/** 任意文本里出现过的 http(s) 地址。 */
function extractUrls(text) {
  if (typeof text !== 'string' || !text) return [];
  return text.match(URL_RE) || [];
}

/** 这份 JSON 里，图片字段上写着的值（不管深浅，数组/对象都走一遍）。 */
function collectImageFieldValues(node, out) {
  const acc = out || [];
  if (Array.isArray(node)) {
    for (const v of node) collectImageFieldValues(v, acc);
    return acc;
  }
  if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (IMAGE_FIELDS.includes(k) && typeof v === 'string') acc.push(v.trim());
      else collectImageFieldValues(v, acc);
    }
  }
  return acc;
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
          try { for (const u of extractUrls(fsmod.readFileSync(full, 'utf-8'))) add(u); }
          catch (err) { /* 读不到就少一类来源 */ }
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
  const used = collectImageFieldValues(parsed)
    .filter((v) => /^https?:\/\//i.test(v));
  const unknown = [...new Set(used)].filter((u) => !known.has(u));
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
  collectImageFieldValues,
  collectAllowedImageUrls,
  imageUrlRejection,
  attachedImagesNote,
};
