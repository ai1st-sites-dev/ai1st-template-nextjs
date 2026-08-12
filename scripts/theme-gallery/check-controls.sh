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
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NEXT="$(cd "$HERE/../.." && pwd)"
GAL="${THEME_GALLERY_DIR:?Set THEME_GALLERY_DIR}"
: "${ANTHROPIC_API_KEY:?Set ANTHROPIC_API_KEY}"

BASE_THEME="${CONTROL_BASE_THEME:-slate-pro}"        # the theme that gets recoloured
DONOR_THEME="${CONTROL_DONOR_THEME:-wine-burgundy}"  # whose colours it borrows
NEG_A="${CONTROL_NEG_A:-electric}"                   # gradient-overlay hero, dark full-bleed
NEG_B="${CONTROL_NEG_B:-sage-minimal}"               # minimal hero, light
CTRL_ID="${BASE_THEME}-recoloured"

CTRL="$GAL/controls"
mkdir -p "$CTRL"
REG="$NEXT/scripts/themes.js"
BAK="$CTRL/themes.js.bak"
cp "$REG" "$BAK"
restore() { cp "$BAK" "$REG"; }
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

printf '%s' "{\"themeId\":\"$BASE_THEME\",\"applied\":true}" > "$NEXT/site/theme.json"
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

# 🔴 The registry is back, but out/ is not: it still holds $BASE_THEME built with $DONOR_THEME's
#    colours. Run verify-applied.mjs against that and it reports 7 wrong accent colours — a red
#    about this script's leftovers, not about the theme. Say so rather than let the next person
#    debug it (that is exactly what happened the first time).
echo
echo "📌 out/ still holds $BASE_THEME built with $DONOR_THEME's colours. Rebuild before trusting"
echo "   anything that reads it:  printf '%s' '{\"themeId\":\"$BASE_THEME\",\"applied\":true}' > site/theme.json && npm run build"
exit $rc
