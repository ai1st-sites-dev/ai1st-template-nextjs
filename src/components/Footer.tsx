import Link from 'next/link';
import ServiceIcon from '@/components/ServiceIcon';
import { brand, defaultLocale, getNavigation, getServices, pagesByLocale } from '@/lib/config';

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

export default function Footer({ locale }: { locale: string }) {
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

  return (
    <footer className="bg-primary-900 text-gray-300">
      <div className="container-width section-padding">
        <div className="grid gap-12 md:grid-cols-2 lg:grid-cols-4">
          {/* Company Info */}
          <div>
            <div className="mb-4 flex items-center gap-2">
              {brand.logoUrl ? (
                <img src={brand.logoUrl} alt={brand.name} className="h-8 w-auto max-w-[140px] object-contain brightness-0 invert" />
              ) : (
                <>
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary-500">
                    <ServiceIcon icon={brand.logoIcon} className="h-5 w-5 text-white" />
                  </div>
                  <span className="text-lg font-bold text-white">{brand.name}</span>
                </>
              )}
            </div>
            <p className="text-sm leading-relaxed">{footer.description}</p>
            {links.length > 0 && (
              <div className="mt-4 flex gap-3">
                {links.map(([platform, url]) => {
                  const info = socialIcons[platform];
                  return (
                    <a
                      key={platform}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={info?.label || platform}
                      className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-800 text-gray-400 transition-colors hover:bg-primary-700 hover:text-white"
                    >
                      {info?.icon || <span className="text-xs font-bold uppercase">{platform[0]}</span>}
                    </a>
                  );
                })}
              </div>
            )}
          </div>

          {/* Footer Columns */}
          {footer.columns.map((column) => (
            <div key={column.title}>
              <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-white">{column.title}</h3>
              <ul className="space-y-2">
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link href={localizeHref(link.href, locale)} className="text-sm transition-colors hover:text-white">{link.label}</Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}

          {/* Services */}
          <div>
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-white">{labels.services}</h3>
            <ul className="space-y-2">
              {services.slice(0, 6).map((service) => (
                <li key={service.id}>
                  <Link href={localizeHref(serviceDetailSlugs.has(service.id) ? `/services/${service.id}` : `/services#${service.id}`, locale)} className="text-sm transition-colors hover:text-white">{service.name}</Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Contact */}
          <div>
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wider text-white">{labels.contact}</h3>
            <ul className="space-y-3 text-sm">
              {brand.locations.map((location) => (
                <li key={location.label}>
                  <strong className="text-white">{location.label}</strong>
                  <br />{location.address}
                  <br />{location.phone}
                </li>
              ))}
              <li>
                <a href={`mailto:${brand.email}`} className="transition-colors hover:text-white">{brand.email}</a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-12 border-t border-gray-700 pt-8 text-center text-sm">
          <p>&copy; {currentYear} {footer.copyright}</p>
        </div>
      </div>
    </footer>
  );
}
