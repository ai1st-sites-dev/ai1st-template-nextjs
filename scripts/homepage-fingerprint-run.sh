#!/usr/bin/env bash
# #1034 AC2/AC3 的两臂:同一批 payload 建 N 个同行业的站,一次开着约束、一次关着。
#
# 用法:  ANTHROPIC_API_KEY=… bash scripts/homepage-fingerprint-run.sh <on|off> <输出目录> [N] [并发]
#
# 🔴 两臂用的是**同一批公司名、同一批 siteId、同一个行业、同一个 themeRotationIndex**,唯一的差别
#    是 payload 里那个 `homepageFingerprint`。少了这一条,读出来的差别可能只是「这批种子恰好
#    不一样」—— 票面 AC3 点名要防的就是它。
#
# 🔴 **总体是「8 个不同站主，各自的第一个站」**(#1034 r2,PM 2026-08-16 退回时点名要的)。
#    r1 这里是 `themeRotationIndex: $i` —— 那是**一个用户连建 8 个站**,而平台库 73 个用户里只有
#    1 个是这样,AC1 的基线又是 6 个不同站主 ⟹ 基线和两臂不是同一个总体,四个数不可比。
#    现在:`themeRotationIndex: 0` 恒定(每个人的第一个站),siteId 各不相同。
#
# 🔴 siteId 用**真实形状的 8 位十六进制**,不用连号:`rotationIndexFromSiteId` 是 h*31+c,
#    连号 id 的哈希也是连号 ⟹ 会走出一条不真实的完美均匀分布,等于给自己送一份好读数。
#    这 8 个是写死的(两臂共用、可复算),不是每次现随机 —— 现随机的话这份读数没人能重跑。
#
# 🔴 为什么每个站要一棵自己的树:`create-site.js` 把结果写进 `path.resolve(__dirname,'..')/site`,
#    也就是**一个**目录。在同一棵树上并发跑,两个站会互相覆盖对方的 site/。
#    每个站给一份 scripts/ 的拷贝 + blocks/ 与 node_modules 的软链(那两样只读)。
#
# 🔴 它是真的花钱的。实测一次建站 $0.30,撞上块库重试就是两次调用 ≈ $0.6;每次的账都打在
#    `<输出目录>/<siteId>.events.jsonl` 的 cost 事件里,跑完自己汇总,别照抄任何写死的数。
set -uo pipefail
ARM="${1:-}"; OUT="${2:-}"; N="${3:-8}"; PAR="${4:-4}"
case "$ARM" in on|off) ;; *) echo "用法: $0 <on|off> <输出目录> [N] [并发]" >&2; exit 2;; esac
[ -n "$OUT" ] || { echo "要给输出目录" >&2; exit 2; }
[ -n "${ANTHROPIC_API_KEY:-}" ] || { echo "🔴 没有 ANTHROPIC_API_KEY —— 这不是「跑过了」" >&2; exit 2; }

NEXT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mkdir -p "$OUT"

# 8 家同行业(牙科)的店。名字不同、服务不同 —— 行业相同是**最坏情况**(行业词把 AI 推向同一批块)。
NAMES=(
  "Bright Smile Dental|Teeth Cleaning,Whitening,Invisalign,Implants,Root Canal,Emergency Dental"
  "Maple Ridge Dental Care|Family Dentistry,Cleanings,Fillings,Crowns,Bridges,Teeth Whitening"
  "Harbourfront Dental Studio|Cosmetic Dentistry,Veneers,Whitening,Bonding,Smile Design,Checkups"
  "Northside Family Dentistry|Pediatric Dentistry,Sealants,Fluoride,Cleanings,Fillings,Orthodontics"
  "Lakeview Dental Clinic|General Dentistry,Extractions,Dentures,Root Canal,Gum Treatment,X-Rays"
  "Cedar Park Dental|Implants,Full Mouth Restoration,Crowns,Bridges,Sedation Dentistry,Cleanings"
  "Riverstone Dental Group|Emergency Dental,Wisdom Teeth,Root Canal,Extractions,Fillings,Checkups"
  "Summit Orthodontics and Dental|Braces,Invisalign,Retainers,Teeth Whitening,Cleanings,Consultations"
)

