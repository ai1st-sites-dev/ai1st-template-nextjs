'use client';

// #1343 —— 活图册的两个开关（切主题 / 切形态）。这个文件是**唯一**的 'use client' 部分：
// 每一格里画出来的东西仍然是服务端渲染的真组件，从 `{children}` 原样传进来。
//
// 🔴 为什么开关要住在客户端而格子不用：切主题不许重载页面（验收标准第 2 条用 window 上的哨兵值
//    判这件事）。而格子本身一次也不重新渲染 —— 下面改 `data-shape` 是直接改 DOM，不是 setState：
//    那些节点是从服务端传下来的 children，React 不拥有它们，也就不会把我们写上去的属性抹掉。
//
// 🔴 **不走 `layout.tsx` 那条 `ai1st:theme-preview-css` 通道**（#1343 正文点名）：那段脚本第一行是
//    `if(window.parent===window)return;`（`layout.tsx:209`），顶层页打开时整段 return，`:567` 那个
//    message 监听器根本没注册；就算塞进 iframe，`:568` 的 `if(e.origin!==T)return;` 还要求消息来自
//    dashboard 的 origin。两种形态下它都不会开火。图册页是模板自己的 app 代码，不需要 postMessage。

import { useEffect, useRef, useState } from 'react';

export interface CatalogTheme {
  id: string;
  label: string;
  /** `public/themes/<sheet>.css` —— 这套主题的**画法表**。 */
  sheet: string;
  /**
   * 这套主题的**皮**：`scripts/theme-css.js` 的 `buildThemeCss()` 现算出来的
   * `@import` 字体表 + `:root{…}`。
   * 🔴 公式只有一份，这里绝不重算 —— `layout.tsx:453-456` 为同一件事留过原话
   *    「翻译器只有一份 …… 重写一遍就是第二份真相，而它分叉时两边都不会红」。
   */
  skinCss: string;
}

interface Props {
  themes: CatalogTheme[];
  initialThemeId: string;
  /** 初次渲染就带上画法表的字节，免得第一屏先闪一下「没有画法」的样子。 */
  initialSheetCss: string;
  summary: string;
  children: React.ReactNode;
}

export default function CatalogBoard({ themes, initialThemeId, initialSheetCss, summary, children }: Props) {
  const [themeId, setThemeId] = useState(initialThemeId);
  const [sheetCss, setSheetCss] = useState(initialSheetCss);
  const [note, setNote] = useState('');
  // 🔴 挂上之前不许点。服务端发下来的是一个**原生** <select>，而 React 的 onChange 要等 hydration
  //    才接得上：在那之前点它，下拉的值真的变了、而页面一个字节都不会变 —— 一个会骗人的开关。
  //    实测（dev 首次编译那几秒，playwright 立刻 selectOption）：select 读到 fake-99，而皮和画法
  //    仍然是 ember-12 的。SSR 与首帧都渲染 disabled，所以这不是 hydration 不一致。
  const [ready, setReady] = useState(false);
  useEffect(() => { setReady(true); }, []);
  const cache = useRef<Map<string, string>>(new Map([[initialThemeId, initialSheetCss]]));

  const current = themes.find((t) => t.id === themeId);
  const skinCss = current ? current.skinCss : '';

  useEffect(() => {
    const t = themes.find((x) => x.id === themeId);
    if (!t) return;
    const cached = cache.current.get(themeId);
    if (cached !== undefined) { setSheetCss(cached); setNote(''); return; }
    let cancelled = false;
    // 画法表整份 fetch，不预先烤进页面：一份表 ~36 KB，池子是会长的（今天 2 套，历史上到过 97 套），
    // 全烤进 HTML 就是几 MB 的首屏。皮那一半很小，所以它是烤进来的。
    fetch(`/themes/${t.sheet}.css`)
      .then((r) => (r.ok ? r.text() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((txt) => {
        if (cancelled) return;
        cache.current.set(themeId, txt);
        setSheetCss(txt);
        setNote('');
      })
      .catch((e) => {
        if (cancelled) return;
        // 🔴 取不到就说出来，别留着上一套的画法装作换过了。
        setSheetCss('');
        setNote(`取不到 /themes/${t.sheet}.css（${e && e.message}）—— 现在页面上没有任何画法。`);
      });
    return () => { cancelled = true; };
  }, [themeId, themes]);

  return (
    <>
      {/* 🔴 这两张表排在 <head> 里那几条 <link> 的**后面**（它们在 <body> 里，文档顺序就是后面），
          所以同名变量、同特异度时它们赢 —— 展示站自己的 /theme.css 和 /custom.css 压不过它们。
          🔴 两张的先后也是承重的：皮在前、画法在后，跟 `buildThemeCss()` 自己拼出来的顺序一样
          （`theme-css.js`：@import → :root → 画法表）。而 `@import` 必须是一张样式表的第一行
          （`theme-css.js:17` 原话），所以它只能待在皮那一张里、且是那一张的开头。 */}
      <style data-catalog-skin="" dangerouslySetInnerHTML={{ __html: skinCss }} />
      <style data-catalog-sheet="" dangerouslySetInnerHTML={{ __html: sheetCss }} />
      <div className="catalog-bar" data-catalog-bar="">
        <strong className="catalog-bar__title">区块活图册</strong>
        <label className="catalog-bar__field">
          主题
          <select
            data-catalog-theme-select=""
            disabled={!ready}
            value={themeId}
            onChange={(e) => setThemeId(e.target.value)}
          >
            {themes.map((t) => (
              <option key={t.id} value={t.id}>{t.id} — {t.label}</option>
            ))}
          </select>
        </label>
        <span className="catalog-bar__summary" data-catalog-summary="">{summary}</span>
        {note ? <span className="catalog-bar__note">{note}</span> : null}
      </div>
      {children}
    </>
  );
}
