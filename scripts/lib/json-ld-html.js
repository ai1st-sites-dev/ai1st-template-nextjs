/**
 * json-ld-html.js —— 结构化数据写进 `<script type="application/ld+json">` 的唯一写法（#1551 r3，QA2 发现）。
 *
 * 🔴 `JSON.stringify` 不转义 `<`：字符串里只要出现 `</script>`，浏览器就在那里把这个标签关掉，后面的字当成新的 HTML
 *    解析 ⟹ 存储型 XSS。写得进去的人很多：站主在编辑器里改 faq 块、用户自己输入的关键词（`seo.targetKeyword`）、
 *    建站向导里填的或从第三方页面抓来的社交链接（LocalBusiness `sameAs`，每一页都出）。
 *
 * 处置：把每个 `<` 写成 `<`。它在 JSON 里是同一个字符（`JSON.parse` 读回来逐字相同），而产物里不会再有任何 `<`，
 * 所以 `</script>` 与 `<!--` 都出现不了。`JsonLd.tsx` 里每一个 JSON-LD 标签都经这里，不许再直接写 `JSON.stringify`。
 * 纯函数、不碰 fs（这个文件会被编辑器的客户端包带进去，见 #1551 r2 dev 记忆）。
 */
'use strict';

function jsonLdHtml(schema) {
  return JSON.stringify(schema).replace(/</g, '\\u003c');
}

module.exports = { jsonLdHtml };
