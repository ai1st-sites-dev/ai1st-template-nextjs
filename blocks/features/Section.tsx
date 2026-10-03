// ══════════════════════════════════════════════════════════════════════════════════════════════════
// features —— 块头（intro）+ 一组项目（items），Webpixels / Bootstrap 那一套（#1475，总纲 #1422 的 T2.4）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 🔴 **一份 markup，三组旋钮**：intro*（introPosition / introAlign / introImage）· items*（itemsLayout /
//    itemsColumns / itemsImage）· item*（itemStyle / itemAlign / itemIcon / itemImage / itemConnector），七个预设各是
//    一个形态目录。实际生效的旋钮 = 形态对应的那个预设给底，`data.options` 里写了的逐个覆盖（`scripts/lib/block-knobs.js`
//    §effectiveKnobs —— 编辑器判 custom 用的是同一个函数）。旋钮值写在根元素上（`data-intro-position` …
//    `data-item-connector` / `data-tone`），`block.css` 按它们排；形态目录自己不带几何。
//    旋钮彼此独立，这里没有「拧了 A 就替你改 B」的纠正（定稿 2026-09-29 删掉了图册里那一条）。
//
// 🔴 **藏东西一律是不渲染**（部件有数据、而且对应的旋钮开着才画），不靠 CSS 藏：`introImage=none` 时 DOM 里
//    就没有那张 `<img>`；某一项没写 `icon` / `number` / `image` / `link`，那一项就没有那个节点。
//
// 🔴 **图片的键叫 `imageUrl`**（`introImage` / `itemsImage` / `items[].image` 三处都是）：AI 改站的写入闸只认
//    `IMAGE_FIELDS` 里的键（`scripts/lib/image-urls.js`）；`image-urls.test.js` 盯着这件事。
//
// 🔴 **图标是内联 SVG**（#1462 那条路，同 header / footer）：`iconTable` 由服务端按数据里出现的名字查好传进来
//    （`scripts/lib/icons.js` §iconTableFor，单格页与真站构建各自传），这里用 `InlineIcon` 画；查不到的名字那一项
//    不画图标（连底色方块也不画）。本组件自己写死的名字只有按钮的箭头 `arrow-right` 和小清单的勾号 `check`（#1527），登记在 `BLOCK_ICONS`。
//
// 🔴 #1505 —— **`items` 也可以写成引用**（`{source: "services"}` / `{source: "pages", under}`），由页面那一层在渲染前
//    展开（`src/lib/sections/item-sources.ts` §resolveItemSources），到这里已经是条目数组，并带着标记
//    `data._sourced.items = <源名>`。这个组件对标记只做三件事：不按 `maxItems` 截（引用写法有几条出几条）·
//    展开出 0 条整块不画（同 `service-related-pages`：服务下面还没有页面时那一块看不见）· 根元素挂
//    `data-items-source`。手写的条目（没有标记）照旧：截到 `maxItems`，0 条照样画块头（编辑器里新拖进来的块不会消失）。
//
// 🔴 **底色与字色走 `scripts/lib/contrast.js` 那两个共用函数**（§bgCss / §toneForBg，footer / cta 同一对），
//    纯色、brand、渐变都认；这里不自己算亮度、不自己拼渐变。

import { blockAttrs } from '@/lib/sections/blockAttrs';
import { slotImg } from '@/lib/sections/blockMedia';
import type { BlockConfig } from '@/lib/types/config';
import InlineIcon, { type IconTable } from '@/components/InlineIcon';
import Eyebrow, { isEyebrowStyle, type EyebrowStyle } from '@/components/Eyebrow';
import Button from '@/components/Button';
import manifest from './manifest.json';
import { effectiveKnobs } from '../../scripts/lib/block-knobs.js';
import { bgCss, bsThemeForBg, toneForBg, type BgValue } from '../../scripts/lib/contrast.js';

type BtnStyle = 'solid' | 'outline' | 'link';

