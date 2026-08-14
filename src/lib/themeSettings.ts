// #961 — 风格设定（theme settings）：四件套之外的第五件。
//
// 圆角 / 留白 / 阴影 / 按钮形状这四组值以前全仓写死一套，「奢华风」和「工具风」因此做不出来。
// 现在它们跟配色、字体走同一条通道 —— CSS 变量 —— 所以构建和换装预览天然都吃得到，
// 34 个 section 组件里那 174 处 `rounded-*` / 28 处 `shadow-*` 一个都不用手改。
//
// 🔴 #1002 起【表和翻译函数都住在 `scripts/theme-settings.js`】，这个文件只剩类型 + 转口。
//    原因：它们现在有三个消费者，跑在三个世界里 ——
//      · 这个文件 → layout.tsx，把四张表原样 JSON.stringify 进换装预览脚本（浏览器里跑）
//      · `scripts/theme-css.js`（普通 node 脚本）→ 构建时和换主题时生成 theme.css
//      · `scripts/theme-pipeline/`（#1004 的准入闸）
//    node 脚本 require 不了 .ts，所以实现必须住在普通 JS 里。**只有那一份**，谁都读同一个对象，
//    预览、构建和闸不可能对不上。
//    📌 #1004 的 `scripts/theme-pipeline/settings-vars.mjs` 是那张票为了绕开「require 不了 .ts」
//    起的子进程桥，它自己的注释里写着「#1002 落地后可以换成一句 require」——那是 #1004 的收尾，
//    不在本票射程内；今天它 import 这个文件，拿到的仍然是同一份实现。
//
// 🔴 `rounded-full` 不在这里（PM 在 #961 裁定）：那 61 处里是 `h-2.5 w-2.5` 的圆点和 `h-9 w-9`
//    的图标圆底，跟着「直角」变成方块是坏掉，不是风格。它在 tailwind.config.ts 里保持 9999px。

// eslint-disable-next-line @typescript-eslint/no-var-requires
import tables from '../../scripts/theme-settings.js';

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

// #1003 — 第二种形状：数值。生成的主题用它，因为**每站微扰（#1006）是整套缩放**，缩放一个枚举词
// 没有意义。两种形状二选一、同一套主题不许混写（schema 在 schemas/theme-tokens.schema.json 里定死，
// 边界也在那儿：radius 0–24px · density 0.6–1.6 · shadowStrength 0–0.4）。
export interface NumericThemeSettings {
  radius: number;          // DEFAULT 档的圆角,px
  density: number;         // 竖向留白相对 standard 的倍数
  shadowStrength: number;  // 阴影颜色的 alpha
  buttonShape: ButtonShapeToken;
}

export const RADIUS: Record<RadiusToken, Record<string, string>> = tables.RADIUS;
export const SHADOW: Record<ShadowToken, Record<string, string>> = tables.SHADOW;
export const DENSITY: Record<DensityToken, Record<string, string>> = tables.DENSITY;
export const BUTTON_SHAPE: Record<ButtonShapeToken, string> = tables.BUTTON_SHAPE;

// 每组的允许集合。themes.js 里那 30 套的值必须逐个落在这里面（#961 AC4）。
export const ALLOWED = {
  radius: Object.keys(RADIUS) as RadiusToken[],
  density: Object.keys(DENSITY) as DensityToken[],
  shadow: Object.keys(SHADOW) as ShadowToken[],
  buttonShape: Object.keys(BUTTON_SHAPE) as ButtonShapeToken[],
};

/**
 * 把一份风格设定翻成 CSS 变量声明（`--radius-lg:0.5rem;` 这种）。两种形状都吃（#1003）：
 * 档位词的走查表，数值的走缩放，判据是 `radius` 是不是数字。实现在
 * `scripts/theme-settings.js` —— 这里只是转口 + 打上类型。
 *
 * 认不出来的档位【整组跳过】，不是塞个瞎猜的值：跳过意味着那一组落回 globals.css `:root` 的
 * 默认值，也就是老站今天的样子 —— 失败方向是「没变」，不是「变成别的」。
 */
export const settingsToCssVars: (
  s: Partial<ThemeSettings> | Partial<NumericThemeSettings> | undefined | null,
) => string[] = tables.settingsToCssVars;
