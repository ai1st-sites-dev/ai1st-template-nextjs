// ══════════════════════════════════════════════════════════════════════════════════════════════════
// contact —— 块头 · 一组联系方式（contact items）· 侧列（表单，可带地图），外加可放在最底下的地图
//                 （#1489，总纲 #1422 的 T2.11；T3 改名 contact，接替 contact-form / contact-info / map-area）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 🔴 **一份 markup，十个旋钮**：块头（introPosition / introAlign）· 侧列（sidePosition / form / formStyle）·
//    contact items（itemsLayout / itemStyle / itemAlign / itemIcon）· 地图（map），五个预设各是一个形态目录。
//    实际生效的旋钮 = 形态对应的那个预设给底，`data.options` 里写了的逐个覆盖（`scripts/lib/block-knobs.js` §effectiveKnobs）。
//    旋钮值写在根元素上（`data-intro-position` … `data-map` / `data-tone`），`block.css` 按它们排；形态目录自己不带几何。
//
// 🔴 **值只有一处**：电话 / 邮箱 / 地址 / 营业时间 / 坐标读站点数据（`scripts/lib/contact-facts.js` §siteFactsFrom：
//    主地点 `brand.locations[0]`（#1976 起营业时间也在它的 `hours` 上）· `brand.email`）。块数据里的 item 只有 kind + 标题 + 提示（link 另带 href）。
//    站点数据里没有那一项（没填营业时间 / 没有邮箱）⟹ 那一条不画。`siteFacts` 只有单格页会传（admin 预览用演示生意那一份，
//    SectionRenderer 的注释）；真站不传 ⟹ 读 `@/lib/config`。
//
// 🔴 **藏东西一律是不渲染**，不靠 CSS 藏：块头只画一份（top 在顶上一行 / beside 在 items 那一列最上面）；
//    items 为空 ⟹ 没有那一组；侧列里既没表单也没地图 ⟹ 侧列不画、items 列占满；块头在顶上且 items 为空 ⟹ items 列不画、侧列占满。
//    两列怎么分由 `data-split` 说（form = 5/12 + 7/12 · even = 各半（侧列只有地图）· one = 只剩一列）。
//
// 🔴 **地图（Chris 2026-09-29 定，正文「地图」）**：点之前是一张**地址卡**（钉子 + 地址 + Open map + OSM 署名），
//    **不放任何地图图片**、页面打开时不向第三方发请求；点「Open map」才换成 OSM 官方嵌入（`ContactMap.tsx`，块里唯一的客户端交互）。
//    站点数据里没有坐标 ⟹ 地图那一格不画、其余照常。
//    🔴 那个「点了才换」**是延迟加载，不是显隐**：iframe 一进 DOM 就会向 openstreetmap.org 发请求，所以点之前它根本不渲染
//    （#1489 验收 7：map=none 与 map=beside 两页的站外主机集合相同）。Bootstrap 的 Collapse / Modal 只管 display，元素得先在 DOM 里
//    ⟹ 直接换过去会打破那条判据；这里留 React 不是沿用已作废的「不用 data-bs-*」，而是这一条。要不要改成「点击时才把 iframe
//    插进 DOM、再交 Bootstrap 管展示」等 Chris 拍（#1514 正文 ②，2026-10-01 挂起）。
//
// 🔴 **画几个地点由数据决定，不是旋钮（#1978，Chris 2026-10-20）**：块数据的 `location`（地点 id）写了 ⟹ 只画那一家（地点页用），
//    指的那一家不存在 ⟹ 整块不渲染；没写 ⟹ 画网站的全部地点。只有一个地点时跟以前一模一样（items 那四个旋钮管 `items`，值读这一家）；
//    两个及以上时每家一组（`.ct-loc`：名称 · 星级 · 地址两行 · 营业时间 · 电话 · 邮箱 · 小地图卡 · Call / Open in Google Maps），
//    `items` 只决定画不画这一整组（空 ⟹ 不画），item 那四个旋钮不起作用；排法归 `locationsLayout` / `locationStyle` 两个旋钮。
//    电话 / 邮箱的兜底（第一家的电话、网站邮箱）在 `contact-facts.js` §locationFactsFrom，这里不再算一遍。
// 🔴 **店面图（`image` 旋钮 none | yes + 块数据 `image`，#1978）**：只有一个 `<img>`。left / right 时住在侧列最上面（叠在表单 / 地图上面）；
//    bottom 时住在联系方式那一列里、块头下面、联系方式 / 地点上面（表单仍在最下面）。窄屏（< 992）上「图挪到联系方式上面」靠
//    block.css 把侧列拆开（`display: contents` + `order`），不画第二份。旋钮是 yes 但块数据没有图 ⟹ 不画，其余照旧。
//
// 🔴 **表单用共用的 `src/components/BlockLeadForm.tsx`**（同 hero / footer / cta），`idPrefix="ct"`，提交走 `/api/leads`。
//    `form` 槽今天只有 `{ id? }`（选哪张站级表单，#1471 落地前不读）。
//
// 🔴 **底色与字色走 `scripts/lib/contrast.js` 那两个共用函数**（§bgCss / §toneForBg）；这里不自己算亮度、不自己拼渐变。

