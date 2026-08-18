#!/usr/bin/env bash
# theme-css-invariants-all-sheets.sh — build a sample site once per theme sheet and take the
# runtime reading on each (#1009). This is the automatic caller for scripts/theme-css-invariants.mjs.
#
#   bash scripts/theme-css-invariants-all-sheets.sh [--make-sample-site] [--shard i/N] [sheet-name …]
#
#   --make-sample-site   create a demo site in templates/nextjs/site first, but ONLY if there is none.
#                        It never replaces a site you put there yourself (same rule as
#                        scripts/theme-gallery/shoot-themes.sh: a tool that silently swaps out the
#                        sample you pointed it at is a tool you cannot use twice). No AI, no cost:
#                        create-site.js's skipAI path returns before the ANTHROPIC_API_KEY check.
#   --shard i/N          take only the i-th of N slices of the sheet list (1-based). See §SHARDING.
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
# ══ AND EVERY SHEET UNDER ITS OWN PALETTE (#1016 r5) ═════════════════════════════════════════════
# Which sheet a site wears is decided by its theme's name: `public/themes/<theme name>.css`. So the
# colours a sheet is judged against are the ones its own theme brings, and this script pairs them that
# way — one palette per sheet, not one for the whole run. The three hand-written `hero-media-*` sheets
# have no theme named after them, so there is no palette that is theirs; they keep the sample site's,
# and their CONTRAST reading is printed without being judged (a pairing no site can be built with is
# not a fact about any theme). Everything else about them is judged, hook coverage above all — that is
# what this job exists for and it has nothing to do with colour.
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

