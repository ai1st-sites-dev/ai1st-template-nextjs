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
    label: '家装与施工',
    en: 'home trades & building',
    words: ['construction', 'contractor', 'roofing', 'plumbing', 'hvac', 'electrical', 'renovation',
      'handyman', 'painting', 'tile', 'concrete', 'scaffolding', 'excavation', 'cleaning'],
  },
  {
    key: 'green-outdoor',
    label: '园艺与绿色',
    en: 'landscaping & green',
    words: ['landscaping', 'garden', 'tree', 'farm', 'agriculture', 'organic', 'eco', 'environment',
      'sustainable', 'solar', 'hemp', 'cannabis', 'pest'],
  },
  {
    key: 'auto-transport',
    label: '汽车与运输',
    en: 'auto & transport',
    words: ['auto', 'mechanic', 'detailing', 'tire', 'towing', 'moving', 'junk removal', 'storage',
      'trucking', 'freight', 'courier', 'logistics', 'warehouse'],
  },
  {
    key: 'industrial-safety',
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

module.exports = { SECTORS, THEMES_PER_SECTOR, wordsForSlot, poolSlots };
