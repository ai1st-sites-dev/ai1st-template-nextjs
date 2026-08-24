#!/usr/bin/env node
/**
 * check-dead-links.test.js — #1176 给那道死链检查自己配的体检。
 *
 * 跑法:  node scripts/check-dead-links.test.js   （也被 `npm run test:scripts` 自动发现，CI 跑）
 * 退出码: 0 全过 · 1 有失败 · 2 跑不起来（**不许当成通过**）
 *
 * 🔴 为什么这份测试必须存在，而不是「AC 上手跑一次」就算完：这道检查的失败方向是**静默的**。
 *    「零死链」和「一个链接都没检查」输出一模一样 —— `manager/ticket722_test.go:58` 为本仓上一道
 *    链接检查写下的就是这句话。一道瞎了的链接检查比没有链接检查更糟：人会以为那一维有人看着。
 *    所以下面每一格都配了**能把它弄红的那一臂**（阳性对照），而不只是「干净的站上读到 0」。
 *
 * 🔴 夹具是现造的目录树，不引用任何真站产物。真站产物会变（页面加减、主题换装），拿它当基线的
 *    格子会为正确的理由红 —— `manager/ticket722_test.go:22` 那条教训。
 */

'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CHECKER = path.join(__dirname, 'check-dead-links.js');

let failed = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
  } catch (err) {
    failed += 1;
    console.error(`  🔴 ${name}\n     ${err.message}`);
  }
}

/** 造一棵 out/ 树。`files` 是 { 相对路径: 内容 }；返回那棵树的绝对路径。 */
function makeOut(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dead-links-'));
  for (const [rel, body] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, body);
  }
  return dir;
}

/** 跑一次检查器，返回 { rc, summary(已解析), stderr }。 */
function run(outDir) {
  const r = spawnSync(process.execPath, [CHECKER, outDir], { encoding: 'utf8' });
  if (r.error) throw r.error;
  const line = r.stdout.split('\n').find(l => l.startsWith('{"event":"dead-links"'));
  assert.ok(line, `stdout 里没有那条 summary 行，检查器坏了。stdout=${JSON.stringify(r.stdout)} stderr=${r.stderr}`);
  return { rc: r.status, summary: JSON.parse(line), stderr: r.stderr };
}

const page = href => `<html><body><a href="${href}">x</a></body></html>`;

console.log('══ #1176 check-dead-links 体检 ══');

// ① 阳性对照 —— 弄坏一处，它必须红，而且必须点名是哪个产物文件里的哪个 href。
//    这一格就是 AC2；它在这里的意义是**每次 CI 都重跑一遍**，而不是只在交票那天跑过一次。
test('① 一个指向不存在页面的 href → rc=1，并逐条点名(文件 + href)', () => {
  const out = makeOut({
    'index.html': page('/nope'),
    'about.html': '<html><body>ok</body></html>',
  });
  const { rc, summary, stderr } = run(out);
  assert.strictEqual(rc, 1, `rc 应为 1，实际 ${rc}`);
  assert.strictEqual(summary.deadCount, 1, `deadCount 应为 1，实际 ${summary.deadCount}`);
  assert.deepStrictEqual(summary.dead, [{ file: 'index.html', href: '/nope' }]);
  assert.ok(stderr.includes('index.html') && stderr.includes('/nope'),
    `人话那一份也要点名，实际 stderr=${JSON.stringify(stderr)}`);
});

// ② 反向臂 —— 同一棵树，把那个 href 指到真存在的页面，它必须绿。
//    没有这一臂，①的红说不出是「检查有牙」还是「它对什么都报红」。
test('② 同一棵树、href 指向真存在的页面 → rc=0，deadCount=0，且 checked>0', () => {
  const out = makeOut({
    'index.html': page('/about'),
    'about.html': '<html><body>ok</body></html>',
  });
  const { rc, summary } = run(out);
  assert.strictEqual(rc, 0, `rc 应为 0，实际 ${rc}`);
  assert.strictEqual(summary.deadCount, 0);
  assert.ok(summary.checked > 0, 'checked 必须 > 0 —— 否则这个绿是「什么都没查」');
});

// ③ 「什么都没查到」不许长成「干净」。
test('③ 一个 html 都没有 → rc=2（不是 0），并且说出「这不是干净」', () => {
  const out = makeOut({ 'robots.txt': 'ok' });
  const { rc, summary, stderr } = run(out);
  assert.strictEqual(rc, 2, `rc 应为 2，实际 ${rc}`);
  assert.strictEqual(summary.pages, 0);
  assert.ok(/NOT a clean bill of health/.test(stderr), `stderr 要说清楚，实际=${JSON.stringify(stderr)}`);
});

// ④ #fragment / ?query 必须先剥掉。两臂：锚点挂在**存在**的页面上不许报，挂在**不存在**的页面上必须报。
//    只有前一臂时，「什么都不报」也能过 —— 那正是把这道检查变成装饰品的路。
test('④ 锚点/查询串剥掉后再判：存在的页面不报，不存在的页面照报', () => {
  const out = makeOut({
    'index.html': `<html><body><a href="/services#svc-1">a</a><a href="/services?x=1">b</a><a href="/ghost#svc-2">c</a></body></html>`,
    'services.html': '<html><body>ok</body></html>',
  });
  const { rc, summary } = run(out);
  assert.strictEqual(rc, 1);
  assert.deepStrictEqual(summary.dead, [{ file: 'index.html', href: '/ghost' }],
    `只有 /ghost 该被报出来，实际 ${JSON.stringify(summary.dead)}`);
});

