#!/usr/bin/env bash
# theme-css-invariants-all-sheets.sh — build a sample site once per theme sheet and take the
# runtime reading on each (#1009). This is the automatic caller for scripts/theme-css-invariants.mjs.
#
#   bash scripts/theme-css-invariants-all-sheets.sh [--make-sample-site] [sheet-name …]
#
#   --make-sample-site   create a demo site in templates/nextjs/site first, but ONLY if there is none.
#                        It never replaces a site you put there yourself (same rule as
#                        scripts/theme-gallery/shoot-themes.sh: a tool that silently swaps out the
#                        sample you pointed it at is a tool you cannot use twice). No AI, no cost:
#                        create-site.js's skipAI path returns before the ANTHROPIC_API_KEY check.
#   sheet-name …         which sheets in public/themes/ to check; default is all of them.
#
# Exit 0 = every sheet's page holds every invariant.
# Exit 1 = at least one does not — the sheet is named, and so is the hook it forgot.
# Exit 2 = the reading could not be taken (no playwright, a build that failed, no free port …).
#          🔴 NOT the same answer as 0. It is why the two are separate codes.
#
# ══ WHY EVERY SHEET, WHICH IS THE POINT OF THE WHOLE THING ═══════════════════════════════════════
# The fifth invariant asks whether the THEME'S OWN sheet has a rule for each hook in the markup
# (#996). Phase 2 (spec §8) moves 34 blocks to neutral markup, and every move needs a rule in every
# sheet. Checking the one sheet a site happens to wear would answer that question for one of the
# three and stay green on the other two — which is exactly the failure spec §8 describes: "the block
# is left with only base.css's look, and the page still opens, and the build is still green".
#
# ══ WHY IT IS NOT PART OF THE SITE BUILD (today) ═════════════════════════════════════════════════
# It needs a browser. `scripts/theme-css-invariants.mjs` borrows the playwright the e2e suite
# installs (scripts/theme-gallery/paths.mjs), and templates/nextjs does not depend on playwright —
# neither does the site repo a build runs in, and the build image has chromium but no driver for it.
# Measured cost on this machine: the reading itself is ~1.9s against an already-built site, so the
# expensive part is not the check, it is putting a browser where the build runs. That is a scope
# decision (#1009, PM), so the runtime half runs here — in CI, over a sample site, over every sheet.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NEXT="$(cd "$HERE/.." && pwd)"            # templates/nextjs
THEMES_DIR="$NEXT/public/themes"

MAKE_SITE=0
SHEETS=()
for a in "$@"; do
  case "$a" in
    --make-sample-site) MAKE_SITE=1 ;;
    -*) echo "🔴 unknown option: $a" >&2; exit 2 ;;
    *) SHEETS+=("$a") ;;
  esac
done

# ── the instrument, before anything else ────────────────────────────────────────────────────────
# 🔴 Asked FIRST and answered with 2, not 1. "There is no browser here" is not a statement about any
# theme sheet, and a caller that reads a missing tool as a failing sheet (or as a pass) is the shape
# this repo keeps writing down.
PW="${PLAYWRIGHT_MODULE:-$(cd "$NEXT/../.." && pwd)/tests/e2e/node_modules/playwright/index.mjs}"
if [ ! -e "$PW" ]; then
  echo "🔴 cannot take the reading: no playwright at $PW" >&2
  echo "   install it where the e2e suite keeps it (cd tests/e2e && npm ci && npx playwright install chromium)," >&2
  echo "   or point PLAYWRIGHT_MODULE at one. Nothing was judged." >&2
  exit 2
fi
export PLAYWRIGHT_MODULE="$PW"

if [ ! -d "$THEMES_DIR" ]; then
  echo "🔴 cannot take the reading: $THEMES_DIR does not exist" >&2
  exit 2
fi