import type { CSSProperties } from 'react';
import { getSeo, getServices, leadFormSite, localeUrl } from '@template/lib/config';
import { getLabels } from '@template/lib/component-labels';
import SiteLink from '@template/components/SiteLink';
import BlockLeadForm from '@template/components/BlockLeadForm';
import BlockSection, { blockTone } from '@template/components/BlockSection';
import type { BlockConfig, SiteData } from '@template/lib/types/config';
import InlineIcon, { type IconTable } from '@template/components/InlineIcon';
import Eyebrow, { isEyebrowStyle, type EyebrowStyle } from '@template/components/Eyebrow';
import ContactMap from './ContactMap';
import manifest from './manifest.json';
import { ratingStars, slotImg } from '@template/lib/sections/blockMedia';
import { effectiveKnobs } from '../../scripts/lib/block-knobs.js';
import { type BgValue } from '../../scripts/lib/contrast.js';
import { pickIcons } from '../../scripts/lib/icon-names.js';
import { copiesSiteFact, locationsFactsFrom, mailtoHref, osmEmbedUrl, siteFactsFrom, telHref, type ContactLocationFacts, type ContactSiteFacts } from '../../scripts/lib/contact-facts.js';

export type ContactKind = 'phone' | 'email' | 'address' | 'hours' | 'link';
export interface ContactNewItem { kind?: ContactKind | string; title?: string; hint?: string; href?: string }
export interface ContactNewOptions {
  introPosition?: string; introAlign?: string;
  sidePosition?: string; form?: string; formStyle?: string;
  itemsLayout?: string; itemStyle?: string; itemAlign?: string; itemIcon?: string;
  locationsLayout?: string; locationStyle?: string; image?: string;
  map?: string;
}
export interface ContactNewData {
  options?: ContactNewOptions;
  introEyebrow?: { text?: string; style?: string };
  headline?: string;
  body?: string;
  items?: ContactNewItem[];
  form?: { id?: string };
  /** #1978 —— 店面图（`image` 旋钮是 yes 时画）。 */
  image?: { imageUrl?: string; alt?: string };
  /** #1978 —— 只画这一家（地点 id，地点页用）；没写 ⟹ 全部地点。 */
  location?: string;
  bg?: BgValue;
}

interface Props {
  data: ContactNewData;
  locale?: string;
  block?: BlockConfig;
  /** 服务端查好的图标表（`scripts/lib/icons.js` §iconTableFor）。没给 ⟹ 一个图标都不画。 */
  iconTable?: IconTable;
  /** 单格页传的演示站点数据（SectionRenderer §siteFacts）；不传 ⟹ 读这个站自己的。 */
  siteFacts?: ContactSiteFacts;
  /** #1665 —— 这个站的内容（SectionRenderer 递下来）。 */
  site: SiteData;
}

// items 最多 6 条（manifest `slots.items.maxItems`，validateSite 拦超出的）；多出来的在这里截掉。
const MAX_ITEMS = manifest.slots.items.maxItems;

