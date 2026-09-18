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
  // ── 首屏 ────────────────────────────────────────────────────────────────────────────────────
  hero: {
    headline: 'Honest auto repair on Yonge Street since 1998',
    subheadline: 'Licensed technicians, written estimates before we touch anything, and a two-year '
      + 'warranty on every repair. Most jobs are back on the road the same day.',
    ctaPrimary: { label: 'Book a service', href: '/quote' },
    ctaSecondary: { label: 'See what we charge', href: '/services' },
    imageUrl: imageUrl('hero-bay'),
    // #1358 —— 可选的图片带槽（FlyonUI hero-1 那条横向照片带）。六条是守卫 (c) 的下限，
    // alt 长短不一是它的第二条（最长 ≥ 最短的 2 倍）—— 两条都别往下压。
    // 🔴 每条都要有 `imageUrl`：缺图的条目组件会整条丢掉（`HeroSection.tsx` 的 filter），
    //    而图册那一格看起来只是「照片少了一张」，是静默的。
    imageBand: [
      { imageUrl: imageUrl('work-1'), alt: 'A technician on the hoist checking brake lines' },
      { imageUrl: imageUrl('work-2'), alt: 'Rear rotors' },
      { imageUrl: imageUrl('work-3'), alt: 'Diagnostic scan running on a sedan in bay two' },
      { imageUrl: imageUrl('work-4'), alt: 'Alignment rack' },
      { imageUrl: imageUrl('work-5'), alt: 'Oil change underway, drain pan and fresh filter ready' },
      { imageUrl: imageUrl('work-6'), alt: 'Safety inspection' },
    ],
    socialProof: {
      avatars: [1, 2, 3, 4, 5, 6].map((n) => ({ imageUrl: imageUrl(`avatar-${n}`) })),
      rating: 4.9,
      text: 'Rated 4.9 by 612 drivers across North York and Midtown',
    },
  },

  'hero-with-form': {
    headline: 'Tell us what the car is doing. We will tell you what it costs.',
    subheadline: 'Send the symptoms and we come back within the hour on a weekday with a price '
      + 'range and the first free slot in the shop.',
    ctaPrimary: { label: 'Get my estimate', href: '/quote' },
    ctaSecondary: { label: 'Call (416) 555-0148', href: 'tel:+14165550148' },
    imageUrl: imageUrl('hero-front-desk'),
    form: {
      buttonText: 'Send it over',
      successMessage: 'Got it — one of our advisors will call you back shortly.',
    },
  },

  // ── 信任 ────────────────────────────────────────────────────────────────────────────────────
  'trusted-brands': {
    headline: 'We service every make that comes through the door',
    brands: [
      'Kia',
      'Toyota',
      'Honda',
      'Volkswagen',
      'Mercedes-Benz',
      'Land Rover / Range Rover',
    ],
  },

  'social-proof': {
    headline: 'What drivers say after they pick the car up',
    overallRating: '4.9',
    totalReviews: '612',
    platforms: [
      { name: 'Google', rating: '4.9', reviews: '412' },
      { name: 'Yelp', rating: '4.7', reviews: '88' },
      { name: 'Facebook', rating: '4.8', reviews: '61' },
      { name: 'CARFAX Service Shops', rating: '4.9', reviews: '134' },
      { name: 'Better Business Bureau of Central Ontario', rating: 'A+', reviews: '27' },
      { name: 'RateMyMechanic Toronto', rating: '5.0', reviews: '19' },
    ],
    badges: [
      'Licensed by the Ontario Motor Vehicle Industry Council',
      'Red Seal certified technicians on every shift',
      'Drive Clean emissions testing',
      'CAA Approved Auto Repair Services',
      'Two-year parts and labour warranty',
      'BBB A+',
    ],
    featuredQuote: {
      text: 'They found a cracked coolant hose two other shops missed, showed me the part on the '
        + 'bench, and still came in under the quote.',
      author: 'Priya R., Willowdale',
    },
    // 🔴 下面两个槽是 #1376 并进来的（那张票把「一排数字」那个块整个删掉，它唯一的内容变成这里的
    //    一个可选槽）。这一组数字就是从那个块的演示内容原样搬过来的 —— 搬，不是重写：图册上
    //    `social-proof` 那几种形态画的正是它，两处各写一份的话，分歧那天两边都不会红。
    //    守卫 (c) 量的是每条「给人读的字」有多少个（`value` + `label`），这六条现测
    //    7 / 10 / 48 / 32 / 7 / 11 —— 最长 48 ≥ 最短 7 的 2 倍。
    stats: [
      { value: '27', label: 'Years' },
      { value: '612', label: 'Reviews' },
      { value: '4.9', label: 'Average rating across Google, Yelp and CARFAX' },
      { value: '2 yr', label: 'Warranty on parts and labour' },
      { value: '11', label: 'Makes' },
      { value: '94%', label: 'Same-day' },
    ],
    imageUrl: imageUrl('reviews-band'),
  },

  testimonials: {
    headline: 'Six of the six hundred',
    subheadline: 'Reviews we did not pick for length — these are the ones drivers left last month.',
    items: [
      {
        id: 'review-daniel',
        name: 'Daniel Osei',
        role: 'Courier, drives a 2016 Transit',
        location: 'North York',
        quote: 'Van died on the 401 on a Tuesday. They had it diagnosed by noon and back on the '
          + 'road before my evening run. That is a day of work they saved me.',
        rating: 5,
        service: 'Emergency diagnostics',
      },
      {
        id: 'review-mei',
        name: 'Mei Lin Chow',
        role: 'Teacher',
        location: 'Lawrence Park',
        quote: 'Clear quote, no upsell, and they washed it.',
        rating: 5,
        service: 'Brake service',
      },
      {
        id: 'review-tom',
        name: 'Tom Reilly',
        role: 'Retired',
        location: 'Leaside',
        quote: 'Twenty-two years with the same shop. They tell me when something can wait, which '
          + 'is why I keep coming back.',
        rating: 5,
        service: 'Seasonal maintenance',
      },
      {
        id: 'review-ana',
        name: 'Ana Ferreira',
        role: 'Nurse, night shifts',
        location: 'Don Mills',
        quote: 'The early drop-off box meant I did not lose a morning of sleep waiting around.',
        rating: 4,
        service: 'Oil and filter',
      },
      {
        id: 'review-sam',
        name: 'Samir Haddad',
        role: 'Small business owner',
        location: 'Thornhill',
        quote: 'They keep three of our vehicles on the road. Invoices are itemised down to the '
          + 'shop supplies, which my bookkeeper appreciates more than I do.',
        rating: 5,
        service: 'Fleet maintenance',
      },
      {
        id: 'review-jo',
        name: 'Jo Whitfield',
        role: 'Student',
        location: 'Midtown',
        quote: 'Cheapest honest quote I got out of four shops.',
        rating: 5,
        service: 'Suspension',
      },
    ],
  },

  // ── 内容 / 排版 ─────────────────────────────────────────────────────────────────────────────
  'features-grid': {
    headline: 'Why drivers stay with us',
    subheadline: 'The boring things done properly: a written estimate, a phone call before any '
      + 'extra work, and the old parts in a box if you want them.',
    columns: '3',
  },

  'card-group': {
    headline: 'What we do most weeks',
    subheadline: 'Every job below is quoted before it starts.',
    items: [
      {
        title: 'Brakes',
        description: 'Pads, rotors, callipers and fluid, measured and photographed before we quote.',
        features: ['Free brake measurement', 'OEM or equivalent pads', 'Two-year warranty'],
      },
      {
        title: 'Oil and filters',
        description: 'Full synthetic, in and out in forty minutes.',
        features: ['Walk-ins welcome'],
      },
      {
        title: 'Check engine diagnostics',
        description: 'We read the codes, then we actually test the circuit the code points at — a '
          + 'code is a symptom, not a diagnosis.',
        features: ['Live data capture', 'Written findings', 'Fee credited toward the repair'],
      },
      {
        title: 'Tires and seasonal swaps',
        description: 'Storage included for the set you are not using.',
        features: ['Free storage', 'Road-force balancing'],
      },
      {
        title: 'Suspension and steering',
        description: 'Struts, bushings, tie rods and a four-wheel alignment on the same visit.',
        features: ['Alignment printout', 'Test drive before and after'],
      },
      {
        title: 'Safety certificates',
        description: 'Same-day inspections for private sales and out-of-province imports.',
        features: ['Same-day', 'Itemised fail list'],
      },
    ],
  },

  'text-block': {
    headline: 'A note about estimates',
    content: 'We will not start a job without your sign-off, and we will not add to it without a '
      + 'second phone call. If the repair turns out to be smaller than the estimate, you pay the '
      + 'smaller number — that has been the rule since the shop opened.',
    background: 'gray',
    centered: true,
    items: [
      'Estimates are written, not verbal',
      'No work starts without your approval',
      'Any change over $50 gets a second call',
      'Old parts are yours if you want them',
      'Diagnostic fees are credited toward the repair when you go ahead with it',
      'Shop supplies are itemised',
    ],
    attribution: '— Marcus Oyelaran, owner',
  },

  'content-split': {
    headline: 'The same two bays, twenty-seven years apart',
    content: 'Marcus bought the shop from his old employer in 1998 with one hoist and a borrowed '
      + 'scan tool. The building has not moved. The tooling has: today the shop runs factory-level '
      + 'diagnostics for eleven makes and still hands you the old parts in a box.',
    bullets: [
      'Two hoists and an alignment rack',
      'Factory diagnostics for eleven makes',
      'Loaner cars',
      'Free local shuttle within five kilometres of the shop, weekday mornings',
      'After-hours key drop',
      'Saturday pickup by appointment',
    ],
    stats: [
      { value: '1998', label: 'Opened' },
      { value: '27', label: 'Years on Yonge Street' },
      { value: '11', label: 'Makes with factory-level diagnostic coverage in the shop' },
      { value: '4.9', label: 'Average rating' },
      { value: '2 yr', label: 'Warranty' },
      { value: '612', label: 'Reviews' },
    ],
    imageUrl: imageUrl('about-workshop'),
  },

  'page-header': {
    title: 'Brake repair in North York',
    subtitle: 'Measured, quoted and warrantied — usually finished the same afternoon.',
    breadcrumbs: [
      { label: 'Home', href: '/' },
      { label: 'Services', href: '/services' },
      { label: 'Repairs', href: '/services/repairs' },
      { label: 'Brakes, rotors and callipers', href: '/services/repairs/brakes' },
      { label: 'North York', href: '/services/repairs/brakes/north-york' },
      { label: 'Book' },
    ],
  },

  // ── 号召 / 表单 ─────────────────────────────────────────────────────────────────────────────
  'cta-banner': {
    headline: 'Something not sounding right?',
    description: 'Describe it in a sentence and we will tell you what it usually costs to fix.',
    button: { label: 'Get an estimate', href: '/quote' },
    // #1361 —— 这个块的可选头像带。**同一批脸**故意跟 hero 的 `socialProof.avatars` 复用：
    // 两处画的是同一件事（这家店的顾客），图册上并排看时换一批脸只会让人以为它们是两群人。
    // 🔴 六张不是凑数：守卫 (c) 要求每个 list 槽 ≥ 6 项（`demo-content.test.js` 的 MIN_ITEMS）。
    avatars: [1, 2, 3, 4, 5, 6].map((n) => ({ imageUrl: imageUrl(`avatar-${n}`) })),
  },

  'announcement-bar': {
    message: 'Winter tire changeovers are booking two weeks out — reserve your slot now.',
    link: { label: 'Reserve a slot', href: '/quote' },
  },

  'newsletter-signup': {
    headline: 'Service reminders, not marketing',
    description: 'Four emails a year: winter prep, spring prep, your next oil change, and your '
      + 'safety certificate expiry.',
    buttonText: 'Remind me',
  },

  'quote-form': {
    formIntro: 'Tell us the make, the model and what it is doing. We answer within the hour on '
      + 'weekdays.',
    propertyTypes: [
      'Sedan',
      'SUV or crossover',
      'Pickup truck',
      'Cargo van or commercial fleet vehicle',
      'Hybrid',
      'Electric',
    ],
    urgencyOptions: [
      'ASAP',
      'Within 1 week',
      'Within 1 month',
      'Just exploring',
      'It is not driveable and needs a tow',
      'Before my safety certificate expires',
    ],
    benefits: [
      'Written estimate before any work starts',
      'Two-year parts and labour warranty',
      'Free local shuttle',
      'Diagnostic fee credited toward the repair when you go ahead',
      'Loaner cars',
      'No upsells',
    ],
    redirectMessage: 'You will be redirected to our secure form.',
    buttonText: 'Get my estimate',
  },

  'contact-form': {
    heading: 'Ask us anything',
    intro: 'Parts availability, a second opinion on someone else\'s quote, or just whether it is '
      + 'safe to drive until Monday.',
    buttonText: 'Send message',
    successMessage: 'Thanks — we reply within one business hour.',
    // #1370 —— 可选图槽，只有 `form-over-media` 那一副形态用它（`shapes.css` 里别的形态把
    // `.contact-form__media` 藏掉）。守卫 (a) 要每个槽位都有值，包括可选槽。
    // 🔴 借的是 `about-workshop` 这张（`content-split` 也用它）：`.contact-form__media` 在
    // `public/base.css` 里是 `aspect-ratio: 16 / 9` + `object-fit: cover`，要一张**横图**，
    // 而 `about-9` 是 1216x642（≈1.89，现取）。`contact` 那一类我试过 —— `contact-1` 带
    // 「Unsplash+」水印（图册是给 Chris 判形态的，别让水印替形态说话）、`contact-2`/`-3` 近正方，
    // 放进 16/9 会把上下裁掉大半。
    imageUrl: imageUrl('about-workshop'),
  },

  'contact-info': {
    headline: 'Find the shop',
    // #1382 —— 只有 `media-side-grid` 这一副把它画出来（其余三副 `shapes.css` 里默认藏起来）。
    // 全填版夹具每个可选槽都填，所以这里必须有值 —— 守卫 (a) 两向都查。
    imageUrl: imageUrl('contact-desk'),
  },

  // ── 数据 / 清单 ─────────────────────────────────────────────────────────────────────────────
  'faq-accordion': {
    headline: 'Questions we get at the counter',
    subheadline: 'If yours is not here, call and ask — we answer the phone.',
    items: [
      {
        question: 'Do I need an appointment?',
        answer: 'For oil changes and tire swaps, no — walk in. For anything diagnostic, book ahead '
          + 'so we can put a technician and a hoist aside for it.',
      },
      {
        question: 'How long does a brake job take?',
        answer: 'Two to three hours for a standard front or rear axle.',
      },
      {
        question: 'Will you look at another shop\'s quote?',
        answer: 'Yes, and we will tell you if it is fair. About a third of the second opinions we '
          + 'give end with us saying the other quote was reasonable.',
      },
      {
        question: 'Do you charge for diagnostics?',
        answer: 'One hour of diagnostic time, credited back against the repair if you go ahead '
          + 'with it here.',
      },
      {
        question: 'Can I supply my own parts?',
        answer: 'You can, but the warranty then covers our labour only.',
      },
      {
        question: 'Do you do safety certificates for private sales?',
        answer: 'Same day, usually within ninety minutes, and you get the itemised fail list '
          + 'whether or not it passes.',
      },
    ],
    // #1362 —— 两个可选槽，只有本票新加的那两副把它们画出来（`media-side` 用图、`aside-cta` 用卡）。
    // 全填版夹具每个可选槽都填，所以这里必须有值 —— 守卫 (a) 两向都查。
    imageUrl: imageUrl('faq-advisor'),
    helpCard: {
      headline: 'Still not sure what it needs?',
      body: 'Describe the noise, the smell or the warning light in one sentence. We will tell you '
        + 'what it usually turns out to be and what that costs to put right.',
      button: { label: 'Ask a technician', href: '/contact' },
    },
  },

  'process-steps': {
    headline: 'How a repair actually goes',
    subheadline: 'Four phone calls at most, and you approve the number before anything is opened up.',
    steps: [
      { title: 'Tell us the symptoms', description: 'Online, on the phone, or at the counter.' },
      {
        title: 'We inspect and measure',
        description: 'Technician time on a hoist, with photos of whatever we find so you are not '
          + 'taking our word for it.',
      },
      { title: 'You get a written estimate', description: 'Parts, labour and taxes, itemised.' },
      {
        title: 'You approve it',
        description: 'Nothing is opened up before this. Anything that changes by more than fifty '
          + 'dollars gets a second call.',
      },
      { title: 'We do the work', description: 'Most jobs finish the same day.' },
      {
        title: 'You pick it up',
        description: 'Old parts in a box if you want them, warranty card in the glovebox, and a '
          + 'reminder set for the next service interval.',
      },
    ],
  },

  'team-grid': {
    headline: 'Who is under your car',
    subheadline: 'Six technicians, four of them Red Seal certified.',
    members: [
      {
        name: 'Marcus Oyelaran',
        role: 'Owner, licensed technician',
        bio: 'Bought the shop from his old boss in 1998 and still takes the hard diagnostic jobs '
          + 'himself.',
      },
      { name: 'Dana Krol', role: 'Shop foreman', bio: 'Drivetrain and transmissions.' },
      {
        name: 'Yusuf Rahimi',
        role: 'Diagnostic technician',
        bio: 'Factory-trained on German makes; the one who finds the intermittent electrical '
          + 'faults nobody else can reproduce.',
      },
      { name: 'Eleni Papas', role: 'Service advisor', bio: 'Writes the estimates you can read.' },
      { name: 'Ray Bhatti', role: 'Tire and alignment', bio: 'Road-force balancing.' },
      {
        name: 'Nina Sorensen',
        role: 'Apprentice technician',
        bio: 'Third-year apprentice, Centennial College, on the hoists Tuesday through Saturday.',
      },
    ],
  },

  'pricing-table': {
    headline: 'What the regular jobs cost',
    subheadline: 'Parts and labour, before tax. A written estimate always beats this table.',
    tiers: [
      // 🔴 **主推那一项要排在第一位**（#1383）。最少版（`--minimal`）把每个必填列表槽压到
      //    **第一项**，而 `.pricing-table__badge` 与 `.pricing-table__item--featured` 这两条钩子
      //    只在 `highlighted` 为真的那一项上进 DOM（`PricingTableSection.tsx:77,79`）——
      //    主推排在第 3 位时，那一臂上这两条钩子一页都不出现，主题漏写规则时没有人会红。
      //    实测：主推在第 3 位时两套主题的最少版「契约里有、这个站没有」从 34 涨到 36。
      //    这也是这家店真实的样子 —— 换机油本来就是最常来的那一项。
      {
        name: 'Oil and filter',
        price: '$89',
        description: 'Full synthetic, up to 5 litres.',
        features: ['Multi-point inspection', 'Fluid top-up'],
        highlighted: true,
      },
      {
        name: 'Seasonal tire swap',
        price: '$70',
        description: 'On rims.',
        features: ['Free storage'],
        highlighted: false,
      },
      {
        name: 'Brake service, one axle',
        price: '$340',
        description: 'Pads and rotors on one axle, including a road test and a torque check on '
          + 'every wheel.',
        features: ['OEM-equivalent pads', 'Two-year warranty', 'Free re-torque at 100 km'],
        highlighted: false,
      },
      {
        name: 'Diagnostics',
        price: '$140',
        description: 'One hour, credited back against the repair.',
        features: ['Written findings'],
        highlighted: false,
      },
      {
        name: 'Four-wheel alignment',
        price: '$160',
        description: 'Before and after printout.',
        features: ['Printout', 'Road test'],
        highlighted: false,
      },
      {
        name: 'Safety certificate',
        price: '$120',
        description: 'Same-day inspection for private sales and out-of-province imports, with the '
          + 'itemised fail list either way.',
        features: ['Same-day', 'Itemised fail list', 'Re-inspection within 10 days included'],
        highlighted: false,
      },
    ],
  },

  gallery: {
    headline: 'In the bays this month',
    subheadline: 'Photographs from actual jobs, posted with the owners\' permission.',
    items: [
      {
        title: 'Coolant hose, 2014 Golf',
        description: 'Cracked at the clamp — the kind of thing a pressure test finds and a code '
          + 'reader never will.',
        category: 'Diagnostics',
        imageUrl: imageUrl('work-1'),
      },
      { title: 'Rear rotors', description: 'Scored past spec.', category: 'Brakes', imageUrl: imageUrl('work-2') },
      {
        title: 'Winter set going into storage',
        description: 'Tagged, bagged and racked until October.',
        category: 'Tires',
        imageUrl: imageUrl('work-3'),
      },
      { title: 'Alignment rack', description: 'Four wheels, printout included.', category: 'Steering', imageUrl: imageUrl('work-4') },
      {
        title: 'Timing belt and water pump',
        description: 'Done together because doing them apart means paying the same labour twice.',
        category: 'Engine',
        imageUrl: imageUrl('work-5'),
      },
      { title: 'Safety inspection', description: 'Same day.', category: 'Inspections', imageUrl: imageUrl('work-6') },
    ],
  },

  'map-area': {
    headline: 'Neighbourhoods we serve',
    subheadline: 'Free shuttle within five kilometres of the shop.',
    areas: [
      { name: 'Willowdale', description: 'Ten minutes up Yonge — most of our weekday regulars.' },
      { name: 'Lawrence Park', description: 'Shuttle territory.' },
      { name: 'Leaside', description: 'Shuttle territory.' },
      {
        name: 'Don Mills',
        description: 'Fifteen minutes east; we hold Saturday pickup slots for drivers coming from '
          + 'this side.',
      },
      { name: 'Thornhill', description: 'Just north of Steeles.' },
      {
        name: 'Midtown Toronto',
        description: 'Subway is two blocks from the shop, so plenty of people drop the car and '
          + 'carry on to work.',
      },
    ],
  },

  'blog-preview': {
    headline: 'From the shop notebook',
    subheadline: 'Written by the people holding the wrench.',
    posts: [
      {
        title: 'What a check engine light actually means',
        excerpt: 'A code tells you which circuit reported a problem. It does not tell you which '
          + 'part failed, and that difference is most of the diagnostic bill.',
        category: 'Diagnostics',
        date: '2026-08-14',
      },
      {
        title: 'When to replace winter tires',
        excerpt: 'Tread depth, not the calendar.',
        category: 'Tires',
        date: '2026-07-02',
      },
      {
        title: 'The second phone call',
        excerpt: 'Why we ring you again when a job changes by more than fifty dollars, even when '
          + 'it would be easier for everyone if we just did the work.',
        category: 'How we work',
        date: '2026-06-19',
      },
      { title: 'Brake noise, decoded', excerpt: 'Squeal, grind, pulse — three different bills.', category: 'Brakes', date: '2026-05-30' },
      {
        title: 'Buying a used car in Ontario',
        excerpt: 'The safety certificate is the seller\'s job. The pre-purchase inspection is '
          + 'yours, and it is the cheaper of the two.',
        category: 'Buying advice',
        date: '2026-04-11',
      },
      { title: 'Why we keep your old parts', excerpt: 'So you can see them.', category: 'How we work', date: '2026-03-08' },
    ],
  },

  'service-related-pages': {
    serviceSlug: 'sample-service',
    headline: 'Related Topics',
    subheadline: 'Other things drivers read before booking this one.',
  },

  // ── 无槽位的两个块（manifest 里 `slots` 是空的）────────────────────────────────────────────
  'services-nav': {},
  'services-list': {},

  // ── 外壳区（#1353：它们也是块）───────────────────────────────────────────────────────────────
  header: {
    menu: [
      { label: 'Home', href: '/' },
      { label: 'Services', href: '/services' },
      { label: 'Brake repair and diagnostics', href: '/services/brakes' },
      { label: 'Pricing', href: '/pricing' },
      { label: 'About the shop', href: '/about' },
      { label: 'Contact', href: '/contact' },
    ],
    cta: { label: 'Book a service', href: '/quote' },
    logo: imageUrl('logo-mark'),
    language: 'en',
  },

  footer: {
    columns: [
      {
        title: 'Services',
        links: [
          { label: 'Brakes', href: '/services/brakes' },
          { label: 'Diagnostics', href: '/services/diagnostics' },
          { label: 'Tires', href: '/services/tires' },
        ],
      },
      { title: 'Shop', links: [{ label: 'About', href: '/about' }] },
      {
        title: 'Book',
        links: [
          { label: 'Get an estimate', href: '/quote' },
          { label: 'Safety certificate booking', href: '/services/safety-certificate' },
        ],
      },
      {
        title: 'Neighbourhoods',
        links: [
          { label: 'Willowdale', href: '/areas/willowdale' },
          { label: 'Lawrence Park', href: '/areas/lawrence-park' },
          { label: 'Leaside', href: '/areas/leaside' },
          { label: 'Don Mills', href: '/areas/don-mills' },
        ],
      },
      { title: 'Read', links: [{ label: 'Notebook', href: '/blog' }] },
      {
        title: 'Legal',
        links: [
          { label: 'Warranty terms', href: '/warranty' },
          { label: 'Privacy', href: '/privacy' },
        ],
      },
    ],
    copyright: `© 2026 ${SITE}. OMVIC licensed.`,
    description: 'Independent auto repair on Yonge Street since 1998. Written estimates, two-year '
      + 'warranty, and your old parts back if you want them.',
    logo: imageUrl('logo-mark-alt'),
    social: [
      { platform: 'google', url: 'https://g.page/northside-auto-care-toronto' },
      { platform: 'yelp', url: 'https://yelp.ca/biz/northside' },
      { platform: 'facebook', url: 'https://facebook.com/northsideautocare' },
      { platform: 'instagram', url: 'https://instagram.com/northside.auto' },
      { platform: 'linkedin', url: 'https://linkedin.com/company/northside-auto-care-toronto' },
      { platform: 'whatsapp', url: 'https://wa.me/14165550148' },
    ],
  },
};

module.exports = { DEMO_CONTENT, SITE };
