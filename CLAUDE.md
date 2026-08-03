# templates/nextjs — Site Builder engine

Loaded when working under `templates/nextjs/`. **产品定位与冻结术语在仓库根 `CLAUDE.md`**，那份是权威；本文件只留这个目录特有的东西。

> 📌 **本文件 2026-08-03 重写。** 上一版（一直未进 git）documented 一整套**不存在**的命令 —— `npm run create-site` 带 flag、`--list-themes`、`dev:<site>` / `build:<site>` / `build:all`、`SITE_CONFIG` 环境变量、`config/` 目录、`blog-index.json`、`@config/*` 别名。那些是 #658 已经在根 `CLAUDE.md` 里逐条更正过的幻影；一份自动加载的 CLAUDE.md 写着假命令，比没有这份文件更糟。下面每条都在本机实证过。

## 真实的命令（就这 6 个 npm script）

```bash
$ node -e "console.log(Object.keys(require('./package.json').scripts).join(', '))"
predev, dev, prebuild, build, start, lint:scripts
```

- `npm run dev` / `npm run build` —— `predev`/`prebuild` 钩子自动跑 `scripts/sync-config.js`
- `npm run lint:scripts` —— 唯一配置了的 lint（只覆盖 `scripts/`，不覆盖 `src/`）
- **没有测试命令**：验证改动用 `npm run build`

🔴 **`create-site` 不是 npm script，也不吃命令行 flag** —— 它是容器侧生成器，**从 stdin 读 JSON**，往 stdout 吐 JSON-lines 进度事件（`scripts/create-site.js:6-9`）：

```bash
echo '{"siteId":"a1b2c3d4", ...}' | ANTHROPIC_API_KEY=xxx node scripts/create-site.js
```

用 flag 调它会立刻死在 `Failed to read input: Invalid JSON on stdin`。字段清单读脚本自己的头注释。

## 配置怎么进到应用里

**一次只有一个活动站点目录，名字是 `site/`**（`sync-config.js:10`，`path.join(rootDir, 'site')`）—— 不是 `sites/<name>/`，**不读任何 `SITE_CONFIG`**。`site_meta.json` 存在时转多语言模式，配置改从 `site/<locale>/` 读。

🔴 **没有 `config/` 目录，什么都不"拷贝过去"** —— sync-config **生成**一个 TypeScript 模块 `src/lib/config-data.ts`（`:250`/`:265`），把配置写成导出常量。它是构建产物却住在 `src/` 下：跑完 build 会留在那儿，之后 `tsc` 校验的是**最后一次 sync 的那个站**。

`src/lib/config.ts` 用**普通相对路径**导入它并再导出 `brand` / `navigation` / `seo` / `services` / `blogPosts` / `allPages` + 取页面的辅助函数。🔴 **不存在 `@config/*` 别名**，`tsconfig.json` 只定义 `@/*` → `./src/*`。

博客同理：`site/blog/*.json`（多语言 `site/<locale>/blog/`）被读进生成的 `config-data.ts`（`blogPostsByLocale`）—— **本仓库任何地方都没有 `blog-index.json`**。

📌 `sites/` 与 `site/` 都被 `.gitignore` 忽略（本目录 `.gitignore:10`），所以你在工作树里看到的站点目录不进版本库。

## 加一个 section

1. 写 `src/components/sections/MyNewSection.tsx`（收一个 `data` prop）
2. 在 `src/lib/sections/registry.ts` 注册：`'my-new': MyNewSection`
3. 页面 JSON 里用：`{ "type": "my-new", "data": { ... } }`

现有 32 个 section 类型、各自的 variant、页面/博客 JSON 的字段格式、主题与 CSS 变量、静态导出与 SEO 的细节 —— 都在根 `CLAUDE.md`，别在这里再抄一份（两份必然分叉，这正是上一版变成幻影文档的原因）。
