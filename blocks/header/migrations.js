'use strict';
// #1916 (SiteAsData T4b-2) —— 顶栏的数据迁移（机制见 `scripts/lib/block-migrations.js`）。拿到的是 `<语言>/navigation.json` 的 `header` 对象。
//
// 1→2：#1787 把顶栏按钮从 `header.cta`（一个 `{label, href}` 对象）换成 `header.buttons`（0–3 颗的列表）、不迁老站 ⟹ 老站的按钮
//   从那天起就画不出来（`Section.tsx` 只读 `buttons`）。这一步把 `cta` 写成 `buttons: [{label, href}]` 并删掉 `cta`。
//   `preservesLook: true`：今天的代码画不出 `cta`，迁移是把按钮找回来，不是改样子（T4b-4 的对照格把它登记进豁免表）。
//   · 已经有 `buttons` 列表的（新站、spike 夹具、老板在编辑器里重新加过按钮的）⟹ `buttons` 原样，只删残留的 `cta`：
//     列表是老板后来的意思，而 `cta` 从 #1787 起没人读也没人写。
//   · `cta` 缺 `label` / `href` ⟹ 画出来也是一颗没字或不知道链到哪的按钮（`header-buttons.js` 拒收的那种），只删不搬。
//   · 只搬 `label` / `href`：`HEADER_BUTTON`（`navigation-owned.js`）只有这两格，样子按位置定（第 1 颗实心）。
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const filled = (v) => (typeof v === 'string' ? v.trim() !== '' : isObj(v));

module.exports = {
  '1→2': {
    preservesLook: true,
    migrate: (header) => {
      if (!Object.prototype.hasOwnProperty.call(header, 'cta')) return header;
      const { cta, ...rest } = header;
      if (Array.isArray(rest.buttons)) return rest;
      const usable = isObj(cta) && typeof cta.label === 'string' && cta.label.trim() !== '' && filled(cta.href);
      return usable ? { ...rest, buttons: [{ label: cta.label, href: cta.href }] } : rest;
    },
  },
};