export interface FeaturesNewImage { imageUrl?: string; alt?: string }
export interface FeaturesNewButton { label?: string; href?: string; style?: BtnStyle; icon?: string; arrow?: boolean; size?: 'sm' | 'md' | 'lg' }
export interface FeaturesNewItem {
  number?: string;
  icon?: string;
  image?: FeaturesNewImage;
  title?: string;
  text?: string;
  /** #1527 —— 条目自己的短清单（旧 card-group 的 `features?: [string]` 那一维）。没写 / 空 ⟹ 不画。 */
  bullets?: string[];
  link?: FeaturesNewButton;
}
export interface FeaturesNewOptions {
  introPosition?: string; introAlign?: string; introImage?: string;
  itemsLayout?: string; itemsColumns?: string; itemsImage?: string;
  itemStyle?: string; itemAlign?: string; itemIcon?: string; itemImage?: string; itemConnector?: string;
}
export interface FeaturesNewData {
  options?: FeaturesNewOptions;
  introEyebrow?: { text?: string; style?: string };
  headline?: string;
  body?: string;
  introCtas?: FeaturesNewButton[];
  introImage?: FeaturesNewImage;
  itemsImage?: FeaturesNewImage;
  items?: FeaturesNewItem[];
  bg?: BgValue;
  /** #1505 —— 展开过的引用（只活在内存里，不写进文件）：槽名 → 源名。 */
  _sourced?: { items?: string };
}

interface Props {
  data: FeaturesNewData;
  locale?: string;
  block?: BlockConfig;
  /** 服务端查好的图标表（`scripts/lib/icons.js` §iconTableFor）。没给 ⟹ 一个图标都不画。 */
  iconTable?: IconTable;
}

// 块头按钮 0–2 条（manifest `slots.introCtas.max`）；项目 1–8 项（`slots.items.maxItems`，validateSite 拦超出的）。
// 演示内容包按守卫 (c) 给列表槽 6 条，多出来的在这里截掉。
const MAX_CTAS = manifest.slots.introCtas.max;
const MAX_ITEMS = manifest.slots.items.maxItems;

const isObj = (v: unknown): v is object => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const imgOf = (v: unknown): FeaturesNewImage | null => (isObj(v) && str((v as FeaturesNewImage).imageUrl) ? (v as FeaturesNewImage) : null);

