// ══════════════════════════════════════════════════════════════════════════════════════════════════
// industry-sectors.js — 新主题池的行业词怎么分配（#1016）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 一套主题的 `industries` 是一句声明：「我这身皮是为这些生意做的」。建站时 `candidateThemesForIndustry()`
// 拿生意的行业文字去匹配它（判据是「行业文字包含这个词」），匹配到的那些主题组成候选池，再按站轮换。
//
// 🔴 这份表要同时满足两件互相拉扯的事，所以它不是随手写的清单：
//
//   ① 每个行业词至少 4 套主题真的写了它（#1016 AC2 的判据 —— `coverage.js --max-thin-pools 0
//      --max-thin-hits 0` 要返回 0，而 `thinPools` 数的是候选池恰好等于兜底下限 3 的词，
//      也就是真命中 ≤3 的词）。
//   ② 不许靠「给每套多塞十几个词」把 ① 凑绿。那样产品面零变化：多声明一个行业不等于为它做过皮。
//      判据是每套声明的行业数不许比今天 30 套更宽（今天 min 10 · 中位 12 · max 19 · 平均 12.97）。
//
// ⟹ 缺口只能靠**套数**补。做法是把 212 个行业词分成 16 个行业组，每组配 5 套主题；一套主题声明的
//    就是它那一组的词（少数几个按下面的轮转让位，把平均压到今天之下），于是每个词恒有 4-5 套真命中。
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
const SECTORS = [
  {
    key: 'legal-professional',
    label: '律所与专业服务',
    en: 'law & professional services',
    words: ['law', 'legal', 'corporate', 'consulting', 'accounting', 'tax', 'escrow', 'title',
      'trust', 'estate', 'auction', 'appraisal', 'surveying'],
  },
  {
    key: 'finance-insurance',
    label: '金融与保险',
    en: 'finance & insurance',
    words: ['finance', 'financial', 'bank', 'credit union', 'mortgage', 'broker', 'brokerage',
      'advisor', 'retirement', 'insurance', 'life insurance', 'underwriting', 'claims', 'benefits'],
  },
  {
    key: 'real-estate',
    label: '房产与物业',
    en: 'real estate & property',
    words: ['real estate', 'realty', 'realtor', 'property', 'penthouse', 'luxury', 'home staging',
      'interior design', 'concierge', 'rental', 'cottage', 'resort', 'hotel'],
  },
  {
    key: 'clinic',
    label: '诊所与医疗',
    en: 'clinics & medical',
    words: ['medical', 'clinic', 'dental', 'pharmacy', 'optometry', 'chiropractic', 'physio', 'lab',
      'nursing', 'pediatric', 'walk-in', 'health', 'veterinary'],
  },
  {
    key: 'wellness-care',
    label: '康养与照护',
    en: 'wellness & care',
    words: ['wellness', 'therapy', 'counseling', 'mental health', 'massage', 'yoga', 'naturopath',
      'herbal', 'senior care', 'home care', 'childcare', 'doula', 'natural'],
  },
  {
    key: 'beauty',
    label: '美业与形象',
    en: 'beauty & grooming',
    words: ['salon', 'spa', 'beauty', 'barber', 'nail', 'lashes', 'makeup', 'cosmetic', 'skincare',
      'tattoo', 'fashion', 'boutique', 'menswear'],
  },
  {
    key: 'dining',
    label: '餐饮与酒水',
    en: 'restaurants & drink',
    words: ['restaurant', 'food', 'bistro', 'fine dining', 'pizza', 'mexican', 'mediterranean',
      'catering', 'brewery', 'whisky', 'wine', 'winery', 'market', 'smokehouse'],
  },
  {
    key: 'artisan-food',
    label: '烘焙与手作',
    en: 'bakery & artisan makers',
    words: ['bakery', 'cafe', 'coffee', 'cake', 'tea', 'roaster', 'butcher', 'craft', 'pottery',
      'ceramics', 'woodwork', 'forge', 'leather'],
  },
  {
    key: 'fitness-water',
    label: '健身与水上',
    en: 'fitness & water sports',
    words: ['fitness', 'gym', 'sports', 'boxing', 'martial arts', 'dance', 'skate', 'surf', 'diving',
      'fishing', 'boat', 'marine', 'yacht'],
  },
  {
    key: 'home-trades',
    onSite: true,
    label: '家装与施工',
    en: 'home trades & building',
    words: ['construction', 'contractor', 'roofing', 'plumbing', 'hvac', 'electrical', 'renovation',
      'handyman', 'painting', 'tile', 'concrete', 'scaffolding', 'excavation', 'cleaning'],
  },
  {
    key: 'green-outdoor',
    onSite: true,
    label: '园艺与绿色',
    en: 'landscaping & green',
    words: ['landscaping', 'garden', 'tree', 'farm', 'agriculture', 'organic', 'eco', 'environment',
      'sustainable', 'solar', 'hemp', 'cannabis', 'pest'],
  },
  {
    key: 'auto-transport',
    onSite: true,
    label: '汽车与运输',
    en: 'auto & transport',
    words: ['auto', 'mechanic', 'detailing', 'tire', 'towing', 'moving', 'junk removal', 'storage',
      'trucking', 'freight', 'courier', 'logistics', 'warehouse'],
  },
  {
    key: 'industrial-safety',
    onSite: true,
    label: '工业与安防',
    en: 'industrial & safety',
    words: ['industrial', 'manufacturing', 'machining', 'welding', 'fabrication', 'equipment',
      'security', 'alarm', 'protection', 'fire', 'emergency', 'printing', 'signage'],
  },
  {
    key: 'tech-media',
    label: '科技与传媒',
    en: 'tech & media',
    words: ['tech', 'software', 'it', 'cyber', 'gaming', 'media', 'video', 'film', 'music',
      'marketing', 'social', 'agency', 'creative', 'design'],
  },
  {
    key: 'events',
    label: '婚庆与活动',
    en: 'events & photography',
    words: ['event', 'wedding', 'party', 'photography', 'entertainment', 'nightlife', 'florist',
      'floral', 'planner', 'gallery', 'art', 'studio', 'branding'],
  },
  {
    key: 'retail-lifestyle',
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
//    今天用这两个函数的一共三处，判据只有这一份：
//      · `isOnSiteIndustry()`（本文件，下面）              —— 这门生意算不算上门
//      · `themes.js` 的 `candidateThemesForIndustry()`     —— 挑哪套主题（#1115）
//      · `theme-pipeline/coverage.js` 的「真命中」那一列   —— 覆盖度普查（#1115）
//    #1115 量到的：只改前两处、把 coverage 那一处留着裸 `includes`，会让同一张表出现 14 个
//    「真命中 > 候选池」的词 —— 而一套真声明了这个词的主题必然在它的候选池里，那是逻辑上不可能的读数。
//    `pool.test.js ⑩` 现在把这条不变量钉住了。

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
// 🔴 #1115 —— `industryTokens` / `hasPhrase` 导出来，是为了让上面那三处**共用同一份判据**。
//    别在调用方那边照着重写一份切词：本仓为「同一个判据两份实现」付过多次账，而这一族的失败方向
//    是静默的（两份实现分叉时，两个读数各自都像是对的）。
module.exports = {
  SECTORS, THEMES_PER_SECTOR, wordsForSlot, poolSlots, isOnSiteIndustry, industryTokens, hasPhrase,
};
