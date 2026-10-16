// #1552 —— 真 404 的那一页（Next 那边是 `app/not-found.tsx` 渲染它，`render/` 出 `404.html` 也渲染它）。
// 🔴 **按站的默认语言出**：CF 只认一份 `404.html`，多语言站也只有这一份。文字取 `component-labels` 那张表。
// 外框照常走 SiteShell（页头 / 页脚 / 主题），看起来是这个站的一页，不是浏览器的裸错误页。
// #1802 —— 从 `app/not-found.tsx` 搬出来，不 import Next：`next/link` 换成 `SiteLink`，href 写在最后（跟 `next/link` 输出的
// 属性顺序一样，Next 导出的 `404.html` 逐字节不变）。
import SiteShell from '@/components/SiteShell';
import SiteLink from '@/components/SiteLink';
import { buttonClass } from '@/components/Button';
import { localeUrl } from '@/lib/config';
import type { SiteData } from '@/lib/types/config';
import { getLabels } from '@/lib/component-labels';

export default function NotFoundPage({ site }: { site: SiteData }) {
  const { defaultLocale } = site;
  const labels = getLabels(defaultLocale);
  return (
    <SiteShell site={site} locale={defaultLocale} currentPath="/" notFound>
      <section className="py-16 py-lg-24" data-not-found="">
        <div className="container">
          <div className="text-center mx-auto mw-read">
            <h1 className="display-5 ls-tight fw-bolder text-heading">{labels.pageNotFound}</h1>
            <p className="lead text-body-secondary mt-4 mb-8">{labels.pageNotFoundBody}</p>
            <SiteLink className={buttonClass('solid', { size: 'lg' })} data-not-found-home="" href={localeUrl(site, 'home', defaultLocale)}>
              {labels.backToHome}
            </SiteLink>
          </div>
        </div>
      </section>
    </SiteShell>
  );
}
