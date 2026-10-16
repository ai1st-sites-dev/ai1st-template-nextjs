// #1802 —— 每一页 <head> 里 metadata 那一段（title / description / robots / canonical / hreflang / 验证 / og / twitter）。
//
// 输入是 Next 那边**同一份** `Metadata` 对象：根布局那层 `rootMetadata(site)` + 这一页的（`homeMetadata` / `subPageMetadata` …，
// 都在 `src/lib/metadata.ts`，Next 的路由文件调的也是它们）。这里只做 Next 自己做的那两件事：
//   ① 合并：这一页给了哪个键，就整个换掉根布局那个键（Next `resolve-metadata.js` §mergeMetadata，不逐层合并字段）；
//      标题走 title template（只对「子段」生效，见 §pageMeta 的 `childSegment`）。
//   ② 收尾：twitter 缺 title / description / images 就从 openGraph 补（§postProcess = Next 的 postProcessMetadata）。
// 然后照 Next 的标签写法写出来（React 渲染，所以转义跟 Next 输出的逐字相同）。
//
// 🔴 只实现我们自己那几个构造器真用到的字段；用到别的字段 ⟹ §pageMeta 直接 throw，不静默丢掉一行 SEO。
//    要支持新字段就在这里补，并在 `scripts/render-diff.js` 跑一次对照。
import { cloneElement, createElement, type ReactElement } from 'react';
import type { Metadata } from 'next';

type Title = { absolute: string; template: string | null };
type Robots = Record<string, unknown>;
interface Resolved {
  title: Title | null;
  description: string | null;
  metadataBase: URL | null;
  canonical: string | null;
  languages: Record<string, string> | null;
  openGraph: Record<string, unknown> | null;
  twitter: Record<string, unknown> | null;
  robots: { basic: string | null; googleBot: string | null } | null;
  verification: Record<string, string[]> | null;
}

const KNOWN_KEYS = new Set(['title', 'description', 'metadataBase', 'alternates', 'openGraph', 'twitter', 'robots', 'verification']);

// Next `resolve-title.js` §resolveTitle（逐行照抄）。
function resolveTitle(title: Metadata['title'], stashedTemplate: string | null): Title {
  const tpl = (t: string | null, s: string) => (t ? t.replace(/%s/g, s) : s);
  let resolved: string | undefined;
  const template = typeof title !== 'string' && title && 'template' in title ? (title.template as string) : null;
  if (typeof title === 'string') resolved = tpl(stashedTemplate, title);
  else if (title) {
    if ('default' in title) resolved = tpl(stashedTemplate, title.default as string);
    if ('absolute' in title && title.absolute) resolved = title.absolute as string;
  }
  return { absolute: resolved || (typeof title === 'string' ? title : '') || '', template };
}

// Next `resolve-url.js` §resolveUrl / §resolveAbsoluteUrlWithPathname（trailingSlash 关着，跟 next.config.js 一样）。
function resolveUrl(url: string, base: URL | null): URL {
  try { return new URL(url); } catch { /* 相对地址，接着往下 */ }
  const b = base || new URL('http://localhost:3000');
  const joined = `${b.pathname.replace(/\/$/, '')}/${url.replace(/^\//, '')}`.replace(/\/{2,}/g, '/');
  return new URL(joined, b);
}
function absoluteUrl(url: string, base: URL | null): string {
  const u = resolveUrl(url, base);
  return u.pathname === '/' && u.searchParams.size === 0 ? u.origin : u.href;
}

// Next `resolve-basics.js` §resolveRobotsValue。
const ROBOTS_KEYS = ['noarchive', 'nosnippet', 'noimageindex', 'nocache', 'notranslate', 'indexifembedded',
  'nositelinkssearchbox', 'unavailable_after', 'max-video-preview', 'max-image-preview', 'max-snippet'];
function robotsValue(r: Robots | undefined): string | null {
  if (!r) return null;
  const values: string[] = [];
  if (r.index) values.push('index'); else if (typeof r.index === 'boolean') values.push('noindex');
  if (r.follow) values.push('follow'); else if (typeof r.follow === 'boolean') values.push('nofollow');
  for (const key of ROBOTS_KEYS) {
    const v = r[key];
    if (typeof v !== 'undefined' && v !== false) values.push(typeof v === 'boolean' ? key : `${key}:${v}`);
  }
  return values.join(', ');
}

