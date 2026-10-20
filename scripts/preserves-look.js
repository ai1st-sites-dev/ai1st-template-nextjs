#!/usr/bin/env node
'use strict';
// #1918 (SiteAsData T4b-4) —— `preservesLook: true` 的机器尺子（实现在 `lib/preserves-look.js`，判据顺序写在那份文件头）。
//
//   node scripts/preserves-look.js [--exempt <JSON 文件>] [--only-self-check]
//
// CI：`template-scripts` job 里 test:scripts / render-catalog 之后那一步（push main 之后、`release` 之前 —— 本仓没有 `pull_request`
// 触发；`release` 的 `needs` 里有 template-scripts，这一步红了就不出包）。要 `gh` 和 `GH_TOKEN`（下 release 包）+ Playwright 的 Chromium。
//
// 两部分，各自计数：
//   ① 尺子自检（每一跑都做）：假块 fake-a 的 v1（`fixtures/preserves-look/fake-a-v1`）→ v2，「前」= 最新的、site.js 认 `--blocks-dir`
//      的那份 release（运行时取 —— release 只留最近 30 份、约一天，写死的 tag 一天就没了）。每一格都有预期结论，读到的不是预期 ⟹ 尺子坏了、红：
//        标定     v2 真换了 background-color 却标 true ⟹ 必须「样子变了」，并点名 background-color（不做这一格，尺子绿着和不存在同形）
//        反向     v2 = fixtures/blocks/fake-a（只改字段名）⟹ 必须绿，而且「前」里确实有那个块的根元素
//        基准不对 「前」改喂已经带 `1→2` 的 fake-a ⟹ 必须「基准不对」，而且没渲
//        拿不到包 fromBuild 指到一个不存在的 tag ⟹ 必须跳过
//        认证坏了 同一个 tag、换一个假 GH_TOKEN ⟹ 必须「跑不起来」，不许是跳过（token 一坏全体变跳过、rc=0，跟尺子不存在同形）
//        前渲不出 「前」那份 bundle 打的时候不带假块（= 不认 `--blocks-dir` 的老 site.js 打出来的那份）⟹ render rc=0 而页面里没有块根 ⟹ 必须「前渲不出」
//        豁免     标定那条迁移进豁免表 ⟹ 必须是豁免、打印理由、没渲
//   ② 真迁移：`blocks/*/migrations.js` 的每一条。豁免表（`lib/preserves-look-exempt.json`，`{ "<块>:<键>": "理由" }`）里的打印理由、单独计数；
//      `preservesLook: false` 的不比（单独计数）；`fromBuild` 没写或不是 build-<sha12> ⟹ 红；拿不到包（release 真不存在）⟹ 跳过、单独计数、不算通过；
//      其余每条按「前」那份包自己的图册演示数据，旧类型每个形态比一次。外壳区（header / footer，manifest `region: true`）的
//      量不了：只判「基准不对」，不是 ⟹ 「量不了」、红、单独计数 —— 它要么进豁免表写理由，要么另造一条量法（#1918 r3）。
//
// 标准输出最后一行：`{"event":"preserves-look", …}`。退出码：0 没有红（跳过的另有计数）· 1 有红 · 2 跑不起来（不许当成通过）——
// gh 认证 / 网络 / 解包失败都算 2（`lib` 抛 InstrumentError），不算「拿不到包」。
const fs = require('fs');
const path = require('path');
const pl = require('./lib/preserves-look');

const ROOT = pl.TEMPLATE_DIR;
const FIXTURES = path.join(ROOT, 'scripts', 'fixtures');
const V1 = path.join(FIXTURES, 'preserves-look', 'fake-a-v1');
const V2 = path.join(FIXTURES, 'blocks', 'fake-a');
const EXEMPT = path.join(ROOT, 'scripts', 'lib', 'preserves-look-exempt.json');
const CALIBRATION_COLOR = 'rgb(214, 40, 57)';

