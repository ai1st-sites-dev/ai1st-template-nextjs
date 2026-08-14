#!/usr/bin/env python3
"""AC4 —— 同一个站分别引三套表各构建一次，HTML 必须逐字节相同（归一化 buildId）。

归一化只做两件事，两件都在 AC 的字面里：
  1. buildId —— Next 每次构建现生成一个，它出现在 `/_next/static/<id>/`、`/_next/<id>/`，
     以及 flight 载荷里的 `\\"b\\":\\"<id>\\"`。按每臂**实测到的那个字符串**整串替换，
     不用「看起来像 id 的正则」——那种写法会顺手抹掉别的东西。
  2. `<link>` 引的表名 —— 三份引的本来就该是不同的表（#991 那格原话就是「除 <link> 之外」）。
     只替换 `/themes/hero-media-<x>.css` 这个形状，不是全文替换 `left|right|top`。
  3. sitemap 的 <lastmod> 是每次现取的墙钟，与 buildId 同类。

用法：ac4-compare.py <臂目录…>   退出码 0 = 三臂逐字节相同。
"""
import os
import re
import sys
import hashlib

SHEET = re.compile(r'/themes/hero-media-(?:left|right|top)\.css')
STAMP = re.compile(r'<lastmod>[0-9T:.Z-]+</lastmod>')


def build_id(arm):
    """从产物目录里读出这一臂真实的 buildId（不猜、不用正则匹形状）。"""
    static = os.path.join(arm, '_next', 'static')
    ids = [d for d in os.listdir(static)
           if os.path.isdir(os.path.join(static, d)) and d not in ('chunks', 'css', 'media')]
    if len(ids) != 1:
        raise SystemExit(f'🔴 {arm}: 期望恰好一个 buildId 目录，读到 {ids}')
    return ids[0]


def norm(path, bid):
    with open(path, encoding='utf-8') as fh:
        s = fh.read()
    s = s.replace(bid, 'BUILDID')
    s = SHEET.sub('/themes/SHEET.css', s)
    s = STAMP.sub('<lastmod>STAMP</lastmod>', s)
    return s


def html_files(root):
    out = {}
    for dirpath, _d, names in os.walk(root):
        for n in names:
            if n.endswith('.html'):
                full = os.path.join(dirpath, n)
                out[os.path.relpath(full, root)] = full
    return out


def main():
    arms = sys.argv[1:]
    ids = {a: build_id(a) for a in arms}
    for a in arms:
        print(f'  {os.path.basename(a):28s} buildId = {ids[a]}')
    sets = [set(html_files(a)) for a in arms]
    if len(set(map(frozenset, sets))) != 1:
        print('🔴 各臂的 HTML 文件集合不一样')
        return 2
    files = sorted(sets[0])
    bad = []
    for rel in files:
        hs = {a: hashlib.md5(norm(html_files(a)[rel], ids[a]).encode()).hexdigest() for a in arms}
        if len(set(hs.values())) != 1:
            bad.append((rel, hs))
    print(f'比了 {len(files)} 个 HTML 文件 × {len(arms)} 臂')
    if not bad:
        print('✅ 三臂逐字节相同')
        return 0
    print(f'🔴 {len(bad)} 个文件在三臂之间不同：')
    for rel, hs in bad:
        print(f'   {rel}')
        a0 = norm(html_files(arms[0])[rel], ids[arms[0]])
        a1 = norm(html_files(arms[1])[rel], ids[arms[1]])
        for i, (x, y) in enumerate(zip(a0, a1)):
            if x != y:
                print(f'      @{i}  A: {a0[max(0,i-80):i+80]!r}')
                print(f'            B: {a1[max(0,i-80):i+80]!r}')
                break
    return 1


if __name__ == '__main__':
    sys.exit(main())
