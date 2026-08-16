#!/usr/bin/env node
/**
 * homepage-fingerprint.js — 量「一批站的首页骨架有多像」。
 *
 * 用法:
 *   node scripts/homepage-fingerprint.js <站目录> [<站目录> …]
 *   node scripts/homepage-fingerprint.js --json <站目录> …      # 只打 JSON,给别的脚本吃
 *
 * 「站目录」= 一个站仓库的根(里面有 site/),或者直接就是那个 site/ 目录。
 *
 * 🔴 射程:**只看首页,种类和顺序都看**(#1034 AC6)。子页面不在射程内 —— 这句话印在每次输出的
 *    抬头上,不是只写在票上,免得下一个人拿它的读数去回答别的问题。
 *
 * 🔴 两种形状都认(#998):新站的页面 JSON 是 `blocks`,#998 之前建的站磁盘上仍是 `sections`。
 *    本脚本量的是**块 type 的有序列表**,而 #998 那次迁移是 1:1 的映射(`scripts/blocks.js` 的
 *    `pageWithBlocks` 只补 id / role / region / weight,不增删也不重排块)—— 所以两代生成器建的站
 *    在这个量上可比。这条是 #1034 AC1 要求「开跑之前写下来」的那个跨代决定,判据见 verify-blocks-1to1
 *    那一段(`node scripts/homepage-fingerprint.js --selftest`)。
 *
 * ── 三种统计量,一个都不省(#1034,PM 2026-08-15 量的)───────────────────────────────────────────
 * 「前 N 块相同的比例」至少有三种读法,在同一份语料上给出的数完全不同(前 4 块:13% / 33% / 67%):
 *   pairwise  两两站对里开头 N 块逐字相同的比例      ← 本票的**主判据**(spec §6 的原话就是「随机取
 *                                                     N 个站比首页序列」,PM 表里那个 13% 也是它)
 *   maxgroup  最大的「开头 N 块相同」那一组 ÷ 站数
 *   anytwin   至少跟另一个站撞了开头 N 块的站 ÷ 站数
 * 三个都打出来,读的人自己挑,但**别在跑完之后才挑**。
 */

const fs = require('fs');
const path = require('path');

// ── 读一个站的首页块序列 ────────────────────────────────────────────────────────────────────────
/** 站目录 → 它的 site/ 目录(传根也行、直接传 site/ 也行);找不到返回 null。 */
function siteRootOf(dir) {
  if (fs.existsSync(path.join(dir, 'site_meta.json'))) return dir;
  const nested = path.join(dir, 'site');
  if (fs.existsSync(path.join(nested, 'site_meta.json'))) return nested;
  // 单语言老形状:site/ 下直接是 pages/
  if (fs.existsSync(path.join(nested, 'pages'))) return nested;
  if (fs.existsSync(path.join(dir, 'pages'))) return dir;
  return null;
}

/** 首页 JSON 的路径。多语言站取 site_meta.json 里的 defaultLocale,老的单语言站就在 pages/ 下。 */
function homePathOf(siteRoot) {
  const metaPath = path.join(siteRoot, 'site_meta.json');
  if (fs.existsSync(metaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      if (meta.defaultLocale) {
        const p = path.join(siteRoot, meta.defaultLocale, 'pages', 'home.json');
        if (fs.existsSync(p)) return p;
      }
    } catch { /* 落到下面那条 */ }
  }
  const flat = path.join(siteRoot, 'pages', 'home.json');
  return fs.existsSync(flat) ? flat : null;
}

/** 一页里的块 —— 两种形状都认(#998)。跟 lib/block-manifest.js 的 blocksOf 同一条纪律。 */
function blocksOf(page) {
  if (!page) return [];
  if (Array.isArray(page.blocks)) return page.blocks;
  if (Array.isArray(page.sections)) return page.sections;
  return [];
}

/** 站目录 → { name, seq: [type…] };读不到就 throw(读不到 ≠ 空序列,别把它算进分母)。 */
function readSite(dir) {
  const root = siteRootOf(dir);
  if (!root) throw new Error(`${dir}: 找不到 site_meta.json 也找不到 pages/ —— 这不是一个站目录`);
  const home = homePathOf(root);
  if (!home) throw new Error(`${dir}: 找不到首页 JSON(home.json)`);
  const page = JSON.parse(fs.readFileSync(home, 'utf8'));
  const seq = blocksOf(page).map((b) => b.type);
  if (!seq.length) throw new Error(`${dir}: 首页一个块都没有 —— 读到的是 ${home}`);
  return { name: path.basename(path.resolve(dir)), home, seq };
}

