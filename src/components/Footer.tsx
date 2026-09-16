import Link from 'next/link';
import ServiceIcon from '@/components/ServiceIcon';
import { blockAttrs } from '@/lib/sections/blockAttrs';
import type { BlockConfig } from '@/lib/types/config';
import { brand, defaultLocale, getNavigation, getServices, getBrandName, pagesByLocale, regions } from '@/lib/config';

const socialIcons: Record<string, { label: string; icon: React.ReactNode }> = {
  google: { label: 'Google', icon: <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12.48 10.92v3.28h7.84c-.24 1.84-.853 3.187-1.787 4.133-1.147 1.147-2.933 2.4-6.053 2.4-4.827 0-8.6-3.893-8.6-8.72s3.773-8.72 8.6-8.72c2.6 0 4.507 1.027 5.907 2.347l2.307-2.307C18.747 1.44 16.133 0 12.48 0 5.867 0 .307 5.387.307 12s5.56 12 12.173 12c3.573 0 6.267-1.173 8.373-3.36 2.16-2.16 2.84-5.213 2.84-7.667 0-.76-.053-1.467-.173-2.053H12.48z"/></svg> },
  yelp: { label: 'Yelp', icon: <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24"><path d="M20.16 12.594l-4.995 1.433c-.96.276-1.74-.8-1.176-1.63l2.905-4.308a1.072 1.072 0 011.596-.206 7.26 7.26 0 012.103 3.2c.247.852-.48 1.644-1.433 1.511zm-3.12 5.916a7.26 7.26 0 01-2.91 2.07c-.88.32-1.78-.37-1.56-1.28l1.14-5.08c.22-.96 1.46-1.14 1.94-.28l2.47 4.4c.38.48.08 1.2-.48 1.4zM12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1.2 15.36c-.2.94-1.52 1.14-1.94.28l-2.5-4.4c-.38-.68.08-1.5.88-1.64l5.06-1.14c.96-.22 1.58.94 1 1.72l-2.5 5.18zm-3.86-6.2a1.07 1.07 0 01-1.18-1.14 7.26 7.26 0 011.58-3.46c.58-.68 1.62-.52 1.86.28l1.44 5.06c.28.96-.68 1.78-1.64 1.28l-2.06-.02z"/></svg> },
  facebook: { label: 'Facebook', icon: <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg> },
  instagram: { label: 'Instagram', icon: <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg> },
  linkedin: { label: 'LinkedIn', icon: <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg> },
  tiktok: { label: 'TikTok', icon: <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/></svg> },
  twitter: { label: 'X', icon: <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg> },
  whatsapp: { label: 'WhatsApp', icon: <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg> },
};

// TICKET-129: defaultLocale uses root URL alias (no /<locale> prefix).
function localizeHref(href: string, locale: string): string {
  if (!href.startsWith('/') || href.startsWith('//')) return href;
  if (locale === defaultLocale) return href;
  if (href === '/') return `/${locale}`;
  return `/${locale}${href}`;
}

// TICKET-123: minimal i18n map for Footer-internal labels (Services / Contact Us
// are hardcoded here; per-locale nav links / column titles already come from
// getNavigation(locale)). Keeps the 14-lang whitelist aligned with TICKET-122a's
// langMap so future副语言 ticket auto-covers. Unknown locales fall back to en.
const FOOTER_LABELS: Record<string, { services: string; contact: string }> = {
  en: { services: 'Services',  contact: 'Contact Us' },
  zh: { services: '服务',        contact: '联系我们' },
  fr: { services: 'Services',  contact: 'Nous contacter' },
  es: { services: 'Servicios', contact: 'Contáctenos' },
  ja: { services: 'サービス',     contact: 'お問い合わせ' },
  ko: { services: '서비스',       contact: '문의하기' },
  de: { services: 'Dienste',   contact: 'Kontakt' },
  it: { services: 'Servizi',   contact: 'Contattaci' },
  pt: { services: 'Serviços',  contact: 'Contato' },
  ru: { services: 'Услуги',      contact: 'Связаться с нами' },
  vi: { services: 'Dịch vụ',   contact: 'Liên hệ' },
  ar: { services: 'الخدمات',       contact: 'اتصل بنا' },
  hi: { services: 'सेवाएँ',        contact: 'संपर्क करें' },
  th: { services: 'บริการ',        contact: 'ติดต่อเรา' },
};

// 🔴🔴 #1353 — ONE MARKUP。页脚跟顶栏同一批从「一变体一棵树」搬进形态层（设计文档 D14）。
//
// 走了三棵树：`multi-column`（多列大脚，也是没换装时的默认）、`slim-row`（单行小脚）、
// `cta-band`（强调色 CTA 色带 + 小脚）。今天是下面这同一副骨架，排版住在 `public/shapes.css` 的
// `[data-block="footer"][data-shape="…"]`，间距和皮住在 `public/base.css` 与主题表。
//
// 🔴 这个文件里【一个 Tailwind 响应式类都不许有】（AC2 逐条 grep `(sm|md|lg|xl):`）。三支原来一共
//    14 处，它们说的是「小屏一列、中屏两列、大屏四列」—— 那是几何，归 shapes.css 的 `@media`。
//
// 🔴 `regionLayout` 不再从这里读。结构走跟别的块同一条路：主题的**选择单**
//    （`scripts/theme-pool.json` 的 `shapes.footer`）→ 构建期算好 → `regions.footer.shape`。
//
// 🔴 每一个零件都恒在 DOM 里，谁露面由 CSS 说（D14 第 2 句）。三支各自少画的那些东西 ——
//    `slim-row` 不画描述和服务/联系两栏、`cta-band` 不画导航栏目 —— 今天是靠**不渲染**做的，
//    也就是三棵不同的树。搬进形态层之后它们是同一棵树上被 `display:none` 关掉的零件。
//    🔴 `slim-row` 那一行里的邮箱是靠 `.footer__col--contact { display: contents }` 把联系那一栏
//    摊平、只留邮箱做到的 —— 不是把邮箱在 DOM 里挪个位置。挪位置就是 D14 第 1 句说的「另一个块」。
//
// 🔴 `variant` 这个 prop 的来历没变（#1000）：只在**同一个布局里出现多个页脚区**时才传
//    （`tri-footer` 的 footer-a/b/c），主题每类区只给一个值、分不出第几个。它今天传的是**形态名**，
//    跟选择单同一套名字（`page-layouts/*.json` 的 `repeatVariants`，构建期对着 manifest 的形态清单校验）。
export default function Footer({ locale, variant: variantOverride }: { locale: string; variant?: string }) {
  const { footer } = getNavigation(locale);
  const services = getServices(locale);
  const localePages = pagesByLocale[locale] ?? [];
  const labels = FOOTER_LABELS[locale] ?? FOOTER_LABELS.en;
  const currentYear = new Date().getFullYear();
  const links = brand.socialLinks
    ? (Array.isArray(brand.socialLinks)
        ? brand.socialLinks.map(l => [l.platform, l.url] as [string, string])
        : Object.entries(brand.socialLinks)
      ).filter(([, url]) => url)
    : [];
  const serviceDetailSlugs = new Set(
    localePages.filter(p => p.slug.startsWith('services/') && p.slug !== 'services').map(p => p.slug.replace('services/', ''))
  );

  const shape = variantOverride || regions.footer.shape;
  const footerBlock = { type: 'footer', shape, role: 'essential' } as unknown as BlockConfig;

  const serviceHref = (id: string) =>
    localizeHref(serviceDetailSlugs.has(id) ? `/services/${id}` : `/services#${id}`, locale);

  return (
    <footer {...blockAttrs('footer', footerBlock)} className="footer">
      {/* 强调色 CTA 色带。`cta-band` 之外的形态把它关掉。 */}
      <div className="footer__cta" data-role="optional">
        <div className="footer__cta-text">
          <p className="footer__cta-title">{getBrandName(locale)}</p>
          <p className="footer__cta-sub">{footer.description}</p>
        </div>
        <Link href={localizeHref(getNavigation(locale).header.cta.href, locale)} className="footer__cta-link">
          {getNavigation(locale).header.cta.label}
        </Link>
      </div>

      <div className="footer__body">
        <div className="footer__brand" data-role="optional">
          <div className="footer__brand-id">
            {brand.logoUrl ? (
              // TICKET-192: 白底药丸把 logo 托起来 —— 深色页脚上，logo 自己的颜色和透明通道都不可靠。
              // 修之前那套 brightness+invert 滤镜假定 logo 背景透明，而 AI 生成的 PNG（提示词强制
              // "pure white background"）和用户上传的 JPG 都不是，整个包围盒被刷成纯白。
              <span className="footer__logo-pill">
                <img src={brand.logoUrl} alt={getBrandName(locale)} className="footer__logo-img" />
              </span>
            ) : (
              <span className="footer__logo-mark">
                <ServiceIcon icon={brand.logoIcon} className="footer__logo-icon" />
              </span>
            )}
            {/* TICKET-159: icon-only logo 或干脆没有 logo 时补一行公司名；用户自传的认为自带字标。 */}
            {(!brand.logoUrl || !brand.logoHasWordmark) && (
              <span className="footer__logo-name">{getBrandName(locale)}</span>
            )}
          </div>
          <p className="footer__desc">{footer.description}</p>
          {links.length > 0 && (
            <div className="footer__social">
              {links.map(([platform, url]) => {
                const info = socialIcons[platform];
                return (
                  <a
                    key={platform}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={info?.label || platform}
                    className="footer__social-link"
                  >
                    {info?.icon || <span className="footer__social-fallback">{platform[0]}</span>}
                  </a>
                );
              })}
            </div>
          )}
        </div>

        {footer.columns.map((column) => (
          <div key={column.title} className="footer__col footer__col--nav">
            <h3 className="footer__col-title">{column.title}</h3>
            <ul className="footer__list">
              {column.links.map((link) => (
                <li key={link.href} className="footer__item">
                  <Link href={localizeHref(link.href, locale)} className="footer__link">{link.label}</Link>
                </li>
              ))}
            </ul>
          </div>
        ))}

        <div className="footer__col footer__col--services">
          <h3 className="footer__col-title">{labels.services}</h3>
          <ul className="footer__list">
            {services.slice(0, 6).map((service) => (
              <li key={service.id} className="footer__item">
                <Link href={serviceHref(service.id)} className="footer__link">{service.name}</Link>
              </li>
            ))}
          </ul>
        </div>

        <div className="footer__col footer__col--contact">
          <h3 className="footer__col-title">{labels.contact}</h3>
          <ul className="footer__list footer__list--contact">
            {brand.locations.map((location) => (
              <li key={location.label} className="footer__item">
                <strong className="footer__loc-label">{location.label}</strong>
                <br />{location.address}
                <br />{location.phone}
              </li>
            ))}
          </ul>
          {/* 🔴 邮箱是联系那一栏的**兄弟**，不在上面那个 `<ul>` 里面 —— `slim-row` 要把它摆进那一行，
              而 `display: contents` 只摊平**直接子元素**。放在 `<li>` 里的话，摊平之后它跟着地址一起
              被关掉，或者要给 `<li>` 再摊一层（那就是靠 DOM 形状写 CSS，契约不许）。 */}
          <a href={`mailto:${brand.email}`} className="footer__email">{brand.email}</a>
        </div>
      </div>

      <div className="footer__legal" data-role="essential">
        <p className="footer__copyright">&copy; {currentYear} {footer.copyright}</p>
      </div>
    </footer>
  );
}
