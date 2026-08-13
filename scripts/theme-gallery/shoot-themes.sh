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
  log="$GAL/logs/build-$id.log"
  printf '%s' "{\"themeId\":\"$id\",\"applied\":true}" > "$NEXT/site/theme.json"
  ( cd "$NEXT" && env -u ANTHROPIC_API_KEY npm run build ) > "$log" 2>&1
  rc=$?
  applied=$(grep -c "Theme \"$id\" applied" "$log")
  if [ $rc -ne 0 ]; then echo "🔴 $id build failed rc=$rc (log: $log)"; continue; fi
  if [ "$applied" -ne 1 ]; then echo "🔴 $id built, but sync-config never said it applied the theme (log: $log)"; continue; fi

  # 🔴 #981 条7 — the built directory is named after the sample site, so it cannot be written here. This used
  #    to be a literal `out/security-vendor`, which meant the script only worked with one particular sample
  #    and failed with a bare `cp: no such file` on any other. Take whatever single directory the build wrote.
  built=$(find "$NEXT/out" -mindepth 1 -maxdepth 1 -type d | head -1)
  if [ -z "$built" ]; then echo "🔴 $id built, but $NEXT/out has no site directory in it (log: $log)"; continue; fi
  rm -rf "$GAL/sites/$id"
  cp -r "$built" "$GAL/sites/$id"

  python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$GAL/sites/$id" > /dev/null 2>&1 &
  srv=$!
  for _ in $(seq 1 40); do curl -sf "http://127.0.0.1:$PORT/" -o /dev/null && break; sleep 0.25; done
  node "$HERE/shoot.mjs" "http://127.0.0.1:$PORT" "$PUB/shots" "$id" $CLOSEUP
  shot_rc=$?
  kill $srv 2>/dev/null; wait $srv 2>/dev/null
  [ $shot_rc -ne 0 ] && echo "🔴 $id screenshot failed"
  echo "✅ $id  $(grep -o 'Theme .* applied: .*' "$log")"
done

echo "done. shots are in $PUB/shots"
ls -1 "$PUB/shots" | wc -l
