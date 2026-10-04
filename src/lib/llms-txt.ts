// #1552 —— 站根的 `/llms.txt`：给 AI 助手读的一份站点说明（llmstxt.org 的格式：`# 站名` → `> 一句话` → 分节的列表）。
// 站是谁、做什么、服务清单、每页一句话（页面的 `description`，即 meta description）、联系方式。按站的默认语言出。
// 🔴 **不抄 `www/llms.txt` 的 Terminology 段** —— 那是我们平台自己的术语（黄金关键词 / GEO …），不是客户站的。
// 生成它的是 `src/app/llms.txt/route.ts`（`force-static`，跟 robots / sitemap 同一套），构建时写成 `out/llms.txt`。
import { brand, defaultLocale, getBrandName, getHomePage, getNonHomePages, getSeo, getServices, getTagline, localeUrl } from '@/lib/config';

const oneLine = (s: unknown) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim() : '');

export function buildLlmsTxt(locale: string = defaultLocale): string {
  const seo = getSeo(locale);
  const name = oneLine(getBrandName(locale));
  const summary = oneLine(seo.siteDescription) || oneLine(getTagline(locale));
  const abs = (slug: string) => `${seo.domain}${localeUrl(slug, locale)}`;
  const out: string[] = [`# ${name}`, ''];
  if (summary) out.push(`> ${summary}`, '');

  const services = getServices(locale).filter((s) => oneLine(s.name));
  if (services.length) {
    out.push('## Services', '');
    for (const s of services) {
      const d = oneLine(s.shortDescription);
      out.push(`- ${oneLine(s.name)}${d ? `: ${d}` : ''}`);
    }
    out.push('');
  }

  const home = getHomePage(locale);
  const pages = [...(home ? [home] : []), ...getNonHomePages(locale)];
  if (pages.length) {
    out.push('## Pages', '');
    for (const p of pages) {
      const d = oneLine(p.description);
      out.push(`- [${oneLine(p.title) || p.slug}](${abs(p.slug)})${d ? `: ${d}` : ''}`);
    }
    out.push('');
  }

  const contact: string[] = [];
  for (const l of brand.locations ?? []) {
    const label = oneLine(l.label);
    if (oneLine(l.address)) contact.push(`- Address${label ? ` (${label})` : ''}: ${oneLine(l.address)}`);
    if (oneLine(l.phone)) contact.push(`- Phone${label ? ` (${label})` : ''}: ${oneLine(l.phone)}`);
  }
  if (oneLine(brand.email)) contact.push(`- Email: ${oneLine(brand.email)}`);
  contact.push(`- Website: ${abs('home')}`);
  out.push('## Contact', '', ...contact, '');
  return out.join('\n');
}