# 8 个站主各自的第一个站。真实形状的 8 位十六进制 siteId,两臂共用同一批(见文件头那两条)。
SITE_IDS=(a3f19c40 7b21de08 c0d4471a 19e6b3f5 f5820ac7 4d7c1e93 b6039fa2 2ec85d71)

one_site() {
  local i="$1" NAME SERVICES SITE_ID DEST ROOT rc
  IFS='|' read -r NAME SERVICES <<< "${NAMES[$i]}"
  SITE_ID="${SITE_IDS[$i]}"
  DEST="$OUT/$SITE_ID"
  [ -d "$DEST/site" ] && { echo "→ [$i] $SITE_ID 已经建过了,跳过"; return 0; }

  ROOT="$(mktemp -d)"
  cp -a "$NEXT/scripts" "$ROOT/scripts"
  for l in blocks node_modules src; do [ -e "$NEXT/$l" ] && ln -s "$NEXT/$l" "$ROOT/$l"; done

  local PAYLOAD
  PAYLOAD=$(SITE_ID="$SITE_ID" NAME="$NAME" SERVICES="$SERVICES" ARM="$ARM" node -e '
    const s = process.env.SERVICES.split(",");
    // 🔴 themeRotationIndex 恒 0 = 「每个站主的第一个站」,不是 r1 那个 `Number(IDX)`。
    //    差异只能从 siteId 来 —— 那正是本轮要证的性质。
    const p = { siteId: process.env.SITE_ID, companyName: process.env.NAME, industry: "dental clinic",
      location: "Toronto, ON", services: s, language: "en",
      themeRotationIndex: 0 };
    if (process.env.ARM === "off") p.homepageFingerprint = false;
    process.stdout.write(JSON.stringify(p));')

  echo "→ [$i] $ARM · $SITE_ID · $NAME  (开跑)"
  printf '%s' "$PAYLOAD" | node "$ROOT/scripts/create-site.js" \
    > "$OUT/$SITE_ID.events.jsonl" 2> "$OUT/$SITE_ID.debug.log"
  rc=$?
  if [ "$rc" != 0 ] || [ ! -d "$ROOT/site" ]; then
    echo "   🔴 [$i] 建站失败 rc=$rc:$(tail -2 "$OUT/$SITE_ID.debug.log" | tr '\n' ' ')"
    rm -rf "$ROOT"; return 1
  fi
  mkdir -p "$DEST"; cp -a "$ROOT/site" "$DEST/site"; rm -rf "$ROOT"
  echo "   ✅ [$i] $(node -e '
    const fs=require("fs"),p=process.argv[1];
    const m=JSON.parse(fs.readFileSync(p+"/site/site_meta.json","utf8"));
    const h=JSON.parse(fs.readFileSync(p+"/site/"+m.defaultLocale+"/pages/home.json","utf8"));
    console.log((h.blocks||h.sections||[]).map(x=>x.type).join(" → "));' "$DEST")"
}

running=0
for i in $(seq 0 $((N - 1))); do
  one_site "$i" &
  running=$((running + 1))
  if [ "$running" -ge "$PAR" ]; then wait -n 2>/dev/null || wait; running=$((running - 1)); fi
done
wait

echo
echo "── $ARM 臂建完。花了多少钱(读每个站自己的 cost 事件):"
node -e '
const fs=require("fs"),dir=process.argv[1];
let total=0, calls=0, sites=0;
for (const f of fs.readdirSync(dir).filter(f=>f.endsWith(".events.jsonl"))) {
  sites++;
  for (const l of fs.readFileSync(dir+"/"+f,"utf8").split("\n")) {
    if(!l.trim())continue; let e; try{e=JSON.parse(l)}catch{continue}
    if(e.event==="cost"){ total+=e.cost; calls++; }
  }
}
console.log(`   ${sites} 个站 · ${calls} 次 AI 调用 · 合计 $${total.toFixed(2)}（每站 $${(total/Math.max(sites,1)).toFixed(2)}）`);
' "$OUT"
echo
node "$NEXT/scripts/homepage-fingerprint.js" "$OUT"/*/
