'use strict';

/**
 * site-shape.js — 这个站的内容文件住在哪（#1109）
 *
 *   const { readSiteShape } = require('./lib/site-shape.js');
 *   readSiteShape(siteDir);   // { flat: false, locales: ['en','zh'] }  多语言站：内容在 site/<语言>/
 *                             // { flat: true,  locales: [] }          老扁平站：内容直接在 site/
 *                             // null                                  问不出来（不许当成任何一个答案）
 *
 * ── 为什么要有它（#1109）───────────────────────────────────────────────────────────────────────
 * `lib/editable-files.js` 那张白名单只看**文件名**，不看这个站是什么形状。于是在多语言站上，
 * 模型往**根目录**写 `seo.json` / `services.json` / `pages/*.json` 会被放行 —— 文件真的落盘、
 * `sync-config` rc=0、正常 commit + push、老板收到「Done」，**而站上一个像素都没变**：构建在
 * 多语言模式下只读 `site/<locale>/` 那一份（`sync-config.js` 的 `localeDir`）。反方向同样：
 * 老扁平站上写 `<locale>/seo.json` 也没人读。
 *
 * 这是「做了一件看起来成功、其实没有效果的事」，比 #1087 治的「说了一句假话」更难被发现 ——
 * 没有任何一层会红。所以白名单必须先知道**这个站是什么形状**。
 *
 * ── 判据跟构建是同一条，这一点是承重的 ────────────────────────────────────────────────────────
 * 🔴 「多语言还是扁平」的唯一判据是 **`site_meta.json` 在不在**，因为构建自己就是这么判的：
 *    `sync-config.js` 的 `if (!fs.existsSync(siteMetaPath)) { … isLegacySchema = true }`，随后
 *    `localeDir = isLegacySchema ? siteDir : path.join(siteDir, locale)`。
 *    这里**不许**发明第二条判据（比如「有没有 site/en/ 这个目录」）：那样「构建会不会读这条路径」
 *    就有了两个答案，而两份实现必然分叉 —— 分叉之后这道门会开始拒一个真读得到的路径，或者放行一个
 *    读不到的，两个方向都回到本票要治的形状。
 * 🔴 也不许只看「locales 里有没有值」：扁平站在 `sync-config.js` 里 `locales` 同样是 `['en']`，
 *    而它的文件住在 `site/seo.json`、**不是** `site/en/seo.json`。`lib/remediation.js` 的 `navRelPath`
 *    上面记着同一个坑（那里第一版就是这么写错的，夹具是多语言站所以没红）。
 *
 * ── 三个返回值分别是什么，别互相替代 ──────────────────────────────────────────────────────────
 * · `{ flat: false, locales: [...] }` —— 多语言。`locales` 只用来把拒绝的理由说具体（「这个站有
 *   en、zh」），**它为空不代表形状不确定**：`site_meta.json` 在、但读不出来（不是合法 JSON、
 *   没有 locales 数组）时形状仍然是多语言，只是那句话里不点语言名。
 * · `{ flat: true, locales: [] }` —— 扁平。
 * · `null` —— 连 `site/` 这个目录都不在，或者读它就抛。**调用方拿到 null 必须什么都不判**：
 *   这里最容易犯的错是把「读不到」当成「扁平」（`fs.existsSync` 对一个不存在的目录里的文件也返回
 *   false），那会在一个多语言站上把 `en/seo.json` 拒掉，理由还是一句「这个站是扁平的」假话。
 */

const fs = require('fs');
const path = require('path');

/**
 * @param {string} siteDir `site/` 的绝对路径
 * @returns {{flat: boolean, locales: string[]}|null} null = 问不出来
 */
function readSiteShape(siteDir) {
  if (typeof siteDir !== 'string' || siteDir === '') return null;
  // 🔴 先证「这个站目录真的在」。少了这一步，一个打错的路径会安静地被判成扁平站（见文件头第三条）。
  try {
    if (!fs.statSync(siteDir).isDirectory()) return null;
  } catch (e) {
    return null;
  }

  const metaPath = path.join(siteDir, 'site_meta.json');
  let hasMeta;
  try {
    hasMeta = fs.existsSync(metaPath);
  } catch (e) {
    return null;
  }
  if (!hasMeta) return { flat: true, locales: [] };

  let locales = [];
  try {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
    if (meta && Array.isArray(meta.locales)) {
      locales = meta.locales.filter((l) => typeof l === 'string' && l !== '');
    }
  } catch (e) {
    // 读不出来 ⟹ 语言名说不出来，但形状是确定的（文件在）。见文件头第三条。
    locales = [];
  }
  return { flat: false, locales };
}

module.exports = { readSiteShape };
