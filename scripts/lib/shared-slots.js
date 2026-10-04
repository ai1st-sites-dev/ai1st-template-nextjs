'use strict';

// #1534 —— 共用的槽定义（`shared-slots.json`；今天只有 `bg`：17 个块逐字相同的那一份颜色槽）。
// 块的 manifest 里写 `"bg": { "ref": "bg" }`，读 manifest 的地方用这里原地展开成完整定义 —— 键的位置不动
// （Go 侧 §manifestColorSlots 按书写顺序读），下游（校验、提示词、单格页、编辑器）看到的跟展开前逐字相同。
// 零依赖：`blocks.js`（站点构建也跑）和 `block-manifest.js` 都 require 它。
// Go 那侧读同一份文件、同一条规矩：manager/template_blocks.go §expandSharedSlots。

const fs = require('fs');
const path = require('path');

const SHARED_SLOTS_FILE = path.join(__dirname, 'shared-slots.json');
// 🔴 用 require、不用 fs + __dirname：单格页（`page.dev.tsx` → block-catalog → block-manifest → 这里）会被 webpack 打进
//    Next 的服务端包，包里的 __dirname 指着 `.next/…`，按路径读当场 ENOENT（#1534 实测 500）。require 一份 JSON 两边都认。
const SHARED = require('./shared-slots.json');
function loadSharedSlots() {
  return SHARED;
}

/** `{ "ref": "<名>" }`（只有这一个键）= 引用共用定义。 */
const isSlotRef = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 1 && typeof v.ref === 'string';

/** 把 manifest 里引用共用定义的槽原地展开（深拷贝，各块拿到自己的一份）。引用了不存在的名字 ⟹ 当场拒。 */
function expandSharedSlots(m, where = 'manifest') {
  const slots = m && m.slots;
  if (!slots || typeof slots !== 'object') return m;
  const defs = loadSharedSlots();
  for (const [name, spec] of Object.entries(slots)) {
    if (!isSlotRef(spec)) continue;
    if (!Object.prototype.hasOwnProperty.call(defs, spec.ref)) {
      throw new Error(`${where}: 槽 ${name} 引用的共用定义 "${spec.ref}" 不存在（scripts/lib/shared-slots.json 里有：${Object.keys(defs).join(' / ')}）`);
    }
    slots[name] = JSON.parse(JSON.stringify(defs[spec.ref]));
  }
  return m;
}

/** 读一份块 manifest 并展开共用槽。自己读 manifest.json 的地方一律走它，别直接 JSON.parse（否则拿到的是 `{ ref }`）。 */
function readManifest(file) {
  return expandSharedSlots(JSON.parse(fs.readFileSync(file, 'utf-8')), file);
}

module.exports = { SHARED_SLOTS_FILE, loadSharedSlots, isSlotRef, expandSharedSlots, readManifest };
