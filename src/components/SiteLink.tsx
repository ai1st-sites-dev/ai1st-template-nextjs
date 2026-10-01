import Link from 'next/link';
import type { AnchorHTMLAttributes } from 'react';

/**
 * #1508 —— 块里凡是 href 可能是站内路径的链接都用它，不用裸 `<a>`。
 * 展示站跑在 basePath=/showcase 下，只有 `next/link` 会自动带前缀；指向 `/contact` 的裸 `<a>` 不吃前缀，
 * 根路径闸（deploy/cloud-dev/build-showcase-from-main.sh）就拒绝切换 —— #1489 那条让展示站冻了 7.4 小时。
 * 判据：以 `/` 开头、但不是协议相对的 `//…` ⟹ 站内，走 Link；`tel:` / `mailto:` / `http(s):` / `#…` 照旧裸 `<a>`。
 * 真站没有 basePath，两条路渲染出来的 href 一样。
 */
export function isSitePath(href: unknown): href is string {
  return typeof href === 'string' && href.startsWith('/') && !href.startsWith('//');
}

type Props = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { href?: string };

// 属性原样透传（不拆出 href），渲染出来的属性顺序跟调用处写的一样 —— 裸 `<a>` 那条路逐字节不变。
export default function SiteLink(props: Props) {
  return isSitePath(props.href) ? <Link {...props} href={props.href} /> : <a {...props} />;
}