# ══ SHARDING (#1073) ═════════════════════════════════════════════════════════════════════════════
# One sheet costs a full `next build` plus a browser reading — ~28 s measured. At 3 sheets that was a
# 108 s job; #1016 takes the pool to 83 and the same job becomes ~40 minutes, with `sync-template`
# waiting behind it (ci-cd.yml §sync-template `needs`). This splits the SHEET LIST across N CI
# runners: wall clock ÷ N, and not one sheet is dropped.
#
# 🔴 WHY THE BUILD CANNOT JUST BE HOISTED OUT OF THE LOOP, which is the obvious cheaper fix and is
# WRONG — measured, because I built it first and then measured it:
#
#   same themeId, two different sheets   → the two `out/` trees differ in ONE file: theme.css
#   different themeId (what #1016 does)  → the HTML differs too: data-region-layout="pill-floating"
#                                          vs "solid-bar" on <header>, "slim-row" vs "cta-band" on
#                                          <footer> (different markup, not just a class), and the
#                                          favicon's colour
#   (both readings normalised for Next's random buildId, which otherwise makes ALL pages differ and
#    hides the real answer — raw diff said 142 files on the first pair, of which only theme.css was real)
#
# #1016 pairs every sheet with THE THEME NAMED AFTER IT (its own §palette line says so), so on that
# tree each sheet's page is genuinely a different page. Reusing one build there would measure 82 of the
# 83 sheets against another theme's markup and report ✅ — a false green, which is the one outcome this
# check exists to prevent. The sheet alone never changes the HTML; the THEME does.
#
# ⟹ Sharding, which is correct whatever the pairing is. The partition is a stride (i, i+N, i+2N …) over
#   the SAME list the unsharded run enumerates, so the union over i=1..N is that list by construction —
#   there is no arithmetic in which a sheet can fall between two shards.
#
# 🔴 N IS NOT WRITTEN DOWN TWICE. On CI it comes from `strategy.job-total`, i.e. the length of the
# matrix itself (ci-cd.yml §theme-css), because the first cut of this hardcoded `/8` next to a
# `matrix: [1..8]` and one of the two ways they can disagree is SILENT: fewer matrix entries than N
# means every shard passes while nobody measures the tail (measured on #1073 r1 — matrix [1..4] with
# `/8` covered 43 of 83 sheets, all four shards green). The other way round is loud (`--shard 5/4` is
# exit 2 below), which is what made the one-way hole easy to miss.
#
# 🔴 LOCALLY, RUN THE SHARDS ONE AFTER ANOTHER, NOT SIDE BY SIDE. Each CI shard is its own runner, but
# in one worktree the shards share `site/`, `out/` and `public/theme.css` — all fixed paths — so
# `--shard 1/8 & --shard 2/8 &` in the same checkout has them overwriting each other's build and the
# readings are junk. Two shards in two separate worktrees is fine (the HTTP port is asked of the
# kernel, see free_port).
MAKE_SITE=0
SHARD_I=0
SHARD_N=0
SHEETS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --make-sample-site) MAKE_SITE=1 ;;
    --shard)
      shift
      # 🔴 A REGEX, NOT A GLOB (#1073 r1, QA1). The first cut matched `[1-9]*/[1-9]*`, and a shell glob's
      # `*` is "any characters" — so `--shard 1a/8b` MATCHED. r1's two numeric comparisons then each
      # printed `[: 1a: integer expression expected` and were treated as false, rc never changed, and the
      # run went on with sharding silently switched off: all 83 sheets, ~40 minutes, exit 0. The coverage
      # direction is safe (it over-runs, it does not skip sheets), which is precisely why nothing would
      # ever notice — the job stays green and the 40 minutes this ticket exists to remove come back.
      if ! [[ "${1:-}" =~ ^[0-9]+/[0-9]+$ ]]; then
        echo "🔴 --shard wants i/N, digits only (got '${1:-}')" >&2; exit 2
      fi
      # 10# so a zero-padded `08` is decimal 8 and not an octal parse error.
      SHARD_I=$(( 10#${1%%/*} ))
      SHARD_N=$(( 10#${1##*/} ))
      if [ "$SHARD_I" -lt 1 ] || [ "$SHARD_N" -lt 1 ]; then
        echo "🔴 --shard wants i/N with both ≥1 (got '$1')" >&2; exit 2
      fi
      if [ "$SHARD_I" -gt "$SHARD_N" ]; then
        echo "🔴 --shard $SHARD_I/$SHARD_N: there is no ${SHARD_I}th slice of $SHARD_N" >&2; exit 2
      fi
      ;;
    -*) echo "🔴 unknown option: $1" >&2; exit 2 ;;
    *) SHEETS+=("$1") ;;
  esac
  shift
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

# The stride slice, taken AFTER the full list exists so every shard partitions the same population.
if [ "$SHARD_N" -gt 0 ]; then
  ALL_COUNT=${#SHEETS[@]}
  SLICE=()
  i=0
  for s in "${SHEETS[@]}"; do
    if [ $(( i % SHARD_N )) -eq $(( SHARD_I - 1 )) ]; then SLICE+=("$s"); fi
    i=$(( i + 1 ))
  done
  # 🔴 An empty slice is exit 2, not a pass. With N > the number of sheets the tail shards get nothing,
  # and "I measured none of them" must never be the same answer as "they all held" — the whole family's
  # rule (#679 ②). It is also the reading that tells whoever set N that they set it too high.
  if [ ${#SLICE[@]} -eq 0 ]; then
    echo "🔴 --shard $SHARD_I/$SHARD_N selected 0 of $ALL_COUNT sheet(s) — nothing would be judged." >&2
    echo "   N is larger than the number of sheets; lower it so every shard has work." >&2
    exit 2
  fi
  SHEETS=("${SLICE[@]}")
  # Names, not just a count: each shard's log has to say which sheets it took, or "all 83 were covered"
  # is only checkable by re-deriving the partition instead of by reading the runs that happened.
  echo "── shard $SHARD_I/$SHARD_N: ${#SHEETS[@]} of $ALL_COUNT sheet(s): ${SHEETS[*]}"
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
  # 🔴 那个演示站只有 5 页 / 8 种块，而契约有 213 条钩子 —— 实测 171 条一次都没被量到，
  # 而整条命令照样 rc=0（#1052）。所以造完站再把它撑到覆盖全部块，否则这道检查对阶段 2 新搬进来的
  # 块永远是空绿：主题表漏了规则，CI 什么都不会说。
  #
  # 🔴 只在**这个脚本自己造的站**上做（就在这个 if 里面）—— 上面那条「site 已经存在就一个字节都
  # 不动」的规矩不能破：一个悄悄改掉你指给它的样例的工具，你没法用第二次。
  if ! ( cd "$NEXT" && node scripts/theme-css-invariants-sample-pages.js "$NEXT/site" ); then
    echo "🔴 cannot take the reading: could not widen the demo site to cover every block" >&2
    exit 2
  fi
  WIDENED=1
fi

# 🔴 #1055 打磨批次 #16 条 12 — SAY WHICH SITE THIS IS, out loud, before any reading is taken.
# The rule above ("a site you put there yourself is not touched") is deliberate and stays. What was
# missing is that nothing said so: someone with a leftover `site/` runs the documented command, gets
# `contract hooks not on any page measured: 171` and rc=0, and there is not one line in the output
# telling them the widening step never ran. CI is unaffected (every run is a fresh checkout, so it
# always makes and widens its own), which is exactly why this went unnoticed — the blind reading only
# happens on the machines where someone is trying to reproduce a CI result.
#
# 🔴 It is also the seam check ⑪ needs: `THEME_CSS_SAMPLE_WIDENED` is what tells the checker whether
# "a contract hook is on no page" means "the theme forgot it" or "this sample site is just small".
# Exported rather than inferred — the checker cannot tell the two sites apart by looking at them.
if [ "${WIDENED:-0}" = 1 ]; then
  echo "── sample site: made by this script and widened to cover every block in the contract"
  export THEME_CSS_SAMPLE_WIDENED=1
else
  echo "── sample site: the one already at $NEXT/site — 🔴 NOT made by this script, so the step that"
  echo "   widens it to cover every block in the contract (scripts/theme-css-invariants-sample-pages.js)"
  echo "   DID NOT RUN. The readings below are only as wide as that site is: every contract hook its"
  echo "   pages do not carry goes unmeasured, and this command still exits 0. To get the CI reading,"
  echo "   move $NEXT/site aside and re-run with --make-sample-site."
  export THEME_CSS_SAMPLE_WIDENED=0
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

# ── which palette each sheet is measured under ──────────────────────────────────────────────────
# 🔴 #1016 r5 — ONE PALETTE PER SHEET, AND IT IS THE SHEET'S OWN. This used to be decided once, before
# the loop: whatever theme the sample site happened to be wearing dressed all of them. That is not how
# a site is put together — which sheet a site wears is decided BY its theme name and by nothing else
# (`create-site.js:907` calls `sheetNameForTheme()`, and `theme-sheet.js:41` is the whole rule: use
# `public/themes/<theme name>.css` if it is there). The pipeline pairs them the same way
# (`theme-pipeline/run.js:119` writes `{themeId: <candidate id>, applied: false, css: <candidate id>}`).
#
# Deciding it once therefore measured a pairing no customer's site can be built with, and the reading
# was real arithmetic about it: with the 80-sheet pool in place the sample site is dressed `jade-60`,
# and `hero-media-top.css` under `jade-60` puts the CTA banner's two lines at 4.00:1 / 3.96:1. Nothing
# is wrong with either of them — no theme is named `hero-media-*`, so that pair does not exist.
#
# 🔴 THE SITE'S OWN THEME IS STILL READ, ONCE, HERE — NOT INSIDE THE LOOP. The loop rewrites
# theme.json on every iteration, so a per-iteration read of it would answer with the PREVIOUS sheet's
# themeId from iteration two onwards. Read it before the first write, keep it, and let the fallback be
# the same value it has always been.
SITE_THEME_ID="$(node -e "
  const fs=require('fs');
  let id='';
  try { id=(JSON.parse(fs.readFileSync('$THEME_JSON','utf-8')).themeId)||''; } catch {}
  if(!id) id=Object.keys(require('$NEXT/scripts/themes.js').themes)[0];
  process.stdout.write(id);
")"
if [ -z "$SITE_THEME_ID" ]; then
  echo "🔴 cannot take the reading: no themeId to build with" >&2
  exit 2
fi

# Is there a theme in the registry named after this sheet? `applied: true` REQUIRES a themeId the
# registry knows — `sync-config.js:144-147` exits 1 by name otherwise, so naming a sheet that is not a
# theme would not measure the wrong colours, it would stop the build. So this question is asked of the
# registry, and the sheets that have no theme of their own keep the site's palette (there is nothing
# else to give them) with their contrast reading left unjudged — see THEME_CSS_PALETTE_NOT_THE_SHEETS_OWN
# below.
#
# 🔴🔴 THREE ANSWERS, NOT TWO (#1016 r6, QA3's finding). r5 wrote this as `process.exit(has ? 0 : 1)`,
# so "node could not answer" — a crash, an EMFILE, a syntax error in the registry — came out as the
# SAME non-zero code as "the registry does not have it". The caller then took the second branch: the
# sheet was dressed in the sample site's palette and its contrast was left UNJUDGED, and the whole
# command still exited 0. QA3 drove it with a node wrapper that fails only this probe: the pool sheet
# `azure-50` — which HAS a theme of its own — was reported as "not this sheet's own palette", its
# contrast went unjudged, and rc was 0. On this machine `EMFILE: too many open files` is a recorded
# routine event, so that is not a hypothetical.
#
# ⟹ "I could not ask" is its own answer (2) and the caller sends it to the unmeasured bucket, which is
# exit 2 for the whole run. This is the same discipline PM's r4 ruling asked for on `sheet-fresh.js`
# and the same one #1062 is about: "this machine had a problem" and "this thing does not qualify" are
# different sentences, and collapsing them makes the second one swallow the first.
#
#   0 = the registry has a theme of this name   1 = it does not   2 = the question could not be asked
registry_has() {
  local out rc
  # The answer is a WORD on stdout, not an exit code, precisely so that a crash cannot forge it: node
  # dying prints nothing and the `case` below falls through to 2.
  #
  # 🔴 STDERR IS NOT CAPTURED, ON PURPOSE. The first cut of this wrote `2>&1`, which puts node's own
  # talk into the same string as the answer — and then ONE unrelated line on stderr (a deprecation
  # warning, an ExperimentalWarning) stops matching `yes`/`no` and turns every sheet into "could not
  # ask", i.e. the whole run into a loud rc=2 about nothing. Letting stderr through to the script's own
  # stderr keeps the answer clean AND keeps the reason visible, which is the only thing `2>&1` bought.
  out="$(node -e "
    const { themes } = require('$NEXT/scripts/themes.js');
    process.stdout.write(Object.prototype.hasOwnProperty.call(themes, process.argv[1]) ? 'yes' : 'no');
  " "$1")"
  rc=$?
  if [ "$rc" -ne 0 ]; then
    printf '     node exited %s (its reason is on stderr above)\n' "$rc" >&2
    return 2
  fi
  case "$out" in
    yes) return 0 ;;
    no) return 1 ;;
    *) printf '     node exited 0 but said %s, which is neither yes nor no\n' "${out:-<nothing>}" >&2; return 2 ;;
  esac
}

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
NOT_OWN_PALETTE=()
echo "checking ${#SHEETS[@]} sheet(s) against the runtime invariants: ${SHEETS[*]}"

for sheet in "${SHEETS[@]}"; do
  echo "───────── $sheet"
  if [ ! -f "$THEMES_DIR/$sheet.css" ]; then
    echo "🔴 $sheet: no such sheet ($THEMES_DIR/$sheet.css)"
    unmeasured=1
    continue
  fi
  # The palette for THIS sheet, and it is said out loud before the reading is taken — a reader who sees
  # a contrast finding has to be able to tell which of the two arrangements produced it.
  registry_has "$sheet"
  case $? in
  0)
    theme_id="$sheet"
    export THEME_CSS_PALETTE_NOT_THE_SHEETS_OWN=0
    echo "   palette: $theme_id — the theme named after this sheet, which is the pairing a real site gets"
    ;;
  1)
    theme_id="$SITE_THEME_ID"
    export THEME_CSS_PALETTE_NOT_THE_SHEETS_OWN=1
    echo "   palette: $theme_id — 🔴 NOT this sheet's own: no theme in scripts/themes.js is named"
    echo "   \"$sheet\", so there is no palette that belongs to it and this pairing is one no site can be"
    echo "   built with. Its contrast ratios are measured and printed below and NOT judged; every other"
    echo "   check on it, hook coverage included, is judged exactly as for any other sheet."
    ;;
  *)
    # 🔴 The probe itself failed (#1016 r6). This must NOT fall into the branch above: that branch
    # leaves contrast unjudged, so a node hiccup would silently drop the contrast dimension for a sheet
    # that has a perfectly good palette of its own — measured by QA3 on `azure-50`, whole run rc=0.
    # "I could not find out" is never a pass, so it goes to the unmeasured bucket (exit 2 at the end).
    echo "🔴 $sheet: could not ask scripts/themes.js whether a theme of this name exists, so which"
    echo "   palette this sheet should be judged under is unknown — nothing was measured for it."
    echo "   (The reason node printed is on stderr above. This is exit 2 territory: an instrument"
    echo "   failure, not a statement about this sheet.)"
    unmeasured=1
    continue
    ;;
  esac
  node -e "
    require('fs').writeFileSync('$THEME_JSON',
      JSON.stringify({ themeId: '$theme_id', applied: true, css: '$sheet' }, null, 2) + '\n');
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
  # 🔴 #1016 r5 — the per-sheet line carries the reach of its own verdict. `✅ hero-media-top` and
  # `✅ jade-60` are not the same statement and the summary at the end cannot tell them apart, so the
  # difference is said on the line that says ✅. The list below is what the closing line then counts.
  if [ "$THEME_CSS_PALETTE_NOT_THE_SHEETS_OWN" = "1" ]; then
    NOT_OWN_PALETTE+=("$sheet")
    unjudged_note=" (contrast NOT judged — the palette is not this sheet's own; everything else was)"
  else
    unjudged_note=""
  fi
  case $rc in
    0) echo "✅ $sheet$unjudged_note" ;;
    1) echo "🔴 $sheet — an invariant does not hold (the lines above name it)$unjudged_note"; fail=1 ;;
    *) echo "🔴 $sheet — the checker could not take the reading (rc=$rc)"; unmeasured=1 ;;
  esac
