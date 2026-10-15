// #1351 —— 「让 AI 改这一块」：这一轮编辑只许动**指定的那一个块**。
//
// 面板上那个按钮把块的 id（老 `sections` 形状是数组下标）和它在哪一页一起带进聊天会话，
// `edit-site.js` 收到之后每一次 `write_file` 都要过这里。越界的写入**整笔拒掉**，磁盘一个字节不动，
// 模型拿着拒绝的理由在同一轮里改口 —— 跟这条路上已有的那几道（#1013 块校验 / #1087 白名单 /
// #1195 图片地址）同一个位置、同一种处置。
//
// 🔴 为什么是「比出来」而不是「信提示词」：提示词里写「只改这一块」是一句**请求**，不是一道判断。
//    #999 已经为这件事付过账（AI 越界改动要能被拒掉）。这里的判据是**磁盘上那份和它要写的这份
//    逐块比一遍**，别的块必须逐字节相同 —— 模型怎么想的不影响读数。
//
// 🔴 这一关**不问内容对不对**，只问「动了谁」。内容那一维归 `pageJsonBlockError`（#1013）和
//    `block-manifest.js` 的 validateSite（#999），它们在同一条路上的前后脚。

// 这一页的块，按**文件里的原始顺序**取出来（不排序、不解 ref、不补 visibility）。
//
// 🔴 故意不走 `normalizeLocalePages`：那个函数会排序、会把站级块解开、会补上 visibility 命中的块，
//    而这里要回答的是「**这份文件**里的第几条被动了」。拿归一化之后的结果比，一个只改了排序权重的
//    写入会被读成「所有块都变了」，而一个把两条互换了位置的写入会被读成「没变」。
function rawBlocks(parsed) {
  const hasBlocks = Object.prototype.hasOwnProperty.call(parsed || {}, 'blocks');
  const hasSections = Object.prototype.hasOwnProperty.call(parsed || {}, 'sections');
  if (hasBlocks === hasSections) return null;
  const arr = hasBlocks ? parsed.blocks : parsed.sections;
  return Array.isArray(arr) ? arr : null;
}

// 这一条是不是我们说的那一个块。
function isTarget(entry, i, scope) {
  if (typeof scope.index === 'number') return i === scope.index;
  if (!entry || typeof entry !== 'object') return false;
  return entry.id === scope.blockId || entry.ref === scope.blockId;
}

// ── #1791 顶栏 / 页脚范围 ───────────────────────────────────────────────────────────────────────
//
// 面板上顶栏 / 页脚的 AI 页把 `region` 带进来，这一轮只许改这种语言 `navigation.json` 里**那一个键**
// （`header` 或 `footer`）。判据跟块那一支同一个：拿磁盘上那份逐键比，别的键必须不变，越界整笔拒、磁盘不动。
//
// 📌 不在范围里的两样，拒绝句里说清去哪儿改（模型照这句回老板）：
//    · 版式和颜色（`theme.json` 的 regionLayout / regionOptions）—— 聊天这条路本来就不许写 theme.json
//      （`editable-files.js` 的 REJECT_REASON，#1087），在白名单那一关就拒了，到不了这里；
//    · 网站名、logo、电话、邮箱、社交链接（`brand.json`）—— 整站的，改在 Website settings。
// 📌 `navigation-owned.js` 那道门（构建会重写的菜单链接那几处）在 `writeRejection` 里、排在这一关前面，照旧。

const REGION_KEYS = ['header', 'footer'];
const REGION_NAME = { header: 'the header', footer: 'the footer' };

/** 不计键序的深比较（JSON 里只有对象 / 数组 / 原值）。别的顶层键只是换了键序，不算动过它。 */
function sameJson(a, b) {
  if (a === b) return true;
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((v, i) => sameJson(v, b[i]));
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && sameJson(a[k], b[k]));
}

function regionScopeRejection(relPath, parsed, scope, readCurrent) {
  const name = REGION_NAME[scope.region];
  if (!name || !scope.navPath) {
    // 认不出来的 region 不许当成「没收窄」放过去 —— scopeFromInput 不会造出这种范围，真来了就拒。
    return 'Could not tell which part of the website this conversation is about, so nothing was written.';
  }
  if (relPath === 'brand.json') {
    return `This conversation is about ${name}. The website name, logo and contact details are changed in `
      + 'Website settings, not here. Nothing was written.';
  }
  if (relPath !== scope.navPath) {
    return `This conversation is about ${name}. You may only change the "${scope.region}" part of `
      + `${scope.navPath}, not ${relPath}. Nothing was written.`;
  }
  const currentRaw = readCurrent(relPath);
  if (currentRaw === null) {
    return `This conversation is about ${name}, so no new files can be created. Nothing was written.`;
  }
  let current;
  try {
    current = JSON.parse(currentRaw);
  } catch (e) {
    // 比不了必须走拒绝（同块那一支的理由）。
    return `Could not read the current ${relPath} to check what changed, so nothing was written.`;
  }
  const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (!isObj(parsed) || !isObj(current)) {
    return `Could not tell what changed in ${relPath}, so nothing was written.`;
  }
  const names = new Set([...Object.keys(current), ...Object.keys(parsed)]);
  const touched = [...names].filter((k) => k !== scope.region && !sameJson(current[k], parsed[k]));
  if (touched.length) {
    return `This conversation is about ${name}. That write also changes `
      + `${touched.map((t) => `"${t}"`).join(', ')} in ${relPath}. Change only "${scope.region}". Nothing was written.`;
  }
  return null;
}

