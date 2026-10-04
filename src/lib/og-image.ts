// #1552 —— 分享卡的图（og:image）和 Twitter 卡型，全站一份。
//
// 三档，**每一档都跳过 `.svg`**（当它不存在、往下一档走 —— Facebook / X / LinkedIn 都不渲染 SVG，而 skipAI 填图槽
// 的占位图就是 `/images/grid-pattern.svg`，`scripts/create-site.js` §PLACEHOLDER_IMAGE_URL）：
//   ① 首页 hero 块的图 —— 读 hero 渲染器读的那个字段（`blocks/hero/Section.tsx` 的 `d.image.imageUrl`），
//      渲染器显示不出来的就不是 hero 图；
//   ② 品牌 logo 图（`brand.json` 的 `logoUrl`；`logoIcon` 是图标名，不是图）；
//   ③ 两样都没有 ⟹ 不出 og:image，卡型从 `summary_large_image` 降成 `summary`（声明大图卡却没有图，就是本票要治的）。
//
// 🔴 **每页都出同一张，按站的默认语言首页取。** 页面级 `generateMetadata` 的 `openGraph` 会整份替掉根布局那份
//    （Next 不逐键合并），所以根布局和 `metadata.ts` 的四个构造器都要接这里 —— 只接一处，别的页就没有图。
// 地址原样给 Next：相对地址（`/logo.png`）由根布局的 `metadataBase`（`seo.domain`）补成绝对地址。
import { brand, defaultLocale, getHomePage } from '@/lib/config';

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isSvg = (url: string) => /\.svg(?:[?#]|$)/i.test(url);
const usable = (url: unknown): string | null => {
  if (typeof url !== 'string') return null;
  const u = url.trim();
  return u && !isSvg(u) ? u : null;
};

/** 这个站的分享图地址；没有可用的图 ⟹ `null`（第三档）。 */
export function siteOgImage(): string | null {
  const home = getHomePage(defaultLocale);
  for (const b of home?.blocks ?? []) {
    if (!b || b.type !== 'hero' || !isObj(b.data) || !isObj(b.data.image)) continue;
    const img = usable(b.data.image.imageUrl);
    if (img) return img;
  }
  return usable(brand.logoUrl);
}

/** 塞进 `openGraph` 的那一段：有图 `{ images: [url] }`，没图 `{}`（一个键都不多）。 */
export function ogImageFields(): { images?: string[] } {
  const img = siteOgImage();
  return img ? { images: [img] } : {};
}

/** Twitter 卡型：有图才声明大图卡。 */
export function twitterCard(): 'summary_large_image' | 'summary' {
  return siteOgImage() ? 'summary_large_image' : 'summary';
}
