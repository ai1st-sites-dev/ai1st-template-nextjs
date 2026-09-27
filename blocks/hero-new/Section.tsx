// ══════════════════════════════════════════════════════════════════════════════════════════════════
// hero-new —— 首屏，Webpixels / Bootstrap 那一套（#1463，总纲 #1422 的 T2.3）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 🔴 **普通页面块**：进 registry、进 Puck、进 AI 建站的块菜单，manifest 不带 `staging`（Chris 2026-09-27
//    「现在没有客户」，设计稿 B1 那条 📌）。它的样式全在 Webpixels 那一份 `site.css` 里，`src/app/layout.tsx`
//    从本票起给每一页都挂上它（与 Tailwind 并存到 T4）。T3 删旧库时 `hero-new` → `hero`。
//    建站那一侧它跟 `hero` 是同一个首屏位置，首页配方的抽取池不收它（`homepage-recipe.js` §NOT_IN_POOL）。
//
// 🔴 **一份 markup，三个旋钮**（align / image / form），五个预设各是一个形态目录。实际生效的旋钮 =
//    形态对应的那个预设给底，`data.options` 里写了的逐个覆盖（`scripts/lib/block-knobs.js`
//    §effectiveKnobs —— 编辑器判 custom 用的是同一个函数）。旋钮值写在根元素上
//    （`data-align` / `data-image` / `data-form` / `data-reverse` / `data-tone`），`block.css` 按它们排；
//    **形态目录自己不带几何**（理由写在每份 `shape.css` 里）。
//
// 🔴 **排版尽量只走 Webpixels 的工具类**（总纲约束 3）。Webpixels 的工具类全带 `!important`，所以
//    `block.css` 里要压过它们的规则也带 `!important`、且选择器的 class 数不少于它（票正文「通用规矩」）。
//    这里「藏东西」一律是**不渲染**（部件有数据才画），不靠 CSS 藏 —— 那样 `image=none` 时 DOM 里就真的
//    没有 `<img>`（AC2），不是一张被 `display:none` 的图。
//
// 🔴 **图片的键叫 `imageUrl`，不叫 `url`**：AI 改站那条路的写入闸只认 `IMAGE_FIELDS` 里的键
//    （`scripts/lib/image-urls.js`，今天是 `imageUrl` / `logoUrl`），换一个名字模型编的地址就能写进来；
//    `image-urls.test.js` 从组件里现读 `<img src={…}>` 的叶子标识符盯着这件事。
//
// 🔴 **字色按背景亮度自动算**（`scripts/lib/contrast.js` §toneFor，编辑器色板预览用同一个函数）。
//    图铺底（`image=background` 且有图）一律按深底处理 —— 图上面压着深色渐变遮罩。

import Link from 'next/link';
import { blockAttrs } from '@/lib/sections/blockAttrs';
import type { BlockConfig } from '@/lib/types/config';
import Icon from '@/components/Icon';
import HeroNewForm, { type HeroNewFormData } from './HeroNewForm';
import manifest from './manifest.json';
import { effectiveKnobs } from '../../scripts/lib/block-knobs.js';
import { toneFor } from '../../scripts/lib/contrast.js';

type BtnStyle = 'solid' | 'outline' | 'link';

export interface HeroNewImage { imageUrl?: string; alt?: string }
export interface HeroNewButton { label?: string; href?: string; style?: BtnStyle; icon?: string; arrow?: boolean; size?: 'sm' | 'md' | 'lg' }
export interface HeroNewOptions { align?: string; image?: string; form?: string; reverse?: boolean }
export interface HeroNewData {
  options?: HeroNewOptions;
  bg?: string;
  proof?: { avatars?: HeroNewImage[]; rating?: number | string; text?: string };
  stats?: { value?: string; label?: string }[];
  logos?: { caption?: string; items?: HeroNewImage[] };
  band?: HeroNewImage[];
  eyebrow?: { text?: string; style?: string };
  headline?: string;
  subheadline?: string;
  ctas?: HeroNewButton[];
  image?: HeroNewImage;
  form?: HeroNewFormData;
}

interface Props {
  data: HeroNewData;
  locale?: string;
  block?: BlockConfig;
}

// 上限写在这里、也写在 manifest 的槽位说明里：演示内容包按守卫 (c) 给每个列表槽 6 条，数据里多出来的
// 在这里截掉，不画出一排八个按钮。
const MAX = { ctas: 2, stats: 3, avatars: 4, logos: 6, band: 6 } as const;

const isObj = (v: unknown): v is object => !!v && typeof v === 'object' && !Array.isArray(v);
const imgs = (v: unknown): HeroNewImage[] =>
  (Array.isArray(v) ? v : []).filter((x): x is HeroNewImage => isObj(x) && typeof (x as HeroNewImage).imageUrl === 'string' && !!(x as HeroNewImage).imageUrl);