/**
 * blockScopeRejection —— 这次 write_file 越界了吗？越界回一句话（英文，模型读），没越界回 null。
 *
 * @param {string} relPath   这次要写的路径，相对 site/
 * @param {object} parsed    这次要写的内容（已经 JSON.parse 过）
 * @param {object} scope     { pagePath, blockId?, index? }；pagePath 也是相对 site/
 * @param {function} readCurrent  (相对 site/ 的路径) → 字符串或 null
 */
function blockScopeRejection(relPath, parsed, scope, readCurrent) {
  // #1791 —— 🔴 region 一支必须排在下面那句 `!scope.pagePath` 之前：region 范围没有 pagePath，
  //    落到那一句就是对每一个文件都回 null = 闸全开，而面板那一侧以为这一轮只改顶栏 / 页脚。
  if (scope && scope.region) return regionScopeRejection(relPath, parsed, scope, readCurrent);
  if (!scope || !scope.pagePath) return null;

  // ── 第一问：写的是不是那一页 ──────────────────────────────────────────────────────────────────
  //
  // 🔴 站级块库是**唯一的例外**，而且不是网开一面：被点名的那个块可能是一条 `{ref}`，它的正文
  //    住在 `blocks/site-blocks.json` 里 —— 不放这个文件的话，「让 AI 改这一块」对跨页复用的块
  //    整个不能用。放行的同时下面第二问照样逐键比，只有那一个 id 允许变。
  const isSiteBlocks = /(^|\/)blocks\/site-blocks\.json$/.test(relPath);
  if (relPath !== scope.pagePath && !isSiteBlocks) {
    return `This conversation is about one block on ${scope.pagePath}. `
      + `You may only write ${scope.pagePath}`
      + (scope.blockId ? ` (or the shared block library entry for "${scope.blockId}")` : '')
      + `, not ${relPath}. Nothing was written.`;
  }

  const currentRaw = readCurrent(relPath);
  if (currentRaw === null) {
    // 这条路上不许**新建**文件：被点名的那个块住在一份已经存在的文件里。
    return `This conversation is about one block on ${scope.pagePath}, so no new files can be created. `
      + `Nothing was written.`;
  }
  let current;
  try {
    current = JSON.parse(currentRaw);
  } catch (e) {
    // 磁盘上那份读不出来就没法比 —— 而「比不了」必须走**拒绝**这一支，不是放行。
    // 放行的话，这一关在它最该说话的时候（文件本来就坏着）恰好闭嘴。
    return `Could not read the current ${relPath} to check which block changed, so nothing was written.`;
  }

  // ── 站级块库：只有被点名那个 id 允许变 ────────────────────────────────────────────────────────
  if (isSiteBlocks) {
    if (!scope.blockId) {
      return `This conversation is about one block on ${scope.pagePath}, which is not a shared block. `
        + `Nothing was written.`;
    }
    const before = (current && typeof current === 'object' && !Array.isArray(current)) ? current : {};
    const after = (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) ? parsed : null;
    if (!after) return `${relPath} must be an object keyed by block id. Nothing was written.`;
    const names = new Set([...Object.keys(before), ...Object.keys(after)]);
    const touched = [...names].filter((k) => k !== scope.blockId
      && JSON.stringify(before[k]) !== JSON.stringify(after[k]));
    if (touched.length) {
      return `This conversation is about the block "${scope.blockId}". `
        + `That write also changes ${touched.map((t) => `"${t}"`).join(', ')} in the shared block library. `
        + `Change only "${scope.blockId}". Nothing was written.`;
    }
    return null;
  }

  // ── 那一页：除了被点名那一条，别的逐字节不许变 ────────────────────────────────────────────────
  const before = rawBlocks(current);
  const after = rawBlocks(parsed);
  if (before === null || after === null) {
    // 形状本身坏了 —— 那一维归 pageJsonBlockError 说话，这里只说自己这一维说不了话。
    return `Could not tell which block changed in ${relPath}, so nothing was written.`;
  }
  if (before.length !== after.length) {
    return `This conversation is about one block on ${scope.pagePath}. `
      + `That write changes how many blocks the page has (${before.length} → ${after.length}). `
      + `Change only the one block. Nothing was written.`;
  }

  // 🔴 **先**问被点名那一条有没有换身份（`id` / `ref` / `type` 被改掉），再逐条比。
  //    顺序是承重的：身份一换，下面那个逐条比就认不出它了，于是它被算进「动了别的块」那一栏 ——
  //    拒是拒掉了，但给模型的那句话变成「你还改了 home-features，请只改 home-features」，
  //    自相矛盾、它照着改不出正确的下一步。实测过，就是这句。
  const ti = before.findIndex((e, i) => isTarget(e, i, scope));
  if (ti >= 0 && after[ti] && typeof after[ti] === 'object') {
    for (const k of ['id', 'ref', 'type']) {
      if (JSON.stringify(before[ti][k]) !== JSON.stringify(after[ti][k])) {
        return `That write changes the block's "${k}", which would make it a different block. `
          + `Change its content instead. Nothing was written.`;
      }
    }
  }

  const touched = [];
  for (let i = 0; i < before.length; i += 1) {
    if (JSON.stringify(before[i]) === JSON.stringify(after[i])) continue;
    if (isTarget(before[i], i, scope) && isTarget(after[i], i, scope)) continue;
    const name = (before[i] && (before[i].id || before[i].ref)) || `#${i}`;
    touched.push(name);
  }
  if (touched.length) {
    const target = scope.blockId ? `"${scope.blockId}"` : `block #${scope.index}`;
    return `This conversation is about ${target} on ${scope.pagePath}. `
      + `That write also changes ${touched.map((t) => `"${t}"`).join(', ')}. `
      + `Change only ${target}. Nothing was written.`;
  }

  return null;
}

