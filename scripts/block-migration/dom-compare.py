#!/usr/bin/env python3
"""AC6 的比较器 —— 比【改动前 / 改动后】两棵产物里【除被搬那个 block 以外】的 DOM。

为什么不能直接比 HTML 逐字节（本票正文 AC6 已经写明）：本票改的是会进 bundle 的源码，
而 webpack 的 chunk 文件名就是那段代码的内容哈希 ⟹ chunk 名必变、<script src> 必变、
Next 的 flight 载荷必变。那不是页面变了，是「代码确实改过」的同义反复。

所以先剔掉 Next 自己那些东西，再把那个 block 的每一节整个摘掉，剩下的部分逐字节比：
  · <script> 里 src 指向 /_next/ 的，以及内联的 flight 载荷（self.__next_f）
  · <link rel=preload/prefetch>，以及 href 指向 /_next/ 的 <link>
  · 资源 URL 里的哈希（/_next/static/<buildId>/… 和 -<hash>.js）
保留：head 的 title/meta、body 的全部标记、JSON-LD（<script type="application/ld+json">）。

用法：dom-compare.py <改动前目录> <改动后目录> [被搬的那个 block，默认 hero]
退出码 0 = 除那个 block 之外逐字节相同；1 = 有差异（逐个文件点名）；2 = 两边文件集合不一样。

🔴 #1019 —— 第三个参数是这次加的，默认值是 `hero`，所以不带它跑跟 #1008 那次逐字节是同一件事。
   加它而不是重写一份的理由写在 README 第一段：31 张搬迁票的「其余 33 个 block 逐字节不变」必须是
   **同一句话**，各票各造一把尺子就不是了。要摘掉的那一节由票自己指定（#1019 摘 page-header）。
"""
import re
import sys
import os

NEXT_SCRIPT = re.compile(
    r'<script[^>]*\bsrc="[^"]*/_next/[^"]*"[^>]*>\s*</script>', re.I)
FLIGHT = re.compile(
    r'<script[^>]*>\s*(?:self\.__next_f|\(self\.__next_f).*?</script>', re.I | re.S)
NEXT_LINK = re.compile(
    r'<link[^>]*(?:rel="(?:preload|prefetch)"[^>]*|href="[^"]*/_next/[^"]*")[^>]*/?>', re.I)
BUILDID = re.compile(r'/_next/static/[A-Za-z0-9_-]{10,}/')
CHUNKHASH = re.compile(r'([-.])[0-9a-f]{8,}(\.(?:js|css))')


def strip_next(html: str) -> str:
    html = FLIGHT.sub('', html)
    html = NEXT_SCRIPT.sub('', html)
    html = NEXT_LINK.sub('', html)
    html = BUILDID.sub('/_next/static/BUILDID/', html)
    html = CHUNKHASH.sub(r'\1HASH\2', html)
    return html


def cut_block(html: str, block: str):
    """把 <section ... data-block="<block>" ...>…</section> 整节摘掉，返回 (剩下的, 摘到几节)。

    手写配对而不是正则：section 会嵌套 section，`.*?` 会在第一个 </section> 就停。
    """
    out, n, pos = [], 0, 0
    while True:
        m = re.search(r'<section[^>]*data-block="%s"' % re.escape(block), html[pos:])
        if not m:
            out.append(html[pos:])
            break
        start = pos + m.start()
        out.append(html[pos:start])
        depth, j = 0, start
        while j < len(html):
            if html.startswith('<section', j):
                depth += 1
                j += len('<section')
            elif html.startswith('</section>', j):
                depth -= 1
                j += len('</section>')
                if depth == 0:
                    break
            else:
                j += 1
        n += 1
        pos = j
    return ''.join(out), n


def normalise(path, block):
    with open(path, encoding='utf-8') as fh:
        html = fh.read()
    body, cut = cut_block(strip_next(html), block)
    return body, cut


def html_files(root):
    found = {}
    for dirpath, _dirnames, filenames in os.walk(root):
        for name in filenames:
            if name.endswith('.html'):
                full = os.path.join(dirpath, name)
                found[os.path.relpath(full, root)] = full
    return found


def main():
    before, after = sys.argv[1], sys.argv[2]
    block = sys.argv[3] if len(sys.argv) > 3 else 'hero'
    a, b = html_files(before), html_files(after)
    if set(a) != set(b):
        print('🔴 两边的 HTML 文件集合不一样')
        for k in sorted(set(a) ^ set(b)):
            print(f'   只在一边: {k}')
        return 2
    bad, cut_counts = [], {}
    for rel in sorted(a):
        na, ha = normalise(a[rel], block)
        nb, hb = normalise(b[rel], block)
        cut_counts[rel] = (ha, hb)
        if na != nb:
            bad.append(rel)
    print(f'比了 {len(a)} 个 HTML 文件；摘掉的 {block} 节数 '
          f'{sum(v[0] for v in cut_counts.values())} → {sum(v[1] for v in cut_counts.values())}')
    if not bad:
        print(f'✅ 除 {block} 之外，剩下的 DOM 逐字节相同')
        return 0
    print(f'🔴 {len(bad)} 个文件在 {block} 之外也变了：')
    for rel in bad:
        na, _ = normalise(a[rel], block)
        nb, _ = normalise(b[rel], block)
        print(f'   {rel}  ({len(na)} → {len(nb)} 字节)')
        for i, (x, y) in enumerate(zip(na, nb)):
            if x != y:
                print(f'      第一处差异在第 {i} 字节: …{na[max(0,i-60):i+60]!r}')
                print(f'                              …{nb[max(0,i-60):i+60]!r}')
                break
    return 1


if __name__ == '__main__':
    sys.exit(main())
