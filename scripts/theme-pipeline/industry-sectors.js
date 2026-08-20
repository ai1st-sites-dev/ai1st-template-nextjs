// ══════════════════════════════════════════════════════════════════════════════════════════════════
// industry-sectors.js — 新主题池的行业词怎么分配（#1016）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 一套主题的 `industries` 是一句声明：「我这身皮是为这些生意做的」。
//
// 🔴 #1119 起，建站时 `candidateThemesForIndustry()` **不再拿这句声明去匹配**（那条路只剩下面说的落回
//    路）：它先用 `sectorIndexForIndustry` 认出这门生意属于哪个行业组，候选池 = 本组 5 套 + `partner`
//    那组 5 套，按【组成员】取。`industries` 从「挑选的判据」退成「归组的判据」（`sectorIndexOfTheme`
//    拿它反查一套皮属于哪组）+ 覆盖度那两把尺的量纲（`pool.test.js` 第 ③ 格只读它）。
//    认不出组时（老板填的自由文本）才落回原来那句「行业文字包含这个词」的匹配 + `NEUTRAL_TOPUP` 兜底。
//
// 🔴 这份表要同时满足两件互相拉扯的事，所以它不是随手写的清单：
//
//   ① 每个行业词至少 4 套主题真的写了它（#1016 AC2 的判据 —— `coverage.js --max-thin-pools 0
//      --max-thin-hits 0` 要返回 0，而 `thinPools` 数的是候选池恰好等于兜底下限 3 的词，
//      也就是真命中 ≤3 的词）。
//   ② 不许靠「给每套多塞十几个词」把 ① 凑绿。那样产品面零变化：**声明一个行业不等于为它做过皮。**
//      判据是每套声明的行业数不许比今天 30 套更宽（今天 min 10 · 中位 12 · max 19 · 平均 12.97）。
//
// ⟹ 缺口只能靠**套数**补。做法是把 212 个行业词分成 16 个行业组，每组配 5 套主题；一套主题声明的
//    就是它那一组的词（少数几个按下面的轮转让位，把平均压到今天之下），于是每个词恒有 4-5 套真命中。
//
// 🔴 #1119 —— ② 那条规则的射程只有一种补法，别把它读成「候选池永远只能是本组这 5 套」：
//
//   · **不许**的是「给每套主题多塞十几个词」—— 一套皮声明它没做过的行业，那是空话，产品面零变化。
//     这一条没变，机器判据仍然是 `pool.test.js` 第 ③ 格（每套声明数 / 每套真命中数不超退役那 30 套）。
//   · **可以**的是「一个行业组整体声明它跟另一组气质相容」（下面每组的 `partner`）。声明的主语从
//     「一套皮」换成了「一组生意」，说的也不再是「我为它做过皮」，而是「这两门生意穿得下同一批皮」。
//     它不动任何主题的 `industries`，所以 ③ 那两行读数按构造一个字不变（本票实测：声明数平均
//     **12.25** / 真命中平均 **12.44**，与同一棵干净 main 上逐字相同）。
//     🔴 引用这两个数要带上「按哪个匹配器量的」：真命中那一列 #1115 从裸 `includes` 换成了词边界，
//        同一个池子的读数从 13.13 变成 12.44（`pool.test.js:89` 两向都记着）。本票初稿写的是
//        13.13 —— 那是在 #1115 落地【之前】取的，今天是假的。声明数那一列不受影响（它只数
//        `industries` 的长度，不经过匹配器）。
//
//   为什么要放这一条：16 组 × 5 套的结构让每个行业词恒只有 4-6 套候选，而 epic #1007 要的是
//   ≥10 —— 那道缺口在 80 套的池子上靠「往 industries 里塞词」算术上无解（要 212×10 = 2120 个
//   命中对，而 ③ 允许的上限是 80×14.73 = 1179）。Chris 2026-08-19 拍的是「标签接宽」，
//   实现落在组与组之间，不落在每套皮上。
//
// 🔴 **词表是今天那 212 个的超集，一个都不许少。** 旧 30 套退役之后，行业词的全集由新池自己的
//    `industries` 并起来决定 —— 少写一个词，今天能匹配上的生意明天就落进 NEUTRAL_TOPUP 那条兜底路，
//    而覆盖度那张表**看不见这件事**（它只统计池子里出现过的词）。所以缩词表是能把覆盖度凑绿的另一条
//    最省事路径，本文件底部那条自检把它钉死。
//
// 分组本身是**审美判断**（哪种配色适合哪门生意），第四道闸（Chris 人审）才是它的裁判；这里只保证
// 机械性质：词表不丢、每词 ≥4 套、每套声明数不超今天。

