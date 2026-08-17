// theme-presets.js — 站主自己挑的**绝对值**：一组配色 / 一档圆角 / 一对字体（#1038）。
//
// 跟 `tweaks.js` 的关系，一句话说完：
//
//   tweaks.js     相对偏移   hueShift ±15° · radiusScale ×0.8–1.25 · densityScale ×0.9–1.15
//   本文件         绝对值     选这一组配色 · 选这一档圆角 · 选这一对字体
//
// 两者写进同一份 `site/custom.css`，而 `custom.css` 是页面最后加载的那一张表（`layout.tsx` 里
// base → theme → custom），所以它写什么就是什么 —— **主题一套都不用动，主题数量也完全不受影响**。
//
// 🔴 为什么是自己一个文件，不加进 `tweaks.js` 的 `TWEAK_BOUNDS`：
//   ① `TWEAK_BOUNDS` 的每一项是 `{min, max}` 的**数值区间**。往里塞一个名字（`"ocean"`）之后，
//      `validateTweaks` 判它非法、`withDefaults` **一声不吭地把它丢掉**（设了配色页面没变，没人会
//      知道）、出错提示变成 `palette ∈ [undefined, undefined]`、`manager/theme.go` 的
//      `tweakBounds`（`min, max float64`）装不下它、已上线的 Customize 弹窗那个 `sameTweaks` 会
//      对字符串键做减法得到 `NaN` ⟹ Apply 永远亮、Reset 永远不灰。五条都是构造性的。
//   ② `dashboard/vite.config.ts` 的 `ai1st-tweaks-engine` 插件把 `tweaks.js` **原样**送进浏览器，
//      并且在它长出任何一条 `require` 时让 dashboard 构建当场失败。而下面的圆角档要用
//      `theme-settings.js` 现成的表，必然要 require ——所以这一层只能住在另一个文件里。
//
// 🔴 值在这里是**冻住的**，不是从主题注册表现读的。下面几组配色/字体的初值确实抄自 `themes.js`
// 里那几套（它们已经被主题流水线量过），但抄完就断开：改一套主题不该改掉一个站主选过的配色。

const { RADIUS, BUTTON_SHAPE } = require('./theme-settings');

/**
 * 配色组。每组给满 `--color-primary-50…900` + `--color-accent-50…600`，跟主题给的是同一批变量，
 * 所以它写进 custom.css 就是整套盖过去。
 *
 * 🔴 策展的判据是**可读性**，不是好看：白字压 `--color-primary-500`（`.btn-primary`）、白字压
 * `-600`（它的 hover）、`gray-900` 压 `--color-accent-400`（`.btn-accent`）三处都要 ≥ 4.5:1。
 * 注册表里 30 套主题有 9 套过不了这一关（实测最低的 `golden-yellow` 是 1.92:1），所以这不是
 * 「抄哪套都行」—— 下面这六组是量过之后挑出来的，判据在 `scripts/theme-presets.test.js` 的第 ① 节
 * （它同时把那个判据打在注册表 30 套主题上，报红 11 套，证明它分得开好坏、不是恒绿）。
 *
 * ── 🔴 第二条判据：**主题表自己写的那些字，配上色相滑块的每一个取值**（#1038 r3，第 ⑨ 节）──────
 *
 * 上面那条只管按钮。而 hero 的标题、cta-banner 的两行、page-header、导航链接，颜色是**主题表**给的
 * —— 一组配色照样要对它们负责。而且站主选完配色还能拖 #1006 那个色相滑块（本票 AC4c 就要求配色在
 * 拖过之后还在），所以要判的是「配色 × 三张主题表 × 滑块的 31 个取值」。
 *
 * QA3 在 r2 上量到的那一格就出在这里：violet + 滑块 −15° ⟹ `.cta-banner__desc` = 4.45:1。机理是
 * `.cta-banner` 的底色是**两个 token 的渐变**，色相偏移保住的是每个 token 自己的亮度，混出来那个点
 * 的亮度会动（详见 `scripts/theme-contrast.js` 的文件头）。
 *
 * 🔴 **下面这六组的 `primary-600..900` 和 `accent-500` / `accent-600` 是为了满足这条判据调过的，
 * 不是随手抄的。** 每一组的余量都只有 0.05 上下 —— 想动其中任何一个数，先跑
 * `node scripts/theme-presets.test.js`，它会指名道姓告诉你破在哪张表、哪个选择器、哪个角度。
 * 各组当前最差的一处（判据自己打印）：ocean 4.55 · forest 4.55 · burgundy 4.57 · violet 4.55 ·
 * graphite 4.56 · navy 4.56。
 *
 * 📌 **调的幅度比只治那一格需要的大，这是有意的**：值这一层比真浏览器那道检查更严（字按抗锯齿多混
 * 一档、渐变上取真正最差的那个点、字的框按主题表允许的最宽算），失败方向因此是「这里过了真机一定
 * 过」。同一批格子的真机读数是 5.1 上下，值层算出来是 4.55 上下。
 *
 * 🔴 **两头拉扯的是 `accent-500`**：`.btn-accent:hover` 是深色字压它 ⟹ 要够亮；而 `.cta-banner` 那条
 * 渐变的远端就是它、上面压着浅色字 ⟹ 要够暗。所以真正的调节旋钮是**另一端的 `primary-600`**（连着
 * 700/800/900 一起，不然色阶会倒过来），把整条渐变压暗，让 `accent-500` 留在按钮需要的亮度上。
 */