// ⑤ 目录不是答案。`output: 'export'` 会同时写 `services.html` 和一个装 RSC payload 的 `services/` 目录，
//    所以「out/<路径> 存在吗」对一个什么都不服务的路径也为真。
test('⑤ 只有同名目录（没有 .html / index.html）→ 仍然是死链', () => {
  const out = makeOut({
    'index.html': page('/services'),
    'services/__next.abc.txt': 'rsc payload',
  });
  const { rc, summary } = run(out);
  assert.strictEqual(rc, 1, 'RSC payload 目录不能把一个死链洗成活链');
  assert.deepStrictEqual(summary.dead, [{ file: 'index.html', href: '/services' }]);
});

// ⑥ `<path>/index.html` 和裸文件（/base.css 那种）都算活的。
test('⑥ 目录里的 index.html、以及裸文件（/base.css）都算解析到了', () => {
  const out = makeOut({
    'index.html': `<html><body><a href="/blog/">a</a><a href="/base.css">b</a><a href="/">c</a></body></html>`,
    'blog/index.html': '<html><body>ok</body></html>',
    'base.css': 'body{}',
  });
  const { rc, summary } = run(out);
  assert.strictEqual(rc, 0, `实际 dead=${JSON.stringify(summary.dead)}`);
  assert.strictEqual(summary.checked, 3);
});

// ⑦ 站外的东西不是我们的射程；`_next/` 是构建自己发的带哈希资源。
//    这一格的判别力在 `checked`：不是「没报错」，而是「它一条都没往里数」。
test('⑦ 外链 / mailto / tel / 纯锚点 / _next 一条都不进射程（checked=0）', () => {
  const out = makeOut({
    'index.html': `<html><body>
      <a href="https://example.com/nope">a</a>
      <a href="//cdn.example.com/x.js">b</a>
      <a href="mailto:x@example.com">c</a>
      <a href="tel:+15550000">d</a>
      <a href="#top">e</a>
      <a href="/_next/static/chunks/deadbeef.js">f</a>
    </body></html>`,
  });
  const { rc, summary } = run(out);
  assert.strictEqual(summary.checked, 0, `一条都不该进射程，实际 checked=${summary.checked}`);
  assert.strictEqual(rc, 0);
});

// ⑧ 同一页里重复的同一个 href 是一条发现，不是几十条 —— 清单要能被人读完，否则没人读它。
//    这条清单本票是「只报不拦」的唯一产出，读不完就等于没有。
test('⑧ 同一页重复同一个死链 href → 只报一条', () => {
  const out = makeOut({
    'index.html': `<html><body><a href="/nope">1</a><a href="/nope">2</a><a href="/nope">3</a></body></html>`,
  });
  const { summary } = run(out);
  assert.strictEqual(summary.deadCount, 1, `实际 ${JSON.stringify(summary.dead)}`);
  assert.strictEqual(summary.checked, 1);
});

// ⑨ 检查器**自己**不许拦任何东西 —— 它只有一个出口：退出码。这一格钉住 rc 的三档语义，
//    因为两个调用方（worker/entrypoint.sh 的 report_dead_links、worker/main.go 的 reportDeadLinks）
//    都在按这三档分开读；谁把 rc=1 改成 0，那两处的「找到死链了」就静默消失。
test('⑨ rc 三档语义：0=查过且干净 · 1=找到死链 · 2=什么都没查到', () => {
  const clean = run(makeOut({ 'index.html': page('/about'), 'about.html': 'ok' }));
  const dirty = run(makeOut({ 'index.html': page('/nope') }));
  const empty = run(makeOut({ 'robots.txt': 'ok' }));
  assert.deepStrictEqual(
    [clean.rc, dirty.rc, empty.rc], [0, 1, 2],
    `三档读数 = ${[clean.rc, dirty.rc, empty.rc]}`,
  );
});

// ⑩ 两种 out/ 形态。容器跑 `npx next build` ⟹ out/ 就是站根；`npm run build` 会把它挪到
//    `out/<SITE_CONFIG>/`（scripts/move-build-output.js restore）。指错那一层的后果不是少报，是
//    **每一条内部 href 都报成死链** —— 一堵误报墙，而这道检查的全部价值就是它的清单会被人相信。
//    两臂：能唯一确定就下钻并说出来；有两个候选就不猜。
test('⑩ 指到 `npm run build` 的外层 out/ 会下钻一层，并把这件事说出来', () => {
  const out = makeOut({
    'mysite/index.html': page('/about'),
    'mysite/about.html': 'ok',
  });
  const { rc, summary, stderr } = run(out);
  assert.strictEqual(rc, 0, `下钻之后该是干净的，实际 dead=${JSON.stringify(summary.dead)}`);
  assert.strictEqual(summary.pages, 2, 'mysite/ 里那两份 html 都该被看到');
  assert.strictEqual(summary.descendedInto, 'mysite');
  assert.ok(/descended into/.test(stderr), `要在 stderr 说出来，实际=${JSON.stringify(stderr)}`);
});

test('⑪ 两个候选站目录 ⟹ 不猜（原地报，不写 descendedInto）', () => {
  const out = makeOut({
    'siteA/index.html': page('/about'),
    'siteB/index.html': page('/about'),
  });
  const { summary } = run(out);
  assert.strictEqual(summary.descendedInto, undefined, '有歧义时不许下钻');
  assert.strictEqual(summary.pages, 2, '原地扫，两个站的页都看到');
});

if (failed > 0) {
  console.error(`\n🔴 #1176 check-dead-links 体检: ${failed} 格失败`);
  process.exit(1);
}
console.log('\n✅ #1176 check-dead-links 体检: 11/11 通过');