if [ ${#SHEETS[@]} -eq 0 ]; then
  mapfile -t SHEETS < <(cd "$THEMES_DIR" && ls -1 ./*.css 2>/dev/null | sed 's|^\./||; s|\.css$||')
fi
if [ ${#SHEETS[@]} -eq 0 ]; then
  # Nothing to look at is not a pass.
  echo "🔴 cannot take the reading: no .css in $THEMES_DIR" >&2
  exit 2
fi

# ── the sample site ─────────────────────────────────────────────────────────────────────────────
if [ ! -f "$NEXT/site/brand.json" ]; then
  if [ "$MAKE_SITE" != "1" ]; then
    echo "🔴 no sample site at $NEXT/site — pass --make-sample-site, or put one there." >&2
    exit 2
  fi
  echo "── making a demo sample site (skipAI, no AI calls)"
  if ! echo '{"siteId":"themecss1","companyName":"Northside Auto Care","industry":"auto repair",
               "location":"Toronto","skipAI":true,"language":"en"}' \
       | ( cd "$NEXT" && env -u ANTHROPIC_API_KEY node scripts/create-site.js ) >/dev/null; then
    echo "🔴 cannot take the reading: create-site.js (skipAI) failed" >&2
    exit 2
  fi
fi

THEME_JSON="$NEXT/site/theme.json"
ORIGINAL_THEME_JSON="$(mktemp)"
# 🔴 "as it was found" includes "it was not there" (#1009 r1, QA3). theme.json is an optional file
# (CLAUDE.md says so) and this script writes one for every sheet it measures. The first version only
# copied a saved file back, so a site that had none was left wearing one this script invented —
# `applied: true` with a themeId taken from the registry's first entry, which is not even the site's
# own. Whether the file existed is the thing to remember, so remember it, rather than asking a
# restored-from-nothing tempfile to answer it.
HAD_THEME_JSON=0
if [ -f "$THEME_JSON" ]; then
  cp "$THEME_JSON" "$ORIGINAL_THEME_JSON"
  HAD_THEME_JSON=1
fi
# The sample site is left exactly as it was found, whichever way this script ends: it is the input to
# the next run, and a run that quietly rewrites its own input cannot be repeated.
cleanup() {
  if [ "$HAD_THEME_JSON" = "1" ]; then
    cp "$ORIGINAL_THEME_JSON" "$THEME_JSON"
  else
    rm -f "$THEME_JSON"
  fi
  rm -f "$ORIGINAL_THEME_JSON"
  [ -n "${SRV_PID:-}" ] && kill "$SRV_PID" 2>/dev/null
  return 0
}
trap cleanup EXIT

# `applied: true` needs a themeId that is in the registry — keep the one the site already has so this
# script is not also choosing the palette.
THEME_ID="$(node -e "
  const fs=require('fs');
  let id='';
  try { id=(JSON.parse(fs.readFileSync('$THEME_JSON','utf-8')).themeId)||''; } catch {}
  if(!id) id=Object.keys(require('$NEXT/scripts/themes.js').themes)[0];
  process.stdout.write(id);
")"
if [ -z "$THEME_ID" ]; then
  echo "🔴 cannot take the reading: no themeId to build with" >&2
  exit 2
fi

# ── which directory under out/ is the site we just built ────────────────────────────────────────
# 🔴 NOT `find out -maxdepth 1 -type d | head -1` (#1009 r1, QA3). out/ deliberately keeps other
# sites' previous builds — scripts/move-build-output.js backs up out/, lets next wipe it, and puts the
# fresh build back as out/<SITE_CONFIG>. So with two directories in there, `head -1` took whichever
# came first in readdir order: measured, a stale second site was picked, the sheet under test had its
# .hero__sub rule deleted, and this script printed ✅ while its own reading line said it had been
# looking at the OTHER site's page. A wrong-site reading that says PASS is worse than no reading.
#
# The name is derived from move-build-output.js instead of being written down a second time (the
# default lives in exactly one place; two copies drift and the drift is silent). If the derivation
# comes back empty, that is exit 2 — "I do not know which directory" is never a pass.
OUT_NAME="${SITE_CONFIG:-$(node -e "
  const src = require('fs').readFileSync('$NEXT/scripts/move-build-output.js', 'utf-8');
  const m = src.match(/SITE_CONFIG\s*\|\|\s*'([^']+)'/);
  process.stdout.write(m ? m[1] : '');
")}"
if [ -z "$OUT_NAME" ]; then
  echo "🔴 cannot take the reading: could not work out which out/<dir> a build lands in" >&2
  echo "   (scripts/move-build-output.js no longer has a \`SITE_CONFIG || '<name>'\` default to read," >&2
  echo "   so set SITE_CONFIG yourself.) Nothing was judged." >&2
  exit 2
fi

free_port() {
  # Asked of the kernel, not guessed: this machine runs a couple of dozen dev servers and a hardcoded
  # port reads someone else's site while looking like a clean pass (measured while writing this: a
  # busy 8991 served another agent's build and the reading came out of THEIR page).
  python3 - <<'PY'
import socket
s = socket.socket()
s.bind(('127.0.0.1', 0))
print(s.getsockname()[1])
s.close()
PY
}

fail=0
unmeasured=0
echo "checking ${#SHEETS[@]} sheet(s) against the runtime invariants: ${SHEETS[*]}"

for sheet in "${SHEETS[@]}"; do
  echo "───────── $sheet"
  if [ ! -f "$THEMES_DIR/$sheet.css" ]; then
    echo "🔴 $sheet: no such sheet ($THEMES_DIR/$sheet.css)"
    unmeasured=1
    continue
  fi
  node -e "
    require('fs').writeFileSync('$THEME_JSON',
      JSON.stringify({ themeId: '$THEME_ID', applied: true, css: '$sheet' }, null, 2) + '\n');
  "
  log="$(mktemp)"
  if ! ( cd "$NEXT" && env -u ANTHROPIC_API_KEY npm run build ) > "$log" 2>&1; then
    echo "🔴 $sheet: the build failed — the invariants were never measured. Last lines:"
    tail -15 "$log" | sed 's/^/     /'
    unmeasured=1
    rm -f "$log"
    continue
  fi
  # 🔴 The sheet has to be in the built page, not merely in the repo. sync-config prints one line
  # either way (#991) precisely so "no sheet" and "a sheet that did nothing" stop looking identical.
  if ! grep -q "Theme CSS: public/themes/$sheet.css" "$log"; then
    echo "🔴 $sheet: built, but sync-config never said it applied this sheet — nothing was measured."
    grep -n 'Theme CSS' "$log" | sed 's/^/     /'
    unmeasured=1
    rm -f "$log"
    continue
  fi
  rm -f "$log"

  built="$NEXT/out/$OUT_NAME"
  if [ ! -d "$built" ]; then
    echo "🔴 $sheet: build reported success but there is no $built — nothing measured."
    echo "     out/ holds: $(ls -1 "$NEXT/out" 2>/dev/null | tr '\n' ' ')"
    unmeasured=1
    continue
  fi
  # Second, independent guard on the same mistake: the build about to be served must itself be wearing
  # the sheet under test. This asks the bytes, not the path arithmetic above, so a wrong directory
  # cannot pass by both.
  #
  # 🔴 #1002 changed the QUESTION, not just the string. This used to grep the built index.html for
  # `/themes/<sheet>.css`, the <link> src/app/layout.tsx emitted. That href is gone: #1002 pastes the
  # sheet's bytes INTO the fixed-path `/theme.css` (scripts/theme-css.js, `blockLayoutCss`) precisely so
  # that no byte of the HTML depends on which theme the site wears — that is the whole mechanism behind
  # "changing a theme needs no rebuild". So "which sheet is this build wearing" has to be asked of
  # theme.css's bytes now. Left unmigrated it read "not this build" for every sheet and exited 2 (that
  # is what it did on main at `eceda5a5`) — loud, and never a false pass, which is why it is still here
  # to fix rather than a green that meant nothing.
  #
  # 🔴 WHOLE-SHEET CONTAINMENT, not "a selector out of it". A rule-level probe would swallow the very
  # mutation this guard exists to let through: deleting one hook's rule from the sheet has to come out
  # of the fifth invariant below as exit 1 naming that hook, and a probe for that rule would turn it
  # into exit 2 "nothing was measured" instead — the check would look like it still worked while having
  # stopped answering. Containment is read against the sheet file as it is now, so the mutation keeps it
  # true and the reading stays the invariant's to make.
  #
  # 🔴 An empty sheet is not a measurement either: "" is contained in anything, so it is refused
  # explicitly rather than passing every directory in existence.
  #
  # 📌 THIS TICKET ALREADY MIGRATED THE SAME READING ONCE, ONE FILE OVER — scripts/theme-pipeline/run.js
  # `whyNotThisBuild` (the function is #1004's; #1002 r5b, commit 4a56adf5, moved it off the href for
  # exactly this reason, measured there as 0/2 candidates admitted with the reason "没有引
  # /themes/gen-07-1.css"). It landed on the same predicate: does the built theme.css carry this sheet's
  # bytes. Two implementations rather than one call, because that one is a CLI internal and not an
  # export — so if theme-css.js ever stops pasting the sheet verbatim, BOTH have to move. It is also
  # the harder question of the two: two sheets can share a filename, they cannot share their bytes.
  if ! probe="$(node -e '
    const fs = require("fs");
    const [sheetPath, servedPath, sheetName, siteDir, indexPath] = process.argv.slice(1);
    // index.html is what gets served; the old grep read it, so keep asking whether it is there at all.
    if (!fs.existsSync(indexPath)) { console.log("there is no index.html in it"); process.exit(1); }
    let served;
    try { served = fs.readFileSync(servedPath, "utf-8"); }
    catch { console.log("there is no theme.css in it at all"); process.exit(1); }
    const sheet = fs.readFileSync(sheetPath, "utf-8").trimEnd();  // == what theme-css.js pastes
    if (!sheet) { console.log("public/themes/" + sheetName + ".css is empty — an empty sheet is contained in every file, so nothing would be measured"); process.exit(1); }
    if (!served.includes(sheet)) {
      const frozen = fs.existsSync(siteDir + "/theme.css");
      console.log("its theme.css (" + served.length + " chars) does not contain the " + sheet.length
        + " chars of public/themes/" + sheetName + ".css"
        + (frozen ? " — and site/theme.css exists, which sync-config copies byte-for-byte in preference to generating one (§theme.css), so this build is wearing THAT instead of the sheet under test" : ""));
      process.exit(1);
    }
  ' "$THEMES_DIR/$sheet.css" "$built/theme.css" "$sheet" "$NEXT/site" "$built/index.html" 2>&1)"; then
    echo "🔴 $sheet: $built is not a build wearing this sheet, so nothing was measured —"
    echo "     $probe"
    echo "     (out/ holds: $(ls -1 "$NEXT/out" 2>/dev/null | tr '\n' ' '))"
    unmeasured=1
    continue
  fi

  port="$(free_port)"
  python3 -m http.server "$port" --bind 127.0.0.1 --directory "$built" >/dev/null 2>&1 &
  SRV_PID=$!
  ok=0
  for _ in $(seq 1 40); do
    curl -sf "http://127.0.0.1:$port/" -o /dev/null && { ok=1; break; }
    sleep 0.25
  done
  if [ "$ok" != "1" ]; then
    echo "🔴 $sheet: the built site would not serve on 127.0.0.1:$port — nothing measured."
    kill "$SRV_PID" 2>/dev/null; SRV_PID=""
    unmeasured=1
    continue
  fi

  node "$NEXT/scripts/theme-css-invariants.mjs" "http://127.0.0.1:$port"
  rc=$?
  kill "$SRV_PID" 2>/dev/null; wait "$SRV_PID" 2>/dev/null; SRV_PID=""
  case $rc in
    0) echo "✅ $sheet" ;;
    1) echo "🔴 $sheet — an invariant does not hold (the lines above name it)"; fail=1 ;;
    *) echo "🔴 $sheet — the checker could not take the reading (rc=$rc)"; unmeasured=1 ;;
  esac
done

if [ "$fail" = "1" ]; then
  echo "🔴 at least one sheet breaks an invariant."
  exit 1
fi
if [ "$unmeasured" = "1" ]; then
  echo "🔴 at least one sheet was never measured — that is not a pass."
  exit 2
fi
echo "✅ every sheet holds every invariant (${#SHEETS[@]} sheet(s))."
exit 0
