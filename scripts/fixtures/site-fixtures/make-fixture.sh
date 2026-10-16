#!/usr/bin/env bash
# SiteAsData 夹具（#1804，T2a-3）：用一份 skipAI 建站 payload 造一个样板站，导成「库里一行 JSON」进仓。
#
#   bash scripts/fixtures/site-fixtures/make-fixture.sh payload-multilang.json site-multilang
#
# 参数是这个目录里的文件名（payload）和输出名（写到这个目录的 <输出名>.json）。同一份 payload 重跑，出来的 JSON 逐字节相同。
#
# 🔴 不碰模板根的 `site/`：create-site.js 的输出目录写死在 `<模板>/site`，开工先 rmSync 它。所以先把模板树 tar 到
#    mkdtemp 的副本里（node_modules 软链回去），在副本里建站 —— 先例 `create-site-all-locales.test.js` §makeTree。
# 为了能复现，导出前抹掉三样每次都变的东西：
#   · 环境：不带 ANTHROPIC_API_KEY（skipAI 本来就不调 AI）、不带 LEAD_API_BASE（它会被写进 site_meta.leadApi）
#   · site/build-report.json（generatedAt / durationSec）和 site/.build/
#   · 页脚版权年份 `© 20xx` 一律写成 `© 2026`（夹具里的年份是固定的）
# skipAI 路写不进社交链接 / 顶条链接 / logo 旋钮 ⟹ 有 `<payload 名>.patch.json` 就在导出前把它并进 site/：
#    键 = site/ 下的相对路径，值按对象深合并（数组整个替换）。
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
NEXT="$(cd "$HERE/../../.." && pwd)"

if [ $# -ne 2 ]; then
  echo "usage: make-fixture.sh <payload.json> <输出名>" >&2
  exit 2
fi
PAYLOAD="$HERE/$(basename "$1")"
OUT="$HERE/$2.json"
PATCH="${PAYLOAD%.json}.patch.json"
[ -f "$PAYLOAD" ] || { echo "🔴 找不到 payload: $PAYLOAD" >&2; exit 2; }

WORK_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/make-fixture-XXXXXX")"
trap 'rm -rf "$WORK_ROOT"' EXIT
WORK="$WORK_ROOT/nextjs"
mkdir -p "$WORK"
( cd "$NEXT" && tar --exclude=./node_modules --exclude=./out --exclude=./.next --exclude=./site --exclude=./public/photos -cf - . ) \
  | tar -xf - -C "$WORK"
ln -s "$NEXT/node_modules" "$WORK/node_modules"

if ! ( cd "$WORK" && env -u ANTHROPIC_API_KEY -u LEAD_API_BASE node scripts/create-site.js < "$PAYLOAD" > "$WORK_ROOT/create-site.log" 2>&1 ); then
  tail -20 "$WORK_ROOT/create-site.log" >&2
  echo "🔴 create-site.js (skipAI) 失败" >&2
  exit 1
fi

SITE="$WORK/site"
if [ -f "$PATCH" ]; then
  node -e '
    const fs = require("fs"), path = require("path");
    const [site, patchFile] = process.argv.slice(1);
    const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);
    const merge = (a, b) => { for (const [k, v] of Object.entries(b)) a[k] = isObj(v) && isObj(a[k]) ? merge(a[k], v) : v; return a; };
    for (const [rel, patch] of Object.entries(JSON.parse(fs.readFileSync(patchFile, "utf-8")))) {
      const f = path.join(site, rel);
      if (!fs.existsSync(f)) { console.error(`🔴 补丁要改的 ${rel} 不在建出来的站里`); process.exit(1); }
      fs.writeFileSync(f, JSON.stringify(merge(JSON.parse(fs.readFileSync(f, "utf-8")), patch), null, 2) + "\n");
    }
  ' "$SITE" "$PATCH"
fi

rm -rf "$SITE/build-report.json" "$SITE/.build"
node -e '
  const fs = require("fs"), path = require("path");
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) { walk(f); continue; }
      const s = fs.readFileSync(f, "utf-8");
      const t = s.replace(/© 20\d\d/g, "© 2026");
      if (t !== s) fs.writeFileSync(f, t);
    }
  }(process.argv[1]));
' "$SITE"

node "$HERE/export-site-json.js" to-json "$SITE" "$OUT"
