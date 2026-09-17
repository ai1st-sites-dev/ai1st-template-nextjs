#!/usr/bin/env node
// #1351 —— 改页面 JSON 里【某一个块】的字段，或者把它挪一格。
//
// 这个脚本在**站自己的容器里**跑（`docker exec -w /app/repo <siteId> node scripts/patch-block.js …`），
// 由 worker 调用。它只改磁盘上的一份页面 JSON，不 commit、不构建 —— 那两件事归 worker
// （`worker/main.go` §processBlockPatchTask，commit 之后 §settleCommittedWork 负责重建）。
//
// 🔴 为什么是一个脚本文件，而不是像换主题那样把 JS 塞进 `node -e`：
//    这里要判「这一页上那些块今天按什么顺序排」，而那个顺序是 `blocks.js` 的
//    `normalizeLocalePages` + `byWeightThenOrder` 算出来的。把那套规矩在别处再写一遍，
//    下一次有人改排序规则时两边会分叉，而分叉的样子是「上移下移点了没反应 / 挪错了一格」——
//    构建全绿。所以这里**直接 require 容器自己那份 `blocks.js`**，判据跟构建时是同一个函数。
//    代价写在明处：站的仓里没有这个脚本时（建站日期早于本票），worker 那边会先探一次、
//    告诉老板「这个网站要先更新一次才能改这里」，而不是写下去假装成功 —— 照 #924 exit 4 那条先例。
//
// 用法：
//   node scripts/patch-block.js '<定位 JSON>' '<patch JSON 或空串>' '<up|down 或空串>'
//
//   定位 JSON = { "page": "<页面 slug>", "locale": "<语言，可空>",
//                 "blockId": "<新 blocks 形状里那个 id>"   或
//                 "index":   <老 sections 形状里的数组下标> }
//
//   patch = JSON merge patch，套在那个块上：写了什么就设什么，值写 `null` 就把那个键删掉。
//           （隐藏 = `{"hidden":true}`；显示回来 = `{"hidden":null}`。）
//   move  = "up" / "down"，跟 patch 二选一，不能同时给。
//
// 成功时 stdout 打**一行** JSON：{"ok":true,"blockId":…,"index":…,"file":…}
//   · `index` 是改完之后那个块在数组里的下标 —— 老 `sections` 形状挪过位置之后下标会变，
//     调用方要拿它刷新自己手上的定位（票里 AC3 量的就是这件事）。
//
// 退出码（每一个都对应一句给老板看的话，worker 那边一一对上）：
//   0 成功   3 找不到那个块   4 找不到那一页   5 参数或页面形状不对   6 已经到头了，挪不动
//   7 这一次改动会把页面上别的块的顺序也改掉 —— 不写，报错（见下面 §orderOf 那段）

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const SITE = path.join(ROOT, 'site');

function die(code, msg) {
  process.stderr.write(String(msg) + '\n');
  process.exit(code);
}

let blocks;
try {
  blocks = require(path.join(ROOT, 'scripts', 'blocks.js'));
} catch (e) {
  die(5, `读不到 scripts/blocks.js：${e.message}`);
}
const { readSiteBlocks, effectiveWeight, normalizeLocalePages, findBlockInPage } = blocks;

// ── 参数 ────────────────────────────────────────────────────────────────────────────────────────
let loc;
try {
  loc = JSON.parse(process.argv[2] || '');
} catch (e) {
  die(5, `第一个参数不是合法 JSON：${e.message}`);
}
if (!loc || typeof loc !== 'object' || Array.isArray(loc)) die(5, '第一个参数必须是一个对象');

let patch = null;
if (process.argv[3]) {
  try {
    patch = JSON.parse(process.argv[3]);
  } catch (e) {
    die(5, `patch 不是合法 JSON：${e.message}`);
  }
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) die(5, 'patch 必须是一个对象');
}
const move = String(process.argv[4] || '');
if (move && move !== 'up' && move !== 'down') die(5, `move 只能是 up 或 down，收到 ${JSON.stringify(move)}`);
if (!patch && !move) die(5, '这次调用既没有 patch 也没有 move —— 什么都不用做');
if (patch && move) die(5, 'patch 和 move 只能给一个');

