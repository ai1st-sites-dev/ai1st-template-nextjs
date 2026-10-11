// ══════════════════════════════════════════════════════════════════════════════════════════════════
// milestones —— 块头（intro）+ 一组数字（stats），Webpixels / Bootstrap 那一套（#1482，总纲 #1422 的 T2.6）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 🔴 **一份 markup，三层旋钮**：块级 blockImage · intro*（introPosition / introAlign / introImage）·
//    stats*（statsColumns / statSize / statStyle / statAlign），五个预设各是一个形态目录。实际生效的旋钮 =
//    形态对应的那个预设给底，`data.options` 里写了的逐个覆盖（`scripts/lib/block-knobs.js` §effectiveKnobs ——
//    编辑器判 custom 用的是同一个函数）。旋钮值写在根元素上（`data-block-image` … `data-stat-align` / `data-tone`），
//    `block.css` 按它们排；形态目录自己不带几何。旋钮彼此独立，这里没有「拧了 A 就替你改 B」的纠正
//    （定稿 2026-09-29 删掉了图册里「side intro 时 3 / 4 列强制 2 列」「blockImage 左右时 4 列强制 3 列」那两条）。
//
// 🔴 **藏东西一律是不渲染**（部件有数据、而且对应的旋钮开着才画），不靠 CSS 藏：`blockImage=none` 时 DOM 里
//    就没有那张 `<img>`；`statIcon` 开关关着（默认），或某条 stat 没写 `icon`（或名字查不到），那一条就没有图标节点。块头只看 `headline` / `body`：
//    两个都空 ⟹ 块头那一列整个不渲染，stats 顶到段顶。每条 stat 只有 value · label（+ icon），没有第三行。
//
// 🔴 **图片的键叫 `imageUrl`**（`blockImage` / `introImage` 两处）：AI 改站的写入闸只认 `IMAGE_FIELDS` 里的键
//    （`scripts/lib/image-urls.js`）。
//
// 🔴 **图标是内联 SVG**（同 features）：`iconTable` 由服务端按数据里出现的名字查好传进来
//    （`scripts/lib/icons.js` §iconTableFor），这里用 `InlineIcon` 画；本组件自己不写死任何图标名。
//
// 🔴 **底色与字色走 `scripts/lib/contrast.js` 那两个共用函数**（§bgCss / §toneForBg，footer / cta 同一对），
//    纯色、brand、渐变都认；这里不自己算亮度、不自己拼渐变。`blockImage=background` 且真有图时字色按深底
//    （图上盖 60% 深色遮罩，遮罩写在 `block.css`）。
import { slotImg } from '@/lib/sections/blockMedia';
import { emptyListHidesBlock, sourcedOf } from '@/lib/sections/emptyList';

import BlockSection from '@/components/BlockSection';
import type { BlockConfig } from '@/lib/types/config';
import InlineIcon, { type IconTable } from '@/components/InlineIcon';
import Eyebrow, { isEyebrowStyle, type EyebrowStyle } from '@/components/Eyebrow';
import Button from '@/components/Button';
import manifest from './manifest.json';
import { effectiveKnobs } from '../../scripts/lib/block-knobs.js';
import { type BgValue } from '../../scripts/lib/contrast.js';

type BtnStyle = 'solid' | 'outline' | 'link';

export interface MilestonesImage { imageUrl?: string; alt?: string }
export interface MilestonesButton { label?: string; href?: string; style?: BtnStyle; icon?: string; arrow?: boolean; size?: 'sm' | 'md' | 'lg' }
export interface MilestonesStat { value?: string; label?: string; icon?: string }
export interface MilestonesOptions {
  blockImage?: string;
  introPosition?: string; introAlign?: string; introImage?: string;
  statsColumns?: string; statSize?: string; statStyle?: string; statAlign?: string;
  statIcon?: boolean;
}
export interface MilestonesData {
  options?: MilestonesOptions;
  blockImage?: MilestonesImage;
  introEyebrow?: { text?: string; style?: string };
  headline?: string;
  body?: string;
  introCtas?: MilestonesButton[];
  introImage?: MilestonesImage;
  stats?: MilestonesStat[];
  bg?: BgValue;
}

interface Props {
  data: MilestonesData;
  locale?: string;
  block?: BlockConfig;
  /** 服务端查好的图标表（`scripts/lib/icons.js` §iconTableFor）。没给 ⟹ 一个图标都不画。 */
  iconTable?: IconTable;
}

// 块头按钮 0–2 条（manifest `slots.introCtas.max`）；stats 1–6 条（`slots.stats.maxItems`，validateSite 拦超出的）。
// 演示内容包按守卫 (c) 给按钮 6 条，多出来的在这里截掉。
const MAX_CTAS = manifest.slots.introCtas.max;
const MAX_STATS = manifest.slots.stats.maxItems;

const isObj = (v: unknown): v is object => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const imgOf = (v: unknown): MilestonesImage | null => (isObj(v) && str((v as MilestonesImage).imageUrl) ? (v as MilestonesImage) : null);

