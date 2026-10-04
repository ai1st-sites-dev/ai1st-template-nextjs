// ══════════════════════════════════════════════════════════════════════════════════════════════════
// hero —— 首屏，Webpixels / Bootstrap 那一套（#1463，总纲 #1422 的 T2.3）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 🔴 **普通页面块**：进 registry、进 Puck、进 AI 建站的块菜单，manifest 不带 `staging`（Chris 2026-09-27
//    「现在没有客户」，设计稿 B1 那条 📌）。它的样式全在 Webpixels 那一份 `site.css` 里，`src/app/layout.tsx`
//    从本票起给每一页都挂上它（与 Tailwind 并存到 T4）。T3 删旧库时 `hero` → `hero`。
//    建站那一侧它跟 `hero` 是同一个首屏位置，首页配方的抽取池不收它（`homepage-recipe.js` §NOT_IN_POOL）。
//
// 🔴 **一份 markup，三个旋钮**（textAlign / image / form），五个预设各是一个形态目录。实际生效的旋钮 =
//    形态对应的那个预设给底，`data.options` 里写了的逐个覆盖（`scripts/lib/block-knobs.js`
//    §effectiveKnobs —— 编辑器判 custom 用的是同一个函数）。旋钮值写在根元素上
//    （`data-text-align` / `data-image` / `data-form` / `data-tone`），`block.css` 按它们排；
//    **形态目录自己不带几何**（理由写在每份 `shape.css` 里）。
// 🔴 #1470 —— 两个旋钮互不影响：`textAlign`（left / center / right）只管文字块里的对齐，`image`
//    （none / left / right / top / bottom / background）只管图放哪、行怎么排。`reverse` 退役了：
//    旧的 `normal + reverse` = 今天的 `left`，旧的 `center + normal (+ reverse)` = 今天的 `bottom`（`top`）。
//
// 🔴 **排版尽量只走 Webpixels 的工具类**（总纲约束 3）。Webpixels 的工具类全带 `!important`，所以
//    `block.css` 里要压过它们的规则也带 `!important`、且选择器的 class 数不少于它（票正文「通用规矩」）。
//    这里「藏东西」一律是**不渲染**（部件有数据才画），不靠 CSS 藏 —— 那样 `image=none` 时 DOM 里就真的
//    没有 `<img>`（AC2），不是一张被 `display:none` 的图。
//
// 🔴 **图片的键叫 `imageUrl`，不叫 `url`**：AI 改站那条路的写入闸只认 `IMAGE_FIELDS` 里的键
//    （`scripts/lib/image-urls.js`，今天是 `imageUrl` / `logoUrl`），换一个名字模型编的地址就能写进来；
//    `image-urls.test.js` 现读 `<img src={…}>` 的叶子标识符盯着这件事（#1538 起图槽的 `<img>` 在 `slotImg` 里，它认调用）。
//
// 🔴 **底色与字色走 `scripts/lib/contrast.js` 那两个共用函数**（§bgCss 写成 CSS、§toneForBg 按亮度反白；#1477，
//    跟 footer / header / cta 同一份）。`bg` 可以是纯色、`brand` 或渐变 `{stops, angle}`。
//    图铺底（`image=background` 且有图）一律按深底处理 —— 图上面压着深色渐变遮罩。
import { slotImg } from '@/lib/sections/blockMedia';

import BlockSection from '@/components/BlockSection';
import type { BlockConfig } from '@/lib/types/config';
import { getServices } from '@/lib/config';
import Icon from '@/components/Icon';
import BlockLeadForm from '@/components/BlockLeadForm';
import Eyebrow, { isEyebrowStyle, type EyebrowStyle } from '@/components/Eyebrow';
import Button from '@/components/Button';
import manifest from './manifest.json';
import { effectiveKnobs } from '../../scripts/lib/block-knobs.js';
import type { BgValue } from '../../scripts/lib/contrast.js';

type BtnStyle = 'solid' | 'outline' | 'link';