/**
 * scopeFromInput —— 把 edit-site.js 收到的那份 JSON 里的定位翻译成 scope，没有就回 null。
 *
 * 老 `sections` 形状带的是 `index`（数组下标），新形状带 `blockId` —— 老形状的块 id 是构建时按数组
 * 下标现算的（`blocks.js` §pageWithBlocks 拼的 `<slug>-<type>-<下标>`），挪一次位置就变，拿它当目标会打到
 * 隔壁那块上；新形状的 id 写在文件里，不随位置变。
 */
function scopeFromInput(input, siteShapeInfo) {
  if (!input || typeof input !== 'object') return null;
  // #1791 —— 顶栏 / 页脚范围，排在下面那几个「回 null = 不收窄」之前。🔴 带了 region 却算不出范围
  //    （值不认识、站的形状读不出来）不许退化成不收窄（那是闸全开），回一个认不出的范围，
  //    让 regionScopeRejection 把每一次写入都拒掉 —— 跟块那一支「说不准就不收窄」的方向相反，
  //    因为这里说不准的后果是「AI 照着一句改顶栏的话去改了首页」。
  const region = input.region;
  if (region !== undefined && region !== null && region !== '') {
    const known = typeof region === 'string' && REGION_KEYS.includes(region);
    if (!known || !siteShapeInfo) return { region: '?', navPath: '' };
    const loc = typeof input.locale === 'string' && input.locale ? input.locale : '';
    const pre = siteShapeInfo.flat ? '' : `${loc || siteShapeInfo.locales[0] || 'en'}/`;
    return { region, navPath: `${pre}navigation.json` };
  }
  const page = typeof input.page === 'string' ? input.page.trim() : '';
  if (!page) return null;
  const hasBlockId = typeof input.blockId === 'string' && input.blockId !== '';
  const hasIndex = Number.isInteger(input.blockIndex);
  if (!hasBlockId && !hasIndex) return null;

  // 内容住在 `site/<语言>/` 还是直接在 `site/` —— 判据跟构建同一条，不在这里另立
  // （`lib/site-shape.js` 的文件头写了为什么只看 `site_meta.json` 在不在）。
  // 🔴 它回的是 `{ flat, locales }`，`flat === true` 才是老扁平站。**读不出来时它回 null**，
  //    而 null 在这里必须当成「说不准」—— 按扁平站猜的话，多语言站上算出来的 pagePath 谁都对不上，
  //    这一关就会把每一次写入都拒掉（方向是拒绝、不是放行，但功能整个不能用）。所以回 null 就
  //    不设范围，让这一轮退化成普通编辑，跟本票之前一模一样。
  if (!siteShapeInfo) return null;
  const locale = typeof input.locale === 'string' && input.locale ? input.locale : '';
  const prefix = siteShapeInfo.flat ? '' : `${locale || siteShapeInfo.locales[0] || 'en'}/`;
  return {
    pagePath: `${prefix}pages/${page}.json`,
    blockId: hasBlockId ? input.blockId : undefined,
    index: hasIndex ? input.blockIndex : undefined,
  };
}

module.exports = { blockScopeRejection, scopeFromInput, rawBlocks, REGION_KEYS };