// ── 哪一份文件 ──────────────────────────────────────────────────────────────────────────────────
//
// 🔴 老扁平站（没有 site_meta.json）的 localeDir 就是 `site/` 本身 —— 这条判据跟
// `sync-config.js:471` 是同一条，不是这里另立的规矩。
const isLegacy = !fs.existsSync(path.join(SITE, 'site_meta.json'));
let locale = typeof loc.locale === 'string' ? loc.locale : '';
if (!isLegacy && !locale) {
  try {
    locale = JSON.parse(fs.readFileSync(path.join(SITE, 'site_meta.json'), 'utf-8')).defaultLocale || 'en';
  } catch (e) {
    die(5, `读不到 site/site_meta.json：${e.message}`);
  }
}
if (locale && !/^[a-z]{2}(-[A-Za-z0-9]{2,8})?$/.test(locale)) die(5, `locale 形状不对：${JSON.stringify(locale)}`);
const localeDir = isLegacy ? SITE : path.join(SITE, locale);

const slug = typeof loc.page === 'string' ? loc.page : '';
// 🔴 slug 会被拼进文件路径，所以在这里挡住 `..` 和绝对路径 —— 这个值是从网络上来的，
//    挡它的责任在拼路径的这一处，不在把它递过来的那个人（同 worker §themeIDSafe 那条规矩）。
if (!/^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*$/.test(slug)) {
  die(5, `page slug 形状不对：${JSON.stringify(slug)}`);
}
const file = path.join(localeDir, 'pages', `${slug}.json`);
if (!fs.existsSync(file)) die(4, `找不到这一页：${path.relative(ROOT, file)}`);

let page;
try {
  page = JSON.parse(fs.readFileSync(file, 'utf-8'));
} catch (e) {
  die(5, `${path.relative(ROOT, file)} 不是合法 JSON：${e.message}`);
}

const hasBlocks = Object.prototype.hasOwnProperty.call(page, 'blocks');
const hasSections = Object.prototype.hasOwnProperty.call(page, 'sections');
if (hasBlocks === hasSections) {
  die(5, `${path.relative(ROOT, file)} 必须恰好写 blocks 或 sections 其中一个`);
}
const key = hasBlocks ? 'blocks' : 'sections';
// 老 `sections` 形状：这一页的块 id 是构建时按数组下标现算的（#1349 的 generatedBlockId），
// 所以它**不是**一个能跨移动认块的名字。下面 §keyList 那段写了这条的完整来历。
const legacyShape = !hasBlocks;
const arr = page[key];
if (!Array.isArray(arr)) die(5, `${path.relative(ROOT, file)} 的 "${key}" 不是数组`);

let siteBlocks = {};
try {
  siteBlocks = readSiteBlocks(localeDir);
} catch (e) {
  die(5, e.message);
}

// ── 这一页今天按什么顺序排 ──────────────────────────────────────────────────────────────────────
//
// 🔴 用的是**构建时那个函数**，不是这里重写一遍的排序规矩。`normalizeLocalePages` 会改传进去的
//    那个对象，所以每次都喂一份深拷贝 —— 要写回磁盘的是上面那个 `page`，不是它吐出来的东西。
// 🔴 每个原始条目先盖一个临时序号 `__pbIdx` 再归一化，归一化完把它读回来 —— 这样「渲染顺序里的
//    第 k 个」能**准确**对回「文件数组里的第几条」。不这么做的话老 `sections` 形状就没法认块：
//    它的条目根本没有 id，靠 `type` 拼一个出来，同一页上两个同类型的块就分不开，而上移下移会
//    挪错一格（实测过：邻居按 id 找，老形状一次都找不到，rc=3）。
//    这个字段只存在于这份深拷贝里，写回磁盘的是上面那个 `page`，它身上没有这个键。
function orderOf(pageObj) {
  const copy = JSON.parse(JSON.stringify(pageObj));
  const list = copy.blocks || copy.sections;
  list.forEach((e, i) => { if (e && typeof e === 'object') e.__pbIdx = i; });
  const out = normalizeLocalePages([copy], JSON.parse(JSON.stringify(siteBlocks)), locale || 'en', {});
  return out[0].blocks.map((b) => {
    // 🔴 `{ref}` 条目上盖的序号**到不了**这里：`blocks.js` 解 ref 那一支摊开的是站级块本体
    //    （`{ ...target, id: entry.ref, … }`），条目自己身上的键一个都没带过来。所以那一类要按
    //    id 回查一次原始数组。只认 `__pbIdx` 的话它们全都读成 -1，而守卫会把一次正确的隐藏
    //    判成「别的块也动了」拒掉（实测过，rc=7）。
    let raw = Number.isInteger(b.__pbIdx) ? b.__pbIdx : -1;
    if (raw === -1 && typeof b.id === 'string' && b.id) {
      raw = list.findIndex((e) => e && typeof e === 'object' && (e.ref === b.id || e.id === b.id));
    }
    return {
      // 靠 visibility 进来、这一页没有条目的站级块：文件里没有它，raw 就是 -1。
      raw,
      id: typeof b.id === 'string' && b.id ? b.id : '',
      type: b.type || '',
      hidden: b.hidden === true,
    };
  });
}

