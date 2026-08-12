// #961 — 风格设定（theme settings）：四件套之外的第五件。
//
// 圆角 / 留白 / 阴影 / 按钮形状这四组值以前全仓写死一套，「奢华风」和「工具风」因此做不出来。
// 现在它们跟配色、字体走同一条通道 —— CSS 变量 —— 所以构建和换装预览天然都吃得到，
// 34 个 section 组件里那 174 处 `rounded-*` / 28 处 `shadow-*` 一个都不用手改。
//
// 🔴 这份表是【唯一】的一份。layout.tsx 既拿它生成构建时的 :root，也把它原样塞进预览脚本里
//    （JSON.stringify 进去），所以预览和构建不可能对不上 —— 它们读的是同一个对象。
//
// 🔴 每一组的第一个档位必须与 globals.css `:root` 里的默认值逐字相同，那是「没写风格设定的老站
//    一个像素都不许变」的实现方式：老站不产生任何覆盖，就落在 :root 的默认值上；而写了
//    `subtle`/`standard`/`soft`/`rounded` 的新站算出来的值与老站相同。改这里任何一个默认值，
//    等于改掉全部存量站的样子。
//
// 🔴 `rounded-full` 不在这里（PM 在 #961 裁定）：那 61 处里是 `h-2.5 w-2.5` 的圆点和 `h-9 w-9`
//    的图标圆底，跟着「直角」变成方块是坏掉，不是风格。它在 tailwind.config.ts 里保持 9999px。

export type RadiusToken = 'subtle' | 'sharp' | 'round';
export type DensityToken = 'standard' | 'compact' | 'airy';
export type ShadowToken = 'soft' | 'none' | 'strong';
export type ButtonShapeToken = 'rounded' | 'square' | 'pill';

export interface ThemeSettings {
  radius: RadiusToken;
  density: DensityToken;
  shadow: ShadowToken;
  buttonShape: ButtonShapeToken;
}

// 圆角 —— 对应 tailwind 的 borderRadius 档位（DEFAULT/md/lg/xl/2xl；full 不在内）
export const RADIUS: Record<RadiusToken, Record<string, string>> = {
  subtle: { DEFAULT: '0.25rem', md: '0.375rem', lg: '0.5rem', xl: '0.75rem', '2xl': '1rem' },
  sharp: { DEFAULT: '0px', md: '0px', lg: '0px', xl: '0px', '2xl': '0px' },
  round: { DEFAULT: '0.5rem', md: '0.75rem', lg: '1rem', xl: '1.5rem', '2xl': '2rem' },
};

// 阴影 —— 对应 boxShadow 档位（DEFAULT/sm/md/lg）
export const SHADOW: Record<ShadowToken, Record<string, string>> = {
  soft: {
    DEFAULT: '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)',
    sm: '0 1px 2px 0 rgb(0 0 0 / 0.05)',
    md: '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)',
    lg: '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)',
  },
  none: { DEFAULT: 'none', sm: 'none', md: 'none', lg: 'none' },
  strong: {
    DEFAULT: '0 4px 8px -1px rgb(0 0 0 / 0.18), 0 2px 4px -2px rgb(0 0 0 / 0.12)',
    sm: '0 2px 4px 0 rgb(0 0 0 / 0.1)',
    md: '0 10px 18px -3px rgb(0 0 0 / 0.2), 0 4px 8px -4px rgb(0 0 0 / 0.14)',
    lg: '0 20px 32px -6px rgb(0 0 0 / 0.26), 0 8px 14px -8px rgb(0 0 0 / 0.18)',
  },
};

// 留白 —— 只落在 globals.css 的 `.section-padding` 一条上（#961 正文写死的收窄口径：
// 不动 tailwind 全局的 spacing scale，那会牵动 972 次使用 / 102 个类名）。
// 四个键对应它今天那四档：base / sm(640) / md(768) / lg(1024)。
export const DENSITY: Record<DensityToken, Record<string, string>> = {
  standard: { y: '4rem', x: '1rem', xSm: '1.5rem', yMd: '6rem', xLg: '2rem' },
  compact: { y: '3rem', x: '1rem', xSm: '1.25rem', yMd: '4rem', xLg: '1.5rem' },
  airy: { y: '6rem', x: '1.5rem', xSm: '2rem', yMd: '9rem', xLg: '3rem' },
};

// 按钮形状 —— 独立于全局圆角的一个值。
// 🔴 必须独立：否则「胶囊」会把每一张卡片也变成胶囊（#961 正文点名的那个后果）。
export const BUTTON_SHAPE: Record<ButtonShapeToken, string> = {
  rounded: '0.5rem',
  square: '0px',
  pill: '9999px',
};

// 每组的允许集合。themes.js 里那 30 套的值必须逐个落在这里面（#961 AC4）。
export const ALLOWED = {
  radius: Object.keys(RADIUS) as RadiusToken[],
  density: Object.keys(DENSITY) as DensityToken[],
  shadow: Object.keys(SHADOW) as ShadowToken[],
  buttonShape: Object.keys(BUTTON_SHAPE) as ButtonShapeToken[],
};

/**
 * 把四个档位翻成 CSS 变量声明（`--radius-lg:0.5rem;` 这种）。
 *
 * 认不出来的档位【整组跳过】，不是塞个瞎猜的值：跳过意味着那一组落回 globals.css `:root` 的
 * 默认值，也就是老站今天的样子 —— 失败方向是「没变」，不是「变成别的」。
 */
export function settingsToCssVars(s: Partial<ThemeSettings> | undefined | null): string[] {
  const out: string[] = [];
  if (!s) return out;
  const radius = s.radius && RADIUS[s.radius];
  if (radius) for (const [k, v] of Object.entries(radius)) out.push(`--radius-${k}: ${v};`);
  const shadow = s.shadow && SHADOW[s.shadow];
  if (shadow) for (const [k, v] of Object.entries(shadow)) out.push(`--shadow-${k}: ${v};`);
  const density = s.density && DENSITY[s.density];
  if (density) for (const [k, v] of Object.entries(density)) out.push(`--section-${k}: ${v};`);
  const button = s.buttonShape && BUTTON_SHAPE[s.buttonShape];
  if (button) out.push(`--radius-button: ${button};`);
  return out;
}