export default function FeaturesNewSection({ data, block, iconTable = {} }: Props) {
  const d: FeaturesNewData = isObj(data) ? data : {};
  const shape = block && typeof block.shape === 'string' ? block.shape : undefined;
  const opts: FeaturesNewOptions = isObj(d.options) ? d.options : {};
  const k = effectiveKnobs(manifest, shape, opts) as Required<{ [K in keyof FeaturesNewOptions]: string }>;
  const tone = toneForBg(d.bg);
  const bgValue = bgCss(d.bg);

  const icon = (name: string | undefined, className?: string) => <InlineIcon name={name} icons={iconTable} className={className} />;
  const hasIcon = (name: unknown) => typeof name === 'string' && !!iconTable[name];

  const eyebrow = isObj(d.introEyebrow) && str(d.introEyebrow.text) ? d.introEyebrow : null;
  // 没写 style ⟹ pill（同 hero / cta：AI 只写了字，眉标照样出来）；明写 none ⟹ 不画。
  const eyebrowStyle: EyebrowStyle | 'none' = !eyebrow ? 'none' : !eyebrow.style ? 'pill' : isEyebrowStyle(eyebrow.style) ? eyebrow.style : 'none';
  const ctas = (Array.isArray(d.introCtas) ? d.introCtas : []).filter((b) => isObj(b) && str(b.label)).slice(0, MAX_CTAS);
  const introImg = k.introImage !== 'none' ? imgOf(d.introImage) : null;
  const itemsImg = k.itemsImage !== 'none' ? imgOf(d.itemsImage) : null;
  const sourced = isObj(d._sourced) && typeof d._sourced.items === 'string' ? d._sourced.items : '';
  const allItems = (Array.isArray(d.items) ? d.items : []).filter((it): it is FeaturesNewItem => isObj(it));
  const items = sourced ? allItems : allItems.slice(0, MAX_ITEMS);
  if (sourced && !items.length) return null;
  // 连线只连「步骤」：一项 number 都没有 ⟹ 不画（旋钮开着也不画 —— 没有编号的连线连的不是任何东西）。
  const connector = k.itemConnector === 'line' && items.some((it) => str(it.number));
  const cover = k.itemImage === 'background';

  const button = (b: FeaturesNewButton, i: number, fallback: BtnStyle, slot: string) => (
    <Button key={i} href={b.href || '#'} style={b.style} fallback={fallback} size={b.size} defaultSize="md" flush>
      {b.icon ? icon(b.icon, 'me-2') : null}
      <span data-slot={slot}>{b.label}</span>
      {b.arrow ? <span className="ms-2 d-inline-flex">{icon('arrow-right')}</span> : null}
    </Button>
  );

  const introText = (
    <div className="fx-intro-text" data-part="intro-text">
      {eyebrow && eyebrowStyle !== 'none' ? (
        <div className="mb-4" data-part="eyebrow">
          <Eyebrow style={eyebrowStyle} text={eyebrow.text} slot="introEyebrow.text" />
        </div>
      ) : null}
      <h2 className="display-5 fw-bold lh-1 ls-tight mb-4 fx-title" data-slot="headline">{d.headline}</h2>
      {d.body ? <p className="fs-5 text-muted mb-0 fx-body" data-slot="body">{d.body}</p> : null}
      {ctas.length ? (
        <div className="fx-ctas d-flex flex-wrap gap-2" data-part="ctas">
          {ctas.map((b, i) => button(b, i, 'solid', `introCtas.${i}.label`))}
        </div>
      ) : null}
    </div>
  );

  return (
    <section
      {...blockAttrs('features', block)}
      data-intro-position={k.introPosition}
      data-intro-align={k.introAlign}
      data-intro-image={k.introImage}
      data-items-layout={k.itemsLayout}
      data-items-columns={k.itemsColumns}
      data-items-image={k.itemsImage}
      data-item-style={k.itemStyle}
      data-item-align={k.itemAlign}
      data-item-icon={k.itemIcon}
      data-item-image={k.itemImage}
      data-item-connector={k.itemConnector}
      data-tone={tone}
      data-bs-theme={bsThemeForBg(d.bg)}
      data-items-source={sourced || undefined}
      className="position-relative py-16 py-lg-24"
      style={bgValue ? { background: bgValue } : undefined}
    >
      <div className="container">
        <div className="row fx-frame gy-10 gx-lg-16">
          <div className="col-12 fx-introcol" data-part="intro">
            <div className="fx-intro">
              {introImg ? (
                <div className="fx-intro-img" data-part="intro-image">
                  {slotImg(introImg, { before: { className: 'img-fluid rounded-4 w-100 object-fit-cover' } })}
                </div>
              ) : null}
              {introText}
            </div>
          </div>
          <div className="col-12 fx-itemscol" data-part="items">
            <div className="row fx-itemsrow gy-10 gx-lg-16">
              {itemsImg ? (
                <div className="col-12 fx-itemsimg" data-part="items-image">
                  {slotImg(itemsImg, { before: { className: 'img-fluid rounded-4 w-100 object-fit-cover' } })}
                </div>
              ) : null}
              <div className="col-12 fx-itemsgrid">
                <div className="row fx-grid g-6">
                  {items.map((it, i) => {
                    const img = k.itemImage !== 'none' ? imgOf(it.image) : null;
                    const num = str(it.number);
                    const showIcon = k.itemIcon !== 'none' && !cover && hasIcon(it.icon);
                    const link = isObj(it.link) && str(it.link.label) ? it.link : null;
                    const bullets = Array.isArray(it.bullets) ? it.bullets.filter((b): b is string => !!str(b)) : [];
                    return (
                      <div key={i} className="fx-item" data-part="item">
                        <div className="fx-inner h-100">
                          {img ? (
                            <div className="fx-img" data-part="item-image">
                              {slotImg(img, { before: { className: 'w-100 h-100 object-fit-cover' } })}
                            </div>
                          ) : null}
                          <div className="fx-content">
                            {num || showIcon ? (
                              <div className="fx-mark" data-part="mark" data-mark={num && showIcon ? '2' : '1'}>
                                {num ? <span className="fx-number d-inline-flex align-items-center justify-content-center rounded-3 bg-primary-subtle text-primary fw-bold" data-part="number" data-slot={`items.${i}.number`}>{num}</span> : null}
                                {showIcon ? <span className="fx-icon d-inline-flex align-items-center justify-content-center rounded-3 bg-primary-subtle text-primary" data-part="icon">{icon(it.icon)}</span> : null}
                                {connector && i < items.length - 1 ? <span className="fx-connector" data-part="connector" aria-hidden="true" /> : null}
                              </div>
                            ) : null}
                            <div className="fx-text">
                              <h3 className="h5 fw-bold mb-2 fx-item-title" data-slot={`items.${i}.title`}>{it.title}</h3>
                              {it.text ? <p className="text-muted mb-0" data-slot={`items.${i}.text`}>{it.text}</p> : null}
                              {bullets.length ? (
                                <ul className="fx-bullets list-unstyled text-muted mt-3 mb-0" data-part="bullets">
                                  {bullets.map((b, j) => <li key={j} className="d-flex align-items-start gap-2">{icon('check', 'fx-check flex-shrink-0')}<span>{b}</span></li>)}
                                </ul>
                              ) : null}
                              {link ? <div className="mt-3" data-part="link">{button(link, 0, 'link', `items.${i}.link.label`)}</div> : null}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
