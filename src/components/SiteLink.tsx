import type { AnchorHTMLAttributes } from 'react';

/**
 * #1508 —— 块里凡是 href 可能是站内路径的链接都用它，不用裸 `<a>`。
 * 判据：以 `/` 开头、但不是协议相对的 `//…` ⟹ 站内，前面拼上 basePath；`tel:` / `mailto:` / `http(s):` / `#…` 原样。
 * #1794 —— 不再走 `next/link`（块要在 dashboard 的 Vite 画布和发布渲染脚本里跑，两边都没有 Next）⟹ 站内链接点了是整页刷新。
 * basePath 原来由 Next 自动带，现在自己拼：展示站跑在 `/showcase` 下，它那份一次性 `next.config.js`
 * （deploy/cloud-dev/build-showcase-from-main.sh）把 `AI1ST_BASE_PATH` 写进 `env`，Next 构建时字面替换进两份包。
 * 不拼的话 `/contact` 不吃前缀，根路径闸就拒绝切换 —— #1489 那条让展示站冻了 7.4 小时。真站是空串，href 跟以前一样。
 * 🔴 `typeof process` 那一截不能省：画布（Vite）的浏览器里没有 `process`，裸写会 `process is not defined`。
 */
export function isSitePath(href: unknown): href is string {
  return typeof href === 'string' && href.startsWith('/') && !href.startsWith('//');
}

const BASE_PATH = (typeof process !== 'undefined' && process.env.AI1ST_BASE_PATH) || '';

/** 站内路径拼上 basePath；`/` 本身跟 Next 一样落成 `/showcase`（不带尾斜杠）。 */
export function withBasePath(href: string): string {
  if (!BASE_PATH) return href;
  return href === '/' ? BASE_PATH : href.startsWith('/?') || href.startsWith('/#') ? BASE_PATH + href.slice(1) : BASE_PATH + href;
}

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { href?: string };

// 非站内那条：属性原样透传（不拆出 href），顺序跟调用处写的一样 —— 逐字节不变。
// 站内那条：href 放在最后，跟 `next/link` 渲染出来的顺序一样（它把 href 排在其余属性后面）⟹ 发布出去的 HTML 逐字节不变。
// 🔴 #1794 从 `<Link>` 改过来的调用处（Button 和五个块）把 `href` 写在最后：`next/link` 对【任何】href（`tel:` / `#` 也算）都把它排最后，
//    写在最后 ⟹ 两条路都跟以前逐字节一样（实测：不这么写，`tel:` 按钮的属性顺序在 40 份导出 HTML 里有 8 份变了）。
export default function SiteLink(props: Props) {
  if (!isSitePath(props.href)) return <a {...props} />;
  const { href, ...rest } = props;
  return <a {...rest} href={withBasePath(href)} />;
}