const asArray = <T,>(v: T | T[] | undefined | null): T[] => (v == null ? [] : Array.isArray(v) ? v : [v]);
const imageUrl = (img: unknown, base: URL | null) => resolveUrl(typeof img === 'string' ? img : String((img as { url: string }).url), base).href;

function resolveOpenGraph(og: NonNullable<Metadata['openGraph']>, base: URL | null): Record<string, unknown> {
  const o = og as Record<string, unknown>;
  return {
    ...o,
    ...(o.url ? { url: absoluteUrl(String(o.url), base) } : {}),
    ...(o.images ? { images: asArray(o.images).map((i) => imageUrl(i, base)) } : {}),
  };
}
function resolveTwitter(tw: NonNullable<Metadata['twitter']>, base: URL | null): Record<string, unknown> {
  const t = tw as Record<string, unknown>;
  return { ...t, ...(t.images ? { images: asArray(t.images).map((i) => imageUrl(i, base)) } : {}) };
}

function merge(target: Resolved, md: Metadata, stashedTemplate: string | null): void {
  for (const key of Object.keys(md)) {
    if (!KNOWN_KEYS.has(key)) throw new Error(`render/meta.tsx: metadata 键 "${key}" 没实现（见文件头）`);
  }
  if ('metadataBase' in md) target.metadataBase = md.metadataBase ? new URL(String(md.metadataBase)) : null;
  const base = target.metadataBase;
  if ('title' in md) target.title = resolveTitle(md.title, stashedTemplate);
  if ('description' in md) target.description = md.description ?? null;
  if ('alternates' in md) {
    const a = (md.alternates || {}) as { canonical?: string; languages?: Record<string, string> };
    target.canonical = a.canonical ? absoluteUrl(String(a.canonical), base) : null;
    target.languages = a.languages
      ? Object.fromEntries(Object.entries(a.languages).map(([k, v]) => [k, absoluteUrl(String(v), base)])) : null;
  }
  if ('openGraph' in md) target.openGraph = md.openGraph ? resolveOpenGraph(md.openGraph, base) : null;
  if ('twitter' in md) target.twitter = md.twitter ? resolveTwitter(md.twitter, base) : null;
  if ('robots' in md) {
    const r = md.robots;
    target.robots = r && typeof r === 'object'
      ? { basic: robotsValue(r as Robots), googleBot: robotsValue((r as { googleBot?: Robots }).googleBot) }
      : (typeof r === 'string' ? { basic: r, googleBot: null } : null);
  }
  if ('verification' in md) {
    const v = (md.verification || {}) as Record<string, unknown>;
    const out: Record<string, string[]> = {};
    for (const k of ['google', 'yahoo', 'yandex', 'me']) if (v[k] != null) out[k] = asArray(v[k] as string).map(String);
    for (const [k, val] of Object.entries((v.other || {}) as Record<string, unknown>)) out[`other:${k}`] = asArray(val as string).map(String);
    target.verification = out;
  }
}

// Next `resolve-metadata.js` §postProcessMetadata + §inheritFromMetadata（我们用得到的那一半：twitter 从 openGraph 补）。
function postProcess(m: Resolved): void {
  const og = m.openGraph;
  const tw = m.twitter;
  if (og) {
    const hasTwTitle = !!(tw && tw.title);
    const hasTwDesc = !!(tw && tw.description);
    const hasTwImages = !!(tw && Object.prototype.hasOwnProperty.call(tw, 'images') && tw.images);
    const fill: Record<string, unknown> = {};
    if (!hasTwTitle) {
      if (og.title) fill.title = og.title;
      else if (m.title && m.title.absolute) fill.title = m.title.absolute;
    }
    if (!hasTwDesc) fill.description = og.description || m.description || undefined;
    if (!hasTwImages) fill.images = og.images;
    m.twitter = { ...(tw || {}), ...Object.fromEntries(Object.entries(fill).filter(([, v]) => v !== undefined)) };
  }
  for (const t of [m.openGraph, m.twitter]) {
    if (!t) continue;
    if (!t.title && m.title && m.title.absolute) t.title = m.title.absolute;
    if (!t.description && m.description) t.description = m.description;
  }
}