const PALETTES = {
  ocean: {
    label: 'Ocean — blue with a warm amber accent',
    colors: {
      primary: { 50: '#eff6ff', 100: '#dbeafe', 200: '#bfdbfe', 300: '#93c5fd', 400: '#60a5fa', 500: '#2563eb', 600: '#173daa', 700: '#193592', 800: '#193173', 900: '#131f46' },
      accent: { 50: '#fffbeb', 100: '#fef3c7', 200: '#fde68a', 300: '#fcd34d', 400: '#fbbf24', 500: '#ba7808', 600: '#915004' },
    },
  },
  forest: {
    label: 'Forest — deep green with an old-gold accent',
    colors: {
      primary: { 50: '#f2f9f4', 100: '#e0f2e6', 200: '#bfe4cc', 300: '#92cea9', 400: '#5faf80', 500: '#2f7d52', 600: '#18422b', 700: '#163a27', 800: '#112d1e', 900: '#0a1e13' },
      accent: { 50: '#fdf9ef', 100: '#faf0d6', 200: '#f3dfab', 300: '#e9c877', 400: '#dcae46', 500: '#aa7f1e', 600: '#7e5d15' },
    },
  },
  burgundy: {
    label: 'Burgundy — deep wine red with a soft gold accent',
    colors: {
      primary: { 50: '#fdf4f6', 100: '#fae7ec', 200: '#f3ccd6', 300: '#e6a4b6', 400: '#d47190', 500: '#8c1d3f', 600: '#6f1632', 700: '#5a1127', 800: '#440d1e', 900: '#2b0812' },
      accent: { 50: '#fdfaef', 100: '#faf3d6', 200: '#f3e4a9', 300: '#e9d075', 400: '#dbb944', 500: '#a28320', 600: '#775e17' },
    },
  },
  violet: {
    label: 'Violet — purple with a teal accent',
    colors: {
      primary: { 50: '#faf5ff', 100: '#f3e8ff', 200: '#e9d5ff', 300: '#d8b4fe', 400: '#c084fc', 500: '#9333ea', 600: '#7620c2', 700: '#651f9e', 800: '#531a7f', 900: '#37075e' },
      accent: { 50: '#f0fdfa', 100: '#ccfbf1', 200: '#99f6e4', 300: '#5eead4', 400: '#2dd4bf', 500: '#119789', 600: '#0a6f66' },
    },
  },
  graphite: {
    label: 'Graphite — neutral grey with an amber accent',
    colors: {
      primary: { 50: '#f7f8f8', 100: '#eceef0', 200: '#d7dbdf', 300: '#b6bdc4', 400: '#8b959f', 500: '#4a545d', 600: '#32393f', 700: '#282d32', 800: '#1e2327', 900: '#121518' },
      accent: { 50: '#fffbeb', 100: '#fef3c7', 200: '#fde68a', 300: '#fcd34d', 400: '#fbbf24', 500: '#ba7908', 600: '#955204' },
    },
  },
  navy: {
    label: 'Navy — dark blue with a brass accent',
    colors: {
      primary: { 50: '#f2f6fb', 100: '#e3ecf7', 200: '#c5d7ee', 300: '#9bb9df', 400: '#6a94cb', 500: '#2a4d84', 600: '#203b66', 700: '#192e52', 800: '#13223c', 900: '#0c1626' },
      accent: { 50: '#fdf8ed', 100: '#f9edd0', 200: '#f2dba1', 300: '#e8c469', 400: '#dbaa3c', 500: '#ad7e0a', 600: '#7f5b07' },
    },
  },
};

