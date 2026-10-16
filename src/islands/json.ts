// #1798 —— 岛的 props 放进 `<script type="application/json">`：`<` 一律转义，否则数据里一段 `</script>` 就把脚本截断、
// 后面的字变成页面 HTML（XSS）。U+2028 / U+2029 也转：老浏览器把它们当换行。JSON.parse 认这些转义，读回来逐字相同。
const LS = new RegExp(String.fromCharCode(0x2028), 'g');
const PS = new RegExp(String.fromCharCode(0x2029), 'g');

export function islandJson(props: unknown): string {
  return JSON.stringify(props)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(LS, '\\u2028')
    .replace(PS, '\\u2029');
}
