#!/usr/bin/env bash
# #932 — build each theme for real and screenshot it. Zero AI calls (the sample site's content
# already exists; building it touches no model).
# #963 — paths parameterised: the template directory comes from this script's own location and
#        the output directory from THEME_GALLERY_DIR, so it runs anywhere.
#
# #981 条7 — absorbed tests/e2e/region-shots.mjs (deleted): the header/footer Region reading now comes out of
#        the DOM in shoot.mjs, and `--header-closeup` replaces that script's multi-locale pass.
#
# Usage:  THEME_GALLERY_DIR=/some/dir  bash shoot-themes.sh [--header-closeup] [theme-id ...]
#         (no ids = all themes in the registry)
#
#   --header-closeup   also write shots/<id>-header.png, a crop of the top 260px of the home page.
#                      🔴 Use it when the sample site at $NEXT/site is MULTI-LOCALE. The language switcher
#                      only renders on a multi-locale site, and in a 5000px-tall full-page shot it is a
#                      12px word — which is why #960 r2's defect (the switcher was the one header child the
#                      overlay never re-coloured, 1.08:1 on a dark hero) survived a human review of 30
#                      full-page shots. A multi-locale sample site is made the same way as any other:
#                        echo '{"siteId":"gallery-ml","companyName":"Northside Auto Care",
#                               "industry":"auto repair","location":"Toronto","skipAI":true,"language":"en",
#                               "secondaryLocales":["zh"],"brandNameByLocale":{"zh":"北岸汽车养护"}}' \
#                          | node scripts/create-site.js
#                      Creating it is deliberately NOT done here: this script does not own $NEXT/site (see
#                      the check below), and a tool that silently replaces the sample you pointed it at is
#                      a tool you cannot use twice.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NEXT="$(cd "$HERE/../.." && pwd)"          # templates/nextjs
GAL="${THEME_GALLERY_DIR:?Set THEME_GALLERY_DIR to the directory the gallery should be written to}"

# 🔴 #932 r2 — only PUB is served to the outside world (index.html + shots/). That directory's
#   whole contents are public: a caddy backup holding a live R2 key sat in an earlier version of
#   it for four hours before QA3 found it over the public URL. Logs, scripts, the sample site and
#   any config backup stay OUT of PUB.
PUB="$GAL/public"
PORT="${THEME_GALLERY_PORT:-8932}"   # just a free port to serve the built site on; override if taken
mkdir -p "$PUB/shots" "$GAL/sites" "$GAL/logs"

if [ ! -d "$NEXT/site" ]; then
  echo "🔴 $NEXT/site is missing — the sample site has to be in place before shooting." >&2
  exit 2
fi