// 这几条类名要**逐字**写在源码里：`site.css` 是按源码 purge 的（`scripts/lib/site-css.js` §PURGE_CONTENT），
// 拼出来的类名 purge 看不见。
const EYEBROW_CLASS: Record<string, string> = {
  pill: 'hro-eyebrow-pill badge rounded-pill bg-primary-subtle text-primary fw-semibold text-xs px-3 py-2',
  outline: 'hro-eyebrow-outline badge rounded-pill border border-primary text-primary bg-transparent fw-semibold text-xs px-3 py-2',
  dash: 'hro-eyebrow-dash text-uppercase text-xs fw-semibold ls-wider text-muted',
  plain: 'hro-eyebrow-plain text-uppercase text-xs fw-semibold ls-wider text-muted',
};

function btnClass(b: HeroNewButton): string {
  const size = b.size === 'sm' ? ' btn-sm' : b.size === 'md' ? '' : ' btn-lg';
  // `d-inline-flex align-items-center justify-content-center`：图标和字在同一行（Webpixels 的 .btn 里
  // 一个 svg 默认会自己占一行）。
  if (b.style === 'link') return `btn btn-link d-inline-flex align-items-center justify-content-center text-nowrap${size}`;
  if (b.style === 'outline') return `btn btn-outline-primary d-inline-flex align-items-center justify-content-center text-nowrap${size}`;
  return `btn btn-primary d-inline-flex align-items-center justify-content-center text-nowrap${size}`;
}

/**
 * 行的类：reverse 的两条原则 —— 桌面在左的，小屏就在上；center 时图换到上面。
 * 🔴 间距是 `gx-8 gy-10 gx-lg-16`，不是定稿抄来的 `g-10 gx-lg-16`：`.row` 的左右负外边距 = 横向间距的一半，
 *    `g-10` 是 20px，而 `.container` 在手机上的内距只有 16px ⟹ 390 宽下整页横向滚动 4px（实测
 *    scrollWidth 394）。横向收到 `gx-8`（16px）刚好贴住内距；竖向与 ≥992 的横向照定稿不变。
 *    也不写成 `g-10 gx-8`：Bootstrap 按尺寸逐档生成 g/gx/gy，`.g-10` 排在 `.gx-8` 后面，会把它压回去。
 */
function rowClass(align: string, reverse: boolean): string {
  const base = 'row align-items-center gx-8 gy-10 gx-lg-16';
  if (!reverse) return base;
  return align === 'center' ? `${base} flex-column-reverse` : `${base} flex-column-reverse flex-lg-row-reverse`;
}

