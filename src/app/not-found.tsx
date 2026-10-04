// #1552 —— 真 404。静态导出时它就是 `out/404.html`；Cloudflare worker 取不到对象时先找 `<siteId>/404.html`，
// 有就以 HTTP 404 返回（`cloudflare/worker.js` §404），所以这一页就是线上「不存在的地址」看到的那一页。
// 🔴 **按站的默认语言出**：CF 只认一份 `404.html`，多语言站也只有这一份。文字取 `component-labels` 那张表。
// 外框照常走 SiteShell（页头 / 页脚 / 主题），看起来是这个站的一页，不是浏览器的裸错误页。
import Link from 'next/link';
import SiteShell from '@/components/SiteShell';
import { buttonClass } from '@/components/Button';
import { defaultLocale, localeUrl } from '@/lib/config';
import { getLabels } from '@/lib/component-labels';

export default function NotFound() {
  const labels = getLabels(defaultLocale);
  return (
    <SiteShell locale={defaultLocale}>
      <section className="py-16 py-lg-24" data-not-found="">
        <div className="container">
          <div className="text-center mx-auto mw-read">
            <h1 className="display-5 ls-tight fw-bolder text-heading">{labels.pageNotFound}</h1>
            <p className="lead text-body-secondary mt-4 mb-8">{labels.pageNotFoundBody}</p>
            <Link href={localeUrl('home', defaultLocale)} className={buttonClass('solid', { size: 'lg' })} data-not-found-home="">
              {labels.backToHome}
            </Link>
          </div>
        </div>
      </section>
    </SiteShell>
  );
}
