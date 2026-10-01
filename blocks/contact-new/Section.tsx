// ══════════════════════════════════════════════════════════════════════════════════════════════════
// contact-new —— 块头 · 一组联系方式（contact items）· 侧列（表单，可带地图），外加可放在最底下的地图
//                 （#1489，总纲 #1422 的 T2.11；T3 改名 contact，接替 contact-form / contact-info / map-area）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 🔴 **一份 markup，十个旋钮**：块头（introPosition / introAlign）· 侧列（sidePosition / form / formStyle）·
//    contact items（itemsLayout / itemStyle / itemAlign / itemIcon）· 地图（map），五个预设各是一个形态目录。
//    实际生效的旋钮 = 形态对应的那个预设给底，`data.options` 里写了的逐个覆盖（`scripts/lib/block-knobs.js` §effectiveKnobs）。
//    旋钮值写在根元素上（`data-intro-position` … `data-map` / `data-tone`），`block.css` 按它们排；形态目录自己不带几何。
//
// 🔴 **值只有一处**：电话 / 邮箱 / 地址 / 营业时间 / 坐标读站点数据（`scripts/lib/contact-facts.js` §siteFactsFrom：
//    `brand.locations[0]` · `brand.email` · `seo.schema.openingHours`）。块数据里的 item 只有 kind + 标题 + 提示（link 另带 href）。
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
//
// 🔴 **表单用共用的 `src/components/BlockLeadForm.tsx`**（同 hero-new / footer-new / cta-new），`idPrefix="ct"`，提交走 `/api/leads`。
//    `form` 槽今天只有 `{ id? }`（选哪张站级表单，#1471 落地前不读）。
//
// 🔴 **底色与字色走 `scripts/lib/contrast.js` 那两个共用函数**（§bgCss / §toneForBg）；这里不自己算亮度、不自己拼渐变。

import { brand as siteBrand, getSeo, getServices } from '@/lib/config';
import Link from 'next/link';
import BlockLeadForm from '@/components/BlockLeadForm';
import { blockAttrs } from '@/lib/sections/blockAttrs';
import type { BlockConfig } from '@/lib/types/config';
import InlineIcon, { type IconTable } from '@/components/InlineIcon';
import ContactMap from './ContactMap';
import manifest from './manifest.json';
import { effectiveKnobs } from '../../scripts/lib/block-knobs.js';
import { bgCss, toneForBg, type BgValue } from '../../scripts/lib/contrast.js';
import { copiesSiteFact, mailtoHref, osmEmbedUrl, siteFactsFrom, telHref, type ContactSiteFacts } from '../../scripts/lib/contact-facts.js';

export type ContactKind = 'phone' | 'email' | 'address' | 'hours' | 'link';
export interface ContactNewItem { kind?: ContactKind | string; title?: string; hint?: string; href?: string }
export interface ContactNewOptions {
  introPosition?: string; introAlign?: string;
  sidePosition?: string; form?: string; formStyle?: string;
  itemsLayout?: string; itemStyle?: string; itemAlign?: string; itemIcon?: string;
  map?: string;
}
export interface ContactNewData {
  options?: ContactNewOptions;
  introEyebrow?: { text?: string; style?: string };
  headline?: string;
  body?: string;
  items?: ContactNewItem[];
  form?: { id?: string };
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
}

// items 最多 6 条（manifest `slots.items.maxItems`，validateSite 拦超出的）；多出来的在这里截掉。
const MAX_ITEMS = manifest.slots.items.maxItems;

// kind → 图标（字面名登记在 `BLOCK_ICONS['contact-new']`，同 footer-new 那五个）。
const KIND_ICON: Record<ContactKind, string> = {
  phone: 'telephone', email: 'envelope', address: 'geo-alt', hours: 'clock', link: 'link-45deg',
};

const isObj = (v: unknown): v is object => !!v && typeof v === 'object' && !Array.isArray(v);

/** #1471 —— 表单「需求」下拉的选项：在 Section.tsx 里读（`page-deps.js` 只看注册表指向的这份文件，理由见 BlockLeadForm 文件头）。 */
function servicesFor(locale: string): { id: string; name: string }[] {
  try { return (getServices(locale) || []).map((s: { id: string; name: string }) => ({ id: s.id, name: s.name })); } catch { return []; }
}
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

// 这几条类名要**逐字**写在源码里：`site.css` 是按源码 purge 的（`scripts/lib/site-css.js` §PURGE_CONTENT），
// 拼出来的类名 purge 看不见。
const EYEBROW_CLASS: Record<string, string> = {
  pill: 'ct-eyebrow-pill badge rounded-pill bg-primary-subtle text-primary fw-semibold text-xs px-3 py-2',
  outline: 'ct-eyebrow-outline badge rounded-pill border border-primary text-primary bg-transparent fw-semibold text-xs px-3 py-2',
  dash: 'ct-eyebrow-dash text-uppercase text-xs fw-semibold ls-wider text-muted',
  plain: 'ct-eyebrow-plain text-uppercase text-xs fw-semibold ls-wider text-muted',
};

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

