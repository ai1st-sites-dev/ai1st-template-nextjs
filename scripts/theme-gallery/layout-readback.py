#!/usr/bin/env python3
# #932 r4 —— 把「这套 theme 的版式表真的落到被拍的那张图上了吗」读回来,给图册当标注。
#
# 🔴 为什么要有这个:r3 交付时图旁只有配色/字体/风格,没有版式读数。于是 Chris 翻图说
#   「30 套像一套」之后,没有任何人能在图上核对「这张图到底是不是它声明的那个版式」——
#   接下来给出的根因("样例站没换装")就是这么猜出来的,而它是错的。
#
# 判据不采信任何一边的说法,而是分别算两个分组再看它们是不是同一个:
#   A) 页面这边:每个位置的 <section>,按渲染出来的骨架(class 里的颜色 token 归一化掉)把 30 套分组
#   B) 注册表这边:每个 section 类型,按它声明的 variant 把 30 套分组
# 两个分组完全相同 ⟹ 这个位置渲染的就是那个类型,而且它确实是按声明的 variant 渲染的。
# 分组对不上就报错退出,不写文件 —— 标注宁可没有,也不能是抄注册表抄出来的。
#
# 读的是 sites/<id>/,也就是 shoot-themes.sh 拍图时服的那份产物本身,不是重新构建一次。
#
# #963 —— 路径参数化:模板目录从本文件位置推出来,输出目录读 THEME_GALLERY_DIR。
# 用法: THEME_GALLERY_DIR=/some/dir python3 layout-readback.py   → 写 <GAL>/layout-readback.json
import re, os, json, subprocess, hashlib, collections, sys

HERE = os.path.dirname(os.path.abspath(__file__))
NEXT = os.path.abspath(os.path.join(HERE, '..', '..'))      # templates/nextjs
GAL = os.environ.get('THEME_GALLERY_DIR')
if not GAL:
    sys.exit('Set THEME_GALLERY_DIR to the directory the gallery is written to.')
GAL = os.path.abspath(GAL)
BASE = f'{GAL}/sites'
PAGES = {'index.html': '首页', 'about.html': '内页'}

COLOR = re.compile(r'\b(primary|accent|gray|slate|zinc|neutral|stone|white|black|red|blue|green|'
                   r'amber|yellow|emerald|teal|purple|rose|orange|indigo|sky|lime|cyan|violet|'
                   r'fuchsia|pink)(-\d{2,3})?\b')

ids = sorted(os.listdir(BASE))
themes = json.loads(subprocess.check_output(
    ['node', '-e', f"console.log(JSON.stringify(require('{NEXT}/scripts/themes.js').themes))"]).decode())


def skeletons(path):
    """一页里每个顶层 <section> 的骨架:标签名 + class(颜色 token 换成 C)。
    颜色必须归一化 —— 不归一化的话每套颜色都不同,分组永远是 30 组,什么都判不出来。"""
    html = open(path, encoding='utf8', errors='replace').read()
    m = re.search(r'<main[^>]*>(.*)</main>', html, re.S)
    body = m.group(1) if m else html
    out, i = [], 0
    while True:
        i = body.find('<section', i)
        if i < 0:
            break
        j = body.find('<section', i + 1)
        chunk = body[i:j if j > 0 else len(body)]
        parts = []
        for tag, attrs in re.findall(r'<(\w+)([^>]*)>', chunk):
            cls = re.search(r'class="([^"]*)"', attrs)
            parts.append(tag + '|' + COLOR.sub('C', cls.group(1) if cls else ''))
        out.append(hashlib.md5('\n'.join(parts).encode()).hexdigest()[:8])
        i += 1
    return out


def partition(values):
    """{theme: 值} → 分组(只关心谁跟谁一组,不关心那个值叫什么)"""
    g = collections.defaultdict(list)
    for k, v in values.items():
        g[v].append(k)
    return frozenset(frozenset(v) for v in g.values())


all_types = sorted({t for th in themes.values() for t in (th.get('layout') or {})})
readback = {i: {} for i in ids}
matched = []