// ── 16 个行业组 ────────────────────────────────────────────────────────────────────────────────────
// 组名只在报告和 label 里露面，不进产品文案。
//
// 每组多一个 `partner`（#1119）：**这一组的生意还能穿哪一组的皮。** 一个行业词的候选池 =
// 本组那 5 套 + `partner` 那组的 5 套 = 10 套，按**组成员**取，不按词匹配取（`sectorThemeIds`）。
// `why` 是这条声明的理由，写的是两组的**气质**为什么能穿同一批皮 —— 它是数据不是注释，因为
// `industry-sectors.test.js` 要逐组问「有没有理由」，而注释问不到。
//
// 🔴 这张表有四条约束，每一条都对应一格会红的检查（`industry-sectors.test.js` ②③④⑤；
//    四条各自单独驱动过的读数在 #1119 的 PM 留言里）：
//
//   ① **一对一**（`partner` 是 16 组的一个置换）—— 一套皮出现在「自己组 + 借它这组的那个组」的
//      池子里。两组借同一组，被借那 5 套就进 3 个池子 ⟹ AC4 红。
//   ② **不许指自己** —— 指自己的那组池子长回 5 套 ⟹ AC1 红。
//   ③ **不许两组对借**（置换里不许有长度 2 的环）—— A 借 B 且 B 借 A 时，两组的候选集合逐字
//      相同 ⟹ AC5 红（行业匹配对这两组等于取消了）。
//   ④ **`green-outdoor` 与 `industrial-safety` 必须借到「有带表单主题」的组** —— 这两组是上门
//      行业，而它们自己 5 套里没有一套给带表单的第一屏写过样式。借不到带表单的组，`themes.js`
//      里 #1114 那道兜底就会补进第 11 套（`azure-50`），而它是 `home-trades` 的成员 ⟹ 进 3 个
//      池子，AC4 红。16 组里 10 组带表单，这条不紧。
const SECTORS = [
  {
    key: 'legal-professional',
    partner: { key: 'finance-insurance', why: '两边都靠资历取信：深色、克制、衬线标题，第一屏摆的是资质与数字而不是照片。' },
    label: '律所与专业服务',
    en: 'law & professional services',
    words: ['law', 'legal', 'corporate', 'consulting', 'accounting', 'tax', 'escrow', 'title',
      'trust', 'estate', 'auction', 'appraisal', 'surveying'],
  },
  {
    key: 'finance-insurance',
    partner: { key: 'real-estate', why: '都在做高单价的信任生意：偏冷的深色配大片留白撑住「稳」，配图是场所与人，不靠插画。' },
    label: '金融与保险',
    en: 'finance & insurance',
    words: ['finance', 'financial', 'bank', 'credit union', 'mortgage', 'broker', 'brokerage',
      'advisor', 'retirement', 'insurance', 'life insurance', 'underwriting', 'claims', 'benefits'],
  },
  {
    key: 'real-estate',
    partner: { key: 'retail-lifestyle', why: '都靠质感卖东西：大图、细字距、低饱和中性底，页面翻起来像一本图册。' },
    label: '房产与物业',
    en: 'real estate & property',
    words: ['real estate', 'realty', 'realtor', 'property', 'penthouse', 'luxury', 'home staging',
      'interior design', 'concierge', 'rental', 'cottage', 'resort', 'hotel'],
  },
  {
    key: 'clinic',
    partner: { key: 'legal-professional', why: '都是执照生意，要的是「干净且不作声」：高明度底、冷色、字号克制，不用夸张对比。' },
    label: '诊所与医疗',
    en: 'clinics & medical',
    words: ['medical', 'clinic', 'dental', 'pharmacy', 'optometry', 'chiropractic', 'physio', 'lab',
      'nursing', 'pediatric', 'walk-in', 'health', 'veterinary'],
  },
  {
    key: 'wellness-care',
    partner: { key: 'clinic', why: '照护与医疗同源：柔和的浅色底加圆角，观感先给安全感，不做强对比。' },
    label: '康养与照护',
    en: 'wellness & care',
    words: ['wellness', 'therapy', 'counseling', 'mental health', 'massage', 'yoga', 'naturopath',
      'herbal', 'senior care', 'home care', 'childcare', 'doula', 'natural'],
  },
  {
    key: 'beauty',
    partner: { key: 'wellness-care', why: '都在卖「被照顾好的感觉」：低饱和的粉杏米色、圆润字形 —— 美容院和理疗馆的门面本来就长得像。' },
    label: '美业与形象',
    en: 'beauty & grooming',
    words: ['salon', 'spa', 'beauty', 'barber', 'nail', 'lashes', 'makeup', 'cosmetic', 'skincare',
      'tattoo', 'fashion', 'boutique', 'menswear'],
  },
  {
    key: 'dining',
    partner: { key: 'artisan-food', why: '同一门吃喝生意：暖色、深木色调、手写感标题，都靠食物照片当主角。' },
    label: '餐饮与酒水',
    en: 'restaurants & drink',
    words: ['restaurant', 'food', 'bistro', 'fine dining', 'pizza', 'mexican', 'mediterranean',
      'catering', 'brewery', 'whisky', 'wine', 'winery', 'market', 'smokehouse'],
  },
  {
    key: 'artisan-food',
    partner: { key: 'events', why: '手作与婚庆共用「温暖加精致」那一路：米白底、暖金点缀、花草与纹理 —— 喜帖和面包店的包装纸是同一种审美。' },
    label: '烘焙与手作',
    en: 'bakery & artisan makers',
    words: ['bakery', 'cafe', 'coffee', 'cake', 'tea', 'roaster', 'butcher', 'craft', 'pottery',
      'ceramics', 'woodwork', 'forge', 'leather'],
  },
  {
    key: 'fitness-water',
    partner: { key: 'dining', why: '都是生活方式类门店：高饱和照片铺满第一屏、粗黑标题喊口号，靠气氛而不是参数说服人。' },
    label: '健身与水上',
    en: 'fitness & water sports',
    words: ['fitness', 'gym', 'sports', 'boxing', 'martial arts', 'dance', 'skate', 'surf', 'diving',
      'fishing', 'boat', 'marine', 'yacht'],
  },
  {
    key: 'home-trades',
    partner: { key: 'industrial-safety', why: '都是穿工装的活：高对比、警示色、粗黑字，第一屏要电话和「今天就能上门」。' },
    onSite: true,
    label: '家装与施工',
    en: 'home trades & building',
    words: ['construction', 'contractor', 'roofing', 'plumbing', 'hvac', 'electrical', 'renovation',
      'handyman', 'painting', 'tile', 'concrete', 'scaffolding', 'excavation', 'cleaning'],
  },
  {
    key: 'green-outdoor',
    partner: { key: 'home-trades', why: '同为上门施工：泥土绿与工装橙都吃得住脏背景，版式一样要把报价和联系方式放在最前。' },
    onSite: true,
    label: '园艺与绿色',
    en: 'landscaping & green',
    words: ['landscaping', 'garden', 'tree', 'farm', 'agriculture', 'organic', 'eco', 'environment',
      'sustainable', 'solar', 'hemp', 'cannabis', 'pest'],
  },
  {
    key: 'auto-transport',
    partner: { key: 'green-outdoor', why: '都在户外干活、都靠车队和设备露脸：饱和度高的实用色加硬边框，照片拍的是现场。' },
    onSite: true,
    label: '汽车与运输',
    en: 'auto & transport',
    words: ['auto', 'mechanic', 'detailing', 'tire', 'towing', 'moving', 'junk removal', 'storage',
      'trucking', 'freight', 'courier', 'logistics', 'warehouse'],
  },
  {
    key: 'industrial-safety',
    partner: { key: 'auto-transport', why: '机械与车辆同族：金属灰蓝加醒目强调色、几何感字形，页面重的是规格参数和资质。' },
    onSite: true,
    label: '工业与安防',
    en: 'industrial & safety',
    words: ['industrial', 'manufacturing', 'machining', 'welding', 'fabrication', 'equipment',
      'security', 'alarm', 'protection', 'fire', 'emergency', 'printing', 'signage'],
  },
  {
    key: 'tech-media',
    partner: { key: 'fitness-water', why: '都靠冲劲：暗底、荧光强调色、大字动感排版 —— 那批高饱和深色皮两边都穿得住。' },
    label: '科技与传媒',
    en: 'tech & media',
    words: ['tech', 'software', 'it', 'cyber', 'gaming', 'media', 'video', 'film', 'music',
      'marketing', 'social', 'agency', 'creative', 'design'],
  },
  {
    key: 'events',
    partner: { key: 'tech-media', why: '都是创意行当，页面按作品集排：整屏图、粗排版、强调色敢用，比传统门店放得开。' },
    label: '婚庆与活动',
    en: 'events & photography',
    words: ['event', 'wedding', 'party', 'photography', 'entertainment', 'nightlife', 'florist',
      'floral', 'planner', 'gallery', 'art', 'studio', 'branding'],
  },
  {
    key: 'retail-lifestyle',
    partner: { key: 'beauty', why: '都跟时尚同源：杂志式版面、细衬线标题、留白多，商品和妆造照片都要「摆得好看」。' },
    label: '零售与生活方式',
    en: 'retail & lifestyle',
    words: ['jewelry', 'watch', 'furniture', 'antique', 'vintage', 'tailor', 'travel', 'tour',
      'pool', 'portfolio', 'architect', 'architecture', 'engineering'],
  },
];

