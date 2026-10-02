// ══════════════════════════════════════════════════════════════════════════════════════════════════
// cta-new —— 独立的行动召唤块，Webpixels / Bootstrap 那一套（#1479，总纲 #1422 的 T2.5）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 🔴 **普通页面块，可放在页面任何位置**（首页 features 之后、内页末尾……）。footer 自己那条 CTA 条照旧，
//    两者不冲突。T3 切换时 `cta-new` → `cta`、`cta-banner` 删；在那之前两个块并存，首页配方的抽取池不收它
//    （`homepage-recipe.js` §NOT_IN_POOL，理由同 cta-banner：收尾用的，不当开场）。
//
// 🔴 **一份 markup，五个旋钮**（layout / frame / textAlign / image / form），六个预设各是一个形态目录。
//    实际生效的旋钮 = 形态对应的那个预设给底，`data.options` 里写了的逐个覆盖（`scripts/lib/block-knobs.js`
//    §effectiveKnobs —— 编辑器判 custom 用的是同一个函数）。旋钮值写在根元素上（`data-layout` / `data-frame` /
//    `data-text-align` / `data-image` / `data-form` / `data-tone`），`block.css` 按它们排；形态目录自己不带几何。
//
// 🔴 **藏东西一律是不渲染**（部件有数据才画），不靠 CSS 藏：`image=none` 时 DOM 里就没有 `<img>`，
//    有表单时 `ctas` 整段不画（提交键就是 CTA）。
//
// 🔴 **图片的键叫 `imageUrl`，不叫 `url`**：AI 改站那条路的写入闸只认 `IMAGE_FIELDS` 里的键
//    （`scripts/lib/image-urls.js`），换一个名字模型编的地址就能写进来；`image-urls.test.js` 盯着这件事。
//
// 🔴 **bg 涂在哪由 frame 决定**：boxed 时涂盒子（`.cta-frame`），段背景不变；none 时涂整段。
//    `image=background` 的照片 + 55% 深色遮罩也跟着 frame 走（boxed 铺盒子，none 铺整段）。
//    底色与字色都走 `scripts/lib/contrast.js` 那两个共用函数（§bgCss 写成 CSS、§toneForBg 按亮度反白，footer-new
//    同一对），不在这里另写一份判据；照片铺底一律按深底处理。
//
// 🔴 **表单用共用的 `src/components/BlockLeadForm.tsx`**（hero-new / footer-new 同一份），不另造：
//    `mode` = 旋钮 form（teaser 露站级表单的 primary + 按钮，full 整张），`formId` = 槽 form.id（#1471）。
//    `form` 槽今天只有 `{ id? }`（选哪张站级表单，#1471 落地前不读），字段 / 按钮字 / 成功提示用组件内置默认。

import Link from 'next/link';
import { blockAttrs } from '@/lib/sections/blockAttrs';
import type { BlockConfig } from '@/lib/types/config';
import Icon from '@/components/Icon';
import BlockLeadForm from '@/components/BlockLeadForm';
import { getServices } from '@/lib/config';
import manifest from './manifest.json';
import { effectiveKnobs } from '../../scripts/lib/block-knobs.js';
import { bgCss, bsThemeForBg, toneForBg, type BgValue } from '../../scripts/lib/contrast.js';

type BtnStyle = 'solid' | 'outline' | 'link';

export interface CtaNewImage { imageUrl?: string; alt?: string }
export interface CtaNewButton { label?: string; href?: string; style?: BtnStyle; icon?: string; arrow?: boolean; size?: 'sm' | 'md' | 'lg' }
export interface CtaNewOptions { layout?: string; frame?: string; textAlign?: string; image?: string; form?: string }
export interface CtaNewData {
  options?: CtaNewOptions;
  eyebrow?: { text?: string; style?: string };
  headline?: string;
  body?: string;
  ctas?: CtaNewButton[];
  image?: CtaNewImage;
  form?: { id?: string };
  bg?: BgValue;
}

interface Props {
  data: CtaNewData;
  locale?: string;
  block?: BlockConfig;
}

// 按钮 0–2 条（定稿）；演示内容包按守卫 (c) 给列表槽 6 条，多出来的在这里截掉。
const MAX_CTAS = 2;

const isObj = (v: unknown): v is object => !!v && typeof v === 'object' && !Array.isArray(v);

/** #1471 —— 表单「需求」下拉的选项：在 Section.tsx 里读（`page-deps.js` 只看注册表指向的这份文件，理由见 BlockLeadForm 文件头）。 */
function servicesFor(locale: string): { id: string; name: string }[] {
  try { return (getServices(locale) || []).map((s: { id: string; name: string }) => ({ id: s.id, name: s.name })); } catch { return []; }
}

// 这几条类名要**逐字**写在源码里：`site.css` 是按源码 purge 的（`scripts/lib/site-css.js` §PURGE_CONTENT），
// 拼出来的类名 purge 看不见。
const EYEBROW_CLASS: Record<string, string> = {
  pill: 'cta-eyebrow-pill badge rounded-pill bg-primary-subtle text-primary fw-semibold text-xs px-3 py-2',
  outline: 'cta-eyebrow-outline badge rounded-pill border border-primary text-primary bg-transparent fw-semibold text-xs px-3 py-2',
  dash: 'cta-eyebrow-dash text-uppercase text-xs fw-semibold ls-wider text-muted',
  plain: 'cta-eyebrow-plain text-uppercase text-xs fw-semibold ls-wider text-muted',
};