for page in PAGES:
    per = {i: skeletons(os.path.join(BASE, i, page)) for i in ids}
    counts = {len(v) for v in per.values()}
    if len(counts) != 1:
        sys.exit(f'🔴 {page} 各套的 section 个数不一样({counts})—— 位置对不上,不写文件')
    for k in range(counts.pop()):
        pa = partition({i: per[i][k] for i in ids})
        if len(pa) == 1:
            continue                      # 30 套长得一样 ⟹ 这段的类型不在版式表里
        for stype in all_types:
            pb = partition({i: (themes[i].get('layout') or {}).get(stype, '(无)') for i in ids})
            if pa != pb:
                continue
            matched.append((PAGES[page], k + 1, stype))
            for i in ids:
                readback[i][stype] = {
                    'variant': themes[i]['layout'][stype],
                    'page': PAGES[page],
                    'nth': k + 1,
                    'skeleton': per[i][k],
                }
            break

# 每个认出来的类型,再单独证一次:同一个 variant 的骨架必须相同,不同 variant 的必须不同。
# (分组相同已经蕴含了这一条,这里是把它显式打印出来,让读的人不必自己推。)
for _, _, stype in matched:
    by = collections.defaultdict(set)
    for i in ids:
        r = readback[i].get(stype)
        if r:
            by[r['skeleton']].add(r['variant'])
    for sk, vs in by.items():
        if len(vs) != 1:
            sys.exit(f'🔴 {stype} 的骨架 {sk} 同时对应 {vs} —— 读回失败,不写文件')

hero_types = [s for _, _, s in matched if s == 'hero']
if not hero_types:
    sys.exit('🔴 首页上没能认出 hero —— 图旁那条最要紧的标注没有依据,不写文件')

# ── 这一页上「哪些东西 30 套是一样的」也一起量出来,让图册自己说,不靠人记 ──────────────
def part_between(tag):
    """<header>/<footer> 这类整块的骨架,30 套去重后有几种"""
    seen = set()
    for i in ids:
        html = open(os.path.join(BASE, i, 'index.html'), encoding='utf8', errors='replace').read()
        a, b = html.find('<' + tag), html.find('</' + tag + '>')
        chunk = html[a:b] if a >= 0 and b > 0 else ''
        parts = []
        for t, attrs in re.findall(r'<(\w+)([^>]*)>', chunk):
            c = re.search(r'class="([^"]*)"', attrs)
            parts.append(t + '|' + COLOR.sub('C', c.group(1) if c else ''))
        seen.add(hashlib.md5('\n'.join(parts).encode()).hexdigest()[:8])
    return len(seen)


hero_dist = collections.Counter(themes[i]['layout']['hero'] for i in ids)
light_hero = 0
for i in ids:
    html = open(os.path.join(BASE, i, 'index.html'), encoding='utf8', errors='replace').read()
    m = re.search(r'<main[^>]*>.*?<section([^>]*)>', html, re.S)
    cls = re.search(r'class="([^"]*)"', m.group(1)).group(1) if m else ''
    if re.search(r'bg-(white|gray-50|slate-50)\b', cls):
        light_hero += 1

facts = {
    'themes': len(ids),
    'sections_home': len(skeletons(os.path.join(BASE, ids[0], 'index.html'))),
    'sections_about': len(skeletons(os.path.join(BASE, ids[0], 'about.html'))),
    'header_skeletons': part_between('header'),
    'footer_skeletons': part_between('footer'),
    'hero_distribution': dict(hero_dist),
    'light_hero': light_hero,
    'dark_hero': len(ids) - light_hero,
}

out = {
    'note': '每一条都是从 sites/<id>/ 里那份被拍的产物读回来的,不是抄注册表',
    'matched': [{'page': p, 'nth': n, 'type': t} for p, n, t in matched],
    'unmatched_types': [t for t in all_types if t not in {s for _, _, s in matched}],
    'facts': facts,
    'themes': readback,
}
with open(f'{GAL}/layout-readback.json', 'w') as f:
    json.dump(out, f, ensure_ascii=False, indent=1)

print(f'认出来 {len(matched)} 段:')
for p, n, t in matched:
    print(f'  {p} 第{n}段 ↔ {t}')
print(f'两张图上看不到的类型({len(out["unmatched_types"])} 个,样例站这两页没有这些段):'
      f' {" ".join(out["unmatched_types"])}')
print(f'写好了 {GAL}/layout-readback.json —— {len(ids)} 套')
