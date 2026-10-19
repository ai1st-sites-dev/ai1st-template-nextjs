# DOMPurify 上游 XSS 向量集（#1833）

`expect-3.4.17.mjs` 逐字节拷自 <https://raw.githubusercontent.com/cure53/DOMPurify/3.4.17/test/fixtures/expect.mjs>
（tag `3.4.17`，跟 `templates/nextjs/package.json` / `dashboard/package.json` 装的 `dompurify` 同一个版本）。
DOMPurify 以 Apache-2.0 / MPL-2.0 双许可发布（上游仓 `LICENSE`）。

npm 包里没有这份文件，所以拷进仓里。`scripts/lib/sanitize-canvas.test.js` 拿每一条 `payload` 喂
`sanitizeForCanvas`，只断言「输出里没有能跑的东西」（没有 `<script`、`on*=`、`srcdoc`、`javascript:`，iframe 一律带
`sandbox`）—— **不**比 `expected`：那一列是上游默认配置的输出，我们的白名单更窄。

升级 `dompurify` 时按新的 tag 重拷一份，文件名跟着改，测试里那一行路径一起改。
