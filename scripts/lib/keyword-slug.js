// #1550 —— 关键词页的 slug：由代码从目标词生成，转写而不是删除（设计文档 S2「URL slug」那一行）。
//
// 🔴 **转写走仓内自带的映射表，不加任何依赖**（正文做什么 4）：改 `package.json` / lock 会让每次建站多一次完整
//    `npm install`（`worker/entrypoint.sh` 按 lock 逐字比缓存），直到 worker 镜像重发。覆盖四类文字：
//    · 拉丁字母带音标的：Unicode 分解（NFKD）后去掉附加符号；分解不了的几个字母（ı ß ø æ œ ł đ ð þ …）走下面那张小表
//    · 西里尔字母：俄 / 乌 / 白俄 / 塞尔维亚 / 马其顿常用字母，取英语世界通行的写法（Москва → moskva）
//    · 希腊字母：一字一对（带重音的先分解再查）
//    · 汉字：`pinyin-table.js`（Unicode Unihan 的 kMandarin，许可证与来源写在那份文件头），一字一段：剪头发 → jian-tou-fa
// 🔴 **表里没有的文字（假名、韩文、阿拉伯文等）不静默删**：整个 slug 退成 `kw-<序号>`，由调用方在建站结果里按词列出。
//    删掉会得到空串或半截（`déboucheur` 以前得到 `d-boucheur`，中文以前得到空串）——那正是本票要治的病。
'use strict';

const PINYIN = require('./pinyin-table');

/** 汉字 → 拼音（不带声调）。表按音节存，这里第一次用时翻成按字查。 */
let hanIndex = null;
function pinyinOf(ch) {
  if (!hanIndex) {
    hanIndex = new Map();
    for (const [syl, chars] of Object.entries(PINYIN)) for (const c of chars) if (!hanIndex.has(c)) hanIndex.set(c, syl);
  }
  return hanIndex.get(ch) || null;
}

// 拉丁字母里 NFKD 分解不了的那些（小写；先整体转小写再查）。
const LATIN_EXTRA = {
  'ı': 'i', 'ß': 'ss', 'ø': 'o', 'æ': 'ae', 'œ': 'oe', 'ł': 'l', 'đ': 'd', 'ð': 'd', 'þ': 'th',
  'ħ': 'h', 'ŧ': 't', 'ŀ': 'l', 'ĸ': 'k', 'ŋ': 'ng', 'ſ': 's', 'ƒ': 'f', 'ı̇': 'i',
};

const CYRILLIC = {
  'а': 'a', 'б': 'b', 'в': 'v', 'г': 'g', 'д': 'd', 'е': 'e', 'ё': 'e', 'ж': 'zh', 'з': 'z', 'и': 'i', 'й': 'y',
  'к': 'k', 'л': 'l', 'м': 'm', 'н': 'n', 'о': 'o', 'п': 'p', 'р': 'r', 'с': 's', 'т': 't', 'у': 'u', 'ф': 'f',
  'х': 'kh', 'ц': 'ts', 'ч': 'ch', 'ш': 'sh', 'щ': 'shch', 'ъ': '', 'ы': 'y', 'ь': '', 'э': 'e', 'ю': 'yu', 'я': 'ya',
  // 乌克兰 / 白俄
  'є': 'ye', 'і': 'i', 'ї': 'yi', 'ґ': 'g', 'ў': 'u',
  // 塞尔维亚 / 马其顿
  'ђ': 'dj', 'ј': 'j', 'љ': 'lj', 'њ': 'nj', 'ћ': 'c', 'џ': 'dz', 'ѓ': 'gj', 'ќ': 'kj', 'ѕ': 'dz',
};

const GREEK = {
  'α': 'a', 'β': 'v', 'γ': 'g', 'δ': 'd', 'ε': 'e', 'ζ': 'z', 'η': 'i', 'θ': 'th', 'ι': 'i', 'κ': 'k', 'λ': 'l',
  'μ': 'm', 'ν': 'n', 'ξ': 'x', 'ο': 'o', 'π': 'p', 'ρ': 'r', 'σ': 's', 'ς': 's', 'τ': 't', 'υ': 'y', 'φ': 'f',
  'χ': 'ch', 'ψ': 'ps', 'ω': 'o',
};

const HAN = /\p{Script=Han}/u;

// ── 长度上限（#1563）─────────────────────────────────────────────────────────────────────────────────
// slug 会原样变成文件名的一段。一页落盘时按页名取名的全部东西（Next 16.2.2 真建过的站上现读）：
//   · 站配置              `site/<locale>/pages/<slug>.json`
//   · 导出 out/           `<slug>.html` · `<slug>.txt` · 裸的 `<slug>/` 目录
//   · next build 的 .next/server/app/（导出之前、构建中途就建）：`<slug>.html` · `<slug>.rsc` · `<slug>.meta` ·
//     `<slug>.segments/` 目录 —— 后缀出自 next/dist/export/routes/app-page.js 的 RSC_SUFFIX / NEXT_META_SUFFIX /
//     RSC_SEGMENTS_DIR_SUFFIX。`.segments/` 里面的文件名是固定的（`_full.segment.rsc`、`$c$slug/__PAGE__.segment.rsc`），不带 slug。
// 服务 id 走同一个函数，落成 `services/<id>.json` 和 `services/<id>/`。哪一个超过单个文件名上限，写盘就抛 ENAMETOOLONG，
// 整站建站失败 —— 63 个汉字转出来就有 251 字节。
// 🔴 上限是推出来的：这里只写「单个文件名能有多长」和后缀清单，SLUG_MAX_BYTES 由它们算。
//    r1 只看了 out/，漏了 `.segments`（9 字节）⟹ 上限算成 250，247~250 字节的 slug 在 next build 那一步照样崩（QA2 实测）。
//    `keyword-slug.test.js` 从 Next 自己的常量取这三种后缀，对不上清单就红；重新现读：
//      find .next out -name '<某个页名>*' | awk -F/ '{n=$NF; sub(/^<某个页名>/,"",n); print n}' | sort -u
const FILENAME_MAX_BYTES = 255;   // ext4 / xfs / btrfs 的 NAME_MAX
const PAGE_FILE_SUFFIXES = ['.json', '.html', '.txt', '.rsc', '.meta', '.segments', ''];
const SLUG_MAX_BYTES = FILENAME_MAX_BYTES - Math.max(...PAGE_FILE_SUFFIXES.map((x) => Buffer.byteLength(x)));

