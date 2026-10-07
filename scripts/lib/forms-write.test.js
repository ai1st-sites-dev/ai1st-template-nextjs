#!/usr/bin/env node
// #1634 —— 编辑器里改表单文案：`lib/forms-write.js` 的判与写，以及经 `write-editor-save.js` 的整条落盘。
//
// 夹具：skipAI 建一个中文 + 英文双语站（真 create-site 进程，不调 AI），在它的 site/ 上跑。
// 格子对应正文验收：
//   ① 改按钮（zh）：只有 site/zh/forms.json 变；contact 别的键、另一张（booking）整张逐字不变；site/en/forms.json sha256 不变
//   ② 清空成功提示：contact 里没有 successMessage 这个键
//   ③ 直发两笔各自 exit 11（buttonText 41 字 / 带 fields），站里所有 forms.json 与页面文件 sha256 不变
//   ④ 只改表单的那一笔不带页面、不带 baseHash 也收（write-editor-save.js 那条「一样都没有」认 forms）
//   ⑤ 单测 planFormsWrite：上限边界（40 过 / 41 拒）、不认识的键、找不到的表单、没改 ⟹ null
'use strict';

const assert = require('assert');
const cp = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const NEXT = path.resolve(__dirname, '..', '..');
const TEMP = [];
process.on('exit', () => { for (const d of TEMP) { try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) { /* 收尾 */ } } });
function die(msg) { console.log(`💥 ${msg}`); process.exit(2); }

let pass = 0;
let fail = 0;
function check(name, fn) {
  try { fn(); pass += 1; console.log(`  ✅ ${name}`); } catch (e) { fail += 1; console.log(`  ❌ ${name}\n     ${e.message}`); }
}

// ── 夹具：skipAI 双语站 ──
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'forms-write-'));
TEMP.push(root);
const work = path.join(root, 'nextjs');
cp.execSync(`tar --exclude=./node_modules --exclude=./out --exclude=./.next --exclude=./site --exclude=./public/photos -cf - . | (mkdir -p "${work}" && tar -xf - -C "${work}")`, { cwd: NEXT, stdio: 'pipe' });
fs.symlinkSync(path.join(NEXT, 'node_modules'), path.join(work, 'node_modules'));
const made = cp.spawnSync(process.execPath, [path.join(work, 'scripts', 'create-site.js')], {
  input: JSON.stringify({ siteId: 'fw163401', siteUrl: 'https://fw.example.test', companyName: 'Demo', industry: 'Plumbing', skipAI: true, language: 'zh', secondaryLocales: ['en'] }),
  cwd: work, encoding: 'utf8', env: { ...process.env, ANTHROPIC_API_KEY: undefined }, timeout: 180000,
});
const SITE = path.join(work, 'site');
if (made.status !== 0 || !fs.existsSync(path.join(SITE, 'zh', 'forms.json')) || !fs.existsSync(path.join(SITE, 'en', 'forms.json'))) {
  die(`夹具立不起来（rc=${made.status}）\n${(made.stderr || '').slice(-600)}`);
}

const read = (loc) => JSON.parse(fs.readFileSync(path.join(SITE, loc, 'forms.json'), 'utf-8'));
// #1635 —— 新站默认只剩一张 contact。「改 contact 不碰别的那张」要有另一张才量得出来 ⟹ 两个语言各补一张内联的
//    booking（结构两边一致，formsProblems 不报），放在 contact 后面。
for (const loc of ['zh', 'en']) {
  const list = read(loc);
  if (list.length !== 1 || list[0].id !== 'contact') die(`夹具前提变了：${loc}/forms.json 不是恰好一张 contact（${JSON.stringify(list.map((f) => f.id))}）`);
  list.push({ id: 'booking', name: loc === 'zh' ? '预约' : 'Book', fields: ['name', 'phone'], primary: 'phone', buttonText: 'OK', successMessage: 'Thanks' });
  fs.writeFileSync(path.join(SITE, loc, 'forms.json'), `${JSON.stringify(list, null, 2)}\n`);
}
const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
/** site/ 下每一份 .json 的 sha256（forms.json 与页面文件都在里面）。 */
function snapshot() {
  const out = {};
  (function walk(d) {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== '.git') walk(f); } else if (e.name.endsWith('.json')) out[path.relative(SITE, f)] = sha(f);
    }
  }(SITE));
  return out;
}
function save(stdin, locale = 'zh') {
  const r = cp.spawnSync(process.execPath, [path.join(work, 'scripts', 'write-editor-save.js'), JSON.stringify({ page: 'contact', locale })], {
    cwd: work, input: JSON.stringify(stdin), encoding: 'utf8', timeout: 60000,
  });
  const line = (r.stdout || '').trim().split('\n').pop() || '';
  let out = null;
  try { out = JSON.parse(line); } catch (e) { out = null; }
  return { rc: r.status, out, stderr: r.stderr || '' };
}