const before = orderOf(page);

// ── 找到要改的那一条 ────────────────────────────────────────────────────────────────────────────
//
// 两种形状两种定位，理由在票里：老 `sections` 形状的块 id 是**现算**的（`blocks.js` §pageWithBlocks
// 结尾那个数组下标），挪一次位置 id 就变，拿它当 PATCH 的目标会打到隔壁那块上。所以老形状按下标定位。
// 🔴 「找哪一条」**不在这个文件里实现** —— 它是 `blocks.js` 的 §findBlockInPage，manager 侧做
//    入队前的同步校验时调的是同一份（#1350 的形态校验要先找到同一个块再看它的槽位）。两份实现的
//    失败形态是「校验放行的是 A 块、写下去的是 B 块」，而两边各自都绿、没有任何东西会红。
const found = findBlockInPage(page, siteBlocks, {
  slug,
  blockId: typeof loc.blockId === 'string' ? loc.blockId : '',
  index: Number.isInteger(loc.index) ? loc.index : undefined,
  materialize: true,
});
switch (found.error) {
  case 'shape':
    die(5, `${path.relative(ROOT, file)} 必须恰好写 blocks 或 sections 其中一个，而且是数组`);
    break;
  case 'bad-locator':
    die(5, key === 'sections' ? '老 sections 形状要按 index 定位（一个整数）' : '新 blocks 形状要按 blockId 定位');
    break;
  case 'out-of-range':
    die(3, `这一页只有 ${arr.length} 个块，没有第 ${loc.index} 个`);
    break;
  case 'not-found':
    die(3, `这一页上找不到块 ${JSON.stringify(loc.blockId)}`);
    break;
  default:
    break;
}
let at = found.at;
let blockId = found.blockId;

const entry = arr[at];
if (!entry || typeof entry !== 'object' || Array.isArray(entry)) die(5, `第 ${at} 个块不是对象`);
// 🔴 老 `sections` 形状不编一个 id 出来回给调用方。那种合成串看着像个能拿去再用的 id，
//    而它下一次挪动就变 —— 正是本票要老形状改用下标定位的原因。这一路回 `blockId: ""`，
//    权威定位是下面那个 `index`。
if (!blockId && typeof entry.id === 'string') blockId = entry.id;