// kind → 图标（字面名登记在 `BLOCK_ICONS['contact']`，同 footer 那五个）。
const KIND_ICON: Record<ContactKind, string> = {
  phone: 'telephone', email: 'envelope', address: 'geo-alt', hours: 'clock', link: 'link-45deg',
};

const isObj = (v: unknown): v is object => !!v && typeof v === 'object' && !Array.isArray(v);

/** #1471 —— 表单「需求」下拉的选项：在 Section.tsx 里读（`page-deps.js` 只看注册表指向的这份文件，理由见 BlockLeadForm 文件头）。 */
function servicesFor(site: SiteData, locale: string): { id: string; name: string }[] {
  try { return (getServices(site, locale) || []).map((s: { id: string; name: string }) => ({ id: s.id, name: s.name })); } catch { return []; }
}
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

interface Row { index: number; kind: ContactKind; title: string; hint: string; value: string; href: string }

/** 一条 item + 站点数据 → 画出来的那一行；站点数据里没有那一项 / link 缺 href → null（那一条不画）。 */
function rowOf(it: ContactNewItem, i: number, f: ContactSiteFacts): Row | null {
  const kind = str(it.kind) as ContactKind;
  if (!(kind in KIND_ICON)) return null;
  // 🔴 r2（QA2 打回 r1）：标题 / 提示里抄了一个值（电话 / 邮箱 / 钟点 / 地址）⟹ 那一格不画 —— 值只画下面那一处。
  //    建站 / 改站写盘时已经剔过（§scrubContactCopies）；这里挡的是可视化编辑器里手打进来、不经过那两处的那份。
  const copied = (s: string) => kind !== 'link' && copiesSiteFact(s, f);
  const title = copied(str(it.title)) ? '' : str(it.title);
  const hint = copied(str(it.hint)) ? '' : str(it.hint);
  const base = { index: i, kind, title, hint };
  if (kind === 'phone') return f.phone ? { ...base, value: f.phone, href: telHref(f.phone) } : null;
  if (kind === 'email') return f.email ? { ...base, value: f.email, href: mailtoHref(f.email) } : null;
  if (kind === 'address') return f.address ? { ...base, value: f.address, href: '' } : null;
  if (kind === 'hours') return f.hours ? { ...base, value: f.hours, href: '' } : null;
  // link：值就是标题，跳 href（WhatsApp、预约页之类）。
  const href = str(it.href);
  return title && href ? { ...base, value: title, href } : null;
}

/** 地址两行：第一个逗号前一行（门牌 + 街道），后面一行（城市 / 省 / 邮编）；没逗号就一行。 */
function addressLines(address: string): [string, string] {
  const i = address.indexOf(',');
  return i < 0 ? [address, ''] : [address.slice(0, i).trim(), address.slice(i + 1).trim()];
}

/** 这一家的地点页（页面 JSON 顶层 `locationPage: {kind: "location", id}`，#1978 第 8 条）的地址；没有 ⟹ ''。 */
function locationPageHref(site: SiteData, locale: string, id: string): string {
  const pages = (site && site.pagesByLocale && site.pagesByLocale[locale]) || [];
  const page = pages.find((p) => isObj(p.locationPage) && p.locationPage.kind === 'location' && p.locationPage.id === id);
  return page ? localeUrl(site, page.slug, locale) : '';
}

