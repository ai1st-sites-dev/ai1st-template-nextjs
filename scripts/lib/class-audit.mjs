// ══════════════════════════════════════════════════════════════════════════════════════════════════
// class-audit.mjs —— 「页面上每个 class 在已加载的样式表里有没有规则」这一问，一处定义（#1424 从
// `theme-css-invariants.mjs` 抽出来，原来是那里的 `classAuditInBrowser`）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 🔴 **这是一个在浏览器里跑的函数**，交给 playwright 的 `page.evaluate(classAuditInBrowser, args)`。
//    它被序列化成源码送进页面，所以函数体里**不许引用这个模块里的任何别的东西**（闭包到了页面里不存在）。
//
// 为什么要抽：#1424 验收 4 要问「图册里 `header` 那一行的每个 class，在 purge 之后的 `site.css`
//    里有没有规则」—— 同一个问题，换一页（dev 的 `/__catalog`）、换一组样式表（只认 `/site.css` +
//    `/shapes.css`）、只看页面的一部分。把它抄一份就是这个问题的第二份定义，分叉那天两边都不会红。
//
// 参数（数组，因为 `page.evaluate` 只收一个参数）：
//   [0] hookClasses     契约钩子的类名清单（theme-css-lint.js 的 HOOK_CLASSES）；不问钩子就给 []
//   [1] themeSheetPath  「主题自己那张表」的路径（#1002 起是 `/theme.css`）；第二个读数只数它
//   [2] opts（可选，#1424 加的；不给 = 原来的行为，逐字节不变）
//        · scope   CSS 选择器：只看这些元素**及其后代**上的 class（不给 = 整页 `[class]`）
//        · sheets  路径数组：`declared` 只从 pathname 在这张单子里的样式表收（不给 = 全部样式表）
//                  内联 `<style>` 没有 href，给了 `sheets` 时它们不算数 —— 问的就是「这几份文件」。
export const classAuditInBrowser = ([hookClasses, themeSheetPath, opts]) => {
  const scope = opts && opts.scope ? opts.scope : null;
  const onlySheets = opts && Array.isArray(opts.sheets) ? opts.sheets : null;
  const declared = new Set();
  const declaredByTheme = new Set();
  const themeSheets = [];
  let unreadableSheets = 0;
  const collect = (rules, into) => {
    for (const r of rules) {
      if (r.selectorText) {
        for (const m of r.selectorText.matchAll(/\.((?:\\.|[-\w -￿])+)/g)) {
          const name = m[1].replace(/\\(.)/g, '$1');
          declared.add(name);
          if (into) into.add(name);
        }
      }
      if (r.cssRules) collect(r.cssRules, into); // @media, @supports, @layer …
    }
  };
  for (const sheet of document.styleSheets) {
    // The theme's own sheet is the one at the fixed path (#1002). base.css (#1001) and custom.css
    // (#1006) are deliberately NOT it: the point of the second reading is that neither the floor nor
    // the site's own overrides may stand in for a rule the theme was supposed to write.
    let isTheme = false;
    try {
      isTheme = !!sheet.href && new URL(sheet.href, window.location.href).pathname === themeSheetPath;
      if (isTheme) themeSheets.push(new URL(sheet.href, window.location.href).pathname);
    } catch { isTheme = false; }
    if (onlySheets) {
      let at = null;
      try { at = sheet.href ? new URL(sheet.href, window.location.href).pathname : null; } catch { at = null; }
      if (!at || !onlySheets.includes(at)) continue;
    }
    let rules;
    try { rules = sheet.cssRules; } catch { unreadableSheets++; continue; } // cross-origin (fonts)
    collect(rules, isTheme ? declaredByTheme : null);
  }
  const used = new Map();
  const els = scope
    ? [...document.querySelectorAll(scope)].flatMap((root) => [root, ...root.querySelectorAll('[class]')])
    : [...document.querySelectorAll('[class]')];
  for (const el of els) {
    for (const c of (el.getAttribute('class') || '').split(/\s+/).filter(Boolean)) {
      if (!used.has(c)) used.set(c, el.tagName.toLowerCase());
    }
  }
  return {
    unreadableSheets,
    sheets: document.styleSheets.length,
    used: used.size,
    orphans: [...used.entries()].filter(([c]) => !declared.has(c)).map(([c, tag]) => `${tag}.${c}`),
    themeSheets,
    // The hooks actually present in this page's markup, and which of them the theme sheet dresses.
    hooksOnPage: hookClasses.filter((c) => used.has(c)),
    hooksMissingFromTheme: hookClasses.filter((c) => used.has(c) && !declaredByTheme.has(c)),
  };
};