// ── 改 ──────────────────────────────────────────────────────────────────────────────────────────
if (patch) {
  for (const k of Object.keys(patch)) {
    // 🔴 键名在这里挡一次。这个值是从网络上来的，而它会变成写进磁盘那份 JSON 的一个键；
    //    挡它的责任在写文件的这一处（同上面 slug 那条）。
    if (!/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(k)) die(5, `patch 里的键名不对：${JSON.stringify(k)}`);
    if (k === 'id' || k === 'ref' || k === 'type') die(5, `不许用 patch 改 "${k}" —— 那会把这个块换成另一个块`);
    if (patch[k] === null) delete entry[k];
    else entry[k] = patch[k];
  }
} else {
  // 上移下移：按**渲染顺序**找邻居，不是按数组顺序 —— 两者在有 weight 的页面上不是一回事。
  // 认块靠上面盖的那个原始下标，不靠 id（老 sections 形状没有 id）。
  const here = before.findIndex((b) => b.raw === at);
  if (here === -1) die(3, '这一页渲染出来的块里没有要挪的那一个');
  // 🔴 **藏起来的块不占一格：找邻居时跳过它们。**（QA1 r3 抓到的那一格）
  //    藏起来的块在建出来的页面上根本没有 DOM（`SectionRenderer.tsx` 直接 `return null`），所以
  //    老板在预览里看到的「下一块」就是下一个**没被藏**的块，而预览里的上移下移换的也是它。
  //    这里要是按完整顺序取邻居，一个藏起来的邻居就会把这一次点击整个吃掉：页面 JSON 里两个权重
  //    确实换了，而**看得见的顺序一个字没变** —— 老板点了、预览里动了、重建完跟点之前一模一样，
  //    没有任何地方会红。所以两边用同一条规矩：邻居 = 这个方向上最近的那个没被藏的块。
  //    到头的判据跟着一起变：后面只剩藏起来的块 = 它已经是（看得见的）最后一个了。
  let to = -1;
  for (let i = move === 'up' ? here - 1 : here + 1; i >= 0 && i < before.length; i += (move === 'up' ? -1 : 1)) {
    if (!before[i].hidden) { to = i; break; }
  }
  if (to === -1) die(6, move === 'up' ? '它已经是第一个了' : '它已经是最后一个了');

  const nb = before[to].raw;
  if (nb === -1) {
    // 邻居是个 visibility 命中、这一页没写条目的站级块。要跟它换位置，得先让它在这一页有个条目。
    die(3, `它旁边那个块（${JSON.stringify(before[to].id)}）在这一页的 blocks 里没有条目，`
      + '先对它做一次改动把条目补出来再挪');
  }

  if (key === 'sections') {
    // 老形状：换数组位置。**id 是按下标现算的，所以换完之后这两块的 id 都变了** —— 这正是
    // 本票要老形状改用下标定位的原因，调用方拿下面回带的 index 刷新自己手上的定位。
    const tmp = arr[at];
    arr[at] = arr[nb];
    arr[nb] = tmp;
    // 两边如果自己写了 weight，也要跟着换，否则换了数组位置而渲染顺序不动。
    const wA = arr[nb].weight;
    const wB = arr[at].weight;
    if (typeof wA === 'number' || typeof wB === 'number') {
      if (typeof wB === 'number') arr[nb].weight = wB; else delete arr[nb].weight;
      if (typeof wA === 'number') arr[at].weight = wA; else delete arr[at].weight;
    }
    at = nb;
  } else {
    // 新形状：id 写在文件里、不随位置变，所以换的是**权重**，数组位置一个字节不动。
    const wHere = effectiveWeight(entry, at);
    const wThere = effectiveWeight(arr[nb], nb);
    entry.weight = wThere;
    arr[nb].weight = wHere;
  }
}

// ── 写之前先问一句：这次改动有没有顺带把别的块的顺序也改了 ──────────────────────────────────────
//
// 🔴 这一段不是锦上添花。补 `{ref}` 条目那条路会往数组里加一条，而**没写 weight 的站级块，
//    它的位置是按「追加进来时那个序号」算的** —— 数组长一条，后面那些块的序号就整体后移一格。
//    症状是老板点了「隐藏这一块」，页面上另外两块对调了位置，而构建全绿。
//    所以这里前后各算一次顺序，只允许出现两种差别：那个块自己被藏起来（从名单里消失），
//    或者上移下移那两块对调。别的差别一律不写，退 7。
// 🔴 比的是**完整顺序**（连藏起来的那些一起比），不是「看得见的那几个」的顺序。
//    这一条是实测逼出来的：拿掉上面那段「补条目时带上今天的 weight」之后，两个站级块确实对调了，
//    而当时的守卫只比可见顺序 —— 被改的那个正好是藏着的，所以它一声没吭，照样写了下去。
//    一把只在「反正也看不见」的时候失明的尺子，等老板把那个块放回来的那天才会显形。
const after = orderOf(page);

