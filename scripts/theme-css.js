// #1002 — 生成 `theme.css`：一个站的「皮」，整份可换。
//
// 页面引的路径不随主题变（layout.tsx 今天发的就是这两条，一条不多）：
//
//     /theme.css    皮 —— 本文件生成的这一份。换主题 = 换掉它的内容，文件名不变
//     /custom.css   这个站自己的微调 —— 换主题时一个字节都不动
//
// 📌 设计里这两层下面还有一层地板 `/base.css`（中性 markup 的兜底，跟主题无关），它是 #1001 的活。
//    这里不列它，也不发它的 <link>：文件还不存在，列上去就是每一页一个 404。
//
// 🔴 文件名不随主题变，是「换主题不用重建」的全部机制：HTML 里不再有任何随主题变的东西，
//    所以换主题只需要替换这一个文件的内容，产物 HTML 一个字节都不用重写。
//
// theme.css 里装三样东西，顺序固定：
//   ① `@import` 字体表 —— 以前是 layout.tsx 里的 <link href={brand.fonts.googleFontsUrl}>。
//      它必须搬进来：字体是主题的一部分，留在 HTML 里就等于换字体要重建。
//      🔴 CSS 规定 @import 只能出现在样式表最前面，所以它永远是第一行。
//   ② `:root { … }` —— 配色 / 字体族 / 风格设定，逐字就是 #961 之前 layout.tsx 里那段 inline
//      <style> 的内容（同一批声明、同一个顺序），所以搬家不改变任何一个 computed style。
//   ③ 这个站的形态样式表（`public/themes/<name>.css`，#991）—— 有就整份贴在后面。
//      贴进来而不是再发一个 <link>：那个 <link> 的文件名随主题变，正是本票要去掉的东西。

const { settingsToCssVars } = require('./theme-settings');

// 字体表的地址会被拼进 `@import url("…")`。放行的形状写死在这里，判据是「拼进去之后不可能提前
// 关掉那个字符串或那条语句」：绝对 http(s) 地址，且不含引号、反斜杠、空白。registry 里那 30 条
// googleFontsUrl 全部通过（它们含 `?` `&` `:` `;` `@`，这些在带引号的 url() 里都是普通字符）。
// 认不出来的地址【整条跳过】—— 失败方向是「这个站没有网络字体」，不是「样式表在这里断掉」。
const FONT_URL_OK = /^https?:\/\/[^\s"'\\]+$/;

/**
 * 生成一个站的 theme.css。
 *
 * @param {object} input
 * @param {{primary: Record<string,string>, accent: Record<string,string>}} input.colors
 * @param {{heading: string[], body: string[], googleFontsUrl?: string}} input.fonts
 * @param {object} [input.settings]        #961 的四个档位；没有就整段不产出（落回 globals.css 默认值）
 * @param {string} [input.blockLayoutCss]  形态样式表的原文（public/themes/<name>.css），没有就没有
 * @returns {string}
 */
function buildThemeCss({ colors, fonts, settings, blockLayoutCss }) {
  const vars = [];
  for (const [shade, value] of Object.entries(colors.primary)) {
    vars.push(`--color-primary-${shade}: ${value};`);
  }
  for (const [shade, value] of Object.entries(colors.accent)) {
    vars.push(`--color-accent-${shade}: ${value};`);
  }
  vars.push(`--font-sans: ${fonts.body.join(', ')};`);
  // #951 / #953 item 10 —— 兜底盖的是 `heading: []`，不是「字段不存在」：`heading` 是必填的
  // string[]，缺字段的 brand.json 根本过不了类型检查。空数组能过，然后标题跟着正文字体走。
  const headingFonts = fonts.heading && fonts.heading.length ? fonts.heading : fonts.body;
  vars.push(`--font-heading: ${headingFonts.join(', ')};`);
  // #961: 没有 settings 的站这里一条都不产出，于是全部落回 globals.css `:root` 的默认值。
  vars.push(...settingsToCssVars(settings));

  const out = [];
  const fontUrl = fonts && typeof fonts.googleFontsUrl === 'string' ? fonts.googleFontsUrl.trim() : '';
  if (fontUrl && FONT_URL_OK.test(fontUrl)) {
    out.push(`@import url("${fontUrl}");`);
  }
  out.push(`:root { ${vars.join(' ')} }`);
  if (blockLayoutCss && blockLayoutCss.trim()) {
    out.push(blockLayoutCss.trimEnd());
  }
  return out.join('\n') + '\n';
}

module.exports = { buildThemeCss, FONT_URL_OK };