console.log('══ #1634 表单文案的判与写 ══');

// ── ① 改按钮（zh）──
console.log('── ① 中文下改 contact 的按钮');
const zh0 = read('zh');
const en0sha = sha(path.join(SITE, 'en', 'forms.json'));
const before1 = snapshot();
const r1 = save({ forms: { id: 'contact', buttonText: '提交' } });
check('rc=0，回执只写了 site/zh/forms.json', () => {
  assert.strictEqual(r1.rc, 0, r1.stderr);
  assert.deepStrictEqual(r1.out.files, ['site/zh/forms.json']);
});
check('zh：contact.buttonText 是「提交」，contact 别的键、booking 整张逐字不变', () => {
  const zh1 = read('zh');
  const c0 = zh0.find((f) => f.id === 'contact');
  const c1 = zh1.find((f) => f.id === 'contact');
  assert.strictEqual(c1.buttonText, '提交');
  assert.deepStrictEqual({ ...c1, buttonText: c0.buttonText }, c0);
  assert.ok(zh0.find((f) => f.id === 'booking'), '夹具里没有 booking ⟹ 下一句恒真');
  assert.deepStrictEqual(zh1.find((f) => f.id === 'booking'), zh0.find((f) => f.id === 'booking'));
});
check('en/forms.json 改前改后 sha256 相同；除 zh/forms.json 外 site/ 下没有一份 .json 变了', () => {
  assert.strictEqual(sha(path.join(SITE, 'en', 'forms.json')), en0sha);
  const after = snapshot();
  const changed = Object.keys(after).filter((k) => after[k] !== before1[k]);
  assert.deepStrictEqual(changed, [path.join('zh', 'forms.json')]);
});

// ── ② 清空成功提示 ──
console.log('── ② 清空 contact 的成功提示');
const r2 = save({ forms: { id: 'contact', successMessage: '' } });
check('rc=0，contact 里没有 successMessage 这个键', () => {
  assert.strictEqual(r2.rc, 0, r2.stderr);
  assert.ok(!('successMessage' in read('zh').find((f) => f.id === 'contact')));
});

// ── ③ 两笔直发都被拒，一个字节不写 ──
console.log('── ③ 超长 / 带 fields：exit 11，所有文件 sha256 不变');
const before3 = snapshot();
const r3a = save({ forms: { id: 'contact', buttonText: 'x'.repeat(41) } });
check('buttonText 41 字 ⟹ exit 11，回执 ok:false 带一句话', () => {
  assert.strictEqual(r3a.rc, 11, r3a.stderr);
  assert.strictEqual(r3a.out.ok, false);
  assert.match(r3a.out.message, /at most 40/);
});
const r3b = save({ forms: { id: 'contact', fields: ['email'] } });
check('带 fields 键 ⟹ exit 11（改字段是 #1637 的事）', () => {
  assert.strictEqual(r3b.rc, 11, r3b.stderr);
  assert.match(r3b.out.message, /fields/);
});
check('两笔之后 site/ 下每一份 .json 的 sha256 都没变', () => assert.deepStrictEqual(snapshot(), before3));

