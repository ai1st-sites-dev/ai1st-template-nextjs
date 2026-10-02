// #1504 —— 评价平台的 logo 取哪个（三档，按顺序；正文「平台 logo」一节，Chris 2026-09-30）：
//   1. 有 `logoUrl` ⟹ 用上传的图（alt = 平台名）
//   2. 否则平台名是常见平台 ⟹ Bootstrap Icons 自带的品牌图标 + 品牌色（下面这张表）
//   3. 都没有 ⟹ 写平台名（粗体文字）
// 比较平台名时忽略大小写和首尾空格（" google " 也命中）。
//
// 🔴 这张表只收 `node_modules/bootstrap-icons/icons/` 里**真有**的图标（1.13.1 里 google / yelp / facebook 都在；
//    tripadvisor / trustpilot / houzz 这些**没有**，它们走第 3 档写名字）。加一行之前先 `ls` 那个目录；
//    `scripts/reviews-render.test.js` 逐行核图标文件在不在。
// 📌 今天只有 reviews 用它。testimonials 的 summary 以后要画平台 logo 时引这一份，别再抄一张。

const PLATFORM_ICONS = {
  google: { icon: 'google', color: '#4285F4' },
  yelp: { icon: 'yelp', color: '#d32323' },
  facebook: { icon: 'facebook', color: '#1877F2' },
};

function platformIcon(source) {
  const key = typeof source === 'string' ? source.trim().toLowerCase() : '';
  return Object.prototype.hasOwnProperty.call(PLATFORM_ICONS, key) ? PLATFORM_ICONS[key] : null;
}

/** 一个平台画哪一档 logo：`{ kind: 'image', logoUrl }` · `{ kind: 'icon', icon, color }` · `{ kind: 'name' }`。 */
function platformLogo(source, logoUrl) {
  if (typeof logoUrl === 'string' && logoUrl.trim()) return { kind: 'image', logoUrl: logoUrl.trim() };
  const hit = platformIcon(source);
  return hit ? { kind: 'icon', icon: hit.icon, color: hit.color } : { kind: 'name' };
}

module.exports = { PLATFORM_ICONS, platformIcon, platformLogo };