// ── 四个数 ──────────────────────────────────────────────────────────────────────────────────────
function pairsOf(n) {
  const out = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) out.push([i, j]);
  return out;
}

function samePrefix(a, b, n) {
  if (a.length < n || b.length < n) return false;
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return false;
  return true;
}

function jaccard(a, b) {
  const A = new Set(a); const B = new Set(b);
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}

function median(xs) {
  if (!xs.length) return 0;
  const s = [...xs].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** 前 N 块相同 —— 三种统计量一起算。 */
function prefixStats(sites, n) {
  const seqs = sites.map((s) => s.seq);
  const pairs = pairsOf(seqs.length);
  const hit = pairs.filter(([i, j]) => samePrefix(seqs[i], seqs[j], n));
  // maxgroup / anytwin:按「开头 N 块」这个 key 分组
  const groups = new Map();
  for (const s of seqs) {
    if (s.length < n) continue;
    const key = s.slice(0, n).join(' → ');
    groups.set(key, (groups.get(key) || 0) + 1);
  }
  const biggest = Math.max(0, ...groups.values());
  const twinned = [...groups.values()].filter((c) => c > 1).reduce((a, c) => a + c, 0);
  return {
    pairwise: { hit: hit.length, of: pairs.length, pct: pairs.length ? hit.length / pairs.length : 0 },
    maxgroup: { hit: biggest, of: seqs.length, pct: seqs.length ? biggest / seqs.length : 0 },
    anytwin: { hit: twinned, of: seqs.length, pct: seqs.length ? twinned / seqs.length : 0 },
    groups: [...groups.entries()].sort((a, b) => b[1] - a[1]),
  };
}

function measure(sites) {
  const seqs = sites.map((s) => s.seq);
  const pairs = pairsOf(seqs.length);
  const jac = pairs.map(([i, j]) => jaccard(seqs[i], seqs[j]));
  return {
    n: sites.length,
    pairs: pairs.length,
    prefix2: prefixStats(sites, 2),
    prefix3: prefixStats(sites, 3),
    prefix4: prefixStats(sites, 4),
    jaccardMedian: median(jac),
    jaccardMin: jac.length ? Math.min(...jac) : 0,
    jaccardMax: jac.length ? Math.max(...jac) : 0,
    types: [...new Set(seqs.flat())].sort(),
  };
}

// ── 自检:#998 的 sections → blocks 是不是 1:1(AC1 那个跨代决定的判据)──────────────────────────
function selftest() {
  const { pageWithBlocks } = require('./blocks');
  const before = {
    slug: 'home',
    sections: [
      { type: 'announcement-bar', data: { text: 'x' } },
      { type: 'hero', data: { headline: 'x' } },
      { type: 'stats-counter', data: {} },
      { type: 'divider', data: {} },
      { type: 'cta-banner', data: {} },
    ],
  };
  const after = pageWithBlocks(JSON.parse(JSON.stringify(before)));
  const a = before.sections.map((s) => s.type);
  const b = blocksOf(after).map((s) => s.type);
  const ok = a.length === b.length && a.every((t, i) => t === b[i]);
  console.log('── #998 sections → blocks 是不是 1:1(本脚本量的是块 type 的有序列表)');
  console.log('   之前:', a.join(' → '));
  console.log('   之后:', b.join(' → '));
  console.log(ok ? '   ✅ 一样 —— 两代生成器建的站在这个量上可比' : '   🔴 不一样 —— 跨代基线不可用');

  // 🔴 第二格:证明这四个数**会动**。一把恒定输出的尺子在任何语料上都"通过",
  //    而它跟一把好尺子在单次读数上长得一模一样 —— 所以两个极端都要量一次。
  const mk = (name, seq) => ({ name, seq });
  const same = [mk('a', ['hero', 'x', 'y', 'z']), mk('b', ['hero', 'x', 'y', 'z']), mk('c', ['hero', 'x', 'y', 'z'])];
  const diff = [mk('a', ['hero', 'p1', 'p2', 'p3']), mk('b', ['q0', 'q1', 'q2', 'q3']), mk('c', ['r0', 'r1', 'r2', 'r3'])];
  const ms = measure(same); const md = measure(diff);
  const line = (t, m) => `   ${t}  前2 ${(m.prefix2.pairwise.pct * 100).toFixed(0)}%`
    + ` · 前3 ${(m.prefix3.pairwise.pct * 100).toFixed(0)}%`
    + ` · 前4 ${(m.prefix4.pairwise.pct * 100).toFixed(0)}%`
    + ` · Jaccard ${m.jaccardMedian.toFixed(3)}`;
  console.log('── 四个数会不会动（两个极端各量一次）');
  console.log(line('三个站完全一样:', ms));
  console.log(line('三个站毫无重叠:', md));
  const moves = ms.prefix2.pairwise.pct === 1 && ms.prefix4.pairwise.pct === 1 && ms.jaccardMedian === 1
    && md.prefix2.pairwise.pct === 0 && md.prefix4.pairwise.pct === 0 && md.jaccardMedian === 0;
  console.log(moves ? '   ✅ 一头 100%/1.000、另一头 0%/0.000 —— 这四个数不是常数'
    : '   🔴 两个极端没走到头 —— 这把尺子读不出差别');
  return (ok && moves) ? 0 : 1;
}

// ── 打印 ────────────────────────────────────────────────────────────────────────────────────────
const pct = (x) => `${(x * 100).toFixed(0)}%`;

function printReport(sites, m) {
  console.log('══ 首页骨架指纹 ══  🔴 只看【首页】,种类和顺序都看;子页面不在射程内(#1034 AC6)');
  console.log(`   ${m.n} 个站 · ${m.pairs} 个站对 · 用到的块种类 ${m.types.length} 种\n`);
  for (const s of sites) console.log(`   ${s.name.padEnd(18)} ${s.seq.join(' → ')}`);
  console.log('\n   ┌ 前 N 块完全相同 —— 三种统计量(它们给的数不一样,主判据是 pairwise)');
  for (const [n, key] of [[2, 'prefix2'], [3, 'prefix3'], [4, 'prefix4']]) {
    const p = m[key];
    console.log(`   │ 前 ${n} 块  pairwise ${String(p.pairwise.hit).padStart(3)}/${String(p.pairwise.of).padEnd(3)} = ${pct(p.pairwise.pct).padStart(4)}`
      + `   maxgroup ${p.maxgroup.hit}/${p.maxgroup.of} = ${pct(p.maxgroup.pct).padStart(4)}`
      + `   anytwin ${p.anytwin.hit}/${p.anytwin.of} = ${pct(p.anytwin.pct).padStart(4)}`);
  }
  console.log(`   └ 块集合重合度(Jaccard) 中位数 ${m.jaccardMedian.toFixed(3)}  (最小 ${m.jaccardMin.toFixed(3)} · 最大 ${m.jaccardMax.toFixed(3)})\n`);
  console.log('   开头 2 块各是什么:');
  for (const [k, c] of m.prefix2.groups) console.log(`     ${String(c).padStart(2)} 个站  ${k}`);
}

// ── main ────────────────────────────────────────────────────────────────────────────────────────
function main(argv) {
  const args = argv.slice(2);
  if (args.includes('--selftest')) return selftest();
  const asJson = args.includes('--json');
  const dirs = args.filter((a) => !a.startsWith('--'));
  if (!dirs.length) {
    console.error('用法: node scripts/homepage-fingerprint.js <站目录> [<站目录> …]  [--json] [--selftest]');
    return 2;
  }
  let sites;
  try {
    sites = dirs.map(readSite);
  } catch (e) {
    console.error(`🔴 ${e.message}`);
    console.error('   (读不到 ≠ 这个站没有块 —— 别把它当成 0 算进分母。)');
    return 2;
  }
  const m = measure(sites);
  if (asJson) console.log(JSON.stringify({ sites: sites.map((s) => ({ name: s.name, seq: s.seq })), ...m }, null, 2));
  else printReport(sites, m);
  return 0;
}

if (require.main === module) process.exit(main(process.argv));

module.exports = { readSite, measure, blocksOf, jaccard, prefixStats };
