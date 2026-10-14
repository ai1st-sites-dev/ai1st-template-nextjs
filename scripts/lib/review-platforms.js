// #1504 —— 评价平台的 logo 取哪个（三档，按顺序；正文「平台 logo」一节，Chris 2026-09-30）：
//   1. 有 `logoUrl` ⟹ 用上传的图（alt = 平台名）
//   2. 否则平台名认得出是常见平台 ⟹ 模板自带的那个全彩 logo 文件（下面这张表）
//   3. 都没有 ⟹ 写平台名（粗体文字）
// #1766 —— 第 2 档从 Bootstrap Icons 的单色字形换成模板自带的全彩文件（Chris 2026-10-13：「常见的几个 review 的 platform，
//    我们可以自己出 logo」）。字形只能染一种色（Google 的 G 是四色），也没有 Google Maps。
//
// 🔴 这张表就是「常见平台」的唯一一份：reviews / testimonials 的平台 logo、logos 块里写的平台 logo 路径、拖下 reviews 块
//    播的那三个平台、AI 提示词里列的文件，都从这里取。加一个平台 = 加一行 + 往 `public/images/platforms/` 放一个文件；
//    `scripts/reviews-render.test.js` 逐行核那个文件真的在。
// 🔴 文件是各平台官方品牌素材的原版，不改色、不改形：
//    google.svg       Google「G」—— commons.wikimedia.org/wiki/File:Google_%22G%22_logo.svg
//    google-maps.svg  Google Maps 图标（2020）—— commons.wikimedia.org/wiki/File:Google_Maps_icon_(2020).svg（补了固有宽高）
//    yelp.svg         Yelp burst —— yelp.com/brand（形状取自 simple-icons，填 Yelp 品牌红 #FF1A1A）
//    facebook.svg     Facebook「f」（2023）—— commons.wikimedia.org/wiki/File:2023_Facebook_icon.svg
//
// 认平台名（§platformKey）：忽略大小写、首尾空格和中间多余的空格，再查 `names`（每一行自己的常见写法）。
// 不做前缀匹配：「Google Maps」必须认成 Google Maps 而不是 Google，前缀规则一碰就错；写法有了新的就往 `names` 里加。

const PLATFORMS = {
  google: { name: 'Google', logo: '/images/platforms/google.svg', names: ['google', 'google reviews', 'google business profile', 'google business', 'google my business'] },
  'google-maps': { name: 'Google Maps', logo: '/images/platforms/google-maps.svg', names: ['google maps'] },
  yelp: { name: 'Yelp', logo: '/images/platforms/yelp.svg', names: ['yelp', 'yelp reviews'] },
  facebook: { name: 'Facebook', logo: '/images/platforms/facebook.svg', names: ['facebook', 'facebook reviews'] },
};

const BY_NAME = new Map();
for (const [key, p] of Object.entries(PLATFORMS)) for (const n of p.names) BY_NAME.set(n, key);

/** 平台名 → 表里的键（`google` / `google-maps` / `yelp` / `facebook`）；认不出 ⟹ null。 */
function platformKey(source) {
  const n = typeof source === 'string' ? source.trim().toLowerCase().replace(/\s+/g, ' ') : '';
  return BY_NAME.get(n) || null;
}

/** 平台名 → 表里那一行 `{ key, name, logo }`；认不出 ⟹ null。 */
function platformOf(source) {
  const key = platformKey(source);
  return key ? { key, name: PLATFORMS[key].name, logo: PLATFORMS[key].logo } : null;
}

/**
 * 一个平台画哪一档 logo：`{ kind: 'image', logoUrl }`（上传的）· `{ kind: 'platform', logoUrl }`（模板自带的文件）· `{ kind: 'name' }`。
 */
function platformLogo(source, logoUrl) {
  if (typeof logoUrl === 'string' && logoUrl.trim()) return { kind: 'image', logoUrl: logoUrl.trim() };
  const hit = platformOf(source);
  return hit ? { kind: 'platform', logoUrl: hit.logo } : { kind: 'name' };
}

module.exports = { PLATFORMS, platformKey, platformOf, platformLogo };