/**
 * 圆角档。三档，**直接用 `theme-settings.js` 里那两张现成的表** —— 30 套主题今天用的就是它们
 * （#1038 正文点名要用现成这三档，不另发明数值）。
 *
 * 每一档同时定全局圆角（`--radius-*`）和按钮圆角（`--radius-button`）：这两个在 #961 起就是
 * 独立的两个变量，只给前者会让「胶囊按钮」这一档根本表达不出来。
 */
const CORNERS = {
  sharp: { label: 'Sharp — square corners everywhere', radius: RADIUS.sharp, button: BUTTON_SHAPE.square },
  subtle: { label: 'Subtle — slightly rounded (the default)', radius: RADIUS.subtle, button: BUTTON_SHAPE.rounded },
  round: { label: 'Round — generous corners, pill buttons', radius: RADIUS.round, button: BUTTON_SHAPE.pill },
};

/**
 * 字体对。每对给 `--font-heading` / `--font-sans` 两个变量，外加一条**字体表地址**。
 *
 * 🔴 那条地址会被写成 `custom.css` 的**第一行** `@import`（CSS 规定 `@import` 只能在样式表最前面，
 * 排到第二行整条就不生效）。地址的形状与 `theme-css.js` 的 `FONT_URL_OK` 同一条判据。
 */
const FONT_PAIRS = {
  modern: {
    label: 'Modern — Inter throughout',
    heading: ['Inter', 'system-ui', 'sans-serif'],
    body: ['Inter', 'system-ui', 'sans-serif'],
    googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap',
  },
  editorial: {
    label: 'Editorial — Playfair Display headings, Source Sans 3 body',
    heading: ['Playfair Display', 'serif'],
    body: ['Source Sans 3', 'system-ui', 'sans-serif'],
    googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700;800&family=Source+Sans+3:wght@400;500;600;700&display=swap',
  },
  classic: {
    label: 'Classic — Libre Baskerville headings, Public Sans body',
    heading: ['Libre Baskerville', 'serif'],
    body: ['Public Sans', 'system-ui', 'sans-serif'],
    googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Libre+Baskerville:wght@400;700&family=Public+Sans:wght@400;500;600;700;800&display=swap',
  },
  geometric: {
    label: 'Geometric — Poppins throughout',
    heading: ['Poppins', 'system-ui', 'sans-serif'],
    body: ['Poppins', 'system-ui', 'sans-serif'],
    googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700;800&display=swap',
  },
  industrial: {
    label: 'Industrial — Oswald headings, Open Sans body',
    heading: ['Oswald', 'system-ui', 'sans-serif'],
    body: ['Open Sans', 'system-ui', 'sans-serif'],
    googleFontsUrl: 'https://fonts.googleapis.com/css2?family=Oswald:wght@400;500;600;700&family=Open+Sans:wght@400;500;600;700&display=swap',
  },
};

/** 三个绝对项，一处定义。键名就是 `site/theme.json` 的 `presets` 里的键名。 */
const PRESET_GROUPS = { palette: PALETTES, corners: CORNERS, fonts: FONT_PAIRS };
const PRESET_KEYS = Object.keys(PRESET_GROUPS);

/** `{ palette: ['ocean', …], corners: [...], fonts: [...] }` —— 通路那两侧照着它认名字。 */
function presetOptions() {
  const out = {};
  for (const key of PRESET_KEYS) out[key] = Object.keys(PRESET_GROUPS[key]);
  return out;
}

/**
 * 校验一组 presets → string[]（每条是给人看的理由，空数组 = 合法）。
 *
 * 🔴 认不出的名字**必须报错，不能静默忽略**：这一层的整个失败形态就是「设了但页面没变」。
 * `tweaks` 那边有同一条纪律（`validateTweaks` 对不认识的键也报）。
 */