// ── ④ 跟页面一起被拒时页面也不写（先全判再全写）──
console.log('── ④ 同一笔里带一个改过的页面 + 一笔超长的表单 ⟹ 页面也一个字节不写');
{
  const pageFile = path.join(SITE, 'zh', 'pages', 'contact.json');
  const pageBefore = fs.readFileSync(pageFile);
  const page = JSON.parse(pageBefore);
  page.title = `${page.title}（改）`;
  const r4 = cp.spawnSync(process.execPath, [path.join(work, 'scripts', 'write-editor-save.js'),
    JSON.stringify({ page: 'contact', locale: 'zh', baseHash: crypto.createHash('sha256').update(pageBefore).digest('hex') })], {
    cwd: work, input: JSON.stringify({ page, forms: { id: 'contact', buttonText: 'y'.repeat(41) } }), encoding: 'utf8', timeout: 60000,
  });
  check('exit 11，contact.json 一个字节没变', () => {
    assert.strictEqual(r4.status, 11, r4.stderr);
    assert.ok(fs.readFileSync(pageFile).equals(pageBefore));
  });
}

// ── ⑤ 单测 planFormsWrite ──
console.log('── ⑤ planFormsWrite');
const fw = require(path.join(work, 'scripts', 'lib', 'forms-write.js'));
const siteShape = require(path.join(work, 'scripts', 'lib', 'site-shape.js'));
const pageWrite = require(path.join(work, 'scripts', 'lib', 'page-write.js'));
const target = pageWrite.resolveTarget(work, siteShape, 'zh');
const throwsCode = (fn, code) => { try { fn(); } catch (e) { assert.ok(e instanceof fw.FormsWriteError, e.message); assert.strictEqual(e.code, code, e.message); return e; } assert.fail(`没有抛（要 ${code}）`); };
check('40 字正好放行（边界）', () => assert.ok(fw.planFormsWrite({ target, forms: { id: 'contact', buttonText: 'z'.repeat(40) } })));
check('41 字拒收 11（上限取 COPY_CAPS，不是 formListProblems —— 它不查长度）', () => throwsCode(() => fw.planFormsWrite({ target, forms: { id: 'contact', buttonText: 'z'.repeat(41) } }), 11));
check('成功提示 201 字拒收 11，表单名 61 字拒收 11', () => {
  throwsCode(() => fw.planFormsWrite({ target, forms: { id: 'contact', successMessage: 's'.repeat(201) } }), 11);
  throwsCode(() => fw.planFormsWrite({ target, forms: { id: 'contact', name: 'n'.repeat(61) } }), 11);
});
check('primary / redirect 这类键也拒收 11', () => {
  throwsCode(() => fw.planFormsWrite({ target, forms: { id: 'contact', primary: 'email' } }), 11);
  throwsCode(() => fw.planFormsWrite({ target, forms: { id: 'contact', redirect: '/thanks' } }), 11);
});
check('找不到的表单 ⟹ 4；没有 id ⟹ 5', () => {
  throwsCode(() => fw.planFormsWrite({ target, forms: { id: 'nope', buttonText: 'a' } }), 4);
  throwsCode(() => fw.planFormsWrite({ target, forms: { buttonText: 'a' } }), 5);
});
check('一个字都没改 ⟹ null（不写这份文件）', () => {
  const cur = read('zh').find((f) => f.id === 'contact');
  assert.strictEqual(fw.planFormsWrite({ target, forms: { id: 'contact', buttonText: cur.buttonText } }), null);
});
check('首尾空白去掉；只有空白 = 清空（删键）', () => {
  const w = fw.planFormsWrite({ target, forms: { id: 'contact', buttonText: '  确定  ', name: '   ' } });
  const c = JSON.parse(w.content).find((f) => f.id === 'contact');
  assert.strictEqual(c.buttonText, '确定');
  assert.ok(!('name' in c));
});

console.log(`\n${fail === 0 ? '✅' : '❌'} #1634 forms-write：${pass} 通过 · ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
