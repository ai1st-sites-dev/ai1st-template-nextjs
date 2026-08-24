#!/usr/bin/env bash
# #963 — does the AI review actually discriminate? Two controls, both scored inside a full
# ranking (rank only means something against the whole set).
#
#   positive  two themes that differ ONLY in colour. Built, not faked: one theme is rebuilt with
#             another theme's colour block and nothing else changed, so "only the colours differ"
#             is true by construction. It MUST land in the top list.
#   negative  a dark full-bleed hero theme × a light minimal one. These really do not look alike —
#             in structure or in lightness — so they must NOT be near the top. The bar is
#             deliberately looser than the positive one (not in the top 3): a strict negative bar
#             invites tuning the prompt until a correct answer looks wrong.
#
# Usage: THEME_GALLERY_DIR=/some/dir ANTHROPIC_API_KEY=... bash check-controls.sh
#
# It rebuilds one theme, so it costs a build plus one full review round (~$2 for 30 themes).
# Run it when the review prompt, the model, or the thumbnail size changes — not every gallery run.
#
# 📌 #1061 — 它跟图册用的是同一个样例站（$NEXT/site），而 shoot.mjs 现在**必须**拍得到那一页
#    「每种块各一次」。站没撑开的话这里会停在下面那句「control screenshot failed」，
#    shoot.mjs 打出来的那行会告诉你撑开的命令。
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NEXT="$(cd "$HERE/../.." && pwd)"
GAL="${THEME_GALLERY_DIR:?Set THEME_GALLERY_DIR}"
: "${ANTHROPIC_API_KEY:?Set ANTHROPIC_API_KEY}"

# 🔴 #1161 —— 这四个默认值原来是 slate-pro / wine-burgundy / electric / sage-minimal，四个**全部**
# 在已下架那 30 套里。本票把那 30 套从注册表拿掉了，所以四个名字全指向空气。换成池子里的，挑法是
# 可复算的、不是看着顺眼（每套的 hero 底色写在它自己那份表的 `.hero { background-color }` 里）：
#
#   node -e "const fs=require('fs'),p=require('./scripts/theme-pool.json');
#     for(const [id,t] of Object.entries(p)){const c=fs.readFileSync('public/themes/'+t.sheet+'.css','utf-8');
#       const m=c.match(/^\.hero \{[\s\S]*?\}/m); const bg=(m[0].match(/background-color:\s*([^;]+);/)||[])[1];
#       console.log(id,(t.supports.hero||[])[0],bg);}"
#   本轮读数：80 套里 23 套 primary-900 · 15 套 primary-800 · 42 套 primary-50。
#
# 🔴 **换完这四个名字，这个脚本仍然跑不起来 —— 那是另一个毛病，不是本票造成的。** 下面那段
# `node -e` 在 `scripts/themes.js` 里找 `  '<id>': {` 当锚点，而 #1016 之后主题的定义**根本不在
# 那个文件里**（池子在 theme-pool.json，退役的在 themes-retired.js）⟹ 锚点恒找不到、脚本恒
# `exit 2`。改前的读数也一样：`git show c8d5dcd7:templates/nextjs/scripts/themes.js | grep -c "^  'slate-pro': {"`
# = 0。修它要改的是这个补丁怎么打（对 theme-pool.json 打），跟下架 30 套是两件各自 ship 各自对的
# 事 —— 按拆票判据该走新票。这里只把四个名字修成真的存在的，并把上面这条读数留在原地。
BASE_THEME="${CONTROL_BASE_THEME:-indigo-03}"        # the theme that gets recoloured
DONOR_THEME="${CONTROL_DONOR_THEME:-crimson-09}"     # whose colours it borrows (a clearly different hue)
NEG_A="${CONTROL_NEG_A:-magenta-01}"                 # with-media hero on primary-900 — dark full-bleed
NEG_B="${CONTROL_NEG_B:-lime-07}"                    # text-only hero on primary-50 — light and minimal
CTRL_ID="${BASE_THEME}-recoloured"

CTRL="$GAL/controls"
mkdir -p "$CTRL"
REG="$NEXT/scripts/themes.js"
BAK="$CTRL/themes.js.bak"
cp "$REG" "$BAK"