done

# 🔴 The closing lines name the sheets whose contrast went unjudged, so the count is visible from the
# summary alone. It is a number that must not be able to grow quietly: every sheet in it is a sheet
# whose colours nothing checks, and the way that number grows is someone adding a hand-written sheet
# with no theme behind it.
if [ ${#NOT_OWN_PALETTE[@]} -gt 0 ]; then
  echo "ℹ️ ${#NOT_OWN_PALETTE[@]} of ${#SHEETS[@]} sheet(s) have no theme named after them, so there is no"
  echo "   palette that is theirs: ${NOT_OWN_PALETTE[*]}"
  echo "   For those, contrast was measured and printed but NOT judged. Every other check on them was"
  echo "   judged, hook coverage included. To bring their colours back under a verdict, give each one a"
  echo "   theme of the same name in scripts/themes.js — that is the same pairing a real site uses."
fi
if [ "$fail" = "1" ]; then
  echo "🔴 at least one sheet breaks an invariant."
  exit 1
fi
if [ "$unmeasured" = "1" ]; then
  echo "🔴 at least one sheet was never measured — that is not a pass."
  exit 2
fi
if [ ${#NOT_OWN_PALETTE[@]} -gt 0 ]; then
  echo "✅ every sheet holds every invariant (${#SHEETS[@]} sheet(s)) — with the contrast of"
  echo "   ${#NOT_OWN_PALETTE[@]} of them left unjudged, as the line above says."
  exit 0
fi
echo "✅ every sheet holds every invariant (${#SHEETS[@]} sheet(s))."
exit 0