// ── 上门服务 vs 展示类（#1097）────────────────────────────────────────────────────────────────────
//
// Chris 2026-08-19 拍板：**跟着行业走** —— 上门服务类（水电 / 保洁 / 搬家 / 维修这一类）的站，第一屏
// 就要能留电话；展示类（餐厅 / 画廊 / 诊所介绍这一类）第一屏要照片，不给。判据用**上面这 16 组**，
// 不新造第二份行业词表 —— 所以这里只给 4 组加一个布尔标记，词表内容一个字都没动。
//
// 哪四组、凭什么（对照上面各组的 `words`，这里不重复抄词）：
//   home-trades       家装与施工 —— Chris 点名的水电 / 保洁 / 维修三个词都在这一组的词表里
//   auto-transport    汽车与运输 —— Chris 点名的搬家在这一组
//   green-outdoor     园艺与绿色 —— 同族上门活（庭院 / 树木）
//   industrial-safety 工业与安防 —— 同族上门活（安防安装 / 焊接 / 设备）
// 其余 12 组一律不给。律所 / 金融 / 房产这类「不上门但也靠联系成交」的**保守归进不给桶** ——
// Chris 原话只点了上门服务类，扩张要他另拍。
//
// 🔴 匹配按**词边界**，不许裸 `includes`。理由是量出来的，不是审美：拿两个桶的 212 个词跑两向，
//    裸 `includes` 会把不给桶的 `retirement`（金融与保险）判成「给」—— 它里面含着上门桶的 `tire`
//    （汽车与运输）。整份词表里这样的磁铁**有且只有这一个**，也就是说它的失败方向是「几乎全对，
//    偶尔把一个退休理财的站建成上门服务的样子」，靠抽查是抓不住的。换成按词边界之后：53 个上门词
//    全判「给」、159 个不给词零误判，两向例外清单都是空的（`scripts/lib/hero-lead-form.test.js` ①，
//    那一格还拿裸 includes 跑同一份夹具做尺子校准 —— 空的例外清单跟「夹具没有区分力」长得一样）。
//
// 🔴 #1115（2026-08-19）—— 挑哪套主题那条路**也换成词边界了**，用的就是下面这两个函数。
//    这段注释在 #1097 时写的是「那是另一件事，别顺手改它」，那句话现在是**假的**；它长在这两个
//    函数正上方，也就是下一个人最可能把它当成现状的位置，所以跟着改。
//    今天用这两个函数的一共四处，判据只有这一份：
//      · `isOnSiteIndustry()`（本文件，下面）              —— 这门生意算不算上门
//      · `sectorIndexForIndustry()`（本文件，下面）        —— 这段行业文字属于哪个行业组（#1119）
//      · `themes.js` 的 `candidateThemesForIndustry()`     —— 挑哪套主题（#1115）
//      · `theme-pipeline/coverage.js` 的「真命中」那一列   —— 覆盖度普查（#1115）
//    #1115 量到的：只改前两处、把 coverage 那一处留着裸 `includes`，会让同一张表出现 14 个
//    「真命中 > 候选池」的词 —— 而一套真声明了这个词的主题必然在它的候选池里，那是逻辑上不可能的读数。
//    `pool.test.js ⑩` 现在把这条不变量钉住了。
//
// 🔴 #1119 —— 上面第三处（挑哪套主题）的**射程缩小了**，这件事对读这段注释的人是承重的：
//    候选池现在分两条路（`themes.js` 的 candidateThemesForIndustry 头上有全文）——
//    认得出行业组的走【组成员】、不看 `industries`；认不出的才落回 `industries` 匹配。
//    而词表里这 212 个词**全都认得出组** ⟹ 那条 `industries` 匹配只剩自由文本走。
//    ⟹ 别再拿「某个词表里的词的候选池」去证明这两个函数还在挑主题那条路上生效：
//      那个读数按构造已经不说话了（`pool.test.js ⑩` 为此换了量的对象，见它自己那段注释）。
//    这两个函数**本身**没退役 —— 归组（`sectorIndexForIndustry`）用的就是它们，
//    所以「词表的词按词边界归组」这件事仍然由它们决定。