# 🔴 #1121 —— 样例站的 theme.json 和 brand.json 也要存一份，因为这个脚本现在也改后者。
#
# 换装这个动作从 #1121 起有两半（理由在 `scripts/lib/dress-site-in-theme.js` 的文件头），而后一半
# 就是**颜色的出处**。这个脚本的正例对照恰恰是「改过的注册表颜色要能到页面上」，所以它必须走那两半 ——
# 而那也意味着它会把 DONOR 的颜色写进样例站的 brand.json。不放回去的话，样例站从此穿着借来的颜色，
# 而图册、`theme-css-invariants-all-sheets.sh` 用的是同一个样例站。
#
# 🔴 存不下来就停手：本脚本是 `set -uo pipefail`（**没有 -e**），`cp` 失败不中止它，而收工那句 `cp`
#    会把一个空文件盖到样例站上 ⟹ brand.json 被清空，而 sync-config 没有它直接退出。
SITE_THEME_JSON="$NEXT/site/theme.json"
SITE_BRAND_JSON="$NEXT/site/brand.json"
if [ ! -f "$SITE_BRAND_JSON" ]; then
  echo "🔴 $SITE_BRAND_JSON 不在 —— 这个样例站还不是一个能构建的站。" >&2; exit 2
fi
HAD_THEME_JSON=0
ORIG_THEME_JSON="$CTRL/theme.json.bak"
ORIG_BRAND_JSON="$CTRL/brand.json.bak"
if [ -f "$SITE_THEME_JSON" ]; then
  cp "$SITE_THEME_JSON" "$ORIG_THEME_JSON" || { echo "🔴 存不下 $SITE_THEME_JSON 的原件。" >&2; exit 2; }
  HAD_THEME_JSON=1
fi
cp "$SITE_BRAND_JSON" "$ORIG_BRAND_JSON" || { echo "🔴 存不下 $SITE_BRAND_JSON 的原件。" >&2; exit 2; }

restore() {
  cp "$BAK" "$REG"
  if [ "$HAD_THEME_JSON" = "1" ]; then cp "$ORIG_THEME_JSON" "$SITE_THEME_JSON"; else rm -f "$SITE_THEME_JSON"; fi
  cp "$ORIG_BRAND_JSON" "$SITE_BRAND_JSON"
  return 0
}
trap restore EXIT

echo "── building $BASE_THEME with $DONOR_THEME's colours (nothing else changed)"
node -e "
const fs = require('fs');
const src = fs.readFileSync('$BAK', 'utf-8');
const { themes } = require('$BAK');
const donor = themes['$DONOR_THEME'].colors;
// Replace only the colors block of the base theme. Anchor on the theme key so the edit cannot
// land on another theme; assert exactly one match rather than trusting the regex.
const key = \"  '$BASE_THEME': {\";
const at = src.indexOf(key);
if (at < 0 || src.indexOf(key, at + 1) >= 0) { console.error('anchor not unique'); process.exit(2); }
const colorsAt = src.indexOf('    colors: {', at);
const colorsEnd = src.indexOf('    },', colorsAt) + '    },'.length;
if (colorsAt < 0 || colorsEnd <= colorsAt) { console.error('colors block not found'); process.exit(2); }
const block = '    colors: {\n' +
  '      primary: ' + JSON.stringify(donor.primary) + ',\n' +
  '      accent: ' + JSON.stringify(donor.accent) + '\n' +
  '    },';
fs.writeFileSync('$REG', src.slice(0, colorsAt) + block + src.slice(colorsEnd));
" || { echo '🔴 could not patch the registry'; exit 2; }

# 🔴 #1121 —— 上色两半都做，而且【在打过补丁的注册表之上】做。
#
# 这里原来是一句 `printf … > site/theme.json`：本票之前，构建期会拿注册表那套颜色现盖 brand.json，
# 所以上面那个补丁（把 DONOR 的 colors 块打进 BASE_THEME）自然就到了页面上。那处覆盖撤掉之后，
# 只写 theme.json 的话**改过的注册表到不了页面** ⟹ 两臂颜色相同 ⟹ 这个正例对照恒过、不再有区分力
# （QA1 在 #1121 r1 上点名的就是这一格）。
#
# 共用件是从磁盘上那份 scripts/themes.js 读的，也就是**刚被打过补丁的那份** —— 所以借来的颜色照旧
# 会落到 brand.json、再到页面上，这一格重新有变量。
node "$NEXT/scripts/lib/dress-site-in-theme.js" "$NEXT/site" "$BASE_THEME" \
  || { echo "🔴 could not dress the sample site in $BASE_THEME"; exit 2; }