export default function HeroNewSection({ data, locale = 'en', block }: Props) {
  const d: HeroNewData = isObj(data) ? data : {};
  const shape = block && typeof block.shape === 'string' ? block.shape : undefined;
  const opts: HeroNewOptions = isObj(d.options) ? d.options : {};
  const k = effectiveKnobs(manifest, shape, opts) as { align: string; image: string; form: string };
  const reverse = opts.reverse === true;
  const img: HeroNewImage | null = isObj(d.image) && typeof d.image.imageUrl === 'string' && d.image.imageUrl ? d.image : null;
  const cover = k.image === 'background' && !!img;
  const side = k.image === 'normal' && !!img;
  const tone = cover ? 'dark' : toneFor(d.bg);
  const center = k.align === 'center';

  const bgStyle = typeof d.bg === 'string'
    ? (d.bg === 'brand' ? { background: 'var(--x-primary)' } : /^#[0-9a-fA-F]{6}$/.test(d.bg) ? { background: d.bg } : undefined)
    : undefined;

  const eyebrow: HeroNewData['eyebrow'] | null = isObj(d.eyebrow) && typeof d.eyebrow.text === 'string' && d.eyebrow.text ? d.eyebrow : null;
  const eyebrowStyle = eyebrow ? (eyebrow.style && (eyebrow.style in EYEBROW_CLASS || eyebrow.style === 'none') ? eyebrow.style : 'pill') : 'none';
  const ctas = (Array.isArray(d.ctas) ? d.ctas : []).filter((b) => isObj(b) && typeof b.label === 'string' && b.label).slice(0, MAX.ctas);
  const showForm = k.form !== 'none';
  const proof: HeroNewData['proof'] | null = isObj(d.proof) && (d.proof.text || imgs(d.proof.avatars).length) ? d.proof : null;
  const stats = (Array.isArray(d.stats) ? d.stats : []).filter((s) => isObj(s) && (s.value || s.label)).slice(0, MAX.stats);
  const logos = isObj(d.logos) ? imgs(d.logos.items).slice(0, MAX.logos) : [];
  const band = imgs(d.band).slice(0, MAX.band);

  // 文字列多宽：center 占满（内容再由 block.css 收到 64ch）；left 时一半 —— 只有 `image=none`（旁边、底下都没有图）
  // 才是 2/3（定稿原话）。图铺底时也是一半：图在整块后面，文字列不因此变宽。
  const textCol = center ? 'col-12 hro-textcol' : (side || cover) ? 'col-12 col-lg-6 hro-textcol' : 'col-12 col-lg-8 hro-textcol';
  const just = center ? ' justify-content-center' : '';

  return (
    <section
      {...blockAttrs('hero-new', block)}
      data-align={k.align}
      data-image={k.image}
      data-form={k.form}
      data-reverse={reverse ? 'true' : 'false'}
      data-tone={tone}
      className={`position-relative py-16 py-lg-24${center ? ' text-center' : ''}`}
      style={bgStyle}
    >
      {cover && img ? (
        <div
          className="position-absolute top-0 start-0 w-100 h-100" data-part="bg"
          style={{ background: `linear-gradient(to top,rgba(2,6,23,.85),rgba(2,6,23,.35)),url(${JSON.stringify(img.imageUrl)}) center/cover no-repeat` }}
          role="img"
          aria-label={img.alt || ''}
        />
      ) : null}
      <div className="container position-relative">
        <div className={rowClass(k.align, reverse)}>
          <div className={textCol}>
            <div data-part="text">
              {eyebrow && eyebrowStyle !== 'none' ? (
                <div className="mb-5" data-part="eyebrow">
                  <span className={EYEBROW_CLASS[eyebrowStyle]} data-eyebrow={eyebrowStyle} data-slot="eyebrow.text">
                    {eyebrowStyle === 'dash' ? '— ' : null}{eyebrow.text}
                  </span>
                </div>
              ) : null}
              <h1 className="display-3 fw-bold lh-1 ls-tight mb-5 hro-title" data-slot="headline">{d.headline}</h1>
              {d.subheadline ? <p className="fs-5 text-muted mb-8 hro-sub" data-slot="subheadline">{d.subheadline}</p> : null}
              {showForm ? (
                <HeroNewForm data={d.form} variant={k.form === 'inline' ? 'inline' : 'stacked'} locale={locale} center={center} />
              ) : ctas.length ? (
                <div className={`d-flex flex-column flex-sm-row gap-2${just}`} data-part="ctas">
                  {ctas.map((b, i) => (
                    <Link key={i} href={b.href || '#'} className={btnClass(b)} data-cta={b.style || 'solid'}>
                      {b.icon ? <Icon name={b.icon} className="me-2" /> : null}
                      <span data-slot={`ctas.${i}.label`}>{b.label}</span>
                      {b.arrow ? <Icon name="arrow-right" className="ms-2" /> : null}
                    </Link>
                  ))}
                </div>
              ) : null}
              {proof ? (
                <div className={`d-flex align-items-center gap-3 mt-8${just}`} data-part="proof">
                  {imgs(proof.avatars).length ? (
                    <div className="d-flex">
                      {imgs(proof.avatars).slice(0, MAX.avatars).map((a, i) => (
                        <img key={i} src={a.imageUrl} alt={a.alt || ''} width={36} height={36}
                          className="rounded-circle border border-2 border-white object-fit-cover hro-avatar" />
                      ))}
                    </div>
                  ) : null}
                  <div className="text-sm">
                    {proof.rating !== undefined && proof.rating !== '' ? (
                      <><span className="text-warning" aria-hidden="true">★★★★★</span> <b>{proof.rating}</b> · </>
                    ) : null}
                    <span data-slot="proof.text">{proof.text}</span>
                  </div>
                </div>
              ) : null}
              {stats.length ? (
                <div className={`d-flex flex-wrap gap-6 gap-md-10 mt-10 pt-8 border-top${just}`} data-part="stats">
                  {stats.map((s, i) => (
                    <div key={i}>
                      <div className="fs-3 fw-bold lh-1" data-slot={`stats.${i}.value`}>{s.value}</div>
                      <div className="text-sm text-muted mt-1" data-slot={`stats.${i}.label`}>{s.label}</div>
                    </div>
                  ))}
                </div>
              ) : null}
              {logos.length ? (
                <div className="mt-12" data-part="logos">
                  {isObj(d.logos) && d.logos.caption ? (
                    <div className="text-sm text-muted mb-4" data-slot="logos.caption">{d.logos.caption}</div>
                  ) : null}
                  <div className={`d-flex flex-wrap align-items-center gap-4 gap-md-5${just}`}>
                    {logos.map((l, i) => <img key={i} src={l.imageUrl} alt={l.alt || ''} className="hro-logo" />)}
                  </div>
                </div>
              ) : null}
            </div>
            {band.length ? (
              <div className="row g-5 mt-10 justify-content-center" data-part="band" data-band-count={band.length}>
                {band.map((b, i) => (
                  <div key={i} className="col-6 col-md" data-part="band-col">
                    <img className="img-fluid rounded-4 w-100 object-fit-cover hro-band-img" src={b.imageUrl} alt={b.alt || ''} />
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          {side && img ? (
            <div className={center ? 'col-12 hro-side' : 'col-12 col-lg-6 hro-side'}>
              <img className="img-fluid rounded-4 w-100 object-fit-cover hro-img" src={img.imageUrl} alt={img.alt || ''} />
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
