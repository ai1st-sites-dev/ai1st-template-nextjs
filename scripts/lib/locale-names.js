'use strict';
// #1999 —— 建站（create-site.js）和建站之后再加一种语言（lib/add-locale.js）共用的三样：语言代码 → 提示词里的英文名、
// 中文简繁那一句提醒、seo.json 的 `locale`。原来写在 create-site.js 里（那份文件跑起来就是 main，不能 require），搬到这里
// 两边各取一份，一个字没改。

// TICKET-169: 'zh' stays Simplified Chinese (historic default, preserves
// existing sites). 'zh-tw' is the new Traditional Chinese variant — maps to
// languageName 'Traditional Chinese' so downstream prompt builder can detect
// and add Simplified-vs-Traditional disambiguation hint.
const LANGUAGE_NAMES = {
  'en': 'English', 'zh': 'Chinese', 'zh-tw': 'Traditional Chinese', 'fr': 'French', 'es': 'Spanish',
  'ja': 'Japanese', 'ko': 'Korean', 'de': 'German', 'it': 'Italian',
  'pt': 'Portuguese', 'ru': 'Russian', 'vi': 'Vietnamese', 'ar': 'Arabic',
  'hi': 'Hindi', 'th': 'Thai',
};

// TICKET-169: returns a sentence-level prompt addendum the AI uses to pick the
// right Chinese character variant. The root cause of "user picks Chinese →
// site comes back Traditional sometimes" was that the LANGUAGE instruction
// just said "Write in Chinese" — Claude flipped a coin. This pins it.
function chineseVariantHint(languageName) {
  if (!languageName) return '';
  const n = languageName.toLowerCase();
  if (n === 'traditional chinese' || n === 'taiwanese' || n === 'cantonese') {
    return ' Use Traditional Chinese characters (Taiwan / Hong Kong convention, 繁體). Do NOT use Simplified Chinese characters anywhere.';
  }
  if (n === 'chinese' || n === 'mandarin' || n === 'simplified chinese') {
    return ' Use Simplified Chinese characters (mainland China convention, 简体). Do NOT use Traditional Chinese characters anywhere.';
  }
  return '';
}

// Map ISO code → BCP-47-style locale string for seo.locale (e.g. zh → zh_CN, fr → fr_CA).
// Defaults pick the most common variant per locale; can be overridden later.
function localeMapForBcp47(iso) {
  const map = {
    // TICKET-169: 'zh' (Simplified) and 'zh-tw' (Traditional) map to canonical
    // BCP-47 region-suffixed forms used in hreflang / JsonLd inLanguage.
    en: 'en_CA', zh: 'zh_CN', 'zh-tw': 'zh_TW', fr: 'fr_CA', es: 'es_MX', ja: 'ja_JP',
    ko: 'ko_KR', de: 'de_DE', it: 'it_IT', pt: 'pt_BR', ru: 'ru_RU',
    vi: 'vi_VN', ar: 'ar_SA', hi: 'hi_IN', th: 'th_TH',
  };
  return map[iso] || `${iso}_${iso.toUpperCase()}`;
}

module.exports = { LANGUAGE_NAMES, chineseVariantHint, localeMapForBcp47 };
