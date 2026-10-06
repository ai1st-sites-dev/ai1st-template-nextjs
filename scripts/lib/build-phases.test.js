#!/usr/bin/env node
// #1598 —— lib/build-phases.js 的续跑点判读：每一种「续不了」都回 `{ why }`（调用方据它从头建），不跳阶段。
// 整条续跑路径（真进程 + 真 git 仓）在 scripts/create-site-resume.test.js。
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { BUILD_PHASES, PHASE_DONE_PERCENT, readResumePoint, writePhaseFiles, statePath, phaseCommitLabel } = require('./build-phases');
const phases = require('./build-phases');

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log(`  ✅ ${name}`); } catch (e) { fail += 1; console.log(`  ❌ ${name}\n     ${e.message}`); }
}
const dirs = [];
process.on('exit', () => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); });
function site(meta) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'bp1598-'));
  dirs.push(d);
  if (meta) fs.writeFileSync(path.join(d, 'site_meta.json'), JSON.stringify(meta));
  return d;
}

console.log('══ #1598 lib/build-phases ══');
check('阶段表 = 今天流水线的顺序（PM r2 裁定 二），每个阶段都有进度百分比且单调上升', () => {
  assert.deepStrictEqual(BUILD_PHASES, ['plan', 'pages', 'images', 'keywordPages', 'secondaryLocales']);
  const pcts = BUILD_PHASES.map((p) => PHASE_DONE_PERCENT[p]);
  assert.ok(pcts.every((n, i) => Number.isFinite(n) && (i === 0 || n > pcts[i - 1])), pcts.join(','));
});
check('写进去的读得回来：标记 + 存档同一个阶段、主题名在；site_meta 原有的键不动', () => {
  const d = site({ siteId: 's1', locales: ['en'] });
  writePhaseFiles(d, 'pages', { themeName: 'azure-29', ai: { pages: [] } });
  const p = readResumePoint(d);
  assert.strictEqual(p.why, undefined, p.why);
  assert.deepStrictEqual([p.phase, p.index, p.state.themeName], ['pages', 1, 'azure-29']);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(d, 'site_meta.json'), 'utf8')), { siteId: 's1', locales: ['en'], buildPhase: 'pages' });
});
check('最后一个阶段：存档目录删掉，续跑点 state 为 null（没有要续的）', () => {
  const d = site({ siteId: 's1' });
  writePhaseFiles(d, 'keywordPages', { themeName: 'azure-29', content: {} });
  writePhaseFiles(d, 'secondaryLocales', null);
  assert.ok(!fs.existsSync(path.dirname(statePath(d))));
  assert.deepStrictEqual(readResumePoint(d), { phase: 'secondaryLocales', index: 4, state: null });
});
check('写一个不认得的阶段 ⟹ 抛（不写半份标记）', () => {
  const d = site({ siteId: 's1' });
  assert.throws(() => writePhaseFiles(d, 'images2', { themeName: 'x' }), /不认得的阶段/);
  assert.strictEqual(JSON.parse(fs.readFileSync(path.join(d, 'site_meta.json'), 'utf8')).buildPhase, undefined);
});
const why = (d) => readResumePoint(d).why || '';
check('续不了的每一种都回 why：没有 site_meta / 没有 buildPhase / 不认得的阶段', () => {
  assert.match(why(site(null)), /site_meta\.json 读不到/);
  assert.match(why(site({ siteId: 's1' })), /没有 buildPhase/);
  assert.match(why(site({ buildPhase: 'Pages' })), /不是认得的阶段/);
});
check('续不了：有标记没存档 / 存档版本不对 / 存档写的是别的阶段 / 存档里没有主题名', () => {
  assert.match(why(site({ buildPhase: 'images' })), /state\.json 读不到/);
  const put = (meta, state) => { const d = site(meta); fs.mkdirSync(path.dirname(statePath(d))); fs.writeFileSync(statePath(d), JSON.stringify(state)); return d; };
  assert.match(why(put({ buildPhase: 'images' }, { version: 2, phase: 'images', themeName: 't' })), /对不上/);
  assert.match(why(put({ buildPhase: 'images' }, { version: 1, phase: 'pages', themeName: 't' })), /对不上：buildPhase images，存档写的是 "pages"/);
  assert.match(why(put({ buildPhase: 'images' }, { version: 1, phase: 'images' })), /没有主题名/);
  // 阳性对照：同一个 put，四个键都对 ⟹ 续得了
  assert.strictEqual(why(put({ buildPhase: 'images' }, { version: 1, phase: 'images', themeName: 't' })), '');
});