const die = (m) => { console.log(`⛔ 跑不起来：${m}`); process.exit(2); };

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--exempt') { a.exempt = argv[i + 1]; i += 1; } else if (argv[i] === '--only-self-check') a.onlySelfCheck = true;
    else die(`不认识的参数 ${argv[i]}`);
  }
  return a;
}

const v2Step = () => {
  // eslint-disable-next-line global-require, import/no-dynamic-require
  const table = require(path.join(V2, 'migrations.js'));
  return { ...table['1→2'] };
};

/** v2 的标定版：fake-a 原样，只给块根换一个 background-color —— 样子真的变了，迁移照旧标 true。 */
const lookChanged = (dir) => {
  const f = path.join(dir, 'fake-a', 'plain', 'shape.css');
  fs.writeFileSync(f, `${fs.readFileSync(f, 'utf-8').trimEnd()}\n[data-block="fake-a"][data-shape="plain"] { background-color: ${CALIBRATION_COLOR}; }\n`);
};

function describe(r) {
  if (r.verdict === 'green') return '绿（前后一样）';
  if (r.reason === 'look') return `红 · 样子变了：${r.diffs.map((d) => `${d.point} 的 ${d.prop}：${JSON.stringify(d.before)} → ${JSON.stringify(d.after)}`).join('；')}`;
  const label = { baseline: '基准不对', 'before-unrenderable': '前渲不出', 'after-unrenderable': '后渲不出', 'bad-step': '迁移函数出错', unmeasurable: '量不了' }[r.reason] || r.reason;
  return `红 · ${label}：${r.why}${r.rendered === false ? '（没有渲染）' : ''}`;
}

async function selfCheck(ws, browser) {
  console.log('① 尺子自检（假块 fake-a v1 → v2）');
  const cells = [];
  const pkg = ws.latestBlocksDirPackage();
  if (pkg.missing) {
    console.log(`  ⏭️ 跳过：拿不到「前」那份包 —— ${pkg.missing}`);
    return { cells: [], skipped: true, why: pkg.missing };
  }
  console.log(`  · 「前」= ${pkg.tag}（最新的、site.js 认 --blocks-dir 的 release）`);
  const old = { id: 'pl-fake-a', type: 'fake-a', role: 'optional', region: 'content', weight: 100, shape: 'plain', schemaVersion: 1, data: { headline: 'Same headline' } };
  const beforeV1 = { tree: pkg.dir, blocksDir: ws.blocksDirIn(pkg.dir, { 'fake-a': V1 }) };
  const afterHonest = { tree: ROOT, blocksDir: ws.blocksDirIn(ROOT, { 'fake-a': V2 }) };
  const afterChanged = { tree: ROOT, blocksDir: ws.blocksDirIn(ROOT, { 'fake-a': V2 }, lookChanged) };
  const step = v2Step();
  const cell = async (name, expect, fn) => {
    const r = await fn();
    const ok = expect(r);
    cells.push({ name, ok });
    const said = r.broken ? `跑不起来 —— ${r.why}` : r.skip ? `跳过 —— ${r.why}` : r.exempt ? `豁免 —— ${r.why}` : describe(r);
    console.log(`  ${ok ? '✅' : '❌'} ${name}：${said}`);
  };

  await cell('标定（v2 换了 background-color、标 true ⟹ 要读红，原因是那一项属性不同）',
    (r) => r.verdict === 'red' && r.reason === 'look' && r.diffs.some((d) => d.prop === 'background-color' && d.after === CALIBRATION_COLOR),
    () => pl.compareCell(ws, browser, { old, key: '1→2', step, before: beforeV1, after: afterChanged }));
  await cell('反向（v2 只改数据形状、标 true ⟹ 要绿，且「前」里有块根）',
    (r) => r.verdict === 'green' && r.beforeHasRoot === true,
    () => pl.compareCell(ws, browser, { old, key: '1→2', step, before: beforeV1, after: afterHonest }));
  await cell('基准不对（「前」喂已经有 1→2 的 fake-a ⟹ 要报基准不对、不渲）',
    (r) => r.verdict === 'red' && r.reason === 'baseline' && r.rendered === false,
    () => pl.compareCell(ws, browser, { old, key: '1→2', step, before: { tree: pkg.dir, blocksDir: ws.blocksDirIn(pkg.dir, { 'fake-a': V2 }) }, after: afterChanged }));
  await cell('拿不到包（fromBuild 指到不存在的 tag ⟹ 要跳过）',
    (r) => r.skip === true,
    async () => { const p = ws.fetchPackage('build-000000000000'); return p.missing ? { skip: true, why: p.missing } : { verdict: 'green' }; });
  await cell('认证坏了（同一个 tag、假 GH_TOKEN ⟹ 要「跑不起来」，不许是跳过）',
    (r) => r.broken === true,
    async () => {
      const bogus = `ghp_${'0'.repeat(36)}`;
      const bad = new pl.Workspace({ env: { ...process.env, GH_TOKEN: bogus, GITHUB_TOKEN: bogus } });
      try {
        const p = bad.fetchPackage('build-000000000000');
        return p.missing ? { skip: true, why: p.missing } : { verdict: 'green' };
      } catch (e) {
        if (e instanceof pl.InstrumentError) return { broken: true, why: e.message };
        throw e;
      } finally { bad.cleanup(); }
    });
  await cell('前渲不出（「前」的 bundle 不带假块 ⟹ render rc=0 而没有块根 ⟹ 要报前渲不出）',
    (r) => r.verdict === 'red' && r.reason === 'before-unrenderable' && r.beforeHasRoot === false,
    () => pl.compareCell(ws, browser, { old, key: '1→2', step, before: { ...beforeV1, ignoreBlocksDir: true }, after: afterHonest }));
  await cell('豁免（标定那条进豁免表 ⟹ 要豁免、打印理由、不渲）',
    (r) => r.exempt === true && r.why === '自检用的理由',
    async () => {
      const c = pl.classify({ type: 'fake-a', key: '1→2', step: { ...step, fromBuild: pkg.tag } }, { 'fake-a:1→2': '自检用的理由' });
      return c.kind === 'exempt' ? { exempt: true, why: c.why } : pl.compareCell(ws, browser, { old, key: '1→2', step, before: beforeV1, after: afterChanged });
    });
  return { cells, skipped: false, tag: pkg.tag };
}

