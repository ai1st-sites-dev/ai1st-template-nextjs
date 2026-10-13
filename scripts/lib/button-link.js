'use strict';

// button-link.js —— #1755 按钮的「去哪儿」（Link Type）⇄ 存在页面 JSON 里的 `href`。纯函数，不碰 DOM、不碰 Puck。
//
// 编辑器里改按钮只有一套控件（`src/components/editor/ButtonLink.tsx`）：画布上点按钮开的弹窗、Content 页 / 右栏按钮列表展开的那一项，
// 都是「Link Type 五选一 + 那一类的一格 + Button label」。五类不另存字段 —— 打开时选中哪一类，由存着的 `href` 推出来（§linkTypeOf），
// 改完再按所选那一类写回一个 `href`（§hrefFor）。存的形状跟今天一样：字符串地址，或本店电话 / 邮箱的引用 `{source}`（#1506，构建时
// 从 brand.json 展开，`item-sources.js`）。
//
//   类型      存成                                    推回来
//   page      站内地址 `/about`（`config.ts` §localeUrl） `/` 开头；空的或只有 `#` 也算这一类、什么都不选
//   external  `https://…`（没写协议就补 https://）      其余的字符串（`http…` 以及认不出来的）
//   email     `{source: "email"}` 或 `mailto:…`         引用 email / `mailto:` 开头
//   phone     `{source: "phone"}` 或 `tel:…`            引用 phone / `tel:` 开头
//   section   `#<块的 id>`（页面上的锚点，`blockAttrs.ts`） `#` 开头、后面还有字

const LINK_TYPES = ['page', 'external', 'email', 'phone', 'section'];

function isRef(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v) && typeof v.source === 'string';
}

/**
 * 存着的 `href` → 选中哪一类、那一格里显示什么。
 * @returns {{ type: 'page'|'external'|'email'|'phone'|'section', business?: boolean, value: string }}
 *   `business` 只在 email / phone 上有：true = 本店那个（引用），false = 另填的（`value` 是去掉 `mailto:` / `tel:` 的那段）。
 *   page 的 `value` 是地址（空串 = 什么都没选）；section 的 `value` 是块的 id（不带 `#`）；external 是整个网址。
 */
function linkTypeOf(href) {
  if (isRef(href)) {
    if (href.source === 'phone') return { type: 'phone', business: true, value: '' };
    if (href.source === 'email') return { type: 'email', business: true, value: '' };
    return { type: 'page', value: '' };
  }
  const s = typeof href === 'string' ? href.trim() : '';
  if (/^tel:/i.test(s)) return { type: 'phone', business: false, value: s.slice(4) };
  if (/^mailto:/i.test(s)) return { type: 'email', business: false, value: s.slice(7) };
  if (s === '' || s === '#') return { type: 'page', value: '' };
  if (s.startsWith('#')) return { type: 'section', value: s.slice(1) };
  if (s.startsWith('/')) return { type: 'page', value: s };
  return { type: 'external', value: s };
}

/** 外部网址：前后空白去掉；写了东西却没写协议（`example.com`）补 `https://`。`mailto:` / `tel:` 这类带冒号的协议原样。 */
function externalUrl(text) {
  const s = String(text || '').trim();
  if (!s) return '';
  return /^[a-z][a-z0-9+.-]*:/i.test(s) || s.startsWith('//') ? s : `https://${s}`;
}

/**
 * 所选那一类 + 那一格 → 存进去的 `href`。
 * @param {'page'|'external'|'email'|'phone'|'section'} type
 * @param {{ business?: boolean, value?: string, location?: number }} [o]
 *   email / phone：`business` 不是 false 就写引用（多门店时 `location` 是第几家，第一家不写，同 EditorApp §LinkHrefControl）。
 */
function hrefFor(type, o = {}) {
  const value = typeof o.value === 'string' ? o.value : '';
  if (type === 'email' || type === 'phone') {
    if (o.business !== false) {
      return Number.isInteger(o.location) && o.location > 0 ? { source: type, location: o.location } : { source: type };
    }
    const v = value.trim();
    return type === 'email' ? `mailto:${v}` : `tel:${v.replace(/\s+/g, '')}`;
  }
  if (type === 'section') return value ? `#${value}` : '';
  if (type === 'external') return externalUrl(value);
  return value.trim();
}

/** 一颗按钮改完的样子：只换 `label` / `href`，别的键（`style` / `icon` / `arrow` / `size`，以及以后加的）原样。 */
function withButton(item, patch) {
  const base = item && typeof item === 'object' && !Array.isArray(item) ? item : {};
  return { ...base, ...patch };
}

module.exports = { LINK_TYPES, linkTypeOf, hrefFor, externalUrl, withButton };
