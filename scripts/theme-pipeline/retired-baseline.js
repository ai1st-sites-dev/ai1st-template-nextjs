// ══════════════════════════════════════════════════════════════════════════════════════════════════
// retired-baseline.js — 已下架那 30 套留下的三个数，冻结在这里（#1161，2026-08-23）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 🔴 这不是「又一份注册表」。它是三个**历史读数**：#1016 换池子那一轮，用来证明「新池不比旧池窄」
// 的那个基线。基线本身住在 `themes-retired.js` 的 `industries` 字段里，而 #1161 把那些字段删了
// （已下架那 30 套只留 id / 名字 / 配色）—— 所以量它的那三格测试要么跟着死，要么把基线冻下来。
// 冻下来是对的：它守的性质「今天匹配得上的生意，明天不许掉进兜底」跟那 30 套还在不在没有关系。
//
// 谁在用它：`theme-pipeline/pool.test.js` 的 ② ③ ④ 三格。
//
// 🔴 怎么复算（别照抄任何地方写着的数，自己跑一次）—— 把下面这段存成一个文件再 node 它：
//
//     const {execSync} = require('child_process'), fs = require('fs');
//     fs.writeFileSync('/tmp/r.js',
//       execSync('git show c8d5dcd7:templates/nextjs/scripts/themes-retired.js', {maxBuffer: 1e8}));
//     const old = require('/tmp/r.js').retiredThemes;
//     const {industryTokens, hasPhrase} = require('./scripts/theme-pipeline/industry-sectors.js');
//     const ids = Object.keys(old);
//     const vocab = [...new Set(ids.flatMap((id) => old[id].industries || []))].sort();
//     const stat = (a) => { const s = [...a].sort((x, y) => x - y); return {
//       min: s[0], med: s[Math.floor(s.length / 2)], max: s[s.length - 1],
//       avg: +(s.reduce((x, y) => x + y, 0) / s.length).toFixed(4) }; };
//     console.log(vocab.length,
//       JSON.stringify(stat(ids.map((id) => (old[id].industries || []).length))),
//       JSON.stringify(stat(ids.map((id) => vocab.filter((w) =>
//         (old[id].industries || []).some((kw) => hasPhrase(industryTokens(w), kw))).length))));
//
//   c8d5dcd7 是 #1161 交付前 origin/main 的那一版，也就是这份数据最后活着的那个 commit。
//
// 📌 RETIRED_HIT_STAT 用的是生产那条匹配（`hasPhrase` + 词边界，#1115），不是裸 `includes` ——
//    跟 pool.test.js ③ 里量新池那一边用的是同一个函数，两边口径必须一样。

/** 那 30 套一共声明过多少个不重复的行业词（排过序，好 diff）。 */
const RETIRED_INDUSTRY_WORDS = [
  "accounting", "advisor", "agency", "agriculture", "alarm", "antique",
  "appraisal", "architect", "architecture", "art", "auction", "auto",
  "bakery", "bank", "barber", "beauty", "benefits", "bistro",
  "boat", "boutique", "boxing", "branding", "brewery", "broker",
  "brokerage", "butcher", "cafe", "cake", "cannabis", "catering",
  "ceramics", "childcare", "chiropractic", "claims", "cleaning", "clinic",
  "coffee", "concierge", "concrete", "construction", "consulting", "contractor",
  "corporate", "cosmetic", "cottage", "counseling", "courier", "craft",
  "creative", "credit union", "cyber", "dance", "dental", "design",
  "detailing", "diving", "doula", "eco", "electrical", "emergency",
  "engineering", "entertainment", "environment", "equipment", "escrow", "estate",
  "event", "excavation", "fabrication", "farm", "fashion", "film",
  "finance", "financial", "fine dining", "fire", "fishing", "fitness",
  "floral", "florist", "food", "forge", "freight", "furniture",
  "gallery", "gaming", "garden", "gym", "handyman", "health",
  "hemp", "herbal", "home care", "home staging", "hotel", "hvac",
  "industrial", "insurance", "interior design", "it", "jewelry", "junk removal",
  "lab", "landscaping", "lashes", "law", "leather", "legal",
  "life insurance", "logistics", "luxury", "machining", "makeup", "manufacturing",
  "marine", "market", "marketing", "martial arts", "massage", "mechanic",
  "media", "medical", "mediterranean", "menswear", "mental health", "mexican",
  "mortgage", "moving", "music", "nail", "natural", "naturopath",
  "nightlife", "nursing", "optometry", "organic", "painting", "party",
  "pediatric", "penthouse", "pest", "pharmacy", "photography", "physio",
  "pizza", "planner", "plumbing", "pool", "portfolio", "pottery",
  "printing", "property", "protection", "real estate", "realtor", "realty",
  "renovation", "rental", "resort", "restaurant", "retirement", "roaster",
  "roofing", "salon", "scaffolding", "security", "senior care", "signage",
  "skate", "skincare", "smokehouse", "social", "software", "solar",
  "spa", "sports", "storage", "studio", "surf", "surveying",
  "sustainable", "tailor", "tattoo", "tax", "tea", "tech",
  "therapy", "tile", "tire", "title", "tour", "towing",
  "travel", "tree", "trucking", "trust", "underwriting", "veterinary",
  "video", "vintage", "walk-in", "warehouse", "watch", "wedding",
  "welding", "wellness", "whisky", "wine", "winery", "woodwork",
  "yacht", "yoga",
];

/** 每套声明了几个行业词。 */
const RETIRED_DECL_STAT = {"min":10,"med":12,"max":19,"avg":12.9667};

/** 每套能真命中几个行业词（词表 = 上面那 212 个）。 */
const RETIRED_HIT_STAT = {"min":10,"med":12,"max":20,"avg":13.3};

module.exports = { RETIRED_INDUSTRY_WORDS, RETIRED_DECL_STAT, RETIRED_HIT_STAT };