function btnClass(b: CtaNewButton): string {
  const size = b.size === 'sm' ? ' btn-sm' : b.size === 'md' ? '' : ' btn-lg';
  if (b.style === 'link') return `btn btn-link d-inline-flex align-items-center justify-content-center text-nowrap${size}`;
  if (b.style === 'outline') return `btn btn-outline-primary d-inline-flex align-items-center justify-content-center text-nowrap${size}`;
  return `btn btn-primary d-inline-flex align-items-center justify-content-center text-nowrap${size}`;
}

export default function CtaNewSection({ data, locale = 'en', block }: Props) {
  const d: CtaNewData = isObj(data) ? data : {};
  const shape = block && typeof block.shape === 'string' ? block.shape : undefined;
  const opts: CtaNewOptions = isObj(d.options) ? d.options : {};
  const k = effectiveKnobs(manifest, shape, opts) as { layout: string; frame: string; textAlign: string; image: string; form: string };
  const boxed = k.frame === 'boxed';
  const img: CtaNewImage | null = isObj(d.image) && typeof d.image.imageUrl === 'string' && d.image.imageUrl ? d.image : null;
  const cover = k.image === 'background' && !!img;
  const side = (k.image === 'left' || k.image === 'right') && !!img;
  const tone = cover ? 'dark' : toneForBg(d.bg);
  const bgValue = bgCss(d.bg);
  const bgStyle = bgValue ? { background: bgValue } : undefined;

  const eyebrow: CtaNewData['eyebrow'] | null = isObj(d.eyebrow) && typeof d.eyebrow.text === 'string' && d.eyebrow.text ? d.eyebrow : null;
  const eyebrowStyle = eyebrow ? (eyebrow.style && (eyebrow.style in EYEBROW_CLASS || eyebrow.style === 'none') ? eyebrow.style : 'pill') : 'none';
  const ctas = (Array.isArray(d.ctas) ? d.ctas : []).filter((b) => isObj(b) && typeof b.label === 'string' && b.label).slice(0, MAX_CTAS);
  const showForm = k.form !== 'none';
  const centerForm = k.textAlign === 'center' && k.layout === 'centered';

  // 照片 + 遮罩：跟着 frame 走 —— boxed 铺盒子（`.cta-frame` 里），none 铺整段（`<section>` 里）。
  const coverLayer = cover && img ? (
    <div
      className="position-absolute top-0 start-0 w-100 h-100 cta-cover" data-part="bg"
      style={{ background: `linear-gradient(rgba(2,6,23,.55),rgba(2,6,23,.55)),url(${JSON.stringify(img.imageUrl)}) center/cover no-repeat` }}
      role="img"
      aria-label={img.alt || ''}
    />
  ) : null;

  const action = showForm ? (
    <div className="cta-action" data-part="action">
      <BlockLeadForm
        mode={k.form === 'teaser' ? 'teaser' : 'full'}
        formId={isObj(d.form) && typeof d.form.id === 'string' ? d.form.id : undefined}
        services={servicesFor(locale)}
        locale={locale}
        center={centerForm}
        idPrefix="cta"
      />
    </div>
  ) : ctas.length ? (
    <div className="cta-action" data-part="action">
      <div className="cta-ctas d-flex flex-wrap gap-2" data-part="ctas">
        {ctas.map((b, i) => (
          <Link key={i} href={b.href || '#'} className={btnClass(b)} data-cta={b.style || 'solid'}>
            {b.icon ? <Icon name={b.icon} className="me-2" /> : null}
            <span data-slot={`ctas.${i}.label`}>{b.label}</span>
            {b.arrow ? <Icon name="arrow-right" className="ms-2" /> : null}
          </Link>
        ))}
      </div>
    </div>
  ) : null;

  return (
    <section
      {...blockAttrs('cta-new', block)}
      data-layout={k.layout}
      data-frame={k.frame}
      data-text-align={k.textAlign}
      data-image={k.image}
      data-form={k.form}
      data-tone={tone}
      data-bs-theme={bsThemeForBg(d.bg, cover)}
      className="position-relative py-16 py-lg-24"
      style={boxed ? undefined : bgStyle}
    >
      {boxed ? null : coverLayer}
      <div className="container position-relative">
        <div
          className={boxed ? 'cta-frame position-relative overflow-hidden rounded-4 p-12 py-lg-16 px-lg-20' : 'cta-frame position-relative'}
          data-part="frame"
          style={boxed ? bgStyle : undefined}
        >
          {boxed ? coverLayer : null}
          <div className="cta-row position-relative">
            {side && img ? (
              <div className="cta-img" data-part="image">
                <img className="img-fluid rounded-4 w-100 object-fit-cover" src={img.imageUrl} alt={img.alt || ''} />
              </div>
            ) : null}
            <div className="cta-main">
              <div className="cta-inline">
                <div className="cta-text" data-part="text">
                  {eyebrow && eyebrowStyle !== 'none' ? (
                    <div className="mb-4" data-part="eyebrow">
                      <span className={EYEBROW_CLASS[eyebrowStyle]} data-eyebrow={eyebrowStyle} data-slot="eyebrow.text">
                        {eyebrowStyle === 'dash' ? '— ' : null}{eyebrow.text}
                      </span>
                    </div>
                  ) : null}
                  <h2 className="display-5 fw-bold lh-1 ls-tight mb-4 cta-title" data-slot="headline">{d.headline}</h2>
                  {d.body ? <p className="fs-5 text-muted cta-body" data-slot="body">{d.body}</p> : null}
                </div>
                {action}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
