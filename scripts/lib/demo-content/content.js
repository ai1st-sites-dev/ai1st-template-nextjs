// ══════════════════════════════════════════════════════════════════════════════════════════════════
// demo-content/content.js — 一家演示生意的真文案（#1383）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 演示生意：**Northside Auto Care**，多伦多的一家汽修店。它跟展示站建站时用的那家是同一家
// （`deploy/cloud-dev/build-showcase-from-main.sh` 的 create-site 载荷里 `companyName` 就是它），
// 所以图册里那一格和展示站别的页面读起来是同一门生意。
//
// 🔴 **这一份只喂图册和夹具页，不进客户站。** 唯一的读者是 `scripts/lib/demo-content/index.js`。
//
// 🔴 **每个槽位都要有值，包括可选槽** —— 图册的「全填版」那一列问的就是「这个块塞满了排得怎么样」，
//    少一个槽位那一列就画不出那个零件，而页面照样打开（静默）。守卫 (a) 按 manifest 现算的槽位集合
//    逐个对，缺一个点名一个。
//
// 🔴 **列表槽的条目要够多、还要长短不一。** 形态是按「六个条目怎么排」设计的（`three-up` /
//    `four-up-tight` / `masonry` 这一族），三个等长的条目量不出它们的差别 —— 老的
//    `sampleDataFor()` 给 `trusted-brands/brands` 发的正是 `["Brands 1","Brands 2","Brands 3"]`：
//    3 项、三项等长。守卫 (c) 的两条常量（≥ 6 项、最长 ≥ 最短的 2 倍）就是冲这个来的。
'use strict';

const { imageUrl } = require('./images');

const SITE = 'Northside Auto Care';

/**
 * 块 → 槽位 → 值。键就是 `blocks/<type>.json` 里 `slots` 的键，一个都不许多、一个都不许少
 * （守卫 (a) 两向都查：缺的点名，多出来的也点名 —— 多出来的那种是 manifest 改过而这里没跟）。
 */