// 认一个块用什么名字：新 `blocks` 形状用它写在文件里的 `id`；老 `sections` 形状一律用
// 「类型 + 它是同类里的第几个」。
//
// 🔴 **不能用数组下标当名字**（试过，错的）：老 `sections` 形状挪一格换的就是数组下标，
//    于是「两个相邻的对调」在那把尺子下读成「两个块都变成了别的东西」，一次正常的下移被判成 rc=7。
//
// 🔴🔴 **所以老形状那一支必须【看形状】判，不能写成「有 id 就用 id」** —— 这一条是 #1349 与本票
//    合在一起才露头的，两张票各自跑都是绿的：
//      · 本票自己那棵树上，老 `sections` 的块**没有** id，`if (b.id)` 那支不开火 ⟹ 走 `type#n`，对；
//      · #1349 让 `normalizeLocalePages` 给它们**补**了一个 id，而那个 id 是
//        `<页>-<类型>-<数组下标>`（`blocks.js` §generatedBlockId）—— 位置的函数。
//      · 合起来：下移一格 ⟹ 两个块的 id 都变 ⟹ 这把尺读成「两个块都变成了别的东西」⟹ rc=7。
//        实测：`node scripts/patch-block.test.js` 第 ③ 节在合并树上红、在本票自己那棵树上 14/0 绿。
//    ⟹ 判据换成**页面的形状**（`key`），不是「这个块有没有 id」。新形状的 id 写在文件里、不随位置变
//    （`{ref}` 解出来的也是站级块自己的 id），那一支不受影响。
//
// 🔴 已知盲区，写在这里而不是假装没有：同一页上**相邻两个同类型**的块互相对调（老形状上它们的
//    名字都是 `type#n`），这把尺子看到的前后名单一模一样 ⟹ 判成「什么都没发生」而拒掉（rc=7）。
//    方向是拒绝、不是放行，文件一个字节不动、老板收到一句话，所以宁可这样。这跟 #1349 之前一模一样
//    —— 上面那个改动只是让老形状**回到**它本来的判法，没有新增也没有消掉这个盲区。
const keyList = (list) => {
  const seen = new Map();
  return list.map((b) => {
    if (b.id && !legacyShape) return b.id;
    const n = seen.get(b.type) || 0;
    seen.set(b.type, n + 1);
    return `${b.type}#${n}`;
  });
};
const seqOf = (list) => keyList(list).map((k, i) => `${k}${list[i].hidden ? '(藏)' : ''}`);
const beforeSeq = seqOf(before);
const afterSeq = seqOf(after);

const allowed = (() => {
  if (before.length !== after.length) return false;
  const bk = keyList(before);
  const ak = keyList(after);

  if (patch) {
    // 藏起来 / 放回来：**位置一个都不许动**，只有被改的那一个块的显隐可以变。
    if (!bk.every((k, i) => k === ak[i])) return false;
    // 认被改的那一个用的是改完之后那份名单里 raw 等于 `at` 的那一条（补 `{ref}` 条目那条路上，
    // 它在「改之前」那份名单里的 raw 是 -1 —— 那会儿文件里还没有它）。
    const ti = after.findIndex((b) => b.raw === at);
    const changed = bk.filter((k, i) => before[i].hidden !== after[i].hidden);
    return changed.length === 0 || (changed.length === 1 && ti >= 0 && changed[0] === ak[ti]);
  }

  // 上移下移：两个块对调，别的位置不动，谁的显隐都不许变（按名字比，不按位置比 ——
  // 按位置比会被对调那一步本身带偏）。
  // 🔴 对调的这两个**不一定挨着**：藏起来的块不占一格（见上面找邻居那段），所以它们中间可以隔着
  //    几个藏起来的块 —— 但**只能是藏起来的**。夹在中间的块如果看得见，那就是这一次改动顺带把
  //    第三个块的位置也改了，照旧拒掉。（中间那些块自己没动 —— `diff` 只有两项就是这个意思。）
  const hb = new Map(bk.map((k, i) => [k, before[i].hidden]));
  if (!ak.every((k, i) => hb.get(k) === after[i].hidden)) return false;
  const diff = bk.map((k, i) => (k === ak[i] ? -1 : i)).filter((i) => i >= 0);
  return diff.length === 2
    && before.slice(diff[0] + 1, diff[1]).every((b) => b.hidden)
    && bk[diff[0]] === ak[diff[1]] && bk[diff[1]] === ak[diff[0]];
})();

if (!allowed) {
  die(7, '这次改动会把页面上别的块的顺序也改掉，已经放弃、文件一个字节没动。\n'
    + `  改之前：${beforeSeq.join(' → ')}\n`
    + `  改之后：${afterSeq.join(' → ')}`);
}

// ── 写回 ────────────────────────────────────────────────────────────────────────────────────────
//
// 🔴 `JSON.stringify(…, null, 2) + '\n'` —— 跟 `create-site.js` 写页面 JSON 用的是同一个写法，
//    所以在这里改过的站和新建的站，文件格式逐字节一样（同 worker §themeWriteCommand 那条理由）。
fs.writeFileSync(file, `${JSON.stringify(page, null, 2)}\n`);

process.stdout.write(`${JSON.stringify({
  ok: true,
  blockId,
  type: entry.type || (entry.ref ? (siteBlocks[entry.ref] || {}).type || '' : ''),
  index: at,
  file: path.relative(ROOT, file),
})}\n`);