check('提交标题里那一段是「阶段名 第几个/一共几个」，只有最后一个阶段是 N/N（manager 的版本历史据此只列建好的那一次）', () => {
  const N = BUILD_PHASES.length;
  assert.deepStrictEqual(BUILD_PHASES.map(phaseCommitLabel), BUILD_PHASES.map((p, i) => `${p} ${i + 1}/${N}`));
  assert.deepStrictEqual(BUILD_PHASES.filter((p) => phaseCommitLabel(p).endsWith(` ${N}/${N}`)), [BUILD_PHASES[N - 1]]);
  assert.throws(() => phaseCommitLabel('Pages'), /不认得的阶段/);
});

check('pagesOfState：images / keywordPages 的存档取 content.pages，plan / pages 的取 ai.pages，别的回空数组', () => {
  const a = [{ slug: 'a' }];
  const b = [{ slug: 'b' }];
  assert.strictEqual(phases.pagesOfState({ content: { pages: a }, ai: { pages: b } }), a);
  assert.strictEqual(phases.pagesOfState({ ai: { pages: b } }), b);
  assert.deepStrictEqual(phases.pagesOfState(null), []);
  assert.deepStrictEqual(phases.pagesOfState({ themeName: 't' }), []);
});

// #1593 的第二语言账（LocaleBook）跟着存档走：存档读回来的页是新对象，账按「第几页、第几块」挂回去。
const { LocaleBook } = require('./all-locales');
function bookFixture() {
  const pages = [{ slug: 'home', title: '首页', sections: [{ type: 'hero', data: { headline: '你好' } }] },
    { slug: 'about', title: '关于', sections: [{ type: 'content', data: { headline: '关于我们' } }, { type: 'cta', data: { headline: '预约' } }] }];
  const book = new LocaleBook(['en']);
  pages.forEach((p) => book.link(p, p.sections, 'en', {
    title: `EN ${p.title}`, description: 'd', navLabel: 'n', sections: p.sections.map((x) => ({ type: x.type, data: { headline: `EN ${x.data.headline}` } })),
  }));
  return { pages, book };
}
const roundTrip = (v) => JSON.parse(JSON.stringify(v));
check('LocaleBook：snapshot 经过 JSON 再 restore 到读回来的新对象上，拼出来的第二语言页跟原来那本账拼的逐字相同', () => {
  const { pages, book } = bookFixture();
  const back = roundTrip(pages);
  const fresh = new LocaleBook(['en']);
  fresh.restore(back, roundTrip(book.snapshot(pages)));
  assert.deepStrictEqual(back.map((p) => fresh.build(p, 'en')), pages.map((p) => book.build(p, 'en')));
  assert.strictEqual(fresh.failed.size, 0);
  // 阳性对照：不 restore 的新账一页都拼不出来（续跑时正是这个形状）
  assert.deepStrictEqual(back.map((p) => new LocaleBook(['en']).build(p, 'en')), [null, null]);
});
check('LocaleBook：存档里没有账 / 页数、slug、块数对不上 ⟹ 放弃全部第二语言（不拿半本账去拼）；已放弃的语言原样带回', () => {
  const { pages, book } = bookFixture();
  const snap = book.snapshot(pages);
  const failedOf = (ps, sn) => { const b = new LocaleBook(['en']); b.restore(ps, sn); return b.failed.get('en') || ''; };
  assert.match(failedOf(roundTrip(pages), undefined), /no second-language texts/);
  assert.match(failedOf(roundTrip(pages).slice(0, 1), roundTrip(snap)), /has 2 pages of second-language texts, the saved site has 1/);
  const renamed = roundTrip(pages); renamed[1].slug = 'team';
  assert.match(failedOf(renamed, roundTrip(snap)), /page 2 \("team"\)/);
  const fewer = roundTrip(pages); fewer[1].sections.pop();
  assert.match(failedOf(fewer, roundTrip(snap)), /page 2 \("about"\)/);
  book.fail('en', 'page "about": missing');
  assert.strictEqual(failedOf(roundTrip(pages), roundTrip(book.snapshot(pages))), 'page "about": missing');
  // 没有第二语言的站：什么都不做（存档里有没有账都一样）
  const none = new LocaleBook([]); none.restore(roundTrip(pages), undefined); assert.strictEqual(none.failed.size, 0);
});

console.log(`\n══ 汇总: 通过 ${pass} · 失败 ${fail} ══`);
process.exit(fail ? 1 : 0);