async function realOnes(ws, browser, exempt) {
  console.log('② 真迁移（blocks/*/migrations.js）');
  const counts = { compared: 0, green: 0, red: 0, badEntry: 0, exempt: 0, skipped: 0, notCompared: 0, unmeasurable: 0 };
  const migrations = pl.realMigrations(path.join(ROOT, 'blocks'));
  if (!migrations.length) console.log('  · blocks/ 下一条迁移都没有');
  const seen = new Set();
  for (const m of migrations) {
    const id = `${m.type}:${m.key}`;
    seen.add(id);
    const c = pl.classify(m, exempt);
    if (c.kind === 'exempt') { counts.exempt += 1; console.log(`  ⚪ ${id} 豁免 —— 理由：${c.why}`); continue; }
    if (c.kind === 'not-compared') { counts.notCompared += 1; console.log(`  ⚪ ${id} 不比 —— ${c.why}`); continue; }
    if (c.kind === 'bad-entry') { counts.badEntry += 1; console.log(`  ❌ ${id} ${c.why}`); continue; }
    const pkg = ws.fetchPackage(m.step.fromBuild);
    if (pkg.missing) { counts.skipped += 1; console.log(`  ⏭️ ${id} 跳过（不算通过）—— 拿不到包：${pkg.missing}`); continue; }
    const oldType = pl.oldTypeOf(m.type, m.key);
    if (m.region) {
      // #1918 r3 —— 外壳区：只判得了「基准不对」，判不出就是「量不了」（lib §regionVerdict）。两样都是红、都不渲染。
      const r = pl.regionVerdict(path.join(pkg.dir, 'blocks'), oldType, m.key);
      if (r.reason === 'baseline') { counts.compared += 1; counts.red += 1; } else counts.unmeasurable += 1;
      console.log(`  ❌ ${id}（前 = ${m.step.fromBuild}）：${describe(r)}`);
      continue;
    }
    const demo = pl.demoBlocksIn(pkg.dir, oldType, m.key);
    counts.compared += 1;
    if (demo.error) { counts.red += 1; console.log(`  ❌ ${id}（前 = ${m.step.fromBuild}）前渲不出：${demo.error}`); continue; }
    let red = false;
    for (const old of demo.blocks) {
      const r = await pl.compareCell(ws, browser, { old, key: m.key, step: m.step, before: { tree: pkg.dir }, after: { tree: ROOT } });
      if (r.verdict !== 'green') red = true;
      console.log(`  ${r.verdict === 'green' ? '✅' : '❌'} ${id} · 形态 ${old.shape}（前 = ${m.step.fromBuild}）：${describe(r)}`);
      if (r.reason === 'baseline') break; // 同一份包，换个形态还是同一个结论
    }
    counts[red ? 'red' : 'green'] += 1;
  }
  for (const id of Object.keys(exempt)) if (!seen.has(id)) console.log(`  ⚠️ 豁免表里的 ${id} 在 blocks/ 里没有这条迁移（键写错了？它什么都没豁免）`);
  return counts;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let exempt = {};
  const exemptFile = args.exempt ? path.resolve(args.exempt) : EXEMPT;
  try { exempt = JSON.parse(fs.readFileSync(exemptFile, 'utf-8')); } catch (e) { die(`豁免表 ${exemptFile} 读不出来：${e.message}`); }
  if (!exempt || typeof exempt !== 'object' || Array.isArray(exempt)) die('豁免表要是 { "<块>:<键>": "理由" }');
  // 没有 gh 是仪器坏了，不是「拿不到包」—— 不许落进跳过那一栏。
  const gh = require('child_process').spawnSync('gh', ['--version'], { encoding: 'utf8' });
  if (gh.error || gh.status !== 0) die(`gh 不能用（下 release 包要它）：${gh.error ? gh.error.message : gh.stderr}`);
  let chromium;
  try { ({ chromium } = require('playwright')); } catch (e) { die(`载入 playwright 失败：${e.message}`); }
  let browser;
  try { browser = await chromium.launch(); } catch (e) { die(`Chromium 起不来：${e.message}`); }

  const t0 = Date.now();
  const ws = new pl.Workspace({ log: (m) => console.log(m) });
  let self;
  let real = { compared: 0, green: 0, red: 0, badEntry: 0, exempt: 0, skipped: 0, notCompared: 0, unmeasurable: 0 };
  try {
    self = await selfCheck(ws, browser);
    if (!args.onlySelfCheck) real = await realOnes(ws, browser, exempt);
  } finally {
    await browser.close();
    ws.cleanup();
  }
  const broken = self.cells.filter((c) => !c.ok).length;
  console.log('');
  console.log(`尺子自检：${self.skipped ? `跳过（拿不到包，这一轮尺子活没活着没有读数）—— ${self.why}` : `${self.cells.length} 格，读到预期 ${self.cells.length - broken} 格、不是预期 ${broken} 格（前 = ${self.tag}）`}`);
  console.log(`真迁移：本轮比了 ${real.compared} 条（绿 ${real.green} · 红 ${real.red}）、豁免 ${real.exempt} 条、跳过 ${real.skipped} 条（拿不到包，不算通过）、不比 ${real.notCompared} 条（preservesLook: false）、条目写错 ${real.badEntry} 条（红）、量不了 ${real.unmeasurable} 条（外壳区，红）`);
  console.log(JSON.stringify({
    event: 'preserves-look', selfCheck: { skipped: self.skipped, cells: self.cells.length, broken }, ...real, ms: Date.now() - t0,
  }));
  if (broken || real.red || real.badEntry || real.unmeasurable) process.exitCode = 1;
}

main().catch((e) => { console.log(`⛔ 跑不起来：${e instanceof pl.InstrumentError ? e.message : e && e.stack ? e.stack : e}`); process.exit(2); });