export default function ContactNewSection({ data, locale, block, iconTable = {}, siteFacts, site }: Props) {
  const d: ContactNewData = isObj(data) ? data : {};
  const shape = block && typeof block.shape === 'string' ? block.shape : undefined;
  const opts: ContactNewOptions = isObj(d.options) ? d.options : {};
  const k = effectiveKnobs(manifest, shape, opts) as Required<{ [K in keyof ContactNewOptions]: string }>;
  const tone = blockTone(d.bg);
  const lang = locale || '';
  // 地点：单格页 / 测试递进来的 `siteFacts.locations`，否则这个站自己的全部地点（`siteFacts` 没带 locations ⟹ 当作只有它那一家）。
  let facts: ContactSiteFacts;
  let all: ContactLocationFacts[];
  if (siteFacts) {
    facts = siteFacts;
    all = Array.isArray(siteFacts.locations) ? siteFacts.locations : [];
  } else {
    let seo: unknown = null;
    try { seo = getSeo(site, lang); } catch { seo = null; }
    facts = siteFactsFrom(site?.brand, seo);
    all = locationsFactsFrom(site?.brand, seo);
  }
  const only = str(d.location);
  if (only) {
    const one = all.find((l) => l.id === only);
    if (!one) return null;
    facts = { phone: one.phone, email: one.email, address: one.address, hours: one.hours, geo: one.geo };
  }
  const multi = !only && all.length >= 2;
  const t = getLabels(lang);

  const icon = (name: string | undefined, className?: string) => <InlineIcon name={name} icons={iconTable} className={className} />;

  const eyebrow = isObj(d.introEyebrow) && str(d.introEyebrow.text) ? d.introEyebrow : null;
  // 没写 style ⟹ pill（同 hero / cta / features / milestones / faq）；明写 none ⟹ 不画。
  const eyebrowStyle: EyebrowStyle | 'none' = !eyebrow ? 'none' : !eyebrow.style ? 'pill' : isEyebrowStyle(eyebrow.style) ? eyebrow.style : 'none';
  const hasIntro = !!(str(d.headline) || str(d.body) || (eyebrow && eyebrowStyle !== 'none'));
  const items = (Array.isArray(d.items) ? d.items : []).slice(0, MAX_ITEMS);
  const rows = multi ? [] : items
    .map((it, i) => (isObj(it) ? rowOf(it, i, facts) : null))
    .filter((r): r is Row => r !== null);
  const hasItems = rows.length > 0;
  // 多地点：`items` 只决定画不画地点组这一整块（空 ⟹ 不画），不决定每组画哪几行（#1978 第 3 条）。
  const hasLocs = multi && items.length > 0;

  const showForm = k.form !== 'none';
  const embedUrl = osmEmbedUrl(facts.geo);
  // 多地点时那一张大地图不画，`map` 不是 none ⟹ 每组一张小地图卡（#1978 第 6 条）。
  const hasMap = !multi && !!embedUrl && !!facts.address;
  const mapBeside = hasMap && k.map === 'beside';
  const mapBottom = hasMap && k.map === 'bottom';
  const locMaps = multi && k.map !== 'none';
  const img = isObj(d.image) && str(d.image.imageUrl) ? { imageUrl: str(d.image.imageUrl), alt: str(d.image.alt) } : null;
  const showImage = k.image === 'yes' && !!img;
  const imageBottom = showImage && k.sidePosition === 'bottom';
  const imageSide = showImage && !imageBottom;
  const introTop = hasIntro && k.introPosition === 'top';
  const introBeside = hasIntro && k.introPosition === 'beside';
  const textCol = introBeside || hasItems || hasLocs || imageBottom;
  const sideCol = showForm || mapBeside || imageSide;
  // 两列怎么分（block.css §split）：两列都在 ⟹ 侧列有表单是 5/7，只有地图是各半；只剩一列 ⟹ one。
  const split = textCol && sideCol ? (showForm ? 'form' : 'even') : 'one';

  const intro = (
    <div className="ct-intro-text" data-part="intro-text">
      {eyebrow && eyebrowStyle !== 'none' ? (
        <div className="mb-4" data-part="eyebrow">
          <Eyebrow style={eyebrowStyle} text={eyebrow.text} slot="introEyebrow.text" />
        </div>
      ) : null}
      {d.headline ? <h2 className="display-5 fw-bold lh-1 ls-tight mb-4 ct-title" data-slot="headline">{d.headline}</h2> : null}
      {d.body ? <p className="fs-5 text-muted mb-0 ct-body" data-slot="body">{d.body}</p> : null}
    </div>
  );

  const map = (where: 'side' | 'bottom') => (
    <ContactMap
      where={where}
      address={facts.address}
      embedUrl={embedUrl}
      pinIcon="geo-alt-fill"
      icons={pickIcons(iconTable, ['geo-alt-fill'])}
    />
  );

  // 店面图：一个 `<img>`，住哪儿见文件头。
  // 🔴 旋钮是 yes、块数据没有图 ⟹ 不画（#1978 第 5 条），所以不走 §knobImg 的占位图。
  const image = (where: 'side' | 'bottom') => (img ? (
    <div className={`ct-media ct-media-${where}`} data-part="image">
      {slotImg(img, { before: { className: 'ct-media-img' }, after: { loading: 'lazy' }, slot: 'image' })}
    </div>
  ) : null);

  const locGroup = (l: ContactLocationFacts) => {
    const href = locationPageHref(site, lang, l.id);
    const [line1, line2] = addressLines(l.address);
    return (
      <div key={l.id} className="ct-loc" data-part="location" data-location={l.id}>
        {l.name ? (
          <div className="ct-loc-head">
            {href
              ? <SiteLink className="ct-loc-name" href={href} data-part="location-name">{l.name}</SiteLink>
              : <span className="ct-loc-name" data-part="location-name">{l.name}</span>}
          </div>
        ) : null}
        {l.rating ? (
          <div className="ct-loc-rating" data-part="location-rating">
            {ratingStars(l.rating.ratingValue, iconTable, {
              root: (n, label) => ({ className: 'ct-stars d-inline-flex gap-1 text-warning', 'data-part': 'location-stars', 'data-rating': n, role: 'img', 'aria-label': label }),
              fillEmpty: true,
              wrap: (st) => ({ className: 'ct-star d-inline-flex', 'data-star': st, 'aria-hidden': 'true' }),
            })}
            <span><b>{l.rating.ratingValue.toFixed(1)}</b> · {l.rating.reviewCount} {t.contactGoogleReviews}</span>
          </div>
        ) : null}
        {l.address || l.hours || l.phone || l.email ? (
          <div className="ct-loc-lines">
            {l.address ? (
              <div className="ct-loc-line" data-value="address">
                {icon(KIND_ICON.address)}
                <span>{line1}{line2 ? <><br />{line2}</> : null}</span>
              </div>
            ) : null}
            {l.hours ? <div className="ct-loc-line" data-value="hours">{icon(KIND_ICON.hours)}<span>{l.hours}</span></div> : null}
            {l.phone ? <div className="ct-loc-line" data-value="phone">{icon(KIND_ICON.phone)}<a href={telHref(l.phone)}>{l.phone}</a></div> : null}
            {l.email ? <div className="ct-loc-line ct-loc-email" data-value="email">{icon(KIND_ICON.email)}<a href={mailtoHref(l.email)}>{l.email}</a></div> : null}
          </div>
        ) : null}
        {locMaps && l.address && osmEmbedUrl(l.geo) ? (
          <ContactMap
            where="loc"
            address={l.address}
            embedUrl={osmEmbedUrl(l.geo)}
            pinIcon="geo-alt-fill"
            icons={pickIcons(iconTable, ['geo-alt-fill'])}
          />
        ) : null}
        {l.phone || l.mapsUrl ? (
          <div className="ct-loc-btns">
            {l.phone ? (
              <a className="btn btn-primary" href={telHref(l.phone)} data-part="location-call">
                {icon(KIND_ICON.phone, 'me-2')}{t.contactCall}
              </a>
            ) : null}
            {/* #1508 —— 外部 https: 不受 basePath 影响，保持裸 <a>。 */}
            {l.mapsUrl ? (
              <a className="btn btn-outline-primary" href={l.mapsUrl} target="_blank" rel="noopener noreferrer" data-part="location-maps">
                {t.contactOpenInGoogleMaps}
              </a>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <BlockSection
      type="contact"
      block={block}
      attrs={{
        'data-intro-position': k.introPosition,
        'data-intro-align': k.introAlign,
        'data-side-position': k.sidePosition,
        'data-form': k.form,
        'data-form-style': k.formStyle,
        'data-items-layout': k.itemsLayout,
        'data-item-style': k.itemStyle,
        'data-item-align': k.itemAlign,
        'data-item-icon': k.itemIcon,
        'data-map': k.map,
        'data-split': split,
        // #1978 —— 三个新旋钮照旧写旋钮值（同上面十个）；「真画了几组地点 / 图真画了、画在哪」另写两项，只在成立时出现。
        'data-locations-layout': k.locationsLayout,
        'data-location-style': k.locationStyle,
        'data-image': k.image,
        'data-locations': hasLocs ? 'many' : undefined,
        'data-image-at': showImage ? (imageBottom ? 'bottom' : 'side') : undefined,
      }}
      bg={d.bg}
      // #1978 —— card 的地点组是白卡片、底色浅灰：只在块自己没给底色时铺这一层浅灰（给了 bg 就听 bg 的）。
      style={hasLocs && k.locationStyle === 'card' && d.bg == null ? ({ background: 'var(--x-gray-50, #f8fafc)' } as CSSProperties) : undefined}
    >
      {introTop ? <div className="ct-top mb-10" data-part="intro">{intro}</div> : null}
      {textCol || sideCol ? (
        <div className="row ct-frame gy-10 gx-lg-16">
          {textCol ? (
            <div className="col-12 ct-textcol" data-part="textcol">
              {introBeside ? <div className="ct-colintro" data-part="intro">{intro}</div> : null}
              {imageBottom ? image('bottom') : null}
              {hasLocs ? (
                <div className="ct-locs" data-part="locations">
                  <div className="ct-loc-grid">{all.map(locGroup)}</div>
                </div>
              ) : null}
              {hasItems ? (
                <div className="ct-info" data-part="items">
                  {rows.map((r) => (
                    <div key={r.index} className="ct-ch" data-part="item" data-kind={r.kind} data-item={`items.${r.index}`}>
                      <div className="ct-ch-inner h-100 d-flex gap-3">
                        <span className="ct-ch-icon d-inline-flex align-items-center justify-content-center rounded-3 bg-primary-subtle text-primary flex-shrink-0" data-part="item-icon">
                          {icon(KIND_ICON[r.kind])}
                        </span>
                        <div className="min-w-0">
                          {/* link 那一条的标题就是值（下面那个链接），不另画一行标题。 */}
                          {r.kind !== 'link' && r.title ? <div className="ct-ch-title fw-semibold" data-slot={`items.${r.index}.title`}>{r.title}</div> : null}
                          {r.hint ? <div className="ct-ch-hint text-xs text-muted mb-1" data-slot={`items.${r.index}.hint`}>{r.hint}</div> : null}
                          {/* 🔴 #1508 —— 站内路径（`/…`）必须走 `SiteLink`（它拼 basePath，#1794）：展示站跑在 basePath 下，裸 `<a>` 不吃前缀，
                              那条根绝对路径会让 build-showcase-from-main.sh 的根路径闸拒绝切换（实测冻了 7.4 小时）。
                              `tel:` / `mailto:` / `http(s):` 不是站内链接，保持裸 `<a>`。判据就是 href 以 `/` 开头。 */}
                          {r.href
                            ? (r.href.startsWith('/')
                                ? <SiteLink className="ct-value fw-semibold text-body" data-value={r.kind} {...(r.kind === 'link' ? { 'data-slot': `items.${r.index}.title` } : {})} href={r.href}>{r.value}</SiteLink>
                                : <a className="ct-value fw-semibold text-body" href={r.href} data-value={r.kind} {...(r.kind === 'link' ? { 'data-slot': `items.${r.index}.title` } : {})}>{r.value}</a>)
                            : <span className="ct-value fw-semibold" data-value={r.kind}>{r.value}</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          {sideCol ? (
            <div className="col-12 ct-sidecol" data-part="side">
              {imageSide ? image('side') : null}
              {showForm ? (
                <div className="ct-form" data-part="form">
                  <BlockLeadForm
                    mode={k.form === 'teaser' ? 'teaser' : 'full'}
                    formId={isObj(d.form) && typeof d.form.id === 'string' ? d.form.id : undefined}
                    services={servicesFor(site, lang)}
                    {...leadFormSite(site, lang)}
                    locale={lang}
                    center={k.sidePosition === 'bottom' && k.introAlign === 'center'}
                    idPrefix="ct"
                    size="sm"
                    tone={k.formStyle === 'card' ? 'light' : tone}
                  />
                </div>
              ) : null}
              {mapBeside ? map('side') : null}
            </div>
          ) : null}
        </div>
      ) : null}
      {mapBottom ? map('bottom') : null}
    </BlockSection>
  );
}
