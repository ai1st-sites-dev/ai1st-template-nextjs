// ══════════════════════════════════════════════════════════════════════════════════════════════════
// themes-retired.js — 已下架那 125 套的【名字和配色】，只为了弹窗里那一张「当前卡」（#1161 / #1317）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 🔴 这里面【不是主题】。一套主题有 colors / fonts / supports / settings / style / industries 六部分
//    （见 themes.js 文件头）；这里每一条只有三样东西：id、显示名、配色。少掉的那几样是【故意】不留的
//    —— 留着就等于这些套还能被穿上，而下架要的正好相反。
// 🔴 **这个数会变，别从这里抄**：`node -e "console.log(Object.keys(require('./scripts/themes-retired.js').retiredThemes).length)"`
//
// 🔴 `themes.js` 【不再】把它并进 `const themes`。所以：按 id 查这些套查不到、新站抽不到、
//    弹窗里没有它们的卡、`layoutFor()` / `settingsFor()` / `themeStyle()` 对它们落回默认值。
//    有一格测试盯着这条（`theme-pipeline/pool.test.js` 的 ④）。
//
// ── 那为什么还要留这些名字 ────────────────────────────────────────────────────────────────────
//
// 因为有站正穿着它们。spec 附四规则 1（Chris 2026-08-23 冻结）说的是：
//   「不换永远不受影响…配套：弹窗对已下架的当前主题照实说『已下架，继续用没任何影响』。」
// 要说出那句话，弹窗得有这个站当前那套主题的**名字**（写「Midnight」而不是写 `midnight`）和一块
// **配色**（卡上那条色带；预览拿不到实时缩略图时它就是卡上唯一的画面）。而平台这一侧，
// `theme-pool.json` 里**没有任何一个退役 id** —— 两份名单按构造不相交（#1317 的迁移脚本是「搬进来
// 再从池子里删掉」），也就是说删光这个文件，弹窗就只剩下一个裸 id 可写。所以留下来的正好是
// 「说那句话要用的东西」，一样不多。
//
// 📌 最早那 30 套完整的 777 行外观表（fonts / supports / settings / style / industries）在 #1161
//    之前的版本里：`git show c8d5dcd7:templates/nextjs/scripts/themes-retired.js`。#1317 下架的那
//    95 套，完整定义在 `git show babe0e23:templates/nextjs/scripts/theme-pool.json`。
//    穿着这些主题的站不受影响 —— 每个站的容器克隆的是站自己那个 repo，里面带着建站那天的模板快照
//    （spec 附四规则 1 的物理保证）。
//
// 🔴 **这份名单只增不删，而「增」只有一条路：下架。** 它不是一份可以随手编辑的表 —— 往里加一条的
//    唯一合法来路是「这套主题从 theme-pool.json 里下架了」，做法是把它的名字和配色搬进来、把它从
//    theme-pool.json 删掉、把 public/themes/ 下它那份表也删掉，三件事一起。#1161 那 30 条是这么来的，
//    #1317 那 95 条也是这么来的。
//    📌 上一版这里写的是「别往这里加第 31 条，这是一份冻结的历史名单」—— 那句话在 #1317 把 95 套
//    搬进来之后不成立了，而它想守的东西（不许凭空往这里写一条没真下架的主题）由上面那条接着守。
const retiredThemes = {
  'bold-red': {
    label: 'Bold Red — strong red primary, emerald accent',
    fontSans: 'Open Sans, system-ui, sans-serif',
    colors: {
      primary: { 50: '#fef2f2', 100: '#fee2e2', 200: '#fecaca', 300: '#fca5a5', 400: '#f87171', 500: '#dc2626', 600: '#b91c1c', 700: '#991b1b', 800: '#7f1d1d', 900: '#450a0a' },
      accent: { 50: '#ecfdf5', 100: '#d1fae5', 200: '#a7f3d0', 300: '#6ee7b7', 400: '#34d399', 500: '#059669', 600: '#047857' },
    },
  },
  'ocean-blue': {
    label: 'Ocean Blue — deep blue primary, amber accent',
    fontSans: 'Inter, system-ui, sans-serif',
    colors: {
      primary: { 50: '#eff6ff', 100: '#dbeafe', 200: '#bfdbfe', 300: '#93c5fd', 400: '#60a5fa', 500: '#2563eb', 600: '#1d4ed8', 700: '#1e40af', 800: '#1e3a8a', 900: '#172554' },
      accent: { 50: '#fffbeb', 100: '#fef3c7', 200: '#fde68a', 300: '#fcd34d', 400: '#fbbf24', 500: '#f59e0b', 600: '#d97706' },
    },
  },
  'forest-green': {
    label: 'Forest Green — green primary, yellow accent',
    fontSans: 'Open Sans, system-ui, sans-serif',
    colors: {
      primary: { 50: '#f0fdf4', 100: '#dcfce7', 200: '#bbf7d0', 300: '#86efac', 400: '#4ade80', 500: '#16a34a', 600: '#15803d', 700: '#166534', 800: '#14532d', 900: '#052e16' },
      accent: { 50: '#fefce8', 100: '#fef9c3', 200: '#fef08a', 300: '#fde047', 400: '#facc15', 500: '#eab308', 600: '#ca8a04' },
    },
  },
  'royal-purple': {
    label: 'Royal Purple — purple primary, teal accent',
    fontSans: 'Poppins, system-ui, sans-serif',
    colors: {
      primary: { 50: '#faf5ff', 100: '#f3e8ff', 200: '#e9d5ff', 300: '#d8b4fe', 400: '#c084fc', 500: '#9333ea', 600: '#7e22ce', 700: '#6b21a8', 800: '#581c87', 900: '#3b0764' },
      accent: { 50: '#f0fdfa', 100: '#ccfbf1', 200: '#99f6e4', 300: '#5eead4', 400: '#2dd4bf', 500: '#14b8a6', 600: '#0d9488' },
    },
  },
  'slate-pro': {
    label: 'Slate Pro — slate/charcoal primary, sky blue accent',
    fontSans: 'Raleway, system-ui, sans-serif',
    colors: {
      primary: { 50: '#f8fafc', 100: '#f1f5f9', 200: '#e2e8f0', 300: '#cbd5e1', 400: '#94a3b8', 500: '#475569', 600: '#334155', 700: '#1e293b', 800: '#0f172a', 900: '#020617' },
      accent: { 50: '#f0f9ff', 100: '#e0f2fe', 200: '#bae6fd', 300: '#7dd3fc', 400: '#38bdf8', 500: '#0ea5e9', 600: '#0284c7' },
    },
  },
  'sunset-orange': {
    label: 'Sunset Orange — warm orange primary, indigo accent',
    fontSans: 'DM Sans, system-ui, sans-serif',
    colors: {
      primary: { 50: '#fff7ed', 100: '#ffedd5', 200: '#fed7aa', 300: '#fdba74', 400: '#fb923c', 500: '#ea580c', 600: '#c2410c', 700: '#9a3412', 800: '#7c2d12', 900: '#431407' },
      accent: { 50: '#eef2ff', 100: '#e0e7ff', 200: '#c7d2fe', 300: '#a5b4fc', 400: '#818cf8', 500: '#6366f1', 600: '#4f46e5' },
    },
  },
  'rose-gold': {
    label: 'Rose Gold — rose primary, gold accent',
    fontSans: 'Lato, system-ui, sans-serif',
    colors: {
      primary: { 50: '#fff1f2', 100: '#ffe4e6', 200: '#fecdd3', 300: '#fda4af', 400: '#fb7185', 500: '#e11d48', 600: '#be123c', 700: '#9f1239', 800: '#881337', 900: '#4c0519' },
      accent: { 50: '#fffbeb', 100: '#fef3c7', 200: '#fde68a', 300: '#fcd34d', 400: '#fbbf24', 500: '#d97706', 600: '#b45309' },
    },
  },
  'midnight': {
    label: 'Midnight — dark navy primary, cyan accent',
    fontSans: 'Space Grotesk, system-ui, sans-serif',
    colors: {
      primary: { 50: '#f0f4ff', 100: '#dbe4ff', 200: '#bac8ff', 300: '#91a7ff', 400: '#748ffc', 500: '#4263eb', 600: '#3b5bdb', 700: '#364fc7', 800: '#2b3ea0', 900: '#1b2a6b' },
      accent: { 50: '#ecfeff', 100: '#cffafe', 200: '#a5f3fc', 300: '#67e8f9', 400: '#22d3ee', 500: '#06b6d4', 600: '#0891b2' },
    },
  },
  'earth-tone': {
    label: 'Earth Tone — warm brown primary, sage green accent',
    fontSans: 'Source Sans 3, system-ui, sans-serif',
    colors: {
      primary: { 50: '#fdf8f1', 100: '#f5e6d3', 200: '#e8cba5', 300: '#d4a574', 400: '#c08552', 500: '#92643a', 600: '#7a5230', 700: '#634126', 800: '#4d321d', 900: '#352213' },
      accent: { 50: '#f1f8f4', 100: '#dceee3', 200: '#b9dcc7', 300: '#8fc5a5', 400: '#6aad84', 500: '#4a9167', 600: '#3a7553' },
    },
  },
  'electric': {
    label: 'Electric — vibrant pink primary, lime accent',
    fontSans: 'Outfit, system-ui, sans-serif',
    colors: {
      primary: { 50: '#fdf2f8', 100: '#fce7f3', 200: '#fbcfe8', 300: '#f9a8d4', 400: '#f472b6', 500: '#ec4899', 600: '#db2777', 700: '#be185d', 800: '#9d174d', 900: '#831843' },
      accent: { 50: '#f7fee7', 100: '#ecfccb', 200: '#d9f99d', 300: '#bef264', 400: '#a3e635', 500: '#84cc16', 600: '#65a30d' },
    },
  },
  'golden-yellow': {
    label: 'Golden Yellow — warm yellow/gold primary, charcoal accent',
    fontSans: 'Source Sans 3, system-ui, sans-serif',
    colors: {
      primary: { 50: '#fefce8', 100: '#fef9c3', 200: '#fef08a', 300: '#fde047', 400: '#facc15', 500: '#eab308', 600: '#ca8a04', 700: '#a16207', 800: '#854d0e', 900: '#713f12' },
      accent: { 50: '#f8fafc', 100: '#f1f5f9', 200: '#e2e8f0', 300: '#cbd5e1', 400: '#94a3b8', 500: '#475569', 600: '#334155' },
    },
  },
  'realty-navy': {
    label: 'Realty Navy — deep navy primary, muted gold accent',
    fontSans: 'Public Sans, system-ui, sans-serif',
    colors: {
      primary: { 50: '#f2f6fb', 100: '#e3ecf7', 200: '#c5d7ee', 300: '#9bb9df', 400: '#6a94cb', 500: '#2a4d84', 600: '#223f6d', 700: '#1b3157', 800: '#142440', 900: '#0d1728' },
      accent: { 50: '#fdf8ed', 100: '#f9edd0', 200: '#f2dba1', 300: '#e8c469', 400: '#dbaa3c', 500: '#b8860b', 600: '#8f6708' },
    },
  },
  'realty-noir': {
    label: 'Realty Noir — near-black primary, gold accent',
    fontSans: 'Jost, system-ui, sans-serif',
    colors: {
      primary: { 50: '#f7f7f6', 100: '#eeedeb', 200: '#d9d7d3', 300: '#b8b5ae', 400: '#8b877f', 500: '#2b2926', 600: '#232120', 700: '#1b1a19', 800: '#141312', 900: '#0b0b0a' },
      accent: { 50: '#fdfaef', 100: '#faf2d5', 200: '#f4e3a8', 300: '#ecd074', 400: '#e0b944', 500: '#c9a227', 600: '#a2811d' },
    },
  },
  'realty-ivory': {
    label: 'Realty Ivory — warm taupe primary, clay accent',
    fontSans: 'Karla, system-ui, sans-serif',
    colors: {
      primary: { 50: '#faf8f5', 100: '#f3efe8', 200: '#e6ded1', 300: '#d3c6b2', 400: '#b9a68c', 500: '#8a7358', 600: '#705d47', 700: '#584a39', 800: '#40362a', 900: '#29221b' },
      accent: { 50: '#fdf4f0', 100: '#fae5db', 200: '#f4c9b6', 300: '#eaa88c', 400: '#dd845f', 500: '#c25f38', 600: '#9c4a2b' },
    },
  },
  'assurance-blue': {
    label: 'Assurance Blue — steel blue primary, emerald accent',
    fontSans: 'Manrope, system-ui, sans-serif',
    colors: {
      primary: { 50: '#f1f7fd', 100: '#dfeefa', 200: '#bcdcf4', 300: '#8ec3ea', 400: '#58a3db', 500: '#1d6fb8', 600: '#175a97', 700: '#134878', 800: '#10375c', 900: '#0a2440' },
      accent: { 50: '#ecfdf5', 100: '#d1fae5', 200: '#a7f3d0', 300: '#6ee7b7', 400: '#34d399', 500: '#10b981', 600: '#059669' },
    },
  },
  'assurance-teal': {
    label: 'Assurance Teal — teal primary, warm sand accent',
    fontSans: 'Nunito Sans, system-ui, sans-serif',
    colors: {
      primary: { 50: '#effbfa', 100: '#d6f5f2', 200: '#ade9e5', 300: '#79d6d1', 400: '#43bab5', 500: '#0f8f8a', 600: '#0c7370', 700: '#0a5c5a', 800: '#084745', 900: '#052e2d' },
      accent: { 50: '#fff8ed', 100: '#ffefd4', 200: '#fedca8', 300: '#fcc272', 400: '#f8a13c', 500: '#e2811a', 600: '#b96413' },
    },
  },
  'assurance-forest': {
    label: 'Assurance Forest — deep green primary, sand accent',
    fontSans: 'Cabin, system-ui, sans-serif',
    colors: {
      primary: { 50: '#f2f9f4', 100: '#e0f2e6', 200: '#bfe4cc', 300: '#92cea9', 400: '#5faf80', 500: '#2f7d52', 600: '#256542', 700: '#1e5035', 800: '#173e29', 900: '#0e281a' },
      accent: { 50: '#fdf9ef', 100: '#faf0d6', 200: '#f3dfab', 300: '#e9c877', 400: '#dcae46', 500: '#c08f22', 600: '#97701a' },
    },
  },
  'wine-burgundy': {
    label: 'Wine Burgundy — burgundy primary, gold accent',
    fontSans: 'Work Sans, system-ui, sans-serif',
    colors: {
      primary: { 50: '#fdf4f6', 100: '#fae7ec', 200: '#f3ccd6', 300: '#e6a4b6', 400: '#d47190', 500: '#8c1d3f', 600: '#741734', 700: '#5e1229', 800: '#470e1f', 900: '#2d0813' },
      accent: { 50: '#fdfaef', 100: '#faf3d6', 200: '#f3e4a9', 300: '#e9d075', 400: '#dbb944', 500: '#c19b26', 600: '#99791d' },
    },
  },
  'arctic-mint': {
    label: 'Arctic Mint — ice blue primary, mint accent',
    fontSans: 'Figtree, system-ui, sans-serif',
    colors: {
      primary: { 50: '#f0fbff', 100: '#dbf5ff', 200: '#b6eaff', 300: '#83d9fb', 400: '#48c0f0', 500: '#0e9bd0', 600: '#0a7daa', 700: '#0a6488', 800: '#094e6b', 900: '#06344a' },
      accent: { 50: '#f0fdf7', 100: '#dcfcec', 200: '#b6f6d7', 300: '#82e9bb', 400: '#4dd49b', 500: '#21b57c', 600: '#189062' },
    },
  },
  'charcoal-lime': {
    label: 'Charcoal Lime — charcoal primary, lime accent',
    fontSans: 'Archivo, system-ui, sans-serif',
    colors: {
      primary: { 50: '#f7f7f7', 100: '#ededed', 200: '#d9d9d9', 300: '#bcbcbc', 400: '#909090', 500: '#3a3a3a', 600: '#2f2f2f', 700: '#262626', 800: '#1c1c1c', 900: '#101010' },
      accent: { 50: '#f7fee7', 100: '#ecfccb', 200: '#d9f99d', 300: '#bef264', 400: '#a3e635', 500: '#7ab317', 600: '#5e8b12' },
    },
  },
  'terracotta': {
    label: 'Terracotta — clay primary, teal accent',
    fontSans: 'Rubik, system-ui, sans-serif',
    colors: {
      primary: { 50: '#fdf6f2', 100: '#fae9e0', 200: '#f4d2bf', 300: '#ebb190', 400: '#de8a60', 500: '#b8542a', 600: '#974423', 700: '#78371c', 800: '#5b2a15', 900: '#3a1b0d' },
      accent: { 50: '#f0fbfa', 100: '#d8f4f1', 200: '#ade7e1', 300: '#79d3cb', 400: '#45b7ad', 500: '#1f958b', 600: '#17786f' },
    },
  },
  'lavender-calm': {
    label: 'Lavender Calm — soft violet primary, peach accent',
    fontSans: 'Quicksand, system-ui, sans-serif',
    colors: {
      primary: { 50: '#f8f6fd', 100: '#f0ecfa', 200: '#e0d7f5', 300: '#c8b8ec', 400: '#a891de', 500: '#7c5fc4', 600: '#654aa5', 700: '#513b84', 800: '#3d2d64', 900: '#281d42' },
      accent: { 50: '#fff5f2', 100: '#ffe8e1', 200: '#ffcdbe', 300: '#ffab93', 400: '#fb8465', 500: '#ef6440', 600: '#cf4c2b' },
    },
  },
  'steel-industrial': {
    label: 'Steel Industrial — steel blue primary, safety orange accent',
    fontSans: 'Barlow, system-ui, sans-serif',
    colors: {
      primary: { 50: '#f5f7f9', 100: '#e8edf1', 200: '#ccd8e1', 300: '#a6bacb', 400: '#7695ae', 500: '#456a86', 600: '#38566d', 700: '#2d4557', 800: '#223442', 900: '#15212b' },
      accent: { 50: '#fff6ed', 100: '#ffe9d5', 200: '#fed0aa', 300: '#fdb174', 400: '#fb8a3c', 500: '#f26a0f', 600: '#cc520a' },
    },
  },
  'sage-minimal': {
    label: 'Sage Minimal — sage green primary, cream accent',
    fontSans: 'Mulish, system-ui, sans-serif',
    colors: {
      primary: { 50: '#f6f8f5', 100: '#eaefe8', 200: '#d3ded0', 300: '#b2c5ae', 400: '#8ba686', 500: '#5f8159', 600: '#4c6847', 700: '#3d5339', 800: '#2f402c', 900: '#1e291c' },
      accent: { 50: '#fdfbf3', 100: '#faf4e0', 200: '#f3e6ba', 300: '#ead28a', 400: '#ddb95a', 500: '#c79f36', 600: '#9e7d2a' },
    },
  },
  'mono-noir': {
    label: 'Mono Noir — black and white, single red accent',
    fontSans: 'Inter, system-ui, sans-serif',
    colors: {
      primary: { 50: '#fafafa', 100: '#f5f5f5', 200: '#e5e5e5', 300: '#d4d4d4', 400: '#a3a3a3', 500: '#262626', 600: '#1f1f1f', 700: '#171717', 800: '#0f0f0f', 900: '#050505' },
      accent: { 50: '#fef2f2', 100: '#fee2e2', 200: '#fecaca', 300: '#fca5a5', 400: '#f87171', 500: '#ef4444', 600: '#dc2626' },
    },
  },
  'coastal-teal': {
    label: 'Coastal Teal — turquoise primary, coral accent',
    fontSans: 'Urbanist, system-ui, sans-serif',
    colors: {
      primary: { 50: '#f0fcfb', 100: '#d5f6f4', 200: '#a9ece9', 300: '#71dbd9', 400: '#3cc2c2', 500: '#14a0a3', 600: '#0f8085', 700: '#0d666b', 800: '#0a4f53', 900: '#063437' },
      accent: { 50: '#fff7f0', 100: '#ffecdb', 200: '#ffd5b3', 300: '#ffb884', 400: '#ff9557', 500: '#f5762f', 600: '#cf5c1e' },
    },
  },
  'plum-modern': {
    label: 'Plum Modern — plum primary, gold accent',
    fontSans: 'Sora, system-ui, sans-serif',
    colors: {
      primary: { 50: '#fbf5fb', 100: '#f6e9f6', 200: '#ecd2ed', 300: '#dcaede', 400: '#c47fc7', 500: '#8e3d92', 600: '#763179', 700: '#602762', 800: '#491d4b', 900: '#2f1230' },
      accent: { 50: '#fdfaef', 100: '#fbf3d5', 200: '#f5e5a5', 300: '#edd06f', 400: '#e0b73f', 500: '#c99b1f', 600: '#a07a18' },
    },
  },
  'copper-dark': {
    label: 'Copper Dark — dark copper primary, slate blue accent',
    fontSans: 'Heebo, system-ui, sans-serif',
    colors: {
      primary: { 50: '#fbf6f2', 100: '#f5eae0', 200: '#e9d2be', 300: '#d9b193', 400: '#c48b62', 500: '#96551f', 600: '#7c4519', 700: '#633714', 800: '#4a290f', 900: '#2e1909' },
      accent: { 50: '#f4f6f9', 100: '#e6ebf2', 200: '#c9d5e3', 300: '#a3b7cd', 400: '#7692b0', 500: '#4d6c8d', 600: '#3d5772' },
    },
  },
  'sky-clinic': {
    label: 'Sky Clinic — light medical blue primary, soft green accent',
    fontSans: 'Nunito, system-ui, sans-serif',
    colors: {
      primary: { 50: '#f0f9ff', 100: '#e0f2fe', 200: '#bae6fd', 300: '#7dd3fc', 400: '#38bdf8', 500: '#0284c7', 600: '#0369a1', 700: '#075985', 800: '#0c4a6e', 900: '#082f49' },
      accent: { 50: '#f2fbf5', 100: '#e0f6e8', 200: '#bfead0', 300: '#92d9ae', 400: '#61c288', 500: '#37a566', 600: '#2a8552' },
    },
  },
  'graphite-amber': {
    label: 'Graphite Amber — graphite primary, amber accent',
    fontSans: 'IBM Plex Sans, system-ui, sans-serif',
    colors: {
      primary: { 50: '#f7f8f8', 100: '#eceef0', 200: '#d7dbdf', 300: '#b6bdc4', 400: '#8b959f', 500: '#4a545d', 600: '#3c454c', 700: '#30373d', 800: '#242a2f', 900: '#16191d' },
      accent: { 50: '#fffbeb', 100: '#fef3c7', 200: '#fde68a', 300: '#fcd34d', 400: '#fbbf24', 500: '#f59e0b', 600: '#d97706' },
    },
  },
  // ══ #1317（2026-09-14）—— 池子那 97 套里下架的 95 套 ══════════════════════════════════════════
  // 留在 theme-pool.json 里的只有 azure-29 与 ember-12。这 95 条跟上面那 30 条是同一种东西、
  // 同一个用途（弹窗那张「当前卡」要说得出名字、画得出色带），来路也是文件头写的同一条：
  // 名字和配色搬进这份名单、从 theme-pool.json 里删掉、public/themes/ 下那份表一并删掉。
  'magenta-01': {
    label: 'Magenta 01 — angular compact magenta with fern accent, for law & professional services',
    fontSans: '"Inter", system-ui, sans-serif',
    colors: {
      primary: { 50: '#f9f1f5', 100: '#f0dbe6', 200: '#e4bed2', 300: '#d392b4', 400: '#c46e9a', 500: '#b54a81', 600: '#983e6d', 700: '#7b3258', 800: '#5e2643', 900: '#3a1829' },
      accent: { 50: '#effbef', 100: '#d7f5d6', 200: '#b6edb6', 300: '#86e085', 400: '#5ed65c', 500: '#36cc33', 600: '#2dab2b' },
    },
  },
  'fern-02': {
    label: 'Fern 02 — softly rounded compact fern with magenta accent, for law & professional services',
    fontSans: '"IBM Plex Sans", system-ui, sans-serif',
    colors: {
      primary: { 50: '#edf9ea', 100: '#d3f0cb', 200: '#b0e4a1', 300: '#7cd263', 400: '#54bb36', 500: '#3d8627', 600: '#337121', 700: '#295b1b', 800: '#1f4614', 900: '#132b0c' },
      accent: { 50: '#fceffa', 100: '#f8d6f3', 200: '#f3b5e9', 300: '#eb84db', 400: '#e45bce', 500: '#de32c2', 600: '#c420aa' },
    },
  },
  'indigo-03': {
    label: 'Indigo 03 — rounded airy indigo with fern accent, for law & professional services',
    fontSans: '"Source Sans 3", system-ui, sans-serif',
    colors: {
      primary: { 50: '#efeefc', 100: '#d6d4f7', 200: '#b6b2f0', 300: '#857ee7', 400: '#5d54de', 500: '#3429d6', 600: '#2c22b4', 700: '#241c92', 800: '#1b156f', 900: '#110d45' },
      accent: { 50: '#effaf3', 100: '#d8f3e1', 200: '#b9e9c9', 300: '#8bdaa5', 400: '#64ce87', 500: '#3dc269', 600: '#33a359' },
    },
  },
  'ember-04': {
    label: 'Ember 04 — rounded airy ember with rose accent, for law & professional services',
    fontSans: '"Public Sans", system-ui, sans-serif',
    colors: {
      primary: { 50: '#f9f2ee', 100: '#f1dfd5', 200: '#e6c6b4', 300: '#d5a082', 400: '#c78058', 500: '#ae633a', 600: '#925431', 700: '#764427', 800: '#5a341e', 900: '#382013' },
      accent: { 50: '#fcf1f6', 100: '#f6dce9', 200: '#efc0d7', 300: '#e596bd', 400: '#dc73a7', 500: '#d35191', 600: '#c43179' },
    },
  },
  'jade-05': {
    label: 'Jade 05 — angular compact jade with jade accent, for law & professional services',
    fontSans: '"Karla", system-ui, sans-serif',
    colors: {
      primary: { 50: '#edf7f4', 100: '#d1ece3', 200: '#acddcc', 300: '#75c7aa', 400: '#49b28d', 500: '#368469', 600: '#2d6f58', 700: '#255a47', 800: '#1c4537', 900: '#112a22' },
      accent: { 50: '#edfcf7', 100: '#d3f8ec', 200: '#b0f2dd', 300: '#7beac7', 400: '#50e2b4', 500: '#24dba1', 600: '#1eb887' },
    },
  },
  'violet-06': {
    label: 'Violet 06 — softly rounded compact violet with crimson accent, for finance & insurance',
    fontSans: '"Work Sans", system-ui, sans-serif',
    colors: {
      primary: { 50: '#faeffa', 100: '#f2d7f4', 200: '#e7b8ea', 300: '#d888dd', 400: '#cb61d1', 500: '#bd39c6', 600: '#9f30a6', 700: '#812786', 800: '#631e67', 900: '#3d123f' },
      accent: { 50: '#fbf2f3', 100: '#f5dfe2', 200: '#edc5ca', 300: '#e09ea7', 400: '#d67d8a', 500: '#cc5d6c', 600: '#bd3c4e' },
    },
  },
  'lime-07': {
    label: 'Lime 07 — rounded airy lime with teal accent, for finance & insurance',
    fontSans: '"Nunito Sans", system-ui, sans-serif',
    colors: {
      primary: { 50: '#f6fae7', 100: '#e8f4c3', 200: '#d6ea93', 300: '#bbdd4a', 400: '#98bc24', 500: '#677f18', 600: '#576b14', 700: '#465711', 800: '#36420d', 900: '#212908' },
      accent: { 50: '#effbfb', 100: '#d6f4f5', 200: '#b6ebed', 300: '#85dde0', 400: '#5cd2d6', 500: '#33c7cc', 600: '#2ba7ab' },
    },
  },
  'azure-08': {
    label: 'Azure 08 — rounded airy azure with crimson accent, for finance & insurance',
    fontSans: '"Inter", system-ui, sans-serif',
    colors: {
      primary: { 50: '#eff4fa', 100: '#d8e4f2', 200: '#b9cfe8', 300: '#8aafd8', 400: '#6394cb', 500: '#3e79bb', 600: '#34669d', 700: '#2a537f', 800: '#203f61', 900: '#14273c' },
      accent: { 50: '#fcf1ee', 100: '#f8ddd5', 200: '#f3c1b4', 300: '#eb9882', 400: '#e47558', 500: '#dd532e', 600: '#c1411f' },
    },
  },
  'crimson-09': {
    label: 'Crimson 09 — angular compact crimson with teal accent, for finance & insurance',
    fontSans: '"IBM Plex Sans", system-ui, sans-serif',
    colors: {
      primary: { 50: '#f9f1f2', 100: '#f0dbdf', 200: '#e4bec5', 300: '#d3929e', 400: '#c46e7e', 500: '#b54a5e', 600: '#983e4f', 700: '#7b3240', 800: '#5e2631', 900: '#3a181e' },
      accent: { 50: '#eff6fa', 100: '#d8e9f3', 200: '#b9d7e9', 300: '#8bbcda', 400: '#64a5ce', 500: '#3d8fc2', 600: '#3378a3' },
    },
  },
  'fern-10': {
    label: 'Fern 10 — softly rounded compact fern with ember accent, for finance & insurance',
    fontSans: '"Source Sans 3", system-ui, sans-serif',
    colors: {
      primary: { 50: '#eaf9ec', 100: '#cbf0cf', 200: '#a2e4a9', 300: '#64d270', 400: '#37bc45', 500: '#288832', 600: '#21732a', 700: '#1b5d22', 800: '#15471a', 900: '#0d2c10' },
      accent: { 50: '#fbf6ef', 100: '#f5e7d6', 200: '#edd4b6', 300: '#e0b885', 400: '#d6a05c', 500: '#cc8833', 600: '#ab732b' },
    },
  },
  'indigo-11': {
    label: 'Indigo 11 — rounded airy indigo with azure accent, for real estate & property',
    fontSans: '"Public Sans", system-ui, sans-serif',
    colors: {
      primary: { 50: '#f3eefc', 100: '#e2d4f7', 200: '#cbb2f0', 300: '#a87ee7', 400: '#8b54de', 500: '#6e29d6', 600: '#5d22b4', 700: '#4b1c92', 800: '#39156f', 900: '#230d45' },
      accent: { 50: '#f1f4fd', 100: '#dde5f9', 200: '#c2cff5', 300: '#99b0ee', 400: '#7795e9', 500: '#557be3', 600: '#2a59dc' },
    },
  },
  'jade-13': {
    label: 'Jade 13 — angular compact jade with indigo accent, for real estate & property',
    fontSans: '"Work Sans", system-ui, sans-serif',
    colors: {
      primary: { 50: '#ecf7f7', 100: '#d1ecec', 200: '#acdddc', 300: '#74c6c5', 400: '#48b1af', 500: '#358281', 600: '#2d6e6d', 700: '#245958', 800: '#1c4443', 900: '#112a29' },
      accent: { 50: '#f4f4fc', 100: '#e5e3f8', 200: '#d0ccf2', 300: '#b0abea', 400: '#968fe3', 500: '#7b73dc', 600: '#5348d1' },
    },
  },
  'magenta-14': {
    label: 'Magenta 14 — softly rounded compact magenta with lime accent, for real estate & property',
    fontSans: '"Nunito Sans", system-ui, sans-serif',
    colors: {
      primary: { 50: '#faeff7', 100: '#f4d7ec', 200: '#eab8dc', 300: '#dd88c5', 400: '#d161b2', 500: '#c6399f', 600: '#a63086', 700: '#86276c', 800: '#671e53', 900: '#3f1233' },
      accent: { 50: '#f8fced', 100: '#eef8d3', 200: '#e1f2b0', 300: '#cdea7b', 400: '#bce250', 500: '#acdb24', 600: '#90b81e' },
    },
  },
  'lime-15': {
    label: 'Lime 15 — rounded airy lime with indigo accent, for real estate & property',
    fontSans: '"Inter", system-ui, sans-serif',
    colors: {
      primary: { 50: '#f0fbe7', 100: '#d9f4c4', 200: '#baeb95', 300: '#8cdd4e', 400: '#68c025', 500: '#488519', 600: '#3d7015', 700: '#315b11', 800: '#26450d', 900: '#172b08' },
      accent: { 50: '#f7f3fb', 100: '#eae1f6', 200: '#d9caee', 300: '#c0a6e3', 400: '#ab88d9', 500: '#976bd0', 600: '#7c44c4' },
    },
  },
  'azure-16': {
    label: 'Azure 16 — rounded airy azure with lime accent, for clinics & medical',
    fontSans: '"IBM Plex Sans", system-ui, sans-serif',
    colors: {
      primary: { 50: '#f0f1fa', 100: '#d9dcf2', 200: '#bac1e8', 300: '#8c97d9', 400: '#6674cc', 500: '#4052bf', 600: '#3645a1', 700: '#2b3882', 800: '#212b63', 900: '#141a3d' },
      accent: { 50: '#f3fbef', 100: '#e2f5d6', 200: '#cbedb6', 300: '#a9e085', 400: '#8cd65c', 500: '#6fcc33', 600: '#5dab2b' },
    },
  },
  'crimson-17': {
    label: 'Crimson 17 — angular compact crimson with violet accent, for clinics & medical',
    fontSans: '"Source Sans 3", system-ui, sans-serif',
    colors: {
      primary: { 50: '#f9f2f1', 100: '#f0dedb', 200: '#e4c4be', 300: '#d39c92', 400: '#c47b6e', 500: '#b55a4a', 600: '#984c3e', 700: '#7b3d32', 800: '#5e2f26', 900: '#3a1d18' },
      accent: { 50: '#faf0fd', 100: '#f3dbf9', 200: '#e9bef4', 300: '#da92ed', 400: '#cd6ee7', 500: '#c14ae1', 600: '#b123d8' },
    },
  },
  'fern-18': {
    label: 'Fern 18 — softly rounded compact fern with fern accent, for clinics & medical',
    fontSans: '"Public Sans", system-ui, sans-serif',
    colors: {
      primary: { 50: '#eaf9f1', 100: '#cbf0db', 200: '#a1e4bf', 300: '#63d294', 400: '#36bb71', 500: '#278651', 600: '#217144', 700: '#1b5b37', 800: '#14462a', 900: '#0c2b1a' },
      accent: { 50: '#f0faef', 100: '#d9f3d8', 200: '#bbe9b9', 300: '#8eda8b', 400: '#68ce64', 500: '#43c23d', 600: '#38a333' },
    },
  },
  'violet-19': {
    label: 'Violet 19 — rounded airy violet with magenta accent, for clinics & medical',
    fontSans: '"Karla", system-ui, sans-serif',
    colors: {
      primary: { 50: '#f8eefc', 100: '#eed4f7', 200: '#e0b2f0', 300: '#cb7ee7', 400: '#b954de', 500: '#a829d6', 600: '#8d22b4', 700: '#721c92', 800: '#57156f', 900: '#360d45' },
      accent: { 50: '#fbf0fa', 100: '#f6daf2', 200: '#eebce8', 300: '#e390d8', 400: '#da6bcb', 500: '#d146be', 600: '#bb2fa8' },
    },
  },
  'amber-20': {
    label: 'Amber 20 — rounded airy amber with fern accent, for clinics & medical',
    fontSans: '"Work Sans", system-ui, sans-serif',
    colors: {
      primary: { 50: '#f8f8ea', 100: '#edeecb', 200: '#dee0a1', 300: '#c8cb63', 400: '#acaf3a', 500: '#787b29', 600: '#656722', 700: '#52531c', 800: '#3f4015', 900: '#27270d' },
      accent: { 50: '#edfcf2', 100: '#d3f8de', 200: '#b0f2c4', 300: '#7bea9d', 400: '#50e27d', 500: '#24db5c', 600: '#1eb84e' },
    },
  },
  'teal-21': {
    label: 'Teal 21 — angular compact teal with magenta accent, for wellness & care',
    fontSans: '"Nunito Sans", system-ui, sans-serif',
    colors: {
      primary: { 50: '#eef5f8', 100: '#d5e6ee', 200: '#b4d2e0', 300: '#82b5cc', 400: '#599cbb', 500: '#3f7e9a', 600: '#356982', 700: '#2b5569', 800: '#214150', 900: '#142831' },
      accent: { 50: '#fbf2f6', 100: '#f4dee9', 200: '#ecc3d8', 300: '#df9bbe', 400: '#d579a8', 500: '#ca5893', 600: '#b93a7c' },
    },
  },
  'rose-22': {
    label: 'Rose 22 — softly rounded compact rose with jade accent, for wellness & care',
    fontSans: '"Inter", system-ui, sans-serif',
    colors: {
      primary: { 50: '#faeff4', 100: '#f4d7e2', 200: '#eab8cc', 300: '#dd88a9', 400: '#d1618d', 500: '#c63970', 600: '#a6305e', 700: '#86274c', 800: '#671e3a', 900: '#3f1224' },
      accent: { 50: '#effbf7', 100: '#d6f5ea', 200: '#b6edda', 300: '#85e0c1', 400: '#5cd6ac', 500: '#33cc98', 600: '#2bab7f' },
    },
  },
  'fern-23': {
    label: 'Fern 23 — rounded airy fern with crimson accent, for wellness & care',
    fontSans: '"IBM Plex Sans", system-ui, sans-serif',
    colors: {
      primary: { 50: '#eafbe8', 100: '#c9f4c5', 200: '#9eeb96', 300: '#5ede50', 400: '#35c325', 500: '#25881a', 600: '#1f7316', 700: '#195d12', 800: '#13470e', 900: '#0c2c08' },
      accent: { 50: '#fdf0f2', 100: '#f9dbe0', 200: '#f4bdc6', 300: '#ed92a1', 400: '#e76d81', 500: '#e14962', 600: '#d72341' },
    },
  },
  'indigo-24': {
    label: 'Indigo 24 — rounded airy indigo with teal accent, for wellness & care',
    fontSans: '"Source Sans 3", system-ui, sans-serif',
    colors: {
      primary: { 50: '#f2f0fa', 100: '#ded9f2', 200: '#c3bae8', 300: '#9b8cd9', 400: '#7a66cc', 500: '#5840bf', 600: '#4a36a1', 700: '#3c2b82', 800: '#2e2163', 900: '#1c143d' },
      accent: { 50: '#effafa', 100: '#d8f3f3', 200: '#b9e9e9', 300: '#8bdada', 400: '#64cdce', 500: '#3dc1c2', 600: '#33a2a3' },
    },
  },
  'ember-25': {
    label: 'Ember 25 — angular compact ember with crimson accent, for wellness & care',
    fontSans: '"Public Sans", system-ui, sans-serif',
    colors: {
      primary: { 50: '#f8f3ef', 100: '#eee2d6', 200: '#e1cab5', 300: '#cda783', 400: '#bc895a', 500: '#9c6c40', 600: '#835b36', 700: '#6a4a2b', 800: '#513821', 900: '#322314' },
      accent: { 50: '#fbf2f0', 100: '#f6dfd9', 200: '#eec5bb', 300: '#e39e8e', 400: '#d97d68', 500: '#d05d43', 600: '#b8472e' },
    },
  },
  'jade-26': {
    label: 'Jade 26 — softly rounded compact jade with teal accent, for beauty & grooming',
    fontSans: '"Karla", system-ui, sans-serif',
    colors: {
      primary: { 50: '#eaf9f6', 100: '#caf0e7', 200: '#a0e4d4', 300: '#61d1b8', 400: '#36b99c', 500: '#26846f', 600: '#206f5e', 700: '#1a5a4c', 800: '#14453a', 900: '#0c2a24' },
      accent: { 50: '#edf7fc', 100: '#d3ebf8', 200: '#b0daf2', 300: '#7bc2ea', 400: '#50aee2', 500: '#249adb', 600: '#1e81b8' },
    },
  },
  'magenta-27': {
    label: 'Magenta 27 — rounded airy magenta with ember accent, for beauty & grooming',
    fontSans: '"Work Sans", system-ui, sans-serif',
    colors: {
      primary: { 50: '#fcedfb', 100: '#f7d2f4', 200: '#f0afeb', 300: '#e679de', 400: '#dd4dd3', 500: '#cd27c2', 600: '#ad21a3', 700: '#8c1b84', 800: '#6b1465', 900: '#420d3e' },
      accent: { 50: '#faf5ef', 100: '#f3e6d8', 200: '#e9d3b9', 300: '#dab58b', 400: '#ce9d64', 500: '#c2843d', 600: '#a36f33' },
    },
  },
  'lime-28': {
    label: 'Lime 28 — rounded airy lime with azure accent, for beauty & grooming',
    fontSans: '"Nunito Sans", system-ui, sans-serif',
    colors: {
      primary: { 50: '#f3f8eb', 100: '#e2eecc', 200: '#cbe1a4', 300: '#a8cc67', 400: '#88b33c', 500: '#62802b', 600: '#526c24', 700: '#43571d', 800: '#334316', 900: '#1f290e' },
      accent: { 50: '#f2f5fc', 100: '#dee5f7', 200: '#c3d0f0', 300: '#9bb1e6', 400: '#7a97de', 500: '#597dd6', 600: '#335fcb' },
    },
  },
  'crimson-30': {
    label: 'Crimson 30 — softly rounded compact crimson with indigo accent, for beauty & grooming',
    fontSans: '"IBM Plex Sans", system-ui, sans-serif',
    colors: {
      primary: { 50: '#faeff0', 100: '#f4d7d9', 200: '#eab8bb', 300: '#dd888d', 400: '#d16167', 500: '#c63942', 600: '#a63037', 700: '#86272d', 800: '#671e22', 900: '#3f1215' },
      accent: { 50: '#f4f4fc', 100: '#e5e3f6', 200: '#cfcdef', 300: '#b0ace5', 400: '#9591dc', 500: '#7b75d3', 600: '#544dc7' },
    },
  },
  'fern-31': {
    label: 'Fern 31 — rounded airy fern with lime accent, for restaurants & drink',
    fontSans: '"Source Sans 3", system-ui, sans-serif',
    colors: {
      primary: { 50: '#e8fbec', 100: '#c5f4d0', 200: '#96ebaa', 300: '#50de71', 400: '#25c34a', 500: '#1a8834', 600: '#16732b', 700: '#125d23', 800: '#0e471b', 900: '#082c11' },
      accent: { 50: '#f8fbef', 100: '#eef5d6', 200: '#e0edb6', 300: '#cbe085', 400: '#bad65c', 500: '#a8cc33', 600: '#8dab2b' },
    },
  },
  'violet-32': {
    label: 'Violet 32 — rounded airy violet with indigo accent, for restaurants & drink',
    fontSans: '"Public Sans", system-ui, sans-serif',
    colors: {
      primary: { 50: '#f5f0fa', 100: '#e6d9f2', 200: '#d2bae8', 300: '#b48cd9', 400: '#9c66cc', 500: '#8340bf', 600: '#6e36a1', 700: '#592b82', 800: '#442163', 900: '#2a143d' },
      accent: { 50: '#f7f3fd', 100: '#ebe0fa', 200: '#dac7f6', 300: '#c2a2f0', 400: '#ae83eb', 500: '#9965e6', 600: '#7b37de' },
    },
  },
  'amber-33': {
    label: 'Amber 33 — angular compact amber with lime accent, for restaurants & drink',
    fontSans: '"Karla", system-ui, sans-serif',
    colors: {
      primary: { 50: '#f8f6ed', 100: '#ece7d1', 200: '#ddd4ac', 300: '#c7b875', 400: '#b39f49', 500: '#857636', 600: '#70642e', 700: '#5a5125', 800: '#453e1c', 900: '#2b2611' },
      accent: { 50: '#f4faef', 100: '#e3f3d8', 200: '#cde9b9', 300: '#acda8b', 400: '#90ce64', 500: '#74c23d', 600: '#62a333' },
    },
  },
  'teal-34': {
    label: 'Teal 34 — softly rounded compact teal with violet accent, for restaurants & drink',
    fontSans: '"Work Sans", system-ui, sans-serif',
    colors: {
      primary: { 50: '#ebf8f9', 100: '#ccecf0', 200: '#a3dde4', 300: '#66c7d3', 400: '#38b1bf', 500: '#29828c', 600: '#226d76', 700: '#1c5860', 800: '#154349', 900: '#0d2a2d' },
      accent: { 50: '#f9f2fc', 100: '#f1ddf7', 200: '#e5c2f0', 300: '#d49ae6', 400: '#c579dd', 500: '#b757d5', 600: '#a532ca' },
    },
  },
  'magenta-35': {
    label: 'Magenta 35 — rounded airy magenta with fern accent, for restaurants & drink',
    fontSans: '"Nunito Sans", system-ui, sans-serif',
    colors: {
      primary: { 50: '#fceef6', 100: '#f7d4e9', 200: '#f0b2d7', 300: '#e77ebd', 400: '#de54a7', 500: '#d62991', 600: '#b4227a', 700: '#921c62', 800: '#6f154b', 900: '#450d2e' },
      accent: { 50: '#eefced', 100: '#d6f8d3', 200: '#b4f2b0', 300: '#83ea7b', 400: '#59e250', 500: '#30db24', 600: '#28b81e' },
    },
  },
  'fern-36': {
    label: 'Fern 36 — rounded airy fern with magenta accent, for bakery & artisan makers',
    fontSans: '"Inter", system-ui, sans-serif',
    colors: {
      primary: { 50: '#eff8eb', 100: '#d7eecd', 200: '#b8e1a5', 300: '#88cd69', 400: '#62b73d', 500: '#47852c', 600: '#3c6f25', 700: '#315a1e', 800: '#254517', 900: '#172a0e' },
      accent: { 50: '#fbf1fa', 100: '#f4dcf1', 200: '#ebc0e7', 300: '#de96d6', 400: '#d373c9', 500: '#c851bb', 600: '#b339a6' },
    },
  },
  'azure-37': {
    label: 'Azure 37 — angular compact azure with fern accent, for bakery & artisan makers',
    fontSans: '"IBM Plex Sans", system-ui, sans-serif',
    colors: {
      primary: { 50: '#f1f1f9', 100: '#dbdbf0', 200: '#bebee4', 300: '#9293d3', 400: '#6e70c4', 500: '#4a4cb5', 600: '#3e4098', 700: '#32337b', 800: '#26275e', 900: '#18183a' },
      accent: { 50: '#effbf2', 100: '#d6f5df', 200: '#b6edc5', 300: '#85e09f', 400: '#5cd67e', 500: '#33cc5e', 600: '#2bab4f' },
    },
  },
  'ember-38': {
    label: 'Ember 38 — softly rounded compact ember with magenta accent, for bakery & artisan makers',
    fontSans: '"Source Sans 3", system-ui, sans-serif',
    colors: {
      primary: { 50: '#faf2ee', 100: '#f3ded5', 200: '#e9c3b4', 300: '#db9b82', 400: '#cf7959', 500: '#bb5b36', 600: '#9d4c2e', 700: '#7f3e25', 800: '#612f1c', 900: '#3c1d11' },
      accent: { 50: '#fdf0f7', 100: '#f9d9ea', 200: '#f4bad9', 300: '#ec8cc0', 400: '#e666ab', 500: '#e04096', 600: '#d02280' },
    },
  },
  'jade-39': {
    label: 'Jade 39 — rounded airy jade with jade accent, for bakery & artisan makers',
    fontSans: '"Public Sans", system-ui, sans-serif',
    colors: {
      primary: { 50: '#e8fbf2', 100: '#c4f4df', 200: '#96ebc6', 300: '#4fdea0', 400: '#25c27e', 500: '#1a8758', 600: '#16724a', 700: '#125c3c', 800: '#0d462e', 900: '#082b1c' },
      accent: { 50: '#effaf6', 100: '#d8f3e9', 200: '#b9e9d7', 300: '#8bdabd', 400: '#64cea7', 500: '#3dc291', 600: '#33a37a' },
    },
  },
  'violet-40': {
    label: 'Violet 40 — rounded airy violet with crimson accent, for bakery & artisan makers',
    fontSans: '"Karla", system-ui, sans-serif',
    colors: {
      primary: { 50: '#f8f0fa', 100: '#efd9f2', 200: '#e2bae8', 300: '#ce8cd9', 400: '#be66cc', 500: '#ad40bf', 600: '#9136a1', 700: '#762b82', 800: '#5a2163', 900: '#37143d' },
      accent: { 50: '#fcf1f3', 100: '#f7dde2', 200: '#f0c2cb', 300: '#e699a8', 400: '#dd778b', 500: '#d5556d', 600: '#c8324f' },
    },
  },
  'amber-41': {
    label: 'Amber 41 — angular compact amber with jade accent, for fitness & water sports',
    fontSans: '"Work Sans", system-ui, sans-serif',
    colors: {
      primary: { 50: '#f6f7ec', 100: '#e7eccf', 200: '#d4dca9', 300: '#b8c570', 400: '#9dac46', 500: '#717c33', 600: '#5f692b', 700: '#4d5523', 800: '#3b411a', 900: '#242810' },
      accent: { 50: '#edfcfc', 100: '#d3f8f7', 200: '#b0f2f1', 300: '#7beae8', 400: '#50e2e0', 500: '#24dbd8', 600: '#1eb8b6' },
    },
  },
  'teal-42': {
    label: 'Teal 42 — softly rounded compact teal with crimson accent, for fitness & water sports',
    fontSans: '"Nunito Sans", system-ui, sans-serif',
    colors: {
      primary: { 50: '#eef5fa', 100: '#d4e5f2', 200: '#b1d0e8', 300: '#7eb1d9', 400: '#5397cd', 500: '#347bb4', 600: '#2c6897', 700: '#24547a', 800: '#1b405e', 900: '#11283a' },
      accent: { 50: '#fbf2f1', 100: '#f4e0dc', 200: '#ebc7c0', 300: '#dea196', 400: '#d38273', 500: '#c8634f', 600: '#b24c38' },
    },
  },
  'rose-43': {
    label: 'Rose 43 — rounded airy rose with teal accent, for fitness & water sports',
    fontSans: '"Inter", system-ui, sans-serif',
    colors: {
      primary: { 50: '#fceef2', 100: '#f7d4dd', 200: '#f0b2c3', 300: '#e77e9a', 400: '#de5479', 500: '#d62957', 600: '#b42249', 700: '#921c3b', 800: '#6f152d', 900: '#450d1c' },
      accent: { 50: '#eff7fb', 100: '#d6ebf5', 200: '#b6daed', 300: '#85c2e0', 400: '#5cadd6', 500: '#3399cc', 600: '#2b81ab' },
    },
  },
  'fern-44': {
    label: 'Fern 44 — rounded airy fern with ember accent, for fitness & water sports',
    fontSans: '"IBM Plex Sans", system-ui, sans-serif',
    colors: {
      primary: { 50: '#ebf8ec', 100: '#ceefce', 200: '#a6e1a8', 300: '#6bce6d', 400: '#3eb941', 500: '#2d872f', 600: '#267228', 700: '#1f5c20', 800: '#174619', 900: '#0e2b0f' },
      accent: { 50: '#fcf5ed', 100: '#f8e6d3', 200: '#f2d2b0', 300: '#eab37b', 400: '#e29a50', 500: '#db8124', 600: '#b86c1e' },
    },
  },
  'indigo-45': {
    label: 'Indigo 45 — angular compact indigo with azure accent, for fitness & water sports',
    fontSans: '"Source Sans 3", system-ui, sans-serif',
    colors: {
      primary: { 50: '#f3f1f9', 100: '#e2dbf0', 200: '#cabee4', 300: '#a792d3', 400: '#896ec4', 500: '#6c4ab5', 600: '#5b3e98', 700: '#49327b', 800: '#38265e', 900: '#23183a' },
      accent: { 50: '#f2f5fb', 100: '#dee5f5', 200: '#c4d1ec', 300: '#9db2e0', 400: '#7c98d6', 500: '#5b7fcb', 600: '#3b64bc' },
    },
  },
  'ember-46': {
    label: 'Ember 46 — softly rounded compact ember with amber accent, for home trades & building',
    fontSans: '"Public Sans", system-ui, sans-serif',
    colors: {
      primary: { 50: '#f9f4ec', 100: '#f1e4cf', 200: '#e6cea8', 300: '#d5ad6e', 400: '#c7913e', 500: '#996f2d', 600: '#815d25', 700: '#684b1e', 800: '#503a17', 900: '#31230e' },
      accent: { 50: '#fbf9ef', 100: '#f5f0d6', 200: '#ede5b6', 300: '#e0d385', 400: '#d6c55c', 500: '#ccb633', 600: '#ab992b' },
    },
  },
  'jade-47': {
    label: 'Jade 47 — rounded airy jade with indigo accent, for home trades & building',
    fontSans: '"Karla", system-ui, sans-serif',
    colors: {
      primary: { 50: '#e7faf9', 100: '#c4f4ef', 200: '#94ebe2', 300: '#4dddcf', 400: '#25c0b0', 500: '#19847a', 600: '#156f66', 700: '#115a53', 800: '#0d453f', 900: '#082a27' },
      accent: { 50: '#f4f4fd', 100: '#e3e3fa', 200: '#cdccf7', 300: '#acaaf1', 400: '#918eed', 500: '#7572e8', 600: '#4742e0' },
    },
  },
  'magenta-48': {
    label: 'Magenta 48 — rounded airy magenta with lime accent, for home trades & building',
    fontSans: '"Work Sans", system-ui, sans-serif',
    colors: {
      primary: { 50: '#faf0f8', 100: '#f2d9ed', 200: '#e8badf', 300: '#d98cca', 400: '#cc66b8', 500: '#bf40a7', 600: '#a1368c', 700: '#822b71', 800: '#632157', 900: '#3d1435' },
      accent: { 50: '#f8faef', 100: '#edf3d8', 200: '#dfe9b9', 300: '#cada8b', 400: '#b8ce64', 500: '#a6c23d', 600: '#8ca333' },
    },
  },
  'lime-49': {
    label: 'Lime 49 — angular compact lime with indigo accent, for home trades & building',
    fontSans: '"Nunito Sans", system-ui, sans-serif',
    colors: {
      primary: { 50: '#f2f7ec', 100: '#dfecd0', 200: '#c5ddab', 300: '#9ec673', 400: '#7eb048', 500: '#5c8135', 600: '#4e6d2c', 700: '#3f5824', 800: '#30431c', 900: '#1e2911' },
      accent: { 50: '#f6f3fc', 100: '#eae1f8', 200: '#d9c9f2', 300: '#bfa5e9', 400: '#aa87e1', 500: '#946ada', 600: '#7740cf' },
    },
  },
  'azure-50': {
    label: 'Azure 50 — softly rounded compact azure with lime accent, for home trades & building',
    fontSans: '"Inter", system-ui, sans-serif',
    colors: {
      primary: { 50: '#eff2fa', 100: '#d7def4', 200: '#b8c3ea', 300: '#889bdd', 400: '#617ad1', 500: '#3959c6', 600: '#304ba6', 700: '#273c86', 800: '#1e2e67', 900: '#121c3f' },
      accent: { 50: '#f4fced', 100: '#e3f8d3', 200: '#cdf2b0', 300: '#acea7b', 400: '#90e250', 500: '#75db24', 600: '#62b81e' },
    },
  },
  'crimson-51': {
    label: 'Crimson 51 — rounded airy crimson with violet accent, for landscaping & green',
    fontSans: '"IBM Plex Sans", system-ui, sans-serif',
    colors: {
      primary: { 50: '#fcefee', 100: '#f7d6d4', 200: '#f0b6b2', 300: '#e7857e', 400: '#de5d54', 500: '#d63429', 600: '#b42c22', 700: '#92241c', 800: '#6f1b15', 900: '#45110d' },
      accent: { 50: '#f9f2fb', 100: '#efdff5', 200: '#e2c5ed', 300: '#cf9fe1', 400: '#bf7fd6', 500: '#af5fcc', 600: '#9c3cbf' },
    },
  },
  'fern-52': {
    label: 'Fern 52 — rounded airy fern with fern accent, for landscaping & green',
    fontSans: '"Source Sans 3", system-ui, sans-serif',
    colors: {
      primary: { 50: '#ebf8f0', 100: '#cdeed9', 200: '#a6e1bb', 300: '#6acd8e', 400: '#3db869', 500: '#2d864d', 600: '#267141', 700: '#1e5b34', 800: '#174628', 900: '#0e2b19' },
      accent: { 50: '#f0fbef', 100: '#d9f5d6', 200: '#bbedb6', 300: '#8de085', 400: '#67d65c', 500: '#41cc33', 600: '#37ab2b' },
    },
  },
  'violet-53': {
    label: 'Violet 53 — angular compact violet with magenta accent, for landscaping & green',
    fontSans: '"Public Sans", system-ui, sans-serif',
    colors: {
      primary: { 50: '#f6f1f9', 100: '#e9dbf0', 200: '#d7bee4', 300: '#bc92d3', 400: '#a66ec4', 500: '#904ab5', 600: '#793e98', 700: '#62327b', 800: '#4b265e', 900: '#2e183a' },
      accent: { 50: '#fceefb', 100: '#f8d5f5', 200: '#f3b3ed', 300: '#ea81e2', 400: '#e457d8', 500: '#dd2dce', 600: '#c01fb2' },
    },
  },
  'amber-54': {
    label: 'Amber 54 — softly rounded compact amber with fern accent, for landscaping & green',
    fontSans: '"Karla", system-ui, sans-serif',
    colors: {
      primary: { 50: '#f9f8ea', 100: '#efedc9', 200: '#e3df9e', 300: '#d0ca5e', 400: '#b4ad34', 500: '#7f7925', 600: '#6a661f', 700: '#565319', 800: '#423f13', 900: '#29270c' },
      accent: { 50: '#effaf2', 100: '#d8f3df', 200: '#b9e9c6', 300: '#8bda9f', 400: '#64ce7f', 500: '#3dc25f', 600: '#33a350' },
    },
  },
  'teal-55': {
    label: 'Teal 55 — rounded airy teal with magenta accent, for landscaping & green',
    fontSans: '"Work Sans", system-ui, sans-serif',
    colors: {
      primary: { 50: '#e9f7fb', 100: '#c9ebf5', 200: '#9edaec', 300: '#5dc2e0', 400: '#28acd4', 500: '#1e809e', 600: '#196c85', 700: '#15576c', 800: '#104352', 900: '#0a2933' },
      accent: { 50: '#fbf1f7', 100: '#f6dceb', 200: '#efbfda', 300: '#e595c2', 400: '#dc72ae', 500: '#d34f9a', 600: '#c23183' },
    },
  },
  'rose-56': {
    label: 'Rose 56 — rounded airy rose with jade accent, for auto & transport',
    fontSans: '"Nunito Sans", system-ui, sans-serif',
    colors: {
      primary: { 50: '#faf0f5', 100: '#f2d9e5', 200: '#e8bad0', 300: '#d98cb1', 400: '#cc6696', 500: '#bf407c', 600: '#a13668', 700: '#822b55', 800: '#632141', 900: '#3d1428' },
      accent: { 50: '#edfcf6', 100: '#d3f8e9', 200: '#b0f2d8', 300: '#7beabe', 400: '#50e2a9', 500: '#24db93', 600: '#1eb87c' },
    },
  },
  'fern-57': {
    label: 'Fern 57 — angular compact fern with crimson accent, for auto & transport',
    fontSans: '"Inter", system-ui, sans-serif',
    colors: {
      primary: { 50: '#eff8ed', 100: '#d6ecd1', 200: '#b6ddad', 300: '#85c776', 400: '#5db349', 500: '#458537', 600: '#3a702e', 700: '#2f5b25', 800: '#24451c', 900: '#162b11' },
      accent: { 50: '#fbf2f4', 100: '#f5dee3', 200: '#ecc4cd', 300: '#e09dac', 400: '#d67d90', 500: '#cc5c74', 600: '#bd3c58' },
    },
  },
  'indigo-58': {
    label: 'Indigo 58 — softly rounded compact indigo with jade accent, for auto & transport',
    fontSans: '"IBM Plex Sans", system-ui, sans-serif',
    colors: {
      primary: { 50: '#f0effa', 100: '#dbd7f4', 200: '#bdb8ea', 300: '#9288dd', 400: '#6d61d1', 500: '#4939c6', 600: '#3d30a6', 700: '#312786', 800: '#261e67', 900: '#17123f' },
      accent: { 50: '#effbfa', 100: '#d6f5f4', 200: '#b6edea', 300: '#85e0dd', 400: '#5cd6d1', 500: '#33ccc6', 600: '#2baba6' },
    },
  },
  'ember-59': {
    label: 'Ember 59 — rounded airy ember with crimson accent, for auto & transport',
    fontSans: '"Source Sans 3", system-ui, sans-serif',
    colors: {
      primary: { 50: '#fbf2eb', 100: '#f6dece', 200: '#eec3a7', 300: '#e39c6c', 400: '#da7b3b', 500: '#b85e23', 600: '#9a4f1d', 700: '#7d4018', 800: '#603112', 900: '#3b1e0b' },
      accent: { 50: '#fcf1ef', 100: '#f9dcd7', 200: '#f3c0b8', 300: '#ec9688', 400: '#e57361', 500: '#df5039', 600: '#ca3821' },
    },
  },
  'jade-60': {
    label: 'Jade 60 — rounded airy jade with teal accent, for auto & transport',
    fontSans: '"Public Sans", system-ui, sans-serif',
    colors: {
      primary: { 50: '#ebf8f4', 100: '#cdeee4', 200: '#a5e1cf', 300: '#69cdae', 400: '#3db791', 500: '#2c8569', 600: '#257059', 700: '#1e5a48', 800: '#174537', 900: '#0e2a22' },
      accent: { 50: '#eff7fa', 100: '#d8ebf3', 200: '#b9dae9', 300: '#8bc2da', 400: '#64adce', 500: '#3d99c2', 600: '#3380a3' },
    },
  },
  'violet-61': {
    label: 'Violet 61 — angular compact violet with ember accent, for industrial & safety',
    fontSans: '"Karla", system-ui, sans-serif',
    colors: {
      primary: { 50: '#f9f1f9', 100: '#f0dbf0', 200: '#e4bee4', 300: '#d292d3', 400: '#c26ec4', 500: '#b34ab5', 600: '#973e98', 700: '#7a327b', 800: '#5d265e', 900: '#39183a' },
      accent: { 50: '#fbf5ef', 100: '#f5e5d6', 200: '#edd0b6', 300: '#e0b185', 400: '#d6975c', 500: '#cc7d33', 600: '#ab692b' },
    },
  },
  'lime-62': {
    label: 'Lime 62 — softly rounded compact lime with azure accent, for industrial & safety',
    fontSans: '"Work Sans", system-ui, sans-serif',
    colors: {
      primary: { 50: '#f5f9ea', 100: '#e5efc9', 200: '#d0e39f', 300: '#b1d05e', 400: '#92b535', 500: '#677f25', 600: '#566b1f', 700: '#465719', 800: '#354213', 900: '#21290c' },
      accent: { 50: '#f0f5fd', 100: '#dbe5f9', 200: '#bed0f4', 300: '#92b1ed', 400: '#6e97e7', 500: '#4a7ee1', 600: '#2361d8' },
    },
  },
  'azure-63': {
    label: 'Azure 63 — rounded airy azure with amber accent, for industrial & safety',
    fontSans: '"Nunito Sans", system-ui, sans-serif',
    colors: {
      primary: { 50: '#eef4fc', 100: '#d4e3f7', 200: '#b2cdf0', 300: '#7eace7', 400: '#5490de', 500: '#2974d6', 600: '#2261b4', 700: '#1c4f92', 800: '#153c6f', 900: '#0d2545' },
      accent: { 50: '#faf8ef', 100: '#f3eed8', 200: '#e9e1b9', 300: '#dacd8b', 400: '#cebc64', 500: '#c2ac3d', 600: '#a39033' },
    },
  },
  'crimson-64': {
    label: 'Crimson 64 — rounded airy crimson with indigo accent, for industrial & safety',
    fontSans: '"Inter", system-ui, sans-serif',
    colors: {
      primary: { 50: '#faf0f1', 100: '#f2d9dc', 200: '#e8bac1', 300: '#d98c97', 400: '#cc6674', 500: '#bf4052', 600: '#a13645', 700: '#822b38', 800: '#63212b', 900: '#3d141a' },
      accent: { 50: '#f4f4fc', 100: '#e3e3f8', 200: '#cdcdf3', 300: '#acacea', 400: '#9190e3', 500: '#7575dc', 600: '#4b49d2' },
    },
  },
  'fern-65': {
    label: 'Fern 65 — angular compact fern with lime accent, for industrial & safety',
    fontSans: '"IBM Plex Sans", system-ui, sans-serif',
    colors: {
      primary: { 50: '#edf8ee', 100: '#d1ecd6', 200: '#addeb4', 300: '#76c783', 400: '#4ab45a', 500: '#378643', 600: '#2e7138', 700: '#255b2d', 800: '#1d4623', 900: '#122b15' },
      accent: { 50: '#f9fced', 100: '#f1f8d3', 200: '#e6f2b0', 300: '#d5ea7b', 400: '#c8e250', 500: '#badb24', 600: '#9cb81e' },
    },
  },
  'indigo-66': {
    label: 'Indigo 66 — softly rounded compact indigo with indigo accent, for tech & media',
    fontSans: '"Source Sans 3", system-ui, sans-serif',
    colors: {
      primary: { 50: '#f4effa', 100: '#e4d7f4', 200: '#ceb8ea', 300: '#ae88dd', 400: '#9261d1', 500: '#7739c6', 600: '#6430a6', 700: '#512786', 800: '#3e1e67', 900: '#26123f' },
      accent: { 50: '#f6f3fb', 100: '#e9e2f6', 200: '#d7cbee', 300: '#bda8e3', 400: '#a78bda', 500: '#916ed1', 600: '#7447c5' },
    },
  },
  'ember-67': {
    label: 'Ember 67 — rounded airy ember with lime accent, for tech & media',
    fontSans: '"Public Sans", system-ui, sans-serif',
    colors: {
      primary: { 50: '#fbf6e8', 100: '#f4e8c7', 200: '#ecd699', 300: '#dfba56', 400: '#ca9f27', 500: '#92721c', 600: '#7b6017', 700: '#634e13', 800: '#4c3c0e', 900: '#2f2509' },
      accent: { 50: '#f4fbef', 100: '#e4f5d6', 200: '#cfedb6', 300: '#afe085', 400: '#95d65c', 500: '#7acc33', 600: '#67ab2b' },
    },
  },
  'teal-68': {
    label: 'Teal 68 — rounded airy teal with violet accent, for tech & media',
    fontSans: '"Karla", system-ui, sans-serif',
    colors: {
      primary: { 50: '#ebf8f8', 100: '#cdeeee', 200: '#a5e0e1', 300: '#69cbcd', 400: '#3db4b7', 500: '#2c8285', 600: '#256e6f', 700: '#1e595a', 800: '#174445', 900: '#0e2a2a' },
      accent: { 50: '#f9f1fd', 100: '#f1dcf9', 200: '#e6c1f5', 300: '#d597ee', 400: '#c774e8', 500: '#b852e3', 600: '#a727dc' },
    },
  },
  'magenta-69': {
    label: 'Magenta 69 — angular compact magenta with fern accent, for tech & media',
    fontSans: '"Work Sans", system-ui, sans-serif',
    colors: {
      primary: { 50: '#f9f1f6', 100: '#f0dbe9', 200: '#e4bed8', 300: '#d392be', 400: '#c46ea9', 500: '#b54a93', 600: '#983e7c', 700: '#7b3264', 800: '#5e264d', 900: '#3a182f' },
      accent: { 50: '#f1faef', 100: '#dbf3d8', 200: '#bfe9b9', 300: '#94da8b', 400: '#70ce64', 500: '#4dc23d', 600: '#40a333' },
    },
  },
  'lime-70': {
    label: 'Lime 70 — softly rounded compact lime with magenta accent, for tech & media',
    fontSans: '"Nunito Sans", system-ui, sans-serif',
    colors: {
      primary: { 50: '#f0f9ea', 100: '#d9f0ca', 200: '#bbe4a0', 300: '#8dd161', 400: '#69b936', 500: '#4b8426', 600: '#3f6f20', 700: '#335a1a', 800: '#274514', 900: '#182a0c' },
      accent: { 50: '#fbf0fb', 100: '#f6daf4', 200: '#eebceb', 300: '#e38fde', 400: '#da69d3', 500: '#d044c8', 600: '#b92eb1' },
    },
  },
  'azure-71': {
    label: 'Azure 71 — rounded airy azure with fern accent, for events & photography',
    fontSans: '"Inter", system-ui, sans-serif',
    colors: {
      primary: { 50: '#eeeffc', 100: '#d4d8f7', 200: '#b2b8f0', 300: '#7e89e7', 400: '#5462de', 500: '#293ad6', 600: '#2231b4', 700: '#1c2892', 800: '#151e6f', 900: '#0d1345' },
      accent: { 50: '#edfcf1', 100: '#d3f8dc', 200: '#b0f2bf', 300: '#7bea95', 400: '#50e272', 500: '#24db4f', 600: '#1eb842' },
    },
  },
  'crimson-72': {
    label: 'Crimson 72 — rounded airy crimson with magenta accent, for events & photography',
    fontSans: '"IBM Plex Sans", system-ui, sans-serif',
    colors: {
      primary: { 50: '#faf2f0', 100: '#f2ded9', 200: '#e8c3ba', 300: '#d99b8c', 400: '#cc7965', 500: '#be583f', 600: '#a04a35', 700: '#823c2b', 800: '#632e21', 900: '#3d1c14' },
      accent: { 50: '#fbf2f7', 100: '#f4ddeb', 200: '#ecc2db', 300: '#df9ac3', 400: '#d478af', 500: '#ca579b', 600: '#b83a85' },
    },
  },
  'fern-73': {
    label: 'Fern 73 — angular compact fern with jade accent, for events & photography',
    fontSans: '"Source Sans 3", system-ui, sans-serif',
    colors: {
      primary: { 50: '#edf8f2', 100: '#d1ecde', 200: '#adddc4', 300: '#76c79d', 400: '#49b37c', 500: '#36855c', 600: '#2e704e', 700: '#255b3f', 800: '#1c4530', 900: '#112b1e' },
      accent: { 50: '#effbf6', 100: '#d6f5e8', 200: '#b6edd6', 300: '#85e0ba', 400: '#5cd6a3', 500: '#33cc8c', 600: '#2bab76' },
    },
  },
  'violet-74': {
    label: 'Violet 74 — softly rounded compact violet with crimson accent, for events & photography',
    fontSans: '"Public Sans", system-ui, sans-serif',
    colors: {
      primary: { 50: '#f8effa', 100: '#edd7f4', 200: '#dfb8ea', 300: '#ca88dd', 400: '#b861d1', 500: '#a639c6', 600: '#8b30a6', 700: '#712786', 800: '#561e67', 900: '#35123f' },
      accent: { 50: '#fdf0f3', 100: '#f9dae2', 200: '#f4bdca', 300: '#ed91a7', 400: '#e76c8a', 500: '#e1486d', 600: '#d6234e' },
    },
  },
  'amber-75': {
    label: 'Amber 75 — rounded airy amber with jade accent, for events & photography',
    fontSans: '"Karla", system-ui, sans-serif',
    colors: {
      primary: { 50: '#f9fae7', 100: '#f0f3c2', 200: '#e4ea92', 300: '#d2dc49', 400: '#afb923', 500: '#767c18', 600: '#636914', 700: '#505510', 800: '#3d410c', 900: '#262808' },
      accent: { 50: '#effaf9', 100: '#d8f3f1', 200: '#b9e9e6', 300: '#8bdad5', 400: '#64cec7', 500: '#3dc2b9', 600: '#33a39b' },
    },
  },
  'teal-76': {
    label: 'Teal 76 — rounded airy teal with crimson accent, for retail & lifestyle',
    fontSans: '"Work Sans", system-ui, sans-serif',
    colors: {
      primary: { 50: '#eef5f9', 100: '#d3e6f0', 200: '#b1d2e5', 300: '#7cb4d3', 400: '#519bc5', 500: '#377da5', 600: '#2e698b', 700: '#255570', 800: '#1d4156', 900: '#122835' },
      accent: { 50: '#fbf2f1', 100: '#f6dedb', 200: '#efc4bf', 300: '#e49c94', 400: '#db7b70', 500: '#d25b4c', 600: '#c04030' },
    },
  },
  'rose-77': {
    label: 'Rose 77 — angular compact rose with teal accent, for retail & lifestyle',
    fontSans: '"Nunito Sans", system-ui, sans-serif',
    colors: {
      primary: { 50: '#f9f1f4', 100: '#f0dbe2', 200: '#e4becb', 300: '#d392a9', 400: '#c46e8c', 500: '#b54a6f', 600: '#983e5e', 700: '#7b324c', 800: '#5e263a', 900: '#3a1824' },
      accent: { 50: '#edf8fc', 100: '#d3edf8', 200: '#b0dff2', 300: '#7bcaea', 400: '#50b9e2', 500: '#24a7db', 600: '#1e8db8' },
    },
  },
  'fern-78': {
    label: 'Fern 78 — softly rounded compact fern with ember accent, for retail & lifestyle',
    fontSans: '"Inter", system-ui, sans-serif',
    colors: {
      primary: { 50: '#ebf9ea', 100: '#cdf0cb', 200: '#a6e4a2', 300: '#6ad264', 400: '#3ebc37', 500: '#2d8828', 600: '#267321', 700: '#1f5d1b', 800: '#184715', 900: '#0e2c0d' },
      accent: { 50: '#faf4ef', 100: '#f3e4d8', 200: '#e9cfb9', 300: '#daaf8b', 400: '#ce9564', 500: '#c27a3d', 600: '#a36633' },
    },
  },
  'indigo-79': {
    label: 'Indigo 79 — rounded airy indigo with azure accent, for retail & lifestyle',
    fontSans: '"IBM Plex Sans", system-ui, sans-serif',
    colors: {
      primary: { 50: '#f1eefc', 100: '#dcd4f7', 200: '#c0b2f0', 300: '#977ee7', 400: '#7454de', 500: '#5129d6', 600: '#4422b4', 700: '#371c92', 800: '#2a156f', 900: '#1a0d45' },
      accent: { 50: '#f1f5fb', 100: '#dce6f6', 200: '#c0d1ef', 300: '#95b3e5', 400: '#7299dc', 500: '#4f80d3', 600: '#3166c3' },
    },
  },
  'ember-80': {
    label: 'Ember 80 — rounded airy ember with amber accent, for retail & lifestyle',
    fontSans: '"Source Sans 3", system-ui, sans-serif',
    colors: {
      primary: { 50: '#f9f3ed', 100: '#f0e2d2', 200: '#e4cbae', 300: '#d2a879', 400: '#c38b4c', 500: '#9e6c35', 600: '#855b2c', 700: '#6c4a24', 800: '#52381b', 900: '#332311' },
      accent: { 50: '#fcf9ed', 100: '#f8f1d3', 200: '#f2e5b0', 300: '#ead47b', 400: '#e2c650', 500: '#dbb824', 600: '#b89b1e' },
    },
  },
  'jade-81': {
    label: 'Jade 81 — angular compact jade with azure accent, for finance & insurance',
    fontSans: '"Public Sans", system-ui, sans-serif',
    colors: {
      primary: { 50: '#edf7f5', 100: '#d1ece7', 200: '#acddd4', 300: '#75c6b7', 400: '#49b29e', 500: '#368375', 600: '#2d6e62', 700: '#255950', 800: '#1c443d', 900: '#112a26' },
      accent: { 50: '#f4f4fc', 100: '#e3e4f6', 200: '#cdceef', 300: '#acade5', 400: '#9192dc', 500: '#7577d3', 600: '#4d4fc7' },
    },
  },
  'magenta-82': {
    label: 'Magenta 82 — softly rounded compact magenta with amber accent, for finance & insurance',
    fontSans: '"Karla", system-ui, sans-serif',
    colors: {
      primary: { 50: '#faeff9', 100: '#f4d7f0', 200: '#eab8e5', 300: '#dd88d3', 400: '#d161c5', 500: '#c639b6', 600: '#a63099', 700: '#86277c', 800: '#671e5f', 900: '#3f123a' },
      accent: { 50: '#f9fbef', 100: '#f0f5d6', 200: '#e4edb6', 300: '#d2e085', 400: '#c3d65c', 500: '#b4cc33', 600: '#97ab2b' },
    },
  },
  'lime-83': {
    label: 'Lime 83 — rounded airy lime with indigo accent, for finance & insurance',
    fontSans: '"Work Sans", system-ui, sans-serif',
    colors: {
      primary: { 50: '#f3fae7', 100: '#e0f4c3', 200: '#c8eb94', 300: '#a3dd4c', 400: '#81be24', 500: '#588219', 600: '#4a6e15', 700: '#3c5911', 800: '#2e440d', 900: '#1c2a08' },
      accent: { 50: '#f6f3fd', 100: '#e9e1fa', 200: '#d8c8f6', 300: '#bda4f0', 400: '#a886eb', 500: '#9268e6', 600: '#713adf' },
    },
  },
  'azure-84': {
    label: 'Azure 84 — rounded airy azure with lime accent, for finance & insurance',
    fontSans: '"Nunito Sans", system-ui, sans-serif',
    colors: {
      primary: { 50: '#f0f3fa', 100: '#d9e1f2', 200: '#bac8e8', 300: '#8ca4d9', 400: '#6685cc', 500: '#4067bf', 600: '#3657a1', 700: '#2b4682', 800: '#213663', 900: '#14213d' },
      accent: { 50: '#f5faef', 100: '#e5f3d8', 200: '#d1e9b9', 300: '#b2da8b', 400: '#98ce64', 500: '#7ec23d', 600: '#6aa333' },
    },
  },
  'crimson-85': {
    label: 'Crimson 85 — angular compact crimson with violet accent, for finance & insurance',
    fontSans: '"Inter", system-ui, sans-serif',
    colors: {
      primary: { 50: '#f9f1f1', 100: '#f0dbdb', 200: '#e4bebe', 300: '#d39293', 400: '#c46e70', 500: '#b54a4c', 600: '#983e40', 700: '#7b3233', 800: '#5e2627', 900: '#3a1818' },
      accent: { 50: '#f9f2fc', 100: '#efdef7', 200: '#e2c4f0', 300: '#cf9de7', 400: '#bf7dde', 500: '#b05cd6', 600: '#9c35cc' },
    },
  },
  'fern-86': {
    label: 'Fern 86 — softly rounded compact fern with fern accent, for finance & insurance',
    fontSans: '"IBM Plex Sans", system-ui, sans-serif',
    colors: {
      primary: { 50: '#eaf9ee', 100: '#cbf0d5', 200: '#a1e4b4', 300: '#63d282', 400: '#36bb5b', 500: '#278742', 600: '#217237', 700: '#1b5c2d', 800: '#144622', 900: '#0d2b15' },
      accent: { 50: '#f0fced', 100: '#d8f8d3', 200: '#b9f2b0', 300: '#8bea7b', 400: '#64e250', 500: '#3edb24', 600: '#34b81e' },
    },
  },
  'violet-87': {
    label: 'Violet 87 — rounded airy violet with magenta accent, for real estate & property',
    fontSans: '"Source Sans 3", system-ui, sans-serif',
    colors: {
      primary: { 50: '#f6eefc', 100: '#e8d4f7', 200: '#d5b2f0', 300: '#b97ee7', 400: '#a254de', 500: '#8b29d6', 600: '#7522b4', 700: '#5f1c92', 800: '#48156f', 900: '#2c0d45' },
      accent: { 50: '#fbf1fa', 100: '#f4dcf3', 200: '#ebbfe9', 300: '#de95db', 400: '#d272cf', 500: '#c74fc3', 600: '#b138ad' },
    },
  },
  'amber-88': {
    label: 'Amber 88 — rounded airy amber with fern accent, for real estate & property',
    fontSans: '"Public Sans", system-ui, sans-serif',
    colors: {
      primary: { 50: '#f8f6eb', 100: '#eeeacd', 200: '#e1d8a5', 300: '#cdbf69', 400: '#b6a53d', 500: '#84772c', 600: '#6f6425', 700: '#5a511e', 800: '#453e17', 900: '#2a260e' },
      accent: { 50: '#effbf1', 100: '#d6f5dd', 200: '#b6edc1', 300: '#85e098', 400: '#5cd675', 500: '#33cc53', 600: '#2bab46' },
    },
  },
  'teal-89': {
    label: 'Teal 89 — angular compact teal with magenta accent, for real estate & property',
    fontSans: '"Karla", system-ui, sans-serif',
    colors: {
      primary: { 50: '#edf6f8', 100: '#d3e9ed', 200: '#afd7de', 300: '#7abdc9', 400: '#4ea7b7', 500: '#3a808d', 600: '#306c76', 700: '#275760', 800: '#1e4349', 900: '#12292d' },
      accent: { 50: '#fcf0f8', 100: '#f9d8ec', 200: '#f4b9dd', 300: '#ec8bc7', 400: '#e664b4', 500: '#e03ea1', 600: '#ce228c' },
    },
  },
  'magenta-90': {
    label: 'Magenta 90 — softly rounded compact magenta with jade accent, for real estate & property',
    fontSans: '"Work Sans", system-ui, sans-serif',
    colors: {
      primary: { 50: '#faeff5', 100: '#f4d7e7', 200: '#eab8d4', 300: '#dd88b7', 400: '#d161a0', 500: '#c63988', 600: '#a63072', 700: '#86275c', 800: '#671e47', 900: '#3f122b' },
      accent: { 50: '#effaf5', 100: '#d8f3e7', 200: '#b9e9d4', 300: '#8bdab7', 400: '#64ce9f', 500: '#3dc287', 600: '#33a372' },
    },
  },
  'fern-91': {
    label: 'Fern 91 — rounded airy fern with rose accent, for real estate & property',
    fontSans: '"Nunito Sans", system-ui, sans-serif',
    colors: {
      primary: { 50: '#edfbe8', 100: '#d1f4c4', 200: '#aceb96', 300: '#75de4f', 400: '#4fc225', 500: '#37871a', 600: '#2e7216', 700: '#255c12', 800: '#1d460d', 900: '#122b08' },
      accent: { 50: '#fcf1f4', 100: '#f6dde4', 200: '#f0c1ce', 300: '#e598ad', 400: '#dd7691', 500: '#d45476', 600: '#c73259' },
    },
  },
  'indigo-92': {
    label: 'Indigo 92 — rounded airy indigo with jade accent, for real estate & property',
    fontSans: '"Inter", system-ui, sans-serif',
    colors: {
      primary: { 50: '#f0f0fa', 100: '#d9d9f2', 200: '#bbbae8', 300: '#8e8cd9', 400: '#6966cc', 500: '#4340bf', 600: '#3836a1', 700: '#2e2b82', 800: '#232163', 900: '#15143d' },
      accent: { 50: '#edfcfb', 100: '#d3f8f4', 200: '#b0f2ec', 300: '#7beadf', 400: '#50e2d5', 500: '#24dbca', 600: '#1eb8aa' },
    },
  },
  'ember-93': {
    label: 'Ember 93 — angular compact ember with crimson accent, for real estate & property',
    fontSans: '"IBM Plex Sans", system-ui, sans-serif',
    colors: {
      primary: { 50: '#f9f3f0', 100: '#efe0d9', 200: '#e3c7ba', 300: '#d0a28c', 400: '#c08266', 500: '#aa6546', 600: '#8f553a', 700: '#74452f', 800: '#593524', 900: '#372016' },
      accent: { 50: '#fbf2f2', 100: '#f4dfdd', 200: '#ecc6c2', 300: '#dfa09a', 400: '#d58079', 500: '#ca6157', 600: '#b8453a' },
    },
  },
  'jade-94': {
    label: 'Jade 94 — softly rounded compact jade with teal accent, for real estate & property',
    fontSans: '"Source Sans 3", system-ui, sans-serif',
    colors: {
      primary: { 50: '#eaf9f3', 100: '#cbf0e1', 200: '#a1e4c9', 300: '#62d1a6', 400: '#36ba86', 500: '#278660', 600: '#217051', 700: '#1a5b42', 800: '#144532', 900: '#0c2b1f' },
      accent: { 50: '#eff8fb', 100: '#d6edf5', 200: '#b6deed', 300: '#85c9e0', 400: '#5cb7d6', 500: '#33a4cc', 600: '#2b8aab' },
    },
  },
  'violet-95': {
    label: 'Violet 95 — rounded airy violet with ember accent, for real estate & property',
    fontSans: '"Public Sans", system-ui, sans-serif',
    colors: {
      primary: { 50: '#faeefc', 100: '#f3d4f7', 200: '#eab2f0', 300: '#dc7ee7', 400: '#d054de', 500: '#c529d6', 600: '#a522b4', 700: '#861c92', 800: '#66156f', 900: '#3f0d45' },
      accent: { 50: '#fcf4ed', 100: '#f8e3d3', 200: '#f2cdb0', 300: '#eaab7b', 400: '#e28f50', 500: '#db7324', 600: '#b8611e' },
    },
  },
  'lime-96': {
    label: 'Lime 96 — rounded airy lime with azure accent, for real estate & property',
    fontSans: '"Karla", system-ui, sans-serif',
    colors: {
      primary: { 50: '#f6f8ea', 100: '#e7eecc', 200: '#d4e0a2', 300: '#b8cc65', 400: '#9ab13b', 500: '#6d7d2a', 600: '#5c6923', 700: '#4a551c', 800: '#394116', 900: '#23280d' },
      accent: { 50: '#f1f5fb', 100: '#dce6f4', 200: '#c1d1eb', 300: '#97b3de', 400: '#759ad3', 500: '#5281c8', 600: '#3969b4' },
    },
  },
  'teal-97': {
    label: 'Teal 97 — angular compact teal with amber accent, for real estate & property',
    fontSans: '"Work Sans", system-ui, sans-serif',
    colors: {
      primary: { 50: '#f0f4f9', 100: '#d9e5ef', 200: '#bacfe3', 300: '#8db0d0', 400: '#6795c1', 500: '#467aac', 600: '#3b6790', 700: '#305375', 800: '#244059', 900: '#162737' },
      accent: { 50: '#fbf8ef', 100: '#f5eed6', 200: '#ede1b6', 300: '#e0cd85', 400: '#d6bc5c', 500: '#ccab33', 600: '#ab902b' },
    },
  },
};

module.exports = { retiredThemes };