export default function MilestonesSection({ data, block, iconTable = {} }: Props) {
  const d: MilestonesData = isObj(data) ? data : {};
  const shape = block && typeof block.shape === 'string' ? block.shape : undefined;
  const opts: MilestonesOptions = isObj(d.options) ? d.options : {};
  const k = effectiveKnobs(manifest, shape, opts) as Required<{ [K in Exclude<keyof MilestonesOptions, 'statIcon'>]: string }>;
  // 布尔开关（#1492，同 header 的 icons）：预设不钉它，默认关 = 照图册那个没勾的 `statIcon`。
  const { statIcon = false } = opts;
  const blockImg = k.blockImage !== 'none' ? imgOf(d.blockImage) : null;
  const cover = !!blockImg && k.blockImage === 'background';

  const icon = (name: string | undefined, className?: string) => <InlineIcon name={name} icons={iconTable} className={className} />;
  const hasIcon = (name: unknown) => typeof name === 'string' && !!iconTable[name];

  const eyebrow = isObj(d.introEyebrow) && str(d.introEyebrow.text) ? d.introEyebrow : null;
  // 没写 style ⟹ pill（同 hero / cta / features：AI 只写了字，眉标照样出来）；明写 none ⟹ 不画。
  const eyebrowStyle: EyebrowStyle | 'none' = !eyebrow ? 'none' : !eyebrow.style ? 'pill' : isEyebrowStyle(eyebrow.style) ? eyebrow.style : 'none';
  const ctas = (Array.isArray(d.introCtas) ? d.introCtas : []).filter((b) => isObj(b) && str(b.label)).slice(0, MAX_CTAS);
  const introImg = k.introImage !== 'none' ? imgOf(d.introImage) : null;
  const hasIntro = !!(str(d.headline) || str(d.body));
  const stats = (Array.isArray(d.stats) ? d.stats : []).filter((s): s is MilestonesStat => isObj(s)).slice(0, MAX_STATS);
  // 写了条目却一条都不合格 ⟹ 整块不画；手写 0 条照画块头（#1536，判据在 src/lib/sections/emptyList.ts）。
  if (emptyListHidesBlock(d.stats, stats.length, sourcedOf(d, 'stats'))) return null;

  const introText = (
    <div className="mi-intro-text" data-part="intro-text">
      {eyebrow && eyebrowStyle !== 'none' ? (
        <div className="mb-4" data-part="eyebrow">
          <Eyebrow style={eyebrowStyle} text={eyebrow.text} slot="introEyebrow.text" />
        </div>
      ) : null}
      {d.headline ? <h2 className="display-5 fw-bold lh-1 ls-tight mb-4 mi-title" data-slot="headline">{d.headline}</h2> : null}
      {d.body ? <p className="fs-5 text-muted mb-0 mi-body" data-slot="body">{d.body}</p> : null}
      {ctas.length ? (
        <div className="mi-ctas d-flex flex-wrap gap-2" data-part="ctas">
          {ctas.map((b, i) => (
            <Button key={i} href={b.href || '#'} style={b.style} fallback="solid" size={b.size} defaultSize="md" flush>
              {b.icon ? icon(b.icon, 'me-2') : null}
              <span data-slot={`introCtas.${i}.label`}>{b.label}</span>
              {b.arrow ? <span className="ms-2 d-inline-flex">{icon('arrow-right')}</span> : null}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );

  return (
    <BlockSection
      type="milestones"
      block={block}
      attrs={{
        'data-block-image': k.blockImage,
        'data-intro-position': k.introPosition,
        'data-intro-align': k.introAlign,
        'data-intro-image': k.introImage,
        'data-stats-columns': k.statsColumns,
        'data-stat-size': k.statSize,
        'data-stat-style': k.statStyle,
        'data-stat-align': k.statAlign,
      }}
      bg={d.bg}
      cover={cover}
      containerClassName="container mi-container"
      layer={cover ? (
        <div className="mi-cover" data-part="block-image">
          {slotImg(blockImg, { before: { className: 'w-100 h-100 object-fit-cover' }, slot: 'blockImage' })}
        </div>
      ) : null}
    >
      <div className="mi-outer">
        <div className="mi-main">
          <div className="row mi-frame gy-10 gx-lg-16">
            {hasIntro ? (
              <div className="col-12 mi-introcol" data-part="intro">
                <div className="mi-intro">
                  {introText}
                  {introImg ? (
                    <div className="mi-intro-img" data-part="intro-image">
                      {slotImg(introImg, { before: { className: 'img-fluid rounded-4 w-100 object-fit-cover' }, slot: 'introImage' })}
                    </div>
                  ) : null}
                </div>
              </div>
            ) : null}
            <div className="col-12 mi-statscol" data-part="stats">
              <div className="mi-grid">
                {stats.map((s, i) => (
                  <div key={i} className="mi-stat" data-part="stat">
                    <div className="mi-inner h-100">
                      {statIcon && hasIcon(s.icon) ? (
                        <div className="mi-icon d-inline-flex align-items-center justify-content-center rounded-3 bg-primary-subtle text-primary mb-4" data-part="icon">
                          {icon(s.icon)}
                        </div>
                      ) : null}
                      <div className="mi-value display-4 fw-bold lh-1 ls-tight" data-slot={`stats.${i}.value`}>{s.value}</div>
                      {s.label ? <div className="mi-label fw-semibold mt-2" data-slot={`stats.${i}.label`}>{s.label}</div> : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        {blockImg && !cover ? (
          <div className="mi-bimg" data-part="block-image">
            {slotImg(blockImg, { before: { className: 'img-fluid rounded-4 w-100 object-fit-cover' }, slot: 'blockImage' })}
          </div>
        ) : null}
      </div>
    </BlockSection>
  );
}
