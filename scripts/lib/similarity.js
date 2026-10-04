// #1550 —— 两段正文有多像：连续 5 个词一片（shingle），两边共有的片数 ÷ 片数少的那一边。
//
// 🔴 **只记录，不设阈值、不重写、不丢页**（正文做什么 3 / 不做）：没有数据之前不设门槛。建站结果每个关键词页一行
//    「最像哪页、多少」，以后拿真站的数来定线。
// 🔴 **没有空格分词的文字（中文、日文等）按单字算，5 个字一片**：不这么做的话，一句中文整句是一个「词」，
//    整篇凑不出 5 个词，相似度恒为 0 ——「换个地名」的两页看起来完全不同，这把尺子就瞎了。
//    拉丁字母、数字按词（转小写、去掉标点）；同一段里两种混着写也行，各按各的切。
// 📌 分母取片数少的那一边（不是 Jaccard 的并集）：一页是另一页的子集时应该读成「很像」；而「换地名」的两页长度
//    几乎一样，这时它跟 Dice 系数一致。
'use strict';

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]/u;

/** 正文 → 词序列。中日韩泰一字一词，其余按连续的字母数字切。 */
function tokens(text) {
  const out = [];
  let word = '';
  const flush = () => { if (word) { out.push(word); word = ''; } };
  for (const ch of String(text || '').normalize('NFKC').toLowerCase()) {
    if (CJK.test(ch)) { flush(); out.push(ch); continue; }
    if (/[\p{L}\p{N}]/u.test(ch)) { word += ch; continue; }
    if (/\p{M}/u.test(ch)) { word += ch; continue; }
    flush();
  }
  flush();
  return out;
}

/** 词序列 → 5 词片的集合。不足 5 个词时整段算一片（空正文是空集合）。 */
function shingles(text, size = 5) {
  const t = tokens(text);
  const set = new Set();
  if (t.length === 0) return set;
  if (t.length < size) { set.add(t.join(' ')); return set; }
  for (let i = 0; i + size <= t.length; i += 1) set.add(t.slice(i, i + size).join(' '));
  return set;
}

/** 0–1：两边共有的片 ÷ 片数少的那一边。任一边为空 ⟹ 0。 */
function similarity(a, b) {
  const A = a instanceof Set ? a : shingles(a);
  const B = b instanceof Set ? b : shingles(b);
  if (A.size === 0 || B.size === 0) return 0;
  const [small, large] = A.size <= B.size ? [A, B] : [B, A];
  let common = 0;
  for (const s of small) if (large.has(s)) common += 1;
  return common / small.size;
}

/**
 * 一页的可读正文：按块的书写顺序，把 data 里所有字符串收起来（跳过链接、图片地址、旋钮、颜色这类不是正文的东西）。
 * 两种页面形状都认（`sections` / `blocks`）。
 */
function pageText(page) {
  const blocks = (page && (page.sections || page.blocks)) || [];
  const out = [];
  const SKIP = new Set(['href', 'imageUrl', 'icon', 'options', 'bg', 'id', 'source', 'under', 'style', 'kind']);
  const walk = (v, key) => {
    if (SKIP.has(key)) return;
    if (typeof v === 'string') { if (!/^(https?:|\/|#|mailto:|tel:)/.test(v.trim())) out.push(v); return; }
    if (Array.isArray(v)) { for (const x of v) walk(x, ''); return; }
    if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  for (const b of Array.isArray(blocks) ? blocks : []) if (b && b.data) walk(b.data, '');
  return out.join('\n');
}

/**
 * 每个新页 vs 同站已有页（含先生成的其它新页），各取最像的那一页。
 * @param {object[]} newPages
 * @param {object[]} existingPages  站上已有的页（不含 newPages 自己）
 * @returns {{ slug: string, mostSimilar: string|null, score: number }[]} score 保留两位小数
 */
function mostSimilarPages(newPages, existingPages) {
  const pool = [...(existingPages || []), ...(newPages || [])]
    .filter((p) => p && typeof p.slug === 'string')
    .map((p) => ({ slug: p.slug, sh: shingles(pageText(p)) }));
  return (newPages || []).filter((p) => p && typeof p.slug === 'string').map((p) => {
    const me = pool.find((x) => x.slug === p.slug);
    let best = null;
    let score = 0;
    for (const other of pool) {
      if (other.slug === p.slug) continue;
      const s = similarity(me.sh, other.sh);
      if (best === null || s > score) { best = other.slug; score = s; }
    }
    return { slug: p.slug, mostSimilar: best, score: Math.round(score * 100) / 100 };
  });
}

module.exports = { tokens, shingles, similarity, pageText, mostSimilarPages };