# 🔴 #1061 —— 样例站必须有「每种块各出现一次」那一页，否则这本图册对 34 种块里的大多数是瞎的
#   （理由写在 shoot.mjs 的 PAGES 上面：#1060 改了 FAQ 的一行，图册前后两张图逐字节相同，
#    因为那个块根本不在图上）。
#
# 🔴 这里问的是**磁盘上有没有那个页面文件**，而 shoot.mjs 问的是**服出来的那一页答不答 200** ——
#   两个不同的判据，故意的。真正的判决权在 shoot.mjs（它量的是被拍的那份产物）；这里只是提前问一句，
#   免得跑完 30-80 次「构建 + 起服务 + 截图」之后才在每一套上各红一次。所以这里不许改成"警告继续"：
#   两处都失败得响，只是响的时刻不同。
ALLBLOCKS_PAGE=""
for p in "$NEXT"/site/pages/allblocks.json "$NEXT"/site/*/pages/allblocks.json; do
  [ -f "$p" ] && { ALLBLOCKS_PAGE="$p"; break; }
done
if [ -z "$ALLBLOCKS_PAGE" ]; then
  echo "🔴 $NEXT/site 里没有 allblocks 那一页 —— 图册会漏掉 34 种块里的大多数，不拍。" >&2
  echo "   撑开这个样例站（不调 AI、不花钱，它只往站里加页面和几处夹具数据）：" >&2
  echo "     cd $NEXT && node scripts/theme-css-invariants-sample-pages.js \"$NEXT/site\"" >&2
  echo "   （它只认多语言形状的站，也就是 create-site.js 现造出来的那种 site/<locale>/。）" >&2
  exit 2
fi

# 🔴 #1121 —— 这个脚本会给样例站换装，所以跑完要把它放回原样。
#
# 换装这个动作从 #1121 起有两半（site/theme.json + site/brand.json，理由在
# `scripts/lib/dress-site-in-theme.js` 的文件头），而后一半是**颜色的出处**。以前只写 theme.json
# 时留一份在站上的代价还小；现在不还原的话，样例站会一直穿着**最后拍的那套主题**的调色板，而
# `theme-css-invariants-all-sheets.sh` 用的是同一个样例站、并且拿它的 theme.json 当「没有自己
# 主题的那几张表」的兜底调色板 ⟹ 上一次拍图册留下的东西会静默改掉另一套检查的读数。
#
# 🔴 存不下来就停手，不是「跑完再说」：这个脚本是 `set -uo pipefail`（**没有 -e**），`cp` 失败
#    不中止它，而收工那句 `cp` 会把一个空的 mktemp 文件盖到样例站上 ⟹ 站的 brand.json 被清空，
#    而 sync-config 没有它直接退出。（同款的账 `theme-css-invariants-all-sheets.sh` 已经付过。）
SITE_THEME_JSON="$NEXT/site/theme.json"
SITE_BRAND_JSON="$NEXT/site/brand.json"
if [ ! -f "$SITE_BRAND_JSON" ]; then
  echo "🔴 $SITE_BRAND_JSON 不在 —— 这个样例站还不是一个能构建的站，不拍。" >&2
  exit 2
fi
HAD_THEME_JSON=0
ORIG_THEME_JSON="$(mktemp)"
ORIG_BRAND_JSON="$(mktemp)"
if [ -f "$SITE_THEME_JSON" ]; then
  if ! cp "$SITE_THEME_JSON" "$ORIG_THEME_JSON"; then
    echo "🔴 存不下 $SITE_THEME_JSON 的原件 —— 不拍（这一轮会改它）。" >&2
    rm -f "$ORIG_THEME_JSON" "$ORIG_BRAND_JSON"; exit 2
  fi
  HAD_THEME_JSON=1
fi
if ! cp "$SITE_BRAND_JSON" "$ORIG_BRAND_JSON"; then
  echo "🔴 存不下 $SITE_BRAND_JSON 的原件 —— 不拍（这一轮会改它）。" >&2
  rm -f "$ORIG_THEME_JSON" "$ORIG_BRAND_JSON"; exit 2
fi
restore_sample_site() {
  if [ "$HAD_THEME_JSON" = "1" ]; then cp "$ORIG_THEME_JSON" "$SITE_THEME_JSON"; else rm -f "$SITE_THEME_JSON"; fi
  cp "$ORIG_BRAND_JSON" "$SITE_BRAND_JSON"
  rm -f "$ORIG_THEME_JSON" "$ORIG_BRAND_JSON"
  return 0
}
trap restore_sample_site EXIT

CLOSEUP=""
IDS=()
for a in "$@"; do
  case "$a" in
    --header-closeup) CLOSEUP="--header-closeup" ;;
    -*) echo "🔴 unknown option: $a" >&2; exit 2 ;;
    *) IDS+=("$a") ;;
  esac
done
if [ ${#IDS[@]} -eq 0 ]; then
  mapfile -t IDS < <(node -e "console.log(Object.keys(require('$NEXT/scripts/themes.js').themes).join('\n'))")
fi
echo "shooting ${#IDS[@]} theme(s): ${IDS[*]}"

for id in "${IDS[@]}"; do
  echo "───────── $id"
  # 🔴 #1061 r2 —— 这一轮对这套主题的起点：先清掉它上一轮留下的图和读数。
  #   必须在建站**之前**：下面建站失败 / 主题没装上 / out 里没有目录，三个分支都 `continue`，
  #   shoot.mjs 一次都不跑 ⟹ 上一轮的三张图和那份 <id>.json 会留在盘上，被下一本图册当成这一轮的
  #   （gallery.mjs 的卡片就是照着盘上有哪几张图摆的）。理由整段写在 shot-files.js 头上。
  node -e 'const {clearShots} = require(process.argv[1]);
    const gone = clearShots(process.argv[2], process.argv[3]);
    if (gone.length) console.log("🧹 清掉上一轮的 " + gone.length + " 个产物：" + gone.join(" "));' \
    "$HERE/shot-files.js" "$PUB/shots" "$id"
  log="$GAL/logs/build-$id.log"
  # 🔴 #1121 —— 给样例站上色的动作有两半（theme.json + brand.json），两半都由这个共用件做。
  #    以前这里是一句 `printf … > site/theme.json`，而 #1121 撤掉了构建期那处「注册表盖
  #    brand.json」之后，只写前一半的后果是：110 套主题会全部穿着**样例站建站那天**那一套调色板
  #    被拍照，而这本图册的全部意义就是「这套主题长什么样」。理由整段在
  #    `scripts/lib/dress-site-in-theme.js` 的文件头。
  if ! node "$NEXT/scripts/lib/dress-site-in-theme.js" "$NEXT/site" "$id"; then
    echo "🔴 $id: could not dress the sample site in it — nothing was built or shot"; continue
  fi
  ( cd "$NEXT" && env -u ANTHROPIC_API_KEY npm run build ) > "$log" 2>&1
  rc=$?
  if [ $rc -ne 0 ]; then echo "🔴 $id build failed rc=$rc (log: $log)"; continue; fi

  # 🔴 #981 条7 — the built directory is named after the sample site, so it cannot be written here. This used
  #    to be a literal `out/security-vendor`, which meant the script only worked with one particular sample
  #    and failed with a bare `cp: no such file` on any other. Take whatever single directory the build wrote.
  built=$(find "$NEXT/out" -mindepth 1 -maxdepth 1 -type d | head -1)
  if [ -z "$built" ]; then echo "🔴 $id built, but $NEXT/out has no site directory in it (log: $log)"; continue; fi

  # 🔴 #1121 —— 放行判据从【日志字样】换成【产物读数】。
  #
  # 这里原来是 `grep -c "Theme \"$id\" applied" "$log"`，也就是拿 sync-config 打的一句话当凭据。
  # 本票把那句话改掉了（颜色不再从注册表来，所以它不能再说 "applied: colors + fonts + N"），于是
  # 那个 grep 对**每一套**主题都读到 0 ⟹ 每一套都 `continue` ⟹ 一张图都拍不出来。QA1 实测 1 → 0。
  #
  # 换成量被拍的那份产物，两条独立的读数，两条都得成立：
  #   ① 调色板真的到了页面上   —— out/<站>/theme.css 里 --color-primary-500 等于注册表那套
  #   ② 主题的画法真的到了页面上 —— 生成的 config-data.ts 里 hero 的 variant 等于这套主题声明的
  # ① 覆盖旧判据本来管的那件事（sync-config 认得这个 id 并按它上了色）而且更强：旧判据只要那行
  # 日志在就放行，日志在跟字节落地不是一件事。② 是旧判据里「N section variant(s)」那一半的直接
  # 读数。两条都不依赖任何一句话的措辞 —— 下一次改日志不会再断一次。
  # 🔴 写成 `if ! reading=$(…)` 而不是先赋值再读 `$?`：后者虽然在【只有一个赋值】的这行上也是对的，
  #    但本仓为「`$?` 读到的是同一行里那个命令替换的码」付过一次账，不留这种要读第二遍才敢确定的写法。
  if ! reading=$(node -e '
    const fs = require("fs"), path = require("path");
    const [next, built, id] = process.argv.slice(1);
    const { themes, layoutFor } = require(path.join(next, "scripts/themes.js"));
    const t = themes[id];
    if (!t) { console.error(`no theme "${id}" in the registry`); process.exit(1); }
    const want = t.colors && t.colors.primary && t.colors.primary["500"];
    if (!want) { console.error(`theme "${id}" has no colors.primary.500 to check against`); process.exit(1); }
    const sheet = fs.readFileSync(path.join(built, "theme.css"), "utf-8");
    if (!sheet.includes(`--color-primary-500: ${want};`)) {
      const got = (sheet.match(/--color-primary-500: *([^;]+);/) || [])[1];
      console.error(`the page is on --color-primary-500 ${got || "(not found)"}, the registry says ${want}`);
      process.exit(1);
    }
    // ② hero 的画法。主题对 hero 没有偏好时这一半没有可比的东西，说出来而不是假装量过了。
    const heroWant = layoutFor(id).hero;
    let heroNote = "hero: this theme states no preference (nothing to compare)";
    if (heroWant) {
      const cd = fs.readFileSync(path.join(next, "src/lib/config-data.ts"), "utf-8");
      const m = cd.match(/export const pagesByLocale = (.*);\n/);
      if (!m) { console.error("cannot read pagesByLocale out of config-data.ts"); process.exit(1); }
      const heroes = [];
      for (const list of Object.values(JSON.parse(m[1])))
        for (const p of list)
          for (const b of (p.blocks || [])) if (b.type === "hero") heroes.push(b.data && b.data.variant);
      if (!heroes.length) { console.error("no hero block in the built config — cannot check the variant"); process.exit(1); }
      const wrong = heroes.filter((v) => v !== heroWant);
      if (wrong.length) {
        console.error(`${wrong.length} of ${heroes.length} hero block(s) are on "${wrong[0]}", the theme declares "${heroWant}"`);
        process.exit(1);
      }
      heroNote = `hero: ${heroes.length} block(s) all on "${heroWant}"`;
    }
    console.log(`--color-primary-500 ${want} · ${heroNote}`);
  ' "$NEXT" "$built" "$id"); then
    echo "🔴 $id built, but the theme did not reach the page (log: $log) — nothing was shot for it"
    continue
  fi

  rm -rf "$GAL/sites/$id"
  cp -r "$built" "$GAL/sites/$id"

  python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$GAL/sites/$id" > /dev/null 2>&1 &
  srv=$!
  for _ in $(seq 1 40); do curl -sf "http://127.0.0.1:$PORT/" -o /dev/null && break; sleep 0.25; done
  node "$HERE/shoot.mjs" "http://127.0.0.1:$PORT" "$PUB/shots" "$id" $CLOSEUP
  shot_rc=$?
  kill $srv 2>/dev/null; wait $srv 2>/dev/null
  [ $shot_rc -ne 0 ] && echo "🔴 $id screenshot failed"
  # 🔴 #1121 —— 这里原来打的是 `grep -o 'Theme .* applied: .*' "$log"`，也就是把那句被本票改掉的
  #    日志再回显一遍（本票之后它恒为空）。改成打上面那两条**产物读数**：说的是页面上真有什么，
  #    而不是构建说了什么。
  echo "✅ $id  $reading"
done

restore_sample_site
trap - EXIT
echo "sample site restored: $NEXT/site 的 theme.json / brand.json 回到跑之前那份"

# 🔴 out/ 与 src/lib/config-data.ts 仍然是**最后那一套主题**的构建产物 —— 样例站的配置还原了，
#    这两个没有（它们是构建输出，不是这个脚本的输入）。谁要拿它们下结论（例如
#    `verify-applied.mjs <id>`），先照那个 id 重新上色再构建一次：
#      node scripts/lib/dress-site-in-theme.js site <themeId> && npm run build
echo "📌 out/ 里那份是最后拍的那套主题的产物。拿它量别的主题之前先重新上色 + 重建。"

echo "done. shots are in $PUB/shots"
ls -1 "$PUB/shots" | wc -l