( cd "$NEXT" && env -u ANTHROPIC_API_KEY npm run build ) > "$CTRL/build.log" 2>&1 || { echo '🔴 build failed'; tail -5 "$CTRL/build.log"; exit 2; }

PORT="${THEME_GALLERY_PORT:-8933}"
rm -rf "$CTRL/site"; cp -r "$NEXT/out/security-vendor" "$CTRL/site"
python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$CTRL/site" > /dev/null 2>&1 &
srv=$!
for _ in $(seq 1 40); do curl -sf "http://127.0.0.1:$PORT/" -o /dev/null && break; sleep 0.25; done
node "$HERE/shoot.mjs" "http://127.0.0.1:$PORT" "$CTRL" "$CTRL_ID"
shot_rc=$?
kill $srv 2>/dev/null; wait $srv 2>/dev/null
[ $shot_rc -ne 0 ] && { echo '🔴 control screenshot failed'; exit 2; }

restore
trap - EXIT
echo "registry restored: $(md5sum "$REG" | cut -c1-32) (was $(md5sum "$BAK" | cut -c1-32))"
echo "sample site restored: $NEXT/site 的 theme.json / brand.json 回到跑之前那份（#1121）"

echo "── scoring the full set with the control image added"
node "$HERE/review-pairs.mjs" --extra "$CTRL_ID=$CTRL/$CTRL_ID.png" --out "$CTRL/review-controls.json" --top 10 || exit 2

node -e "
const r = require('$CTRL/review-controls.json');
const rank = (a, b) => r.all.findIndex(x => (x.a === a && x.b === b) || (x.a === b && x.b === a)) + 1;
const pos = rank('$BASE_THEME', '$CTRL_ID');
const neg = rank('$NEG_A', '$NEG_B');
const posRow = r.all.find(x => [x.a, x.b].includes('$CTRL_ID'));
const negRow = r.all.find(x => (x.a === '$NEG_A' && x.b === '$NEG_B') || (x.a === '$NEG_B' && x.b === '$NEG_A'));
console.log('');
console.log('ranked pairs: ' + r.all.length + '  (top list = ' + r.top.length + ')');
console.log('positive  $BASE_THEME × $CTRL_ID  → rank ' + pos + ' / similarity ' + (posRow && posRow.similarity) + '  — ' + (posRow && posRow.reason));
console.log('negative  $NEG_A × $NEG_B  → rank ' + neg + ' / similarity ' + (negRow && negRow.similarity) + '  — ' + (negRow && negRow.reason));
const bad = [];
if (!pos || pos > r.top.length) bad.push('positive control did not make the top ' + r.top.length + ' (rank ' + pos + ')');
if (!neg || neg <= 3) bad.push('negative control is in the top 3 (rank ' + neg + ')');
console.log('');
if (bad.length) { bad.forEach(b => console.log('🔴 ' + b)); process.exit(1); }
console.log('✅ both controls behaved: the review separates a recolour from a genuinely different look.');
"
rc=$?

# 🔴 The registry and the sample site are back, but out/ is not: it still holds $BASE_THEME built
#    with $DONOR_THEME's colours. Run verify-applied.mjs against that and it reports 7 wrong accent
#    colours — a red about this script's leftovers, not about the theme. Say so rather than let the
#    next person debug it (that is exactly what happened the first time).
#
# 🔴 #1121 — the rebuild command needs BOTH halves of dressing now. Writing theme.json alone would
#    rebuild with whatever palette the sample site's brand.json holds, i.e. NOT $BASE_THEME's —
#    which is a different wrong reading, not a fix.
echo
echo "📌 out/ still holds $BASE_THEME built with $DONOR_THEME's colours. Rebuild before trusting"
echo "   anything that reads it:  node scripts/lib/dress-site-in-theme.js site $BASE_THEME && npm run build"
exit $rc
