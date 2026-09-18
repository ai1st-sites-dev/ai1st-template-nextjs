import type { Config } from 'tailwindcss';

const config: Config = {
  // 🔴 #1387 —— `./blocks/**` 这一行是承重的，不是顺手加的。块组件从 `src/components/sections/`
  // 搬进了 `blocks/<块>/Section.tsx`（设计文档 D20），而 Tailwind 只给**扫到的文件**里出现过的
  // 类名出 CSS。少了这一行，只在块组件里用到的那些工具类**整批不进产物** —— 页面照样建得出来、
  // 构建照样绿、HTML 一个字节都不差，只是那些元素在浏览器里按默认样式画。
  // 实测（本票交付时）：少这一行 ⟹ `theme-css-invariants.mjs` 报
  // 「unstyled class: "a.btn-primary" … no loaded stylesheet has a rule for it」，两套皮各 2 处。
  content: [
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
    './blocks/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: 'var(--color-primary-50)',
          100: 'var(--color-primary-100)',
          200: 'var(--color-primary-200)',
          300: 'var(--color-primary-300)',
          400: 'var(--color-primary-400)',
          500: 'var(--color-primary-500)',
          600: 'var(--color-primary-600)',
          700: 'var(--color-primary-700)',
          800: 'var(--color-primary-800)',
          900: 'var(--color-primary-900)',
        },
        accent: {
          50: 'var(--color-accent-50)',
          100: 'var(--color-accent-100)',
          200: 'var(--color-accent-200)',
          300: 'var(--color-accent-300)',
          400: 'var(--color-accent-400)',
          500: 'var(--color-accent-500)',
          600: 'var(--color-accent-600)',
        },
      },
      fontFamily: {
        sans: ['var(--font-sans)'],
        // #951: `font-heading` for anything that wants the heading typeface without being an
        // h1-h3 (globals.css handles those). Headings themselves need no class.
        heading: ['var(--font-heading)'],
      },
      // #961 — 圆角和阴影改读 CSS 变量，跟上面的 colors / fontFamily 同一个做法。
      // 这一处改动就让 section 组件里现有的 174 处 `rounded-*` / 28 处 `shadow-*` 跟着 theme 走，
      // 34 个组件一个都不用手改。变量的默认值在 globals.css 的 `:root`，与今天的字面值逐字相同，
      // 所以没写风格设定的老站算出来的值不变。
      //
      // 🔴 只列真正在用的那几档（DEFAULT/md/lg/xl/2xl · DEFAULT/sm/md/lg）。`extend` 是合并语义，
      //    没列到的档位保持 tailwind 默认 —— 其中 `full` 是【故意】不列的：PM 在 #961 裁定它保持
      //    9999px，因为那 61 处里有圆点和图标圆底，跟着「直角」变方块是坏掉，不是风格。
      borderRadius: {
        DEFAULT: 'var(--radius-DEFAULT)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
        '2xl': 'var(--radius-2xl)',
      },
      boxShadow: {
        DEFAULT: 'var(--shadow-DEFAULT)',
        sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
      },
    },
  },
  plugins: [require('@tailwindcss/typography')],
};

export default config;