const DEMO_CONTENT = {


  // #1463 —— Webpixels 那一版首屏（普通页面块，样式在全站挂的 site.css 里）。5 个预设 × 54 种旋钮组合吃的都是
  // 这一份（AC1 / AC5 定死的夹具）：每个部件都填上，单格页的开关才有东西可切。
  // 🔴 `ctas` / `stats` / `band` 是顶层 list 槽，守卫 (c) 要各 ≥ 6 项、最长 ≥ 最短 2 倍 —— 所以这里各给 6 条，
  //    而组件按定稿的上限截（按钮 ≤ 2、统计 ≤ 3、图片带 ≤ 6，`Section.tsx` §MAX）。画出来的是前几条。
  'hero': {
    // 🔴 `options` 里**不写旋钮**：写了就会压过每个预设形态自己那组值（`block-knobs.js` §effectiveKnobs），
    //    5 张预设卡片会全部排成同一个样子。#1470 起 hero 没有布尔修饰了 ⟹ 这里是空对象。
    // 📌 `form` 同理是空对象：那个槽只有 `{id?}`（选站级表单库里哪一张，#1471；空 = 第一张）。字段 / 按钮文字 /
    //    成功提示来自站级表单库（`BlockLeadForm`；站没有 forms.json 时用它的内置默认值）；Lead form 预设的表单照样画得出来。
    // 🔴 这两个键**不能整段删**：全填版要求每个槽位在包里都有一个键（守卫 (a)，`demo-content.test.js`；
    //    运行时 `demoDataFor` 缺槽直接抛错，图册那一格就打不开）。空对象 = 键在、不带任何值。
    options: {},
    bg: '#ffffff',
    proof: {
      avatars: [1, 2, 3, 4].map((n) => ({ imageUrl: imageUrl(`avatar-${n}`) })),
      rating: 4.9,
      text: '612 Google reviews',
    },
    stats: [
      { value: '1998', label: 'On Yonge Street since' },
      { value: '14,000+', label: 'Cars back on the road' },
      { value: '2 yr', label: 'Warranty on every repair' },
      { value: 'Same day', label: 'Most jobs' },
      { value: '4.9', label: 'Average Google rating across 612 reviews' },
      { value: '6', label: 'Bays' },
    ],
    logos: {
      caption: 'Certified by and rated on',
      items: [
        { imageUrl: imageUrl('client-logo-1'), alt: 'OMVIC' },
        { imageUrl: imageUrl('client-logo-2'), alt: 'CAA Approved Auto Repair' },
        { imageUrl: imageUrl('client-logo-3'), alt: 'Google' },
        { imageUrl: imageUrl('client-logo-4'), alt: 'Yelp' },
      ],
    },
    band: [
      { imageUrl: imageUrl('work-1'), alt: 'A technician on the hoist checking brake lines' },
      { imageUrl: imageUrl('work-2'), alt: 'Rear rotors' },
      { imageUrl: imageUrl('work-3'), alt: 'Diagnostic scan running on a sedan in bay two' },
      { imageUrl: imageUrl('work-4'), alt: 'Alignment rack' },
      { imageUrl: imageUrl('work-5'), alt: 'Oil change underway, drain pan and fresh filter ready' },
      { imageUrl: imageUrl('work-6'), alt: 'Safety inspection' },
    ],
    eyebrow: { text: 'North York · Licensed & insured', style: 'pill' },
    headline: 'Honest auto repair, done the same day',
    subheadline: 'Written estimates before we touch anything and a two-year warranty on every repair. '
      + 'Most jobs are back on the road by closing.',
    ctas: [
      { label: 'Book a service', href: '/quote', style: 'solid', icon: 'calendar-check' },
      // #1506 —— 电话按钮写成引用：号码不抄进块里，渲染前从站点数据（单格页是 DEMO_SITE.brand）填。
      { label: '{phone}', href: { source: 'phone' }, style: 'outline', icon: 'telephone' },
      { label: 'See what we charge for brakes, tires and diagnostics', href: '/services', style: 'link', arrow: true },
      { label: 'Directions', href: '/contact', style: 'link' },
      { label: 'Warranty', href: '/warranty', style: 'link' },
      { label: 'Reviews', href: '/reviews', style: 'link' },
    ],
    image: { imageUrl: imageUrl('hero-bay'), alt: 'Bay two at Northside Auto Care with a car on the hoist' },
    form: {},
  },


  // #1496 —— logos：Northside Auto Care 被认证 / 被评价的 6 个地方，带块头链接（全填版，单格页拧旋钮时都看得到）。
  //    🔴 `introEyebrow.style` 写明 pill，理由同 features 那条（词表 `none` 排第一，工具栏不写就亮 none）。
  //    🔴 `options` 留空对象：写了旋钮就会压过每个预设形态自己那组值（`block-knobs.js` §effectiveKnobs）。
  //    前两项带 `href`（整格是链接），后四项不带 —— 两种画法夹具里都有。
  'logos': {
    options: {},
    introEyebrow: { text: 'Certified & rated', style: 'pill' },
    headline: 'Certified by the people who check the checkers',
    body: 'Licensed by OMVIC, approved by CAA and rated on every platform drivers actually read.',
    introCta: { label: 'See our certifications →', href: '/about', style: 'link' },
    items: [
      { imageUrl: imageUrl('client-logo-1'), alt: 'OMVIC', href: 'https://www.omvic.ca' },
      { imageUrl: imageUrl('client-logo-2'), alt: 'CAA Approved Auto Repair', href: 'https://www.caa.ca' },
      { imageUrl: imageUrl('client-logo-3'), alt: 'Google' },
      { imageUrl: imageUrl('client-logo-4'), alt: 'Yelp' },
      { imageUrl: imageUrl('client-logo-5'), alt: 'Automotive Service Excellence' },
      { imageUrl: imageUrl('client-logo-6'), alt: 'Better Business Bureau' },
    ],
    bg: null,
  },



  // #1488 —— testimonials：Northside Auto Care 的六条评价（正文做什么 8：4 条带头像、2 条没有 ⟹ 首字母圆；
  //    来源混 Google / Yelp / HomeStars；一条 4 星；带 summary）。长短不一是守卫 (c) 要的。
  //    #1500 —— summary 是一组平台：Google 带 href（那一格是链接）；HomeStars 没有内置图标、也没有 logoUrl
  //    ⟹ 走「写平台名」那一档（正文做什么 8）。4 个而不是 3 个：demo-content.test.js 守卫 (c) 要 min(6, maxItems) = 4 项；
  //    四个平台逐字同 reviews.platforms（#1504），两块共用 review-platforms.js 的三档规则（PM 2026-10-01 裁定 A）。
  //    🔴 `introEyebrow.style` 写明 pill，理由同上面 features 那条（词表 `none` 排第一，工具栏不写就亮 none）。
  'testimonials': {
    options: {},
    introEyebrow: { text: 'Reviews', style: 'pill' },
    headline: 'Drivers who trusted us with their car',
    body: 'Real reviews from customers across Northside. We read every one and reply to most.',
    summary: [
      { source: 'Google', rating: 4.9, count: 312, href: 'https://www.google.com/maps' },
      { source: 'Yelp', rating: 4.8, count: 46 },
      { source: 'HomeStars', rating: 4.7, count: 28 },
      { source: 'Facebook', rating: 5.0, count: 19 },
    ],
    items: [
      {
        quote: 'Van died on the 401 on a Tuesday. They had it diagnosed by noon and back on the road '
          + 'before my evening run. That is a day of work they saved me.',
        name: 'Daniel Osei', role: 'North York · Emergency diagnostics',
        photo: { imageUrl: imageUrl('avatar-1'), alt: 'Daniel Osei' }, rating: 5, source: 'Google',
      },
      {
        quote: 'Clear quote, no upsell, and they washed it.',
        name: 'Mei Lin Chow', role: 'Lawrence Park · Brakes',
        photo: { imageUrl: imageUrl('avatar-2'), alt: 'Mei Lin Chow' }, rating: 5, source: 'Google',
      },
      {
        quote: 'We run four delivery vans through Northside now. They text me photos before any extra work '
          + 'and the invoice matches the quote every time. That alone is worth it.',
        name: 'Priya Raman', role: 'Fleet manager',
        photo: { imageUrl: imageUrl('avatar-3'), alt: 'Priya Raman' }, rating: 5, source: 'Yelp',
      },
      {
        quote: 'They found the rattle two other shops missed — a loose heat shield — and did not charge me for the diagnosis.',
        name: 'Tom Reilly', role: 'Leaside · Exhaust',
        photo: { imageUrl: imageUrl('avatar-4'), alt: 'Tom Reilly' }, rating: 5, source: 'Google',
      },
      {
        quote: 'Booked online at 7pm, confirmed in ten minutes.',
        name: 'Sam Patel', role: 'Midtown · Oil change', rating: 5, source: 'Google',
      },
      {
        quote: 'Honest advice: they told me my brakes had another season in them and only replaced the pads. '
          + 'Took a day longer than promised, but I will be back.',
        name: 'Ana Rodrigues', role: 'Don Mills · Brake inspection', rating: 4, source: 'HomeStars',
      },
    ],
    bg: null,
  },

  // #1504 —— reviews：Northside Auto Care 在四个平台上的评分（正文做什么 8）。Google 带 href（那一格是链接）；
  //    HomeStars 没有内置图标、也没有 logoUrl ⟹ 走「写平台名」那一档。加权总分 = 1976.2 / 405 = 4.88 → 4.9。
  //    🔴 `introEyebrow.style` 写明 pill，理由同上面 features 那条（词表 `none` 排第一，工具栏不写就亮 none）。
  'reviews': {
    options: {},
    introEyebrow: { text: 'Reviews', style: 'pill' },
    headline: 'Rated 4.9 by Northside drivers',
    body: 'Real reviews on the sites you already trust. We reply to every one.',
    platforms: [
      { source: 'Google', rating: 4.9, count: 312, href: 'https://www.google.com/maps' },
      { source: 'Yelp', rating: 4.8, count: 46 },
      { source: 'HomeStars', rating: 4.7, count: 28 },
      { source: 'Facebook', rating: 5.0, count: 19 },
    ],
    bg: null,
  },





  // #1498 —— content：一段 About（两段话 + 三条列表 + 一处加粗 + 两个按钮 + 一张图）。body 是 richtext
  //    （scripts/lib/richtext.js 认的 markdown 子集）。按钮按守卫 (c) 给满 6 条，组件按 manifest 的 max 2 截。
  'content': {
    options: {},
    introEyebrow: { text: 'About us', style: 'pill' },
    headline: 'Family-run since 2009',
    body: 'Northside Auto Care started with one bay and a rule: **tell people the price before you touch the car**. '
      + 'Fifteen years later we have six bays, and the rule has not changed.\n\n'
      + 'Every technician on the team is licensed and on our payroll — we never hand your car to a subcontractor. '
      + 'That is why the same faces keep showing up when you [book a service](/quote).\n\n'
      + '- Written quotes before any work starts\n'
      + '- Two-year warranty on parts and labour\n'
      + '- Same-day service when you drop off before noon',
    ctas: [
      { label: 'Book a service', href: '/quote', style: 'solid' },
      { label: 'Meet the team', href: '/about', style: 'outline' },
      { label: 'Read our warranty in full before you book', href: '/warranty', style: 'link', arrow: true },
      { label: 'Services', href: '/services', style: 'link' },
      { label: 'Reviews', href: '/reviews', style: 'link' },
      { label: 'Directions', href: '/contact', style: 'link' },
    ],
    image: { imageUrl: imageUrl('about-workshop'), alt: 'The Northside Auto Care workshop with two cars on hoists' },
    bg: null,
  },


  // #1502 —— Webpixels 那一版内页标题带：Northside Auto Care 的一个服务页（eyebrow + h1 + 副标题 + 按钮 + 图）。
  //    🔴 **没有 breadcrumbs**：面包屑按页面路径算（`src/lib/breadcrumbs.ts`），不是块的数据；单格页给它一个夹具页的
  //       slug（`catalogShared.ts` §CATALOG_PAGE_HEADER_SLUG，三级：Home → Brake Repair → 本页）。
  //    🔴 `options` 留空、`ctas` 6 条、`introEyebrow.style` 写明，理由同下面 cta / features 那几条。
  'page-header': {
    options: {},
    introEyebrow: { text: 'Brake repair', style: 'pill' },
    headline: 'Brake repair in North York',
    subheadline: 'Measured, quoted and warrantied — pads, rotors and callipers, usually finished the same afternoon. You see the worn parts and the written price before we start.',
    ctas: [
      { label: 'Book a brake check', href: '/quote', style: 'solid' },
      { label: 'Call (416) 555-0142', href: 'tel:+14165550142', style: 'outline' },
      { label: 'See what we charge for pads, rotors and a full brake-fluid flush', href: '/services', style: 'link', arrow: true },
      { label: 'Directions', href: '/contact', style: 'link' },
      { label: 'Warranty', href: '/warranty', style: 'link' },
      { label: 'Reviews', href: '/reviews', style: 'link' },
    ],
    image: { imageUrl: imageUrl('work-2'), alt: 'A technician measuring a brake rotor' },
    bg: null,
  },


  // #1479 —— Webpixels 那一版 CTA（普通页面块，样式在 site.css 里）。6 个预设 × 旋钮组合吃的都是这一份：
  // 定稿「夹具内容默认带 eyebrow（pill）和 2 个 ctas」，图 / 表单也填上，单格页的旋钮才有东西可切。
  // 🔴 `options` 留空对象：写了旋钮就会压过每个预设形态自己那组值（`block-knobs.js` §effectiveKnobs），6 张卡会排成一样；
  //    这个块没有布尔修饰，所以里面什么都不放（键要在：守卫 (a) 按键查每个槽都在包里）。
  // 🔴 `ctas` 是顶层 list 槽，守卫 (c) 要 ≥ 6 项、最长 ≥ 最短 2 倍 —— 组件按定稿截到前 2 条（`Section.tsx` §MAX_CTAS）。
  // `bg: null` = 没填（manifest 每个槽都要在演示包里有键，`demoDataFor`）。
  'cta': {
    options: {},
    eyebrow: { text: 'Free 15-minute check', style: 'pill' },
    headline: 'Car making a noise you do not like?',
    body: 'Bring it in and we will tell you what it is and what it costs before any work starts.',
    ctas: [
      { label: 'Book a free check', href: '/quote', style: 'solid' },
      // #1506 —— 同 hero：电话按钮写成引用。
      { label: 'Call {phone}', href: { source: 'phone' }, style: 'outline' },
      { label: 'See what we charge for brakes, tires and diagnostics', href: '/services', style: 'link', arrow: true },
      { label: 'Directions', href: '/contact', style: 'link' },
      { label: 'Warranty', href: '/warranty', style: 'link' },
      { label: 'Reviews', href: '/reviews', style: 'link' },
    ],
    image: { imageUrl: imageUrl('work-1'), alt: 'A technician on the hoist checking brake lines' },
    form: {},
    bg: null,
  },

  // #1475 —— features：Northside Auto Care 的 6 项服务，每项都带 icon / image / link（全填版，单格页拧旋钮时
  //    哪个都看得到）。`number` 不在这一版里：7 个预设都不是步骤式的，带了编号每张卡都会多一个 01 / 02。
  //    带编号的那一版是下面的 FEATURES_NEW_STEPS（测试与夹具站用）。
  //    🔴 `introEyebrow.style` 必须写：这个槽的词表 `none` 排第一（#1481 规矩 1），单格页工具栏在数据里没这个子字段时
  //       取 values[0] 当选中的那一档（`page.dev.tsx` §knobOverrides）⟹ 不写的话工具栏亮着 none、画布上却是 pill
  //       （组件对「只写了字」按 pill 画，同 hero / cta）。
  'features': {
    options: {},
    introEyebrow: { text: 'What we fix', style: 'pill' },
    // 45 个字符：1440 下 introAlign=left 时要一行放下（#1475 AC3 量的就是这一句）。
    headline: 'Honest car care that keeps your family moving',
    body: 'Licensed technicians, factory-grade parts and a written quote before any work starts.',
    introCtas: [
      { label: 'Book a service', href: '/quote', style: 'solid' },
      { label: 'Call (416) 555-0142', href: 'tel:+14165550142', style: 'outline', icon: 'telephone' },
      { label: 'See every service we offer and what each one costs', href: '/services', style: 'link', arrow: true },
      { label: 'Warranty', href: '/warranty', style: 'link' },
      { label: 'Reviews', href: '/reviews', style: 'link' },
      { label: 'Directions', href: '/contact', style: 'link' },
    ],
    introImage: { imageUrl: imageUrl('about-workshop'), alt: 'The Northside Auto Care workshop with two cars on hoists' },
    itemsImage: { imageUrl: imageUrl('hero-bay'), alt: 'A technician checking a car on the hoist' },
    // #1527 —— 6 条里只有两条带 bullets（第 2 条 1 项、第 3 条 3 项），其余四条不带 ⟹ 0 / 1 / 多三种情况一页齐。
    //    3 项那份挂在最长的 Diagnostics 上：守卫 (c) 要最长 ≥ 最短 2 倍，挂在短条目上会把最短那条抬上去。
    items: [
      { icon: 'disc', image: { imageUrl: imageUrl('work-1'), alt: 'New brake rotors and pads' }, title: 'Brakes',
        text: 'Pads, rotors and callipers — with a road test before you pick it up.',
        link: { label: 'Brake service', href: '/services/brakes', arrow: true } },
      { icon: 'snow', image: { imageUrl: imageUrl('work-2'), alt: 'Winter tires on a rack' }, title: 'Tires & changeovers',
        text: 'Seasonal swaps, balancing and storage for your second set.',
        bullets: ['Changeovers in under an hour'],
        link: { label: 'Tire service', href: '/services/tires', arrow: true } },
      { icon: 'speedometer2', image: { imageUrl: imageUrl('work-3'), alt: 'A scan tool plugged into a dashboard' }, title: 'Diagnostics',
        text: 'Check-engine light on? We read the codes, find the cause and explain it in plain words before quoting a single repair.',
        bullets: ['Free code read with any repair', 'Photos of the worn parts', 'Same-day results'],
        link: { label: 'Diagnostics', href: '/services/diagnostics', arrow: true } },
      { icon: 'droplet', image: { imageUrl: imageUrl('work-4'), alt: 'Fresh oil' }, title: 'Oil changes',
        text: 'Synthetic or conventional, done in 30 minutes.',
        link: { label: 'Oil change', href: '/services/oil', arrow: true } },
      { icon: 'battery-charging', image: { imageUrl: imageUrl('work-5'), alt: 'A battery tester on a car battery' }, title: 'Batteries & electrical',
        text: 'Free battery test, replacements and alternator repairs.',
        link: { label: 'Electrical', href: '/services/electrical', arrow: true } },
      { icon: 'shield-check', image: { imageUrl: imageUrl('work-6'), alt: 'An inspection checklist on a clipboard' }, title: 'Safety inspections',
        text: 'Ontario safety certificates and pre-purchase checks for used cars.',
        link: { label: 'Inspections', href: '/services/inspections', arrow: true } },
    ],
    bg: null,
  },

  // #1482 —— milestones：Northside Auto Care 的六个数字，每条带 icon（正文做什么 9 点名的是前四条；守卫 (c) 要列表槽
  //    ≥ 6 条、长短不一，所以补了两条）。`introCtas` 给 6 条同理，组件只画前 2 条（`slots.introCtas.max`）。
  //    🔴 `introEyebrow.style` 写明 pill，理由同上面 features 那条（词表 `none` 排第一，工具栏不写就亮 none）。
  milestones: {
    options: {},
    blockImage: { imageUrl: imageUrl('hero-bay'), alt: 'A technician checking a car on the hoist' },
    introEyebrow: { text: 'By the numbers', style: 'pill' },
    headline: 'Trusted by drivers across Northside',
    body: 'Fifteen years of honest repairs, written quotes and a two-year warranty on every job.',
    introCtas: [
      { label: 'Book a service', href: '/quote', style: 'solid' },
      { label: 'Call (416) 555-0142', href: 'tel:+14165550142', style: 'outline', icon: 'telephone' },
      { label: 'Read what our customers say about their repairs', href: '/reviews', style: 'link', arrow: true },
      { label: 'Warranty', href: '/warranty', style: 'link' },
      { label: 'Services', href: '/services', style: 'link' },
      { label: 'Directions', href: '/contact', style: 'link' },
    ],
    introImage: { imageUrl: imageUrl('about-workshop'), alt: 'The Northside Auto Care workshop with two cars on hoists' },
    stats: [
      { value: '2009', label: 'Serving Northside since', icon: 'calendar-check' },
      { value: '14,000+', label: 'Jobs completed', icon: 'wrench-adjustable' },
      { value: '60 min', label: 'Average arrival', icon: 'stopwatch' },
      { value: '4.9', label: 'Google rating', icon: 'star-fill' },
      { value: '2 yr', label: 'Warranty on parts and labour for every repair we do', icon: 'shield-check' },
      { value: '24/7', label: 'Towing', icon: 'truck' },
    ],
    bg: null,
  },

  // #1483 —— pricing：Northside Auto Care 的三档保养套餐（正文做什么 10 点名的是前三档，中间那档 featured + badge、
  //    三档都填 price.yearly；带 billing、highlights、proof）。守卫 (c) 要列表槽 ≥ 6 条、长短不一，所以 plans / highlights
  //    各补到 6 条 —— 组件只画前 4 条（`slots.plans.maxItems` / `slots.highlights.maxItems`）。
  //    🔴 `introEyebrow.style` 写明 pill，理由同 features（词表 `none` 排第一，工具栏不写就亮 none）。
  'pricing': {
    options: {},
    introEyebrow: { text: 'Maintenance plans', style: 'pill' },
    headline: 'Car care that pays for itself',
    body: 'Pick a plan, skip the surprise bills. Every plan includes a written quote before we touch your car.',
    highlights: [
      { icon: 'shield-check', title: 'Licensed technicians', text: 'Every tech is Red Seal certified.' },
      { icon: 'clock', title: 'Same-day service', text: 'Book before noon and drive home tonight.' },
      { icon: 'receipt', title: 'Upfront pricing', text: 'You approve the quote before we start, and the price never moves after that.' },
      { icon: 'award', title: 'Two-year warranty', text: 'Parts and labour.' },
      { icon: 'truck', title: 'Free towing', text: 'Within 25 km of the shop on the Complete and Premium plans.' },
      { icon: 'star-fill', title: '4.9 on Google', text: 'From 312 reviews.' },
    ],
    proof: {
      avatars: [1, 2, 3, 4].map((n) => ({ imageUrl: imageUrl(`avatar-${n}`) })),
      rating: '4.9',
      text: '312 Google reviews',
    },
    logos: {
      caption: 'Approved by',
      items: [
        { imageUrl: imageUrl('client-logo-1'), alt: 'OMVIC' },
        { imageUrl: imageUrl('client-logo-2'), alt: 'CAA Approved Auto Repair' },
        { imageUrl: imageUrl('client-logo-3'), alt: 'Google' },
        { imageUrl: imageUrl('client-logo-4'), alt: 'Yelp' },
      ],
    },
    billing: { monthlyLabel: 'Monthly', yearlyLabel: 'Yearly', yearlyNote: '2 months free' },
    plans: [
      {
        name: 'Essential',
        price: { monthly: '$19', yearly: '$16' },
        period: '/ month',
        description: 'Oil changes and a check-up, done on time.',
        features: ['Two synthetic oil changes a year', 'Multi-point inspection', '10% off repairs'],
        cta: { label: 'Choose Essential', href: '/quote' },
      },
      {
        name: 'Complete',
        price: { monthly: '$39', yearly: '$32' },
        period: '/ month',
        description: 'Everything a daily driver needs, with priority booking.',
        features: ['Everything in Essential', 'Seasonal tire swap and storage', 'Brake inspection twice a year', 'Priority same-day booking', '15% off repairs'],
        cta: { label: 'Choose Complete', href: '/quote' },
        featured: true,
        badge: 'Most popular',
      },
      {
        name: 'Premium',
        price: { monthly: '$69', yearly: '$57' },
        period: '/ month',
        description: 'For drivers who put on serious kilometres every year and want a loaner car while theirs is in the shop.',
        features: ['Everything in Complete', 'Free loaner car', 'Free towing within 25 km', '20% off repairs'],
        cta: { label: 'Choose Premium', href: '/quote' },
      },
      {
        name: 'Fleet',
        price: { monthly: '$149', yearly: '$124' },
        period: '/ month',
        description: 'Up to five vehicles on one plan.',
        features: ['Complete for every vehicle', 'One monthly invoice'],
        cta: { label: 'Talk to us', href: '/contact' },
      },
      {
        name: 'Classic',
        price: { monthly: '$29' },
        period: '/ month',
        description: 'Seasonal care for a car that sleeps all winter.',
        features: ['Spring wake-up service', 'Fall storage prep'],
        cta: { label: 'Choose Classic', href: '/quote' },
      },
      {
        name: 'EV',
        price: { monthly: '$25', yearly: '$21' },
        period: '/ month',
        description: 'Brakes, tires and cabin filters.',
        features: ['Tire rotation', 'Cabin filter'],
        cta: { label: 'Choose EV', href: '/quote' },
      },
    ],
    bg: null,
    featuredColor: null,
  },





  // #1489 —— contact：Northside Auto Care 的六条 contact item。phone / email / address / hours 四条的**值不在这里**——
  //    从站点数据读（真站读 `@/lib/config`；图册 / 单格页读下面的 DEMO_SITE），这里只有标题和提示；两条 link 自带 href。
  //    六条而不是正文说的四条：守卫 (c) 要列表槽 ≥ 6 项（`demo-content.test.js` MIN_ITEMS），正好等于 items 的 maxItems。
  'contact': {
    options: {},
    introEyebrow: { text: 'Contact', style: 'pill' },
    headline: 'Talk to a technician today',
    body: 'Call, email or send the form — a licensed technician gets back to you within the hour while the shop is open.',
    items: [
      { kind: 'phone', title: 'Call us', hint: 'Fastest way to book' },
      { kind: 'email', title: 'Email us', hint: 'Photos of the problem help us quote' },
      { kind: 'address', title: 'Visit us', hint: 'Drop-off bays on the north side of the building' },
      { kind: 'hours', title: 'Hours', hint: 'Closed Sundays' },
      { kind: 'link', title: 'Text us on WhatsApp', hint: 'Replies within 15 minutes', href: 'https://wa.me/14165550142' },
      { kind: 'link', title: 'Book online', hint: 'Pick a time', href: '/contact' },
    ],
    form: {},
    bg: '#ffffff',
  },

  // ── 数据 / 清单 ─────────────────────────────────────────────────────────────────────────────
  // #1484 —— faq：Northside Auto Care 的 6 条问答（长短不一 —— 守卫 (c) 要最长 ≥ 最短的 2 倍）+ help 卡。
  //    🔴 `introEyebrow.style` 必须写（同 features 那条注释：词表 none 排第一，单格页工具栏取 values[0]）。
  'faq': {
    options: {},
    introEyebrow: { text: 'FAQ', style: 'pill' },
    headline: 'Questions we get at the counter',
    body: 'Straight answers about pricing, timing and warranty. Still not sure? Call us — a real person picks up.',
    help: {
      headline: 'Still have a question?',
      body: 'Talk to a licensed technician, not a call centre. Free advice, no obligation.',
      cta: { label: 'Call (416) 555-0142', href: 'tel:+14165550142', style: 'solid' },
    },
    items: [
      {
        question: 'Do you charge for estimates?',
        answer: 'No. You get a written quote before any work starts, and nothing happens until you approve it. '
          + 'Diagnostic time is one hour, credited back if you go ahead with the repair here.',
      },
      {
        question: 'Do I need an appointment?',
        answer: 'Not for oil changes or tire swaps — walk in. Book ahead for anything diagnostic.',
      },
      {
        question: 'How long does a brake job take?',
        answer: 'Two to three hours for a standard front or rear axle.',
      },
      {
        question: 'Is the work guaranteed?',
        answer: 'Parts and labour are guaranteed for two years on every repair, at any of our partner shops across Ontario.',
      },
      {
        question: 'Which cars do you work on?',
        answer: 'Every make, domestic and import, including hybrids. We do not service commercial trucks over one tonne.',
      },
      {
        question: 'Can I wait while you work?',
        answer: 'Yes — there is a waiting room with Wi-Fi and coffee. For longer jobs we offer a free ride within Northside.',
      },
    ],
    bg: null,
  },



  // #1487 —— team：Northside Auto Care 的六个人，每人带照片（演示内容已有的 avatar-1…6，不外链新图）、简介、链接，
  //    外加一张招聘卡 `join`。正文做什么 9 写的是 4 位成员；守卫 (c) 要列表槽 ≥ 6 条、长短不一，所以给了六位（同 milestones）。
  //    链接的字段叫 `icon`（`icons.js` §iconNamesIn 只收这个键名）。
  //    🔴 `introEyebrow.style` 写明 pill，理由同上面 features 那条（词表 `none` 排第一，工具栏不写就亮 none）。
  'team': {
    options: {},
    introEyebrow: { text: 'Our team', style: 'pill' },
    headline: 'The people who work on your car',
    body: 'Licensed, local and the same small crew every visit, so you always know who is looking after your car.',
    members: [
      {
        name: 'Marcus Oyelaran',
        role: 'Owner · Licensed technician',
        photo: { imageUrl: imageUrl('avatar-1'), alt: 'Marcus Oyelaran' },
        bio: 'Bought the shop from his old boss in 1998 and still takes the hard diagnostic jobs himself.',
        links: [{ icon: 'linkedin', href: 'https://www.linkedin.com/' }, { icon: 'envelope', href: 'mailto:marcus@northsideauto.example' }],
      },
      {
        name: 'Dana Krol',
        role: 'Shop foreman',
        photo: { imageUrl: imageUrl('avatar-2'), alt: 'Dana Krol' },
        bio: 'Drivetrain and transmissions.',
        links: [{ icon: 'linkedin', href: 'https://www.linkedin.com/' }],
      },
      {
        name: 'Yusuf Rahimi',
        role: 'Diagnostic technician',
        photo: { imageUrl: imageUrl('avatar-3'), alt: 'Yusuf Rahimi' },
        bio: 'Factory-trained on German makes; the one who finds the intermittent electrical faults nobody else can reproduce.',
        links: [{ icon: 'envelope', href: 'mailto:yusuf@northsideauto.example' }],
      },
      {
        name: 'Eleni Papas',
        role: 'Service advisor',
        photo: { imageUrl: imageUrl('avatar-4'), alt: 'Eleni Papas' },
        bio: 'Writes the estimates you can read and texts you when the car is ready.',
        links: [{ icon: 'telephone', href: 'tel:+14165550142' }, { icon: 'envelope', href: 'mailto:eleni@northsideauto.example' }],
      },
      {
        name: 'Ray Bhatti',
        role: 'Tire and alignment',
        photo: { imageUrl: imageUrl('avatar-5'), alt: 'Ray Bhatti' },
        bio: 'Road-force balancing.',
        links: [{ icon: 'instagram', href: 'https://www.instagram.com/' }],
      },
      {
        name: 'Nina Sorensen',
        role: 'Apprentice technician',
        photo: { imageUrl: imageUrl('avatar-6'), alt: 'Nina Sorensen' },
        bio: 'Third-year apprentice, Centennial College, on the hoists Tuesday through Saturday.',
        links: [{ icon: 'linkedin', href: 'https://www.linkedin.com/' }],
      },
    ],
    join: {
      title: 'Join our crew',
      body: 'We are hiring licensed technicians and apprentices. Steady hours, paid training and a shop that fixes things properly.',
      cta: { label: 'See open roles', href: '/contact', style: 'outline' },
    },
    bg: null,
  },



  // #1495 —— 7 张作品照，横竖方都有（瀑布流才看得出错落），都带标题 + 图注。
  'gallery': {
    options: {},
    introEyebrow: { text: 'Our work', style: 'pill' },
    headline: 'Recent jobs from our bays',
    body: 'Real photos from real jobs — every one done by our own licensed technicians.',
    items: [
      { image: { imageUrl: imageUrl('work-wide-1'), alt: '' }, title: 'Fleet service day', caption: 'North York · 6 vans' },
      { image: { imageUrl: imageUrl('work-tall-1'), alt: 'A technician going over the inspection sheet' }, title: 'Pre-purchase inspection', caption: 'Willowdale' },
      { image: { imageUrl: imageUrl('work-1'), alt: 'New brake rotors and pads on the bench' }, title: 'Brake job', caption: 'Front pads & rotors' },
      { image: { imageUrl: imageUrl('work-tall-2'), alt: 'Diagnostics running on a laptop in bay two' }, title: 'Check-engine diagnosis', caption: 'Thornhill · same day' },
      { image: { imageUrl: imageUrl('work-wide-2'), alt: 'The front desk on a Saturday morning' }, title: 'Saturday walk-ins', caption: 'Front desk' },
      { image: { imageUrl: imageUrl('work-2'), alt: 'Winter tires on the rack' }, title: 'Winter changeover', caption: 'Tires & storage' },
      { image: { imageUrl: imageUrl('work-tall-3'), alt: 'Paperwork for a warranty repair' }, title: 'Warranty repair', caption: 'Don Mills' },
    ],
    bg: null,
  },

  // #1497 —— blog：块里只有块头与 postCount，文章来自站点博客（上面的 DEMO_BLOG_POSTS 由单格页挂进去）。
  'blog': {
    options: {},
    introEyebrow: { text: 'From the shop', style: 'pill' },
    headline: 'Car care tips from the crew',
    body: 'Short, practical guides written by the technicians who do the work.',
    introCta: { label: 'All articles', href: '/blog', style: 'outline' },
    postCount: '3',
    bg: null,
  },





  // #1424 —— Webpixels 那一版顶栏（`staging: true`，只在图册里）。#1462 起 7 个预设吃同一份：`topbar` 只有
  // topbar 开的预设画（手机上折进抽屉），`ctaSecondary` 在那两个预设的抽屉里不出 —— 两样都填上，
  // 那几条断点行为单格页上才看得见。`options` 里不写旋钮、也不写 topbar（#1468 起它归预设管）：初值来自形态名（= 预设名），
  // 写了就会压过每个预设自己那一份。
  // 🔴 `topbar` 底下那三份 list 是嵌套的，守卫 (c) 只看顶层 list 槽，所以 3 个社交链接够用（票正文）。
  'header': {
    logo: imageUrl('brand-logo'),
    brandName: SITE,
    nav: [
      { label: 'Home', href: '/', icon: 'house-door', show: 'both' },
      { label: 'Services', href: '/services', icon: 'tools', show: 'both' },
      { label: 'Brake repair and diagnostics', href: '/services/brakes', icon: 'disc', show: 'both' },
      { label: 'Pricing', href: '/pricing', icon: 'tag', show: 'both' },
      { label: 'About the shop', href: '/about', icon: 'shop', show: 'both' },
      { label: 'Contact', href: '/contact', icon: 'envelope', show: 'icon' },
    ],
    ctaPrimary: { label: 'Book a service', href: '/quote', style: 'solid' },
    // #1506 —— 电话 / 地址写成引用（`scripts/lib/item-sources.js`），渲染前从站点数据（单格页是 DEMO_SITE.brand）填；
    //    营业时间不是联系方式的源（正文「不做」），照旧手写。
    ctaSecondary: { label: 'Call us', href: { source: 'phone' }, style: 'outline' },
    topbar: {
      // #1528 —— 一句话公告（带链接文字的那种写法，老公告条的形状派生过来就是这样）。
      message: { text: 'Free brake inspection with every oil change this month.', href: '/quote', label: 'Book now' },
      contact: [
        { source: 'phone' },
        { icon: 'clock', text: 'Mon–Sat 8am–6pm' },
        { source: 'address' },
      ],
      links: [
        { label: 'Sign in', href: '/account/sign-in' },
        { label: 'Create account', href: '/account/new' },
      ],
      social: [
        { label: 'Facebook', href: 'https://facebook.com/', icon: 'facebook' },
        { label: 'Instagram', href: 'https://instagram.com/', icon: 'instagram' },
        { label: 'Google reviews', href: 'https://google.com/maps', icon: 'google' },
      ],
    },
    // #1476 —— 颜色槽：`null` = 没填（浅底 `bg-body`，跟改前逐字相同）。键得在：演示包要求每个槽都有一项
    // （§demoDataFor 缺槽就抛）；深底 / 渐变由单格页的 `?bg=` 和色板给。
    bg: null,
    options: { icons: false },
  },

  // #1455 —— Webpixels 那一版页脚（`staging: true`，只在图册里）。6 个预设吃同一份；`cta` / `form`
  // 两个可选部件也填上，单格页工具栏上的勾选 / 单选才有东西可切（#1458 起开关住在 `[shape]/CellOptions.tsx`）。
  // 🔴 `nav` / `social` / `legal` 是顶层 list 槽，守卫 (c) 要各 ≥ 6 项、最长 ≥ 最短 2 倍（网址记 0 字，
  //    `icon` 是字、要算进去）。`columns` / `contact` / `cta` / `form` 是 object，底下的 list 不查。
  'footer': {
    logo: imageUrl('brand-logo'),
    brandName: SITE,
    tagline: 'Independent auto repair on Yonge Street since 1998. Written estimates before we touch anything.',
    nav: [
      { label: 'Home', href: '/' },
      { label: 'Services', href: '/services' },
      { label: 'Brake repair and diagnostics', href: '/services/brakes' },
      { label: 'Pricing', href: '/pricing' },
      { label: 'About the shop', href: '/about' },
      { label: 'Contact', href: '/contact' },
    ],
    columns: {
      services: [
        { label: 'Brakes', href: '/services/brakes' },
        { label: 'Diagnostics', href: '/services/diagnostics' },
        { label: 'Tires and seasonal changeover', href: '/services/tires' },
        { label: 'Safety certificates', href: '/services/safety-certificate' },
      ],
      areas: [
        { label: 'Willowdale', href: '/areas/willowdale' },
        { label: 'Lawrence Park', href: '/areas/lawrence-park' },
        { label: 'Leaside', href: '/areas/leaside' },
        { label: 'Don Mills', href: '/areas/don-mills' },
      ],
      contact: true,
    },
    // #1506 —— 联系方式与社交链接写成引用：从站点数据（单格页是 DEMO_SITE.brand）展开。`{source: "brand"}` 只带
    //    电话 / 邮箱 / 地址三样（营业时间不是它的源）⟹ 夹具里的营业时间那一行跟着不画。
    contact: { source: 'brand' },
    social: { source: 'social' },
    legal: [
      { label: 'Privacy', href: '/privacy' },
      { label: 'Terms', href: '/terms' },
      { label: 'Warranty terms', href: '/warranty' },
      { label: 'Accessibility (AODA) statement', href: '/accessibility' },
      { label: 'Cookies', href: '/cookies' },
      { label: 'Sitemap', href: '/sitemap' },
    ],
    copyright: `© 2026 ${SITE}. OMVIC licensed.`,
    cta: {
      title: 'Car making a noise you do not like?',
      subtitle: 'Book a free 15-minute check. We tell you what it is and what it costs before any work starts.',
      buttons: [
        { label: 'Book a free check', href: '/quote', style: 'solid' },
        { label: 'Call {phone}', href: { source: 'phone' }, style: 'outline' },
      ],
    },
    // #1464 —— 部件 `form`（跟 hero 同一个表单部件）。#1471 起槽只有 `{ id? }`（选站级表单库里哪一张，空 = 第一张），
    // 露多少是旋钮 `options.form`（下面那一行）—— #1469 的 `form: { mode }` 已迁移，不做兼容读。
    form: {},
    // #1469 —— 颜色槽：`null` = 没填（浅底 `bg-body`，跟改前 `dark=false` 逐字相同）。键得在：演示包要求每个槽都有一项
    // （§demoDataFor 缺槽就抛）；深底 / 渐变由单格页的 `?bg=` 和色板给。
    bg: null,
    options: { brand: 'left', form: 'teaser' },
  },

};