function validatePresets(presets) {
  const problems = [];
  if (presets === undefined || presets === null) return problems;   // 没有 presets 是合法的
  if (typeof presets !== 'object' || Array.isArray(presets)) {
    problems.push(`presets: 应该是 object，实际是 ${Array.isArray(presets) ? 'array' : typeof presets}`);
    return problems;
  }
  for (const key of Object.keys(presets)) {
    if (!Object.prototype.hasOwnProperty.call(PRESET_GROUPS, key)) {
      problems.push(`presets.${key}: 不是一个预设组（有的是 ${PRESET_KEYS.join(' / ')}）`);
      continue;
    }
    const name = presets[key];
    if (name === undefined || name === null || name === '') continue;   // 缺省 = 这一组不覆盖
    if (typeof name !== 'string') {
      problems.push(`presets.${key}: 应该是 string，实际是 ${typeof name}（${JSON.stringify(name)}）`);
      continue;
    }
    if (!Object.prototype.hasOwnProperty.call(PRESET_GROUPS[key], name)) {
      problems.push(`presets.${key} = ${JSON.stringify(name)}：不在这一组里`
        + `（有的是 ${Object.keys(PRESET_GROUPS[key]).join(' / ')}）`);
    }
  }
  return problems;
}

/** 这组 presets 等于什么都没选吗？（空对象、全是空串、字段缺席都算） */
function isEmptyPresets(presets) {
  if (!presets || typeof presets !== 'object' || Array.isArray(presets)) return true;
  return !PRESET_KEYS.some((k) => typeof presets[k] === 'string' && presets[k] !== ''
    && Object.prototype.hasOwnProperty.call(PRESET_GROUPS[k], presets[k]));
}

/** 只留认得出的那几项，键的顺序固定成 `PRESET_KEYS` 的顺序 —— 同一组选择永远产出同一份字节。 */
function normalisePresets(presets) {
  const out = {};
  if (!presets || typeof presets !== 'object' || Array.isArray(presets)) return out;
  for (const key of PRESET_KEYS) {
    const name = presets[key];
    if (typeof name === 'string' && Object.prototype.hasOwnProperty.call(PRESET_GROUPS[key], name)) {
      out[key] = name;
    }
  }
  return out;
}

/**
 * 一个字体名写进 CSS 该长什么样。
 *
 * 🔴 **名字里带数字的那一个必须加引号，而漏掉它的症状不是报错、是整条声明被丢掉。** CSS 里不加引号的
 * 字体名是若干个标识符，而 `3` 是数字不是标识符 —— `font-family: Source Sans 3, system-ui, sans-serif`
 * 整条无效，浏览器退回它自己的默认字体。实测（真浏览器读 `getComputedStyle(document.body).fontFamily`）：
 * 加引号前正文量到的是 `"Times New Roman"`，`document.fonts` 里根本没有 Source Sans 3；加引号后才是
 * `"Source Sans 3", system-ui, sans-serif`。
 * 📌 `scripts/theme-css.js:49` 今天是直接 `join(', ')` 的，能用只是因为 30 套主题的字体名恰好一个数字
 * 都没有 —— 那不是一条保证，只是当前这批数据的样子。
 */
function cssFamily(name) {
  // 每一段都得是 CSS 标识符（字母/下划线/连字符开头，后面可带数字）才能不加引号。
  const bare = String(name).split(' ').every((part) => /^[A-Za-z_-][A-Za-z0-9_-]*$/.test(part));
  return bare ? name : `"${name}"`;
}

/**
 * 一组 presets → 它要写死的那些变量 + 字体表地址。
 *
 * @returns {{vars: Array<[string,string]>, fontImport: string|null, chose: object}}
 *   `vars` 的顺序固定：颜色 → 圆角 → 字体，同一组选择产出同一份字节。
 */
function presetVars(presets) {
  const chose = normalisePresets(presets);
  const vars = [];
  if (chose.palette) {
    const { colors } = PALETTES[chose.palette];
    for (const [shade, value] of Object.entries(colors.primary)) vars.push([`--color-primary-${shade}`, value]);
    for (const [shade, value] of Object.entries(colors.accent)) vars.push([`--color-accent-${shade}`, value]);
  }
  if (chose.corners) {
    const c = CORNERS[chose.corners];
    for (const [k, v] of Object.entries(c.radius)) vars.push([`--radius-${k}`, v]);
    vars.push(['--radius-button', c.button]);
  }
  let fontImport = null;
  if (chose.fonts) {
    const f = FONT_PAIRS[chose.fonts];
    vars.push(['--font-sans', f.body.map(cssFamily).join(', ')]);
    vars.push(['--font-heading', (f.heading && f.heading.length ? f.heading : f.body).map(cssFamily).join(', ')]);
    fontImport = f.googleFontsUrl || null;
  }
  return { vars, fontImport, chose };
}

module.exports = {
  PALETTES,
  CORNERS,
  FONT_PAIRS,
  PRESET_GROUPS,
  PRESET_KEYS,
  presetOptions,
  validatePresets,
  isEmptyPresets,
  normalisePresets,
  presetVars,
};