/** 收到 max 字节以内：在连字符处截（不切半个词 / 半个拼音），整段只有一个词时才硬截。slug 只含 a-z0-9-，字符数 = 字节数。 */
function fitSlug(slug, max = SLUG_MAX_BYTES) {
  if (slug.length <= max) return slug;
  const cut = slug.slice(0, max);
  const atWord = slug[max] === '-' ? cut : (cut.slice(0, Math.max(cut.lastIndexOf('-'), 0)) || cut);
  return atWord.replace(/-+$/, '');
}

/** 站内去重的第 n 个（-2、-3 …）：后缀算在上限里，先给它让出位置再接上。 */
function withDedupSuffix(stem, n) {
  const tail = `-${n}`;
  return `${fitSlug(stem, SLUG_MAX_BYTES - tail.length)}${tail}`;
}

/**
 * 一段文字 → 只含 a-z0-9 的转写串（词与词之间是空格，调用方再收成连字符）。
 * 有一个字母转写不了 ⟹ 回 null（整段不要，交给 `kw-<序号>`）。
 */
function transliterate(text) {
  const s = String(text || '').toLowerCase();
  let out = '';
  for (const raw of s) {
    if (/[a-z0-9]/.test(raw)) { out += raw; continue; }
    // 单独出现的附加符号（土耳其语 `İ` 转小写后是「i + 上点」两个码位）：丢掉，不当分隔。
    if (/\p{M}/u.test(raw)) continue;
    if (HAN.test(raw)) {
      const py = pinyinOf(raw);
      if (!py) return null;
      out += ` ${py} `;
      continue;
    }
    if (LATIN_EXTRA[raw] !== undefined) { out += LATIN_EXTRA[raw]; continue; }
    if (CYRILLIC[raw] !== undefined) { out += CYRILLIC[raw]; continue; }
    // NFKD：带音标的拉丁 / 希腊字母分解成「字母 + 附加符号」，全角字母分解成半角。
    const base = raw.normalize('NFKD').replace(/\p{M}/gu, '');
    if (base !== raw && base) {
      let piece = '';
      for (const c of base) {
        if (/[a-z0-9]/.test(c)) piece += c;
        else if (GREEK[c] !== undefined) piece += GREEK[c];
        else if (LATIN_EXTRA[c] !== undefined) piece += LATIN_EXTRA[c];
        else if (/[\p{L}\p{N}]/u.test(c)) return null;
        else piece += ' ';
      }
      out += piece;
      continue;
    }
    if (GREEK[raw] !== undefined) { out += GREEK[raw]; continue; }
    if (/[\p{L}\p{N}]/u.test(raw)) return null;   // 表里没有的字母 / 数字（假名、韩文、阿拉伯文 …）
    out += ' ';                                    // 空格、标点、符号：只当分隔
  }
  return out;
}

/** 目标词 → slug（不超过 SLUG_MAX_BYTES）；转写不了或转出来是空串 ⟹ null。 */
function keywordSlug(keyword) {
  const t = transliterate(keyword);
  if (t === null) return null;
  const slug = t.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug ? fitSlug(slug) : null;
}

/**
 * 一个站的全部关键词 → 各自的 slug，按给的顺序。
 *   · 转写不了的 ⟹ `kw-<序号>`（序号 = 它在这份清单里的位置，从 1 起），`fallback: true`
 *   · 站内重复（不分服务）⟹ 第二个起依次加 `-2`、`-3`（截断之后才去重，带后缀的那个也不超过上限）
 * @param {string[]} keywords
 * @returns {{ keyword: string, slug: string, fallback: boolean }[]}
 */
function assignKeywordSlugs(keywords) {
  const taken = new Set();
  return (Array.isArray(keywords) ? keywords : []).map((keyword, i) => {
    const base = keywordSlug(keyword);
    const fallback = base === null;
    const stem = fallback ? `kw-${i + 1}` : base;
    let slug = stem;
    for (let n = 2; taken.has(slug); n += 1) slug = withDedupSuffix(stem, n);
    taken.add(slug);
    return { keyword, slug, fallback };
  });
}

module.exports = { transliterate, keywordSlug, assignKeywordSlugs, withDedupSuffix, SLUG_MAX_BYTES, PAGE_FILE_SUFFIXES, FILENAME_MAX_BYTES };