/**
 * #1475 —— features 带编号的那一版（「步骤」式内容：每项一个 number，itemConnector 打开）。
 * 从上面那份派生，只多 `number` 和 `options.itemConnector`，别的逐字一样 —— 两版的差别只在编号那一维。
 */
const FEATURES_NEW_STEPS = {
  ...DEMO_CONTENT['features'],
  options: { itemConnector: 'line' },
  items: DEMO_CONTENT['features'].items.map((it, i) => ({ number: String(i + 1).padStart(2, '0'), ...it })),
};

/**
 * #1489 —— 演示生意的**站点数据**那几样（contact 从站点数据读电话 / 邮箱 / 地址 / 营业时间 / 坐标，块里不存副本）。
 * 形状就是真站 `brand.json` / `seo.json` 里对应的那一截，单格页用 `scripts/lib/contact-facts.js` §siteFactsFrom 把它变成块要的值。
 * `geo` 是 2150 Yonge St 附近的坐标（夹具，不是查出来的；真站由 `scripts/lib/geocode.js` 建站时查一次）。
 */
const DEMO_SITE = {
  // #1471 —— 演示生意的站级表单库（`site/<locale>/forms.json` 的形状，`scripts/lib/site-forms.js`）。quote 在前：块里 `form.id`
  //    为空时取第一张。四个块的 render 测试按 `formId` 从这里取字段。
  forms: [
    {
      id: 'quote',
      name: 'Get a free estimate',
      fields: ['name', 'phone', 'service'],
      primary: 'phone',
      buttonText: 'Get my estimate',
      successMessage: "Thanks! A technician will call you back within the hour.",
    },
    {
      id: 'contact',
      name: 'Ask the shop',
      fields: ['name', 'email', 'message'],
      primary: 'email',
      buttonText: 'Send to the shop',
      successMessage: 'Got it — we reply to every email the same business day.',
    },
  ],
  // #1505 —— 演示生意的服务目录（形状 = 真站 `services.json` 的一条，只留 features 引用写法要读的那几样）。
  //    6 个服务、其中 5 个有详情页（`pages` 里那几条 `services/<id>`，最后一个 `seasonal-storage` 没有 ⟹ 那一条不带「了解更多」）；
  //    `icon` 是 ServiceIcon 那一套名字，`snowflake` 在 Bootstrap Icons 里叫 `snow`（item-sources.js §SERVICE_ICON_ALIASES）。
  services: [
    { id: 'brakes', name: 'Brake repair', shortDescription: 'Pads, rotors and calipers, with a written quote before we start.', icon: 'shield-check' },
    { id: 'diagnostics', name: 'Diagnostics', shortDescription: 'Check-engine light, noises and warning lights traced to the actual cause.', icon: 'lightbulb' },
    { id: 'tires', name: 'Tires and seasonal changeover', shortDescription: 'Mount, balance and swap your winter set in under an hour.', icon: 'snowflake' },
    { id: 'safety-certificate', name: 'Safety certificates', shortDescription: 'Ontario safety standards inspection for buying, selling or registering.', icon: 'fingerprint' },
    { id: 'ac', name: 'Air conditioning', shortDescription: 'Recharge, leak test and repair so the cabin cools again.', icon: 'thermometer' },
    { id: 'seasonal-storage', name: 'Tire storage', shortDescription: 'Clean, bagged and stored on site until the next changeover.', icon: 'tree' },
  ],
  pages: [
    { slug: 'services/brakes', title: 'Brake repair', description: '' },
    { slug: 'services/diagnostics', title: 'Diagnostics', description: '' },
    { slug: 'services/tires', title: 'Tires and seasonal changeover', description: '' },
    { slug: 'services/safety-certificate', title: 'Safety certificates', description: '' },
    { slug: 'services/ac', title: 'Air conditioning', description: '' },
  ],
  brand: {
    email: 'service@northsideauto.ca',
    locations: [{ label: 'Northside Auto Care', address: '2150 Yonge St, Toronto, ON', phone: '(416) 555-0142', geo: { lat: 43.7056, lng: -79.3983 }, city: 'Toronto' }],
    // #1506 —— footer 的 `social: {source: "social"}` 从这里展开（数组那种存法；对象那种由 contact-refs.test.js 另测）。
    socialLinks: [
      { platform: 'google', url: 'https://g.page/northside-auto-care-toronto' },
      { platform: 'yelp', url: 'https://yelp.ca/biz/northside' },
      { platform: 'facebook', url: 'https://facebook.com/northsideautocare' },
      { platform: 'instagram', url: 'https://instagram.com/northside.auto' },
      { platform: 'linkedin', url: 'https://linkedin.com/company/northside-auto-care-toronto' },
      { platform: 'whatsapp', url: 'https://wa.me/14165550148' },
    ],
  },
  seo: {
    schema: { openingHours: { days: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'], opens: '08:00', closes: '18:00' } },
  },
};

// #1497 —— 站点博客夹具（`BlogPostConfig` 形状）。blog 只从站点博客读、块里不存文章，所以图册单格页和
//    渲染单测要一份「这个站有博客」：单格页把它挂在一个没有任何路由会问的 locale 键下
//    （`src/app/%5F_catalog/catalogShared.ts` §registerCatalogFixtureBlogPosts，同 service-related-pages 那几页夹具）。
//    5 篇、按 publishedAt 故意打乱（块按倒序取最新 N 篇 —— 顺序由 sync-config 排，夹具这里由调用方排）：
//    3 篇带封面 + 作者 + 头像，1 篇没封面（占位），1 篇没摘要也没作者。
const DEMO_BLOG_POSTS = [
  {
    slug: 'check-engine-light',
    title: 'What a check engine light actually means',
    excerpt: 'A code tells you which circuit reported a problem. It does not tell you which part failed — and that difference is most of the diagnostic bill.',
    content: '<p>' + 'A check engine light is the car telling you a sensor reported something out of range. '.repeat(40) + '</p>',
    category: 'Diagnostics',
    tags: ['engine', 'diagnostics'],
    author: 'Dana Whitfield',
    authorAvatarUrl: imageUrl('avatar-1'),
    publishedAt: '2026-09-18',
    coverImage: { imageUrl: imageUrl('work-1'), alt: 'A technician reading a diagnostic scanner' },
    seo: { metaTitle: 'What a check engine light actually means', metaDescription: 'Codes, circuits and what the diagnostic bill pays for.' },
  },
  {
    slug: 'winter-tires',
    title: 'When to swap to winter tires in Toronto',
    excerpt: 'Tread depth and the 7 °C rule, not the calendar.',
    content: '<p>' + 'Winter tires stay soft below seven degrees, which is why the date on the calendar matters less than the forecast. '.repeat(20) + '</p>',
    category: 'Tires',
    tags: ['tires', 'winter'],
    author: 'Marcus Lee',
    authorAvatarUrl: imageUrl('avatar-2'),
    publishedAt: '2026-09-04',
    coverImage: { imageUrl: imageUrl('work-2'), alt: 'A stack of winter tires in the shop' },
    seo: { metaTitle: 'When to swap to winter tires', metaDescription: 'The 7 °C rule.' },
  },
  {
    slug: 'brake-noise',
    title: 'Squeal, grind or click: what your brakes are telling you',
    excerpt: 'Three sounds, three very different repair bills.',
    content: '<p>' + 'A squeal is usually the wear indicator doing its job; a grind means metal on metal. '.repeat(12) + '</p>',
    category: 'Brakes',
    tags: ['brakes'],
    author: 'Priya Nair',
    authorAvatarUrl: imageUrl('avatar-3'),
    publishedAt: '2026-08-21',
    coverImage: { imageUrl: imageUrl('work-3'), alt: 'A brake rotor and caliper' },
    seo: { metaTitle: 'What your brakes are telling you', metaDescription: 'Squeal, grind or click.' },
  },
  {
    slug: 'oil-change-intervals',
    title: 'How often you really need an oil change',
    excerpt: 'The 5,000 km sticker is a habit, not a rule. Your owner’s manual and your driving decide it.',
    content: '<p>' + 'Modern synthetic oil lasts longer than the old sticker suggests. '.repeat(15) + '</p>',
    category: 'Maintenance',
    tags: ['oil'],
    author: 'Dana Whitfield',
    publishedAt: '2026-07-30',
    seo: { metaTitle: 'How often you need an oil change', metaDescription: 'Intervals explained.' },
  },
  {
    slug: 'battery-cold-start',
    title: 'Why batteries die on the first cold morning',
    excerpt: '',
    content: '<p>' + 'Cold slows the chemistry inside a battery. '.repeat(10) + '</p>',
    category: 'Electrical',
    tags: ['battery'],
    author: '',
    publishedAt: '2026-07-12',
    seo: { metaTitle: 'Why batteries die in the cold', metaDescription: 'Cold starts.' },
  },
];

/**
 * #1505 —— features 的**引用写法**样例：条目不写在块里，指向本站的服务目录（`items: {source: "services"}`），
 * 渲染前由 `scripts/lib/item-sources.js` §resolveItemSources 展开（单格页用上面 DEMO_SITE 那份服务目录）。
 * 跟手写那一版（DEMO_CONTENT['features']）并存，别的槽逐字一样。
 */
const FEATURES_NEW_FROM_SERVICES = {
  ...DEMO_CONTENT['features'],
  items: { source: 'services' },
};

module.exports = { DEMO_CONTENT, SITE, FEATURES_NEW_STEPS, FEATURES_NEW_FROM_SERVICES, DEMO_SITE, DEMO_BLOG_POSTS };