/** 行业文字 → 小写 token 序列。切法是「非字母数字都当分隔符」，所以 `walk-in` 和 `walk in` 同形。 */
function industryTokens(text) {
  return String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/** `tokens` 里有没有出现 `phrase` 这一串**连续** token（词表里有 `credit union` 这种双词条目）。 */
function hasPhrase(tokens, phrase) {
  const want = industryTokens(phrase);
  if (!want.length) return false;
  for (let i = 0; i + want.length <= tokens.length; i += 1) {
    let all = true;
    for (let j = 0; j < want.length; j += 1) {
      if (tokens[i + j] !== want[j]) { all = false; break; }
    }
    if (all) return true;
  }
  return false;
}

/** 打了 `onSite` 标记的那几组的词，摊平成一张表。 */
function onSiteWords() {
  return SECTORS.filter((s) => s.onSite).flatMap((s) => s.words);
}

/**
 * 这门生意算不算上门服务？
 *
 * 命中上面四组词表里**任何一个词**就算，不做多组仲裁（一段行业文字可能同时含着两组的词，而
 * 「更像哪一组」不是这里判得了的事；本函数只答一个是非题，多判一次的代价是首屏多个表单，
 * 少判一次的代价是上门生意收不到联系方式 —— 方向上宁可命中）。一组都没命中 ⟹ false。
 */
function isOnSiteIndustry(industry) {
  const tokens = industryTokens(industry);
  if (!tokens.length) return false;
  return onSiteWords().some((w) => hasPhrase(tokens, w));
}

// ── 组邻接：一个行业词该看哪些组的主题（#1119）────────────────────────────────────────────────────

/**
 * 这段行业文字属于哪个行业组？答一个下标；答不出来是 -1（老板自己填的自由文本多半如此，
 * `themes.js` 那边会落回原来的子串匹配 + 兜底）。
 *
 * 匹配用本文件那两个按词边界切的函数（`industryTokens` + `hasPhrase`），**不是** `themes.js` 里那个
 * 裸 `includes`。理由是量出来的：裸 `includes` 下 `fitness` / `title` / `security` 都含着 tech-media
 * 那个 `it`，于是健身房、律所、安防会被算成科技传媒（#1115 的题面）。
 *
 * 🔴 **只答一个组，不答一个集合** —— 这一条是承重的，不是图省事：如果候选池按「命中的每一组 +
 *    它们各自的 partner」取，那么 `interior design`（房产的词，同时含着 tech-media 的 `design`）
 *    会把 tech-media 那 5 套连同 tech-media 的 partner 一起拉进房产这一组的池子 ⟹ 那几套皮出现在
 *    3 个组的池子里，AC4 当场红。
 *
 * 多组同时命中时怎么裁（确定性，三级；`industry-sectors.test.js` ⑥ 把每一级都驱动过）：
 *   ① 命中的短语最长的那组赢 —— 长短语是更具体的一句话（`interior design` 比 `design` 具体）
 *   ② 还平就看命中了几个词（「wedding photography catering」里婚庆命中两个、餐饮一个）
 *   ③ 还平就取上面注册顺序靠前的那组（只为让结果可复算，不含产品含义）
 */
function sectorIndexForIndustry(industry) {
  const tokens = industryTokens(industry);
  if (!tokens.length) return -1;
  let best = -1;
  let bestPhrase = 0;
  let bestCount = 0;
  SECTORS.forEach((sector, i) => {
    let phrase = 0;
    let count = 0;
    for (const w of sector.words) {
      if (!hasPhrase(tokens, w)) continue;
      count += 1;
      const n = industryTokens(w).length;
      if (n > phrase) phrase = n;
    }
    if (!count) return;
    if (phrase > bestPhrase || (phrase === bestPhrase && count > bestCount)) {
      best = i; bestPhrase = phrase; bestCount = count;
    }
  });
  return best;
}

/** 第 `sectorIndex` 组借的是第几组。`partner.key` 写错了 ⟹ -1，这里不猜，让检查那一格去点名。 */
function partnerIndexOf(sectorIndex) {
  const s = SECTORS[sectorIndex];
  if (!s || !s.partner) return -1;
  return SECTORS.findIndex((x) => x.key === s.partner.key);
}

/**
 * 一套主题属于哪个行业组？判据是它的 `industries` 落在哪一组的词表里（`wordsForSlot` 让出的那一个
 * 词让它是真子集）。用包含关系而不是「它在 `theme-pool.json` 里排第几」，因为位置依赖 JSON 的键顺序
 * —— 那是生成器的副产物，重生成一次就可能换。今天两种算法给出的归属**逐套相同**（80/80），
 * `industry-sectors.test.js` ① 把这件事钉住。
 *
 * 归不进恰好一组 ⟹ -1：形状变了的时候不猜，那一格检查会把这些 id 点名（它们挑不到）。
 *
 * 📌 `sectors` 是参数而不是直接读 `SECTORS`：判据要能拿**故意造坏的组表**驱动一次，否则「组外 0 套」
 *    这个恒空的清单跟一张健康的表长得一模一样（`industry-sectors.test.js` ① 的反向对照第一版就是
 *    这么假绿的 —— 它传了第二个参数，而当时的实现不收，于是那条对照量的还是真表）。
 */
function sectorIndexOfTheme(theme, sectors = SECTORS) {
  const declared = (theme && theme.industries) || [];
  if (!declared.length) return -1;
  const hit = [];
  sectors.forEach((s, i) => { if (declared.every((w) => s.words.includes(w))) hit.push(i); });
  return hit.length === 1 ? hit[0] : -1;
}

/**
 * 把一池主题按行业组分好队。
 *   byIndex   下标 → 那一组的 id 清单，顺序 = 传进来那一池自己的键顺序（轮换要可预测）
 *   orphans   归不进任何一组的 id —— 它们**挑不到**（组邻接那条路只按组成员取），所以这个数得有人
 *             看着：`industry-sectors.test.js` ① 要求它是空的。
 */
function sectorThemeIds(pool, sectors = SECTORS) {
  const byIndex = sectors.map(() => []);
  const orphans = [];
  for (const id of Object.keys(pool || {})) {
    const i = sectorIndexOfTheme(pool[id], sectors);
    if (i < 0) orphans.push(id);
    else byIndex[i].push(id);
  }
  return { byIndex, orphans };
}

// 一组配几套主题。16 组 × 5 = 80 套。
const THEMES_PER_SECTOR = 5;

/**
 * 第 slot 套（0..4）在这一组里声明哪些词。
 *
 * 每套让出 `drop` 个词（按 slot 轮转，位置各不相同）—— 让出的目的只有一个：把「每套声明几个行业」的
 * 平均压到今天 30 套之下（12.97）。让位是轮转的，所以一个词最多被一套让掉 ⟹ 真命中恒 ≥ 4。
 * 组里有 14 个词时让 1 个、13 个词时也让 1 个 ⟹ 每套声明 12-13 个。
 */
function wordsForSlot(sector, slot) {
  const k = sector.words.length;
  const drop = 1;
  const dropped = new Set();
  for (let m = 0; m < drop; m += 1) dropped.add((slot * drop + m) % k);
  return sector.words.filter((_, i) => !dropped.has(i));
}

/** 80 个位子，按注册顺序：组 0 的 5 套、组 1 的 5 套…… 每个位子知道自己是哪一组、声明哪些词。 */
function poolSlots() {
  const out = [];
  SECTORS.forEach((sector, si) => {
    for (let slot = 0; slot < THEMES_PER_SECTOR; slot += 1) {
      out.push({
        index: out.length,
        sectorIndex: si,
        sectorKey: sector.key,
        sectorLabel: sector.label,
        sectorEn: sector.en,
        slot,
        industries: wordsForSlot(sector, slot),
      });
    }
  });
  return out;
}

// 🔴 只导出 `isOnSiteIndustry` 这一个新口子。切词和摊平那两个函数留在文件内：测试要的两个桶
// 直接从 `SECTORS` 按 `onSite` 标记自己摊（那是**独立的一条推导**），共用实现里那个 helper 反而
// 会让「实现和测试用同一把尺子」这件事多一处。
// 🔴 #1115 —— `industryTokens` / `hasPhrase` 导出来，是为了让上面那几处**共用同一份判据**。
//    别在调用方那边照着重写一份切词：本仓为「同一个判据两份实现」付过多次账，而这一族的失败方向
//    是静默的（两份实现分叉时，两个读数各自都像是对的）。
// 🔴 #1119 —— 这两个的消费者**不许再减**：`pool.test.js ⑩` 的第一臂就是拿它们直接量匹配器的
//    （组邻接把候选池与 `industries` 脱钩之后，那一臂是那 14 个词唯一还能被钉住的地方）。
module.exports = {
  SECTORS, THEMES_PER_SECTOR, wordsForSlot, poolSlots, isOnSiteIndustry, industryTokens, hasPhrase,
  // #1119 组邻接那条路要的四个（`themes.js` 的 candidateThemesForIndustry 是唯一调用方）
  sectorIndexForIndustry, partnerIndexOf, sectorIndexOfTheme, sectorThemeIds,
};