export default function ContactNewSection({ data, locale, block, iconTable = {}, siteFacts }: Props) {
  const d: ContactNewData = isObj(data) ? data : {};
  const shape = block && typeof block.shape === 'string' ? block.shape : undefined;
  const opts: ContactNewOptions = isObj(d.options) ? d.options : {};
  const k = effectiveKnobs(manifest, shape, opts) as Required<{ [K in keyof ContactNewOptions]: string }>;
  const tone = toneForBg(d.bg);
  const bgValue = bgCss(d.bg);
  const lang = locale || '';
  let facts: ContactSiteFacts;
  if (siteFacts) facts = siteFacts;
  else {
    let seo: unknown = null;
    try { seo = getSeo(lang); } catch { seo = null; }
    facts = siteFactsFrom(siteBrand, seo);
  }

  const icon = (name: string | undefined, className?: string) => <InlineIcon name={name} icons={iconTable} className={className} />;

  const eyebrow = isObj(d.introEyebrow) && str(d.introEyebrow.text) ? d.introEyebrow : null;
  // 没写 style ⟹ pill（同 hero-new / cta-new / features-new / milestones / faq-new）；明写 none ⟹ 不画。
  const eyebrowStyle = !eyebrow ? 'none' : !eyebrow.style ? 'pill' : eyebrow.style in EYEBROW_CLASS ? eyebrow.style : 'none';
  const hasIntro = !!(str(d.headline) || str(d.body) || (eyebrow && eyebrowStyle !== 'none'));
  const rows = (Array.isArray(d.items) ? d.items : [])
    .slice(0, MAX_ITEMS)
    .map((it, i) => (isObj(it) ? rowOf(it, i, facts) : null))
    .filter((r): r is Row => r !== null);
  const hasItems = rows.length > 0;

  const showForm = k.form !== 'none';
  const embedUrl = osmEmbedUrl(facts.geo);
  const hasMap = !!embedUrl && !!facts.address;
  const mapBeside = hasMap && k.map === 'beside';
  const mapBottom = hasMap && k.map === 'bottom';
  const introTop = hasIntro && k.introPosition === 'top';
  const introBeside = hasIntro && k.introPosition === 'beside';
  const textCol = introBeside || hasItems;
  const sideCol = showForm || mapBeside;
  // 两列怎么分（block.css §split）：两列都在 ⟹ 侧列有表单是 5/7，只有地图是各半；只剩一列 ⟹ one。
  const split = textCol && sideCol ? (showForm ? 'form' : 'even') : 'one';

  const intro = (
    <div className="ct-intro-text" data-part="intro-text">
      {eyebrow && eyebrowStyle !== 'none' ? (
        <div className="mb-4" data-part="eyebrow">
          <span className={EYEBROW_CLASS[eyebrowStyle]} data-eyebrow={eyebrowStyle} data-slot="introEyebrow.text">
            {eyebrowStyle === 'dash' ? '— ' : null}{eyebrow.text}
          </span>
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
      pin={icon('geo-alt-fill')}
    />
  );

  return (
    <section
      {...blockAttrs('contact-new', block)}
      data-intro-position={k.introPosition}
      data-intro-align={k.introAlign}
      data-side-position={k.sidePosition}
      data-form={k.form}
      data-form-style={k.formStyle}
      data-items-layout={k.itemsLayout}
      data-item-style={k.itemStyle}
      data-item-align={k.itemAlign}
      data-item-icon={k.itemIcon}
      data-map={k.map}
      data-split={split}
      data-tone={tone}
      className="position-relative py-16 py-lg-24"
      style={bgValue ? { background: bgValue } : undefined}
    >
      <div className="container">
        {introTop ? <div className="ct-top mb-10" data-part="intro">{intro}</div> : null}
        {textCol || sideCol ? (
          <div className="row ct-frame gy-10 gx-lg-16">
            {textCol ? (
              <div className="col-12 ct-textcol" data-part="textcol">
                {introBeside ? <div className="ct-colintro" data-part="intro">{intro}</div> : null}
                {hasItems ? (
                  <div className="ct-info" data-part="items">
                    {rows.map((r) => (
                      <div key={r.index} className="ct-ch" data-part="item" data-kind={r.kind}>
                        <div className="ct-ch-inner h-100 d-flex gap-3">
                          <span className="ct-ch-icon d-inline-flex align-items-center justify-content-center rounded-3 bg-primary-subtle text-primary flex-shrink-0" data-part="item-icon">
                            {icon(KIND_ICON[r.kind])}
                          </span>
                          <div className="min-w-0">
                            {/* link 那一条的标题就是值（下面那个链接），不另画一行标题。 */}
                            {r.kind !== 'link' && r.title ? <div className="ct-ch-title fw-semibold" data-slot={`items.${r.index}.title`}>{r.title}</div> : null}
                            {r.hint ? <div className="ct-ch-hint text-xs text-muted mb-1" data-slot={`items.${r.index}.hint`}>{r.hint}</div> : null}
                            {/* 🔴 #1508 —— 站内路径（`/…`）必须走 `next/link`：展示站跑在 basePath 下，裸 `<a>` 不吃前缀，
                                那条根绝对路径会让 build-showcase-from-main.sh 的根路径闸拒绝切换（实测冻了 7.4 小时）。
                                `tel:` / `mailto:` / `http(s):` 不是站内链接，保持裸 `<a>`。判据就是 href 以 `/` 开头。 */}
                            {r.href
                              ? (r.href.startsWith('/')
                                  ? <Link className="ct-value fw-semibold text-body" href={r.href} data-value={r.kind} {...(r.kind === 'link' ? { 'data-slot': `items.${r.index}.title` } : {})}>{r.value}</Link>
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
                {showForm ? (
                  <div className="ct-form" data-part="form">
                    <BlockLeadForm
                      mode={k.form === 'teaser' ? 'teaser' : 'full'}
                      formId={isObj(d.form) && typeof d.form.id === 'string' ? d.form.id : undefined}
                      services={servicesFor(lang)}
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
      </div>
    </section>
  );
}