const meta = (attrs: Record<string, string>) => createElement('meta', attrs);
const titleOf = (v: unknown) => (v && typeof v === 'object' && 'absolute' in (v as object) ? String((v as Title).absolute) : String(v));

function tagsOf(m: Resolved, extraRobots: string | null): ReactElement[] {
  const out: ReactElement[] = [];
  if (m.title) out.push(createElement('title', null, m.title.absolute));
  if (m.description) out.push(meta({ name: 'description', content: m.description }));
  if (extraRobots) out.push(meta({ name: 'robots', content: extraRobots }));
  if (m.robots && m.robots.basic) out.push(meta({ name: 'robots', content: m.robots.basic }));
  if (m.robots && m.robots.googleBot) out.push(meta({ name: 'googlebot', content: m.robots.googleBot }));
  if (m.canonical) out.push(createElement('link', { rel: 'canonical', href: m.canonical }));
  for (const [lang, href] of Object.entries(m.languages || {})) out.push(createElement('link', { rel: 'alternate', hrefLang: lang, href }));
  const VERIFY: Record<string, string> = { google: 'google-site-verification', yahoo: 'y_key', yandex: 'yandex-verification', me: 'me' };
  for (const [k, vals] of Object.entries(m.verification || {})) {
    const name = k.startsWith('other:') ? k.slice('other:'.length) : VERIFY[k];
    for (const v of vals) out.push(meta({ name, content: v }));
  }
  const og = m.openGraph;
  if (og) {
    const p = (property: string, v: unknown) => { if (v != null && v !== '') out.push(meta({ property, content: String(v) })); };
    p('og:title', og.title != null ? titleOf(og.title) : null);
    p('og:description', og.description);
    p('og:url', og.url);
    p('og:site_name', og.siteName);
    p('og:locale', og.locale);
    for (const img of asArray(og.images as string[])) p('og:image', img);
    p('og:type', og.type);
    if (og.type === 'article') {
      p('article:published_time', og.publishedTime);
      // 🔴 作者 / 标签 Next 是逐个照写的，空串也写（`metadata.js` 里这两处没有 truthy 判断，别的字段都有）——
      //    文章没写作者时 Next 产物里就是一条 `content=""`（site-multilang 夹具实测）。
      for (const a of asArray(og.authors as string[])) out.push(meta({ property: 'article:author', content: String(a) }));
      for (const t of asArray(og.tags as string[])) out.push(meta({ property: 'article:tag', content: String(t) }));
    }
  }
  const tw = m.twitter;
  if (tw) {
    const n = (name: string, v: unknown) => { if (v != null && v !== '') out.push(meta({ name, content: String(v) })); };
    n('twitter:card', tw.card || (asArray(tw.images as string[]).length ? 'summary_large_image' : 'summary'));
    n('twitter:title', tw.title != null ? titleOf(tw.title) : null);
    n('twitter:description', tw.description);
    for (const img of asArray(tw.images as string[])) n('twitter:image', img);
  }
  return out;
}

/**
 * 一页的 metadata 标签。
 * @param childSegment  这一页是不是根布局的「子段」。Next 只对子段套根布局的 title template：站根 `/`（`app/page.tsx`，
 *                      跟根布局同一段）不套，`[...slug]` / `blog/*` 下的都套 —— 所以首页标题是 `siteTitle`，
 *                      `/blog` 是 `Blog | 店名`（Next 导出的 HTML 里就是这样，`render-diff.js` 对得上）。
 * @param extraRobots   404 页 Next 自己多插一条 `<meta name="robots" content="noindex">`（在根布局那条之外）。
 */
export function pageMeta(root: Metadata, page: Metadata | null, { childSegment, extraRobots = null }: { childSegment: boolean; extraRobots?: string | null }): ReactElement[] {
  const m: Resolved = { title: null, description: null, metadataBase: null, canonical: null, languages: null, openGraph: null, twitter: null, robots: null, verification: null };
  merge(m, root, null);
  const stash = childSegment && m.title ? m.title.template : null;
  if (page) merge(m, page, stash);
  postProcess(m);
  return tagsOf(m, extraRobots).map((el, i) => cloneElement(el, { key: i }));
}
