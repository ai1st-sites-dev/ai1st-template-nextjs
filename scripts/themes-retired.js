// ══════════════════════════════════════════════════════════════════════════════════════════════════
// themes-retired.js — 已下架那 30 套的【名字和配色】，只为了弹窗里那一张「当前卡」（#1161）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 🔴 这里面【不是主题】。一套主题有 colors / fonts / supports / settings / style / industries 六部分
//    （见 themes.js 文件头）；这里每一条只有三样东西：id、显示名、配色。少掉的那几样是【故意】不留的
//    —— 留着就等于这 30 套还能被穿上，而本票要的正好相反。
//
// 🔴 `themes.js` 【不再】把它并进 `const themes`。所以：按 id 查这 30 套查不到、新站抽不到、
//    弹窗里没有它们的卡、`layoutFor()` / `settingsFor()` / `themeStyle()` 对它们落回默认值。
//    有一格测试盯着这条（`theme-pipeline/pool.test.js` 的 ④）。
//
// ── 那为什么还要留这 30 个名字 ──────────────────────────────────────────────────────────────────
//
// 因为有站正穿着它们。spec 附四规则 1（Chris 2026-08-23 冻结）说的是：
//   「不换永远不受影响…配套：弹窗对已下架的当前主题照实说『已下架，继续用没任何影响』。」
// 要说出那句话，弹窗得有这个站当前那套主题的**名字**（写「Midnight」而不是写 `midnight`）和一块
// **配色**（卡上那条色带；预览拿不到实时缩略图时它就是卡上唯一的画面）。而平台这一侧，
// `theme-pool.json` 那 80 个键里**没有任何一个退役 id** —— 也就是说删光这个文件，弹窗就只剩下
// 一个裸 id 可写。所以留下来的正好是「说那句话要用的东西」，一样不多。
//
// 📌 完整的那 777 行外观表（fonts / supports / settings / style / industries）在 #1161 之前的
//    版本里，要看就去 git：`git show c8d5dcd7:templates/nextjs/scripts/themes-retired.js`。
//    穿着这些主题的站不受影响 —— 每个站的容器克隆的是站自己那个 repo，里面带着建站那天的模板快照
//    （spec 附四规则 1 的物理保证）。
//
// 🔴 别往这里加第 31 条。这是一份**冻结的历史名单**，不是「下架区」——今天池子里那 80 套要下架时，
//    该做的是同一件事：把它的名字和配色搬进这份名单，并从 theme-pool.json 里删掉。
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
};

module.exports = { retiredThemes };
