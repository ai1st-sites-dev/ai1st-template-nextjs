#!/usr/bin/env bash
# #932 — build each theme for real and screenshot it. Zero AI calls (the sample site's content
# already exists; building it touches no model).
# #963 — paths parameterised: the template directory comes from this script's own location and
#        the output directory from THEME_GALLERY_DIR, so it runs anywhere.
#
# Usage:  THEME_GALLERY_DIR=/some/dir  bash shoot-themes.sh [theme-id ...]
#         (no ids = all themes in the registry)
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

IDS=("$@")
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

  rm -rf "$GAL/sites/$id"
  cp -r "$NEXT/out/security-vendor" "$GAL/sites/$id"

  python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$GAL/sites/$id" > /dev/null 2>&1 &
  srv=$!
  for _ in $(seq 1 40); do curl -sf "http://127.0.0.1:$PORT/" -o /dev/null && break; sleep 0.25; done
  node "$HERE/shoot.mjs" "http://127.0.0.1:$PORT" "$PUB/shots" "$id"
  shot_rc=$?
  kill $srv 2>/dev/null; wait $srv 2>/dev/null
  [ $shot_rc -ne 0 ] && echo "🔴 $id screenshot failed"
  echo "✅ $id  $(grep -o 'Theme .* applied: .*' "$log")"
done

echo "done. shots are in $PUB/shots"
ls -1 "$PUB/shots" | wc -l