export interface HeroNewImage { imageUrl?: string; alt?: string }
export interface HeroNewButton { label?: string; href?: string; style?: BtnStyle; icon?: string; arrow?: boolean; size?: 'sm' | 'md' | 'lg' }
export interface HeroNewOptions { textAlign?: string; image?: string; form?: string }
export interface HeroNewData {
  options?: HeroNewOptions;
  bg?: BgValue;
  proof?: { avatars?: HeroNewImage[]; rating?: number | string; text?: string };
  stats?: { value?: string; label?: string }[];
  logos?: { caption?: string; items?: HeroNewImage[] };
  band?: HeroNewImage[];
  eyebrow?: { text?: string; style?: string };
  headline?: string;
  subheadline?: string;
  ctas?: HeroNewButton[];
  image?: HeroNewImage;
  // 选哪张站级表单（#1471，`site/<locale>/forms.json`）；空 = 第一张，站没有表单库 = BlockLeadForm 的内置默认字段。
  // 露多少只看 `options.form`（`block-knobs.js:13`：旋钮值只存一处）。
  form?: { id?: string };
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

/**
 * 行的类，按 `image` 出（#1470）。DOM 顺序恒为「文字在前、图在后」。
 * 🔴 #1536 —— 有图列（left / right / top / bottom 且给了图）时**不走 Bootstrap 栅格**：行只有 `hro-row`，图在哪一边、
 *    两栏多宽、上下叠隔多少，全由 manifest 的 `mediaLayout` 生成（`scripts/block-build/media-layout.js`，6 个块共用一份）。
 *    几何跟原来的 `col-lg-6` + `gx-lg-16` 一个像素不差（1440 下图 612 / 文字 612，那是 Chris 拍板的 (A)）。
 * 没有图列（`hasSide` 为假：none / background / 没给图）时，文字列的位置跟 `textAlign` 走：
 * center 整块居中、right 整块靠右 —— 对齐类写在行上，文字列只有 2/3（或铺底时 1/2）宽。
 * 🔴 间距是 `gx-8 gy-10 gx-lg-16`，不是定稿抄来的 `g-10 gx-lg-16`：`.row` 的左右负外边距 = 横向间距的一半，
 *    `g-10` 是 20px，而 `.container` 在手机上的内距只有 16px ⟹ 390 宽下整页横向滚动 4px（实测
 *    scrollWidth 394）。横向收到 `gx-8`（16px）刚好贴住内距；竖向与 ≥992 的横向照定稿不变。
 *    也不写成 `g-10 gx-8`：Bootstrap 按尺寸逐档生成 g/gx/gy，`.g-10` 排在 `.gx-8` 后面，会把它压回去。
 */
function rowClass(textAlign: string, hasSide: boolean): string {
  if (hasSide) return 'hro-row';
  const base = 'row align-items-center gx-8 gy-10 gx-lg-16';
  if (textAlign === 'center') return `${base} justify-content-center`;
  if (textAlign === 'right') return `${base} justify-content-end`;
  return base;
}

/** 表单「需求」下拉的选项 —— 站内服务列表（在这里读、不在 BlockLeadForm 里读，理由见它的文件头：page-deps 只看这份 Section.tsx）。 */
function servicesFor(locale: string): { id: string; name: string }[] {
  try { return (getServices(locale) || []).map((s: { id: string; name: string }) => ({ id: s.id, name: s.name })); } catch { return []; }
}

export default function HeroNewSection({ data, locale = 'en', block }: Props) {
  const d: HeroNewData = isObj(data) ? data : {};
  const shape = block && typeof block.shape === 'string' ? block.shape : undefined;
  const opts: HeroNewOptions = isObj(d.options) ? d.options : {};
  const k = effectiveKnobs(manifest, shape, opts) as { textAlign: string; image: string; form: string };
  const img: HeroNewImage | null = isObj(d.image) && typeof d.image.imageUrl === 'string' && d.image.imageUrl ? d.image : null;
  const cover = k.image === 'background' && !!img;
  // 图列画不画（#1470 做什么 2；hero-render.test.js 的反向对照逐字锚在这一行上）。
  const side = (k.image === 'left' || k.image === 'right' || k.image === 'top' || k.image === 'bottom') && !!img;
  // 上下叠：文字块、图各占一整行（文字块宽度、大图 21:9 由 block.css 按 data-image 排）。
  const stacked = k.image === 'top' || k.image === 'bottom';
  const center = k.textAlign === 'center';
  const right = k.textAlign === 'right';


  const eyebrow: HeroNewData['eyebrow'] | null = isObj(d.eyebrow) && typeof d.eyebrow.text === 'string' && d.eyebrow.text ? d.eyebrow : null;
  const eyebrowStyle: EyebrowStyle | 'none' = eyebrow ? (eyebrow.style === 'none' ? 'none' : isEyebrowStyle(eyebrow.style) ? eyebrow.style : 'pill') : 'none';
  const ctas = (Array.isArray(d.ctas) ? d.ctas : []).filter((b) => isObj(b) && typeof b.label === 'string' && b.label).slice(0, MAX.ctas);
  const showForm = k.form !== 'none';
  const proof: HeroNewData['proof'] | null = isObj(d.proof) && (d.proof.text || imgs(d.proof.avatars).length) ? d.proof : null;
  const stats = (Array.isArray(d.stats) ? d.stats : []).filter((s) => isObj(s) && (s.value || s.label)).slice(0, MAX.stats);
  const logos = isObj(d.logos) ? imgs(d.logos.items).slice(0, MAX.logos) : [];
  const band = imgs(d.band).slice(0, MAX.band);

  // 文字列多宽：上下叠（top / bottom）占满（center 时 block.css 在 ≥992 收到 80%）；并排（left / right）时一半 —— 只有 `image=none`（旁边、底下都没有图）
  // 才是 2/3（定稿原话）。图铺底时也是一半：图在整块后面，文字列不因此变宽。
  // 有图列时文字列、图列都不带 Bootstrap 栅格类（两栏 / 上下叠由 mediaLayout 生成，见 §rowClass）。
  const textCol = side ? 'hro-textcol' : stacked ? 'col-12 hro-textcol' : cover ? 'col-12 col-lg-6 hro-textcol' : 'col-12 col-lg-8 hro-textcol';
  const just = center ? ' justify-content-center' : right ? ' justify-content-end' : '';

  return (
    <BlockSection
      type="hero"
      block={block}
      attrs={{
        'data-text-align': k.textAlign,
        'data-image': k.image,
        'data-form': k.form,
      }}
      bg={d.bg}
      cover={cover}
      className={`position-relative section-padding${center ? ' text-center' : right ? ' text-end' : ''}`}
      containerClassName="container position-relative"
      layer={cover && img ? (
        <div
          className="position-absolute top-0 start-0 w-100 h-100" data-part="bg"
          style={{ background: `linear-gradient(to top,rgba(2,6,23,.85),rgba(2,6,23,.35)),url(${JSON.stringify(img.imageUrl)}) center/cover no-repeat` }}
          role="img"
          aria-label={img.alt || ''}
        />
      ) : null}
    >
      <div className={rowClass(k.textAlign, side)}>
        <div className={textCol}>
          <div data-part="text">
            {eyebrow && eyebrowStyle !== 'none' ? (
              <div className="mb-5" data-part="eyebrow">
                <Eyebrow style={eyebrowStyle} text={eyebrow.text} slot="eyebrow.text" />
              </div>
            ) : null}
            <h1 className="display-3 fw-bold lh-1 ls-tight mb-5 hro-title" data-slot="headline">{d.headline}</h1>
            {d.subheadline ? <p className="fs-5 text-muted mb-8 hro-sub" data-slot="subheadline">{d.subheadline}</p> : null}
            {showForm ? (
              <BlockLeadForm
                mode={k.form === 'teaser' ? 'teaser' : 'full'}
                formId={isObj(d.form) && typeof d.form.id === 'string' ? d.form.id : undefined}
                services={servicesFor(locale)}
                locale={locale}
                align={k.textAlign === 'center' ? 'center' : k.textAlign === 'right' ? 'right' : 'left'}
              />
            ) : ctas.length ? (
              <div className={`d-flex flex-column flex-sm-row gap-2${just}`} data-part="ctas">
                {ctas.map((b, i) => (
                  <Button key={i} href={b.href || '#'} style={b.style} fallback="solid" size={b.size} defaultSize="lg">
                    {b.icon ? <Icon name={b.icon} className="me-2" /> : null}
                    <span data-slot={`ctas.${i}.label`}>{b.label}</span>
                    {b.arrow ? <Icon name="arrow-right" className="ms-2" /> : null}
                  </Button>
                ))}
              </div>
            ) : null}
            {proof ? (
              <div className={`d-flex align-items-center gap-3 mt-8${just}`} data-part="proof">
                {imgs(proof.avatars).length ? (
                  <div className="d-flex">
                    {imgs(proof.avatars).slice(0, MAX.avatars).map((a, i) => (
                      slotImg(a, { key: i, after: { width: 36, height: 36, className: 'rounded-circle border border-2 border-body object-fit-cover hro-avatar' } })
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
                  {logos.map((l, i) => slotImg(l, { key: i, after: { className: 'hro-logo' } }))}
                </div>
              </div>
            ) : null}
          </div>
          {band.length ? (
            <div className="row g-5 mt-10 justify-content-center" data-part="band" data-band-count={band.length}>
              {band.map((b, i) => (
                <div key={i} className="col-6 col-md" data-part="band-col">
                  {slotImg(b, { before: { className: 'img-fluid rounded-4 w-100 object-fit-cover hro-band-img' } })}
                </div>
              ))}
            </div>
          ) : null}
        </div>
        {side && img ? (
          <div className="hro-side">
            {slotImg(img, { before: { className: 'img-fluid rounded-4 w-100 object-fit-cover hro-img' } })}
          </div>
        ) : null}
      </div>
    </BlockSection>
  );
}
