#!/usr/bin/env node
// #1634 —— 编辑器里改表单文案：`lib/forms-write.js` 的判与写，以及经 `write-editor-save.js` 的整条落盘。
//
// 夹具：skipAI 建一个中文 + 英文双语站（真 create-site 进程，不调 AI），在它的 site/ 上跑。
// 格子对应正文验收：
//   ① 改按钮（zh）：只有 site/zh/forms.json 变；contact 别的键、另一张（booking）整张逐字不变；site/en/forms.json sha256 不变
//   ② 清空成功提示：contact 里没有 successMessage 这个键
//   ③ 直发两笔各自 exit 11（buttonText 41 字 / 带 redirect），站里所有 forms.json 与页面文件 sha256 不变
//      （#1637 前第二笔是「带 fields」—— fields 现在是本票放开的键，换成仍然不许改的 redirect）
//   ④ 只改表单的那一笔不带页面、不带 baseHash 也收（write-editor-save.js 那条「一样都没有」认 forms）
//   ⑤ 单测 planFormsWrite：上限边界（40 过 / 41 拒）、不认识的键、找不到的表单、没改 ⟹ 空数组
//   ⑥~⑩ #1637 字段：见各段标题（对应正文验收 1 / 2 / 3 / 4 / 5 与「各语言一致」那条检查）
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
console.log('── ③ 超长 / 带 redirect：exit 11，所有文件 sha256 不变');
const before3 = snapshot();
const r3a = save({ forms: { id: 'contact', buttonText: 'x'.repeat(41) } });
check('buttonText 41 字 ⟹ exit 11，回执 ok:false 带一句话', () => {
  assert.strictEqual(r3a.rc, 11, r3a.stderr);
  assert.strictEqual(r3a.out.ok, false);
  assert.match(r3a.out.message, /at most 40/);
});
const r3b = save({ forms: { id: 'contact', redirect: '/thanks' } });
check('带 redirect 键 ⟹ exit 11（面板不改跳转）', () => {
  assert.strictEqual(r3b.rc, 11, r3b.stderr);
  assert.match(r3b.out.message, /redirect/);
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
const siteForms = require(path.join(work, 'scripts', 'lib', 'site-forms.js'));
const target = pageWrite.resolveTarget(work, siteShape, 'zh');
const throwsCode = (fn, code) => { try { fn(); } catch (e) { assert.ok(e instanceof fw.FormsWriteError, e.message); assert.strictEqual(e.code, code, e.message); return e; } assert.fail(`没有抛（要 ${code}）`); };
check('40 字正好放行（边界）', () => assert.strictEqual(fw.planFormsWrite({ target, forms: { id: 'contact', buttonText: 'z'.repeat(40) } }).length, 1));
check('41 字拒收 11（上限取 COPY_CAPS，不是 formListProblems —— 它不查长度）', () => throwsCode(() => fw.planFormsWrite({ target, forms: { id: 'contact', buttonText: 'z'.repeat(41) } }), 11));
check('成功提示 201 字拒收 11，表单名 61 字拒收 11', () => {
  throwsCode(() => fw.planFormsWrite({ target, forms: { id: 'contact', successMessage: 's'.repeat(201) } }), 11);
  throwsCode(() => fw.planFormsWrite({ target, forms: { id: 'contact', name: 'n'.repeat(61) } }), 11);
});
check('redirect / 改 id 这类键拒收 11（#1637 起 fields / primary / labels 放行，见 ⑥~⑩）', () => {
  throwsCode(() => fw.planFormsWrite({ target, forms: { id: 'contact', redirect: '/thanks' } }), 11);
  throwsCode(() => fw.planFormsWrite({ target, forms: { id: 'contact', newId: 'x' } }), 11);
});
check('找不到的表单 ⟹ 4；没有 id ⟹ 5', () => {
  throwsCode(() => fw.planFormsWrite({ target, forms: { id: 'nope', buttonText: 'a' } }), 4);
  throwsCode(() => fw.planFormsWrite({ target, forms: { buttonText: 'a' } }), 5);
});
check('一个字都没改 ⟹ 空数组（一份都不写）', () => {
  const cur = read('zh').find((f) => f.id === 'contact');
  assert.deepStrictEqual(fw.planFormsWrite({ target, forms: { id: 'contact', buttonText: cur.buttonText } }), []);
});
check('首尾空白去掉；只有空白 = 清空（删键）', () => {
  const [w] = fw.planFormsWrite({ target, forms: { id: 'contact', buttonText: '  确定  ', name: '   ' } });
  const c = JSON.parse(w.content).find((f) => f.id === 'contact');
  assert.strictEqual(c.buttonText, '确定');
  assert.ok(!('name' in c));
});

// ══ #1637 字段：增删 / 换顺序 / primary / 字段名 ══
const contactOf = (loc) => read(loc).find((f) => f.id === 'contact');
const hasCjk = (t) => /[㐀-鿿]/.test(t);

// ── ⑥ 验收 1：删 name、把 message 拖到第一（在 en 下改）。#1635 落地后默认已含 phone，「加」那一步由 ⑦ 的加回 name 量 ──
console.log('── ⑥ en 下改字段 ⟹ 每个语言的 fields / primary 都是新的那份，文字一个不动');
{
  const zhBefore = contactOf('zh');
  const enBefore = contactOf('en');
  const bookingBefore = { zh: read('zh').find((f) => f.id === 'booking'), en: read('en').find((f) => f.id === 'booking') };
  check('起点是 #1635 之后的默认 ["name","phone","email","message"] / primary phone', () => {
    assert.deepStrictEqual(enBefore.fields, ['name', 'phone', 'email', 'message']);
    assert.strictEqual(enBefore.primary, 'phone');
  });
  const r = save({ forms: { id: 'contact', fields: ['message', 'phone', 'email'], primary: 'phone' } }, 'en');
  check('rc=0，回执写了 en 与 zh 两份 forms.json', () => {
    assert.strictEqual(r.rc, 0, r.stderr);
    assert.deepStrictEqual([...r.out.files].sort(), ['site/en/forms.json', 'site/zh/forms.json']);
  });
  check('en 与 zh 的 contact.fields 逐字是 ["message","phone","email"]，primary 都是 phone', () => {
    for (const loc of ['en', 'zh']) {
      assert.deepStrictEqual(contactOf(loc).fields, ['message', 'phone', 'email'], loc);
      assert.strictEqual(contactOf(loc).primary, 'phone', loc);
    }
  });
  check('除 fields 外两份 contact 逐字不变（zh 的按钮还是「提交」），booking 两份逐字不变', () => {
    assert.deepStrictEqual({ ...contactOf('zh'), fields: zhBefore.fields }, zhBefore);
    assert.deepStrictEqual({ ...contactOf('en'), fields: enBefore.fields }, enBefore);
    assert.deepStrictEqual(read('zh').find((f) => f.id === 'booking'), bookingBefore.zh);
    assert.deepStrictEqual(read('en').find((f) => f.id === 'booking'), bookingBefore.en);
  });
}

// ── ⑦ 验收 2 / 3：中文下加回 name 并改名「您的姓名」⟹ 结构两份一致，labels 只有 zh 那份有 ──
console.log('── ⑦ zh 下加 name + labels.name ⟹ fields 两份一致，labels 只写 zh');
{
  const enBefore = contactOf('en');
  const r = save({ forms: { id: 'contact', fields: ['message', 'phone', 'email', 'name'], primary: 'phone', labels: { name: '  您的姓名 ' } } }, 'zh');
  check('rc=0；zh.labels 是 { name: 「您的姓名」 }（去首尾空白），en 没有 labels', () => {
    assert.strictEqual(r.rc, 0, r.stderr);
    assert.deepStrictEqual(contactOf('zh').labels, { name: '您的姓名' });
    assert.ok(!('labels' in contactOf('en')));
  });
  check('zh 与 en 的 fields / primary 相同；en 除 fields 外逐字不变', () => {
    assert.deepStrictEqual(contactOf('zh').fields, contactOf('en').fields);
    assert.strictEqual(contactOf('zh').primary, contactOf('en').primary);
    assert.deepStrictEqual({ ...contactOf('en'), fields: enBefore.fields }, enBefore);
  });
}

// ── ⑧ 清空字段名 ⟹ labels 键整个删掉；没动结构 ⟹ en 一个字节不写 ──
console.log('── ⑧ 清空 labels.name');
{
  const enSha = sha(path.join(SITE, 'en', 'forms.json'));
  const r = save({ forms: { id: 'contact', labels: { name: '' } } }, 'zh');
  check('rc=0，只写了 zh；zh 的 contact 没有 labels 键；en sha256 不变', () => {
    assert.strictEqual(r.rc, 0, r.stderr);
    assert.deepStrictEqual(r.out.files, ['site/zh/forms.json']);
    assert.ok(!('labels' in contactOf('zh')));
    assert.strictEqual(sha(path.join(SITE, 'en', 'forms.json')), enSha);
  });
}

// ── ⑨ 验收 4：电话和邮箱都删 ⟹ exit 11，所有文件 sha256 不变 ──
console.log('── ⑨ 删光 phone 与 email：exit 11，一个字节不写');
{
  const before = snapshot();
  const r = save({ forms: { id: 'contact', fields: ['name', 'message'] } }, 'zh');
  check('exit 11，回执 ok:false，那句话是英文、说出 Phone / Email', () => {
    assert.strictEqual(r.rc, 11, r.stderr);
    assert.strictEqual(r.out.ok, false);
    assert.match(r.out.message, /Phone or an Email/);
    assert.ok(!hasCjk(r.out.message), r.out.message);
  });
  check('site/ 下每一份 .json 的 sha256 都没变', () => assert.deepStrictEqual(snapshot(), before));
}

// ── ⑩ 单测：字段组合、primary 跟随、字段名上限 ──
console.log('── ⑩ planFormsWrite：字段 / primary / labels');
{
  const contactIn = (writes, loc) => JSON.parse(writes.find((w) => w.file === path.join(SITE, loc, 'forms.json')).content).find((f) => f.id === 'contact');
  check('删掉的正好是 primary（phone）且没带 primary ⟹ 两个语言的 primary 都落到剩下的第一个（email）', () => {
    assert.strictEqual(contactOf('zh').primary, 'phone');
    const w = fw.planFormsWrite({ target, forms: { id: 'contact', fields: ['email', 'message'] } });
    for (const loc of ['zh', 'en']) assert.strictEqual(contactIn(w, loc).primary, 'email', loc);
  });
  check('带了 primary 但它不在 fields 里 ⟹ 11（不许指空）；只带 primary 且在 fields 里 ⟹ 两个语言都改', () => {
    throwsCode(() => fw.planFormsWrite({ target, forms: { id: 'contact', fields: ['phone', 'message'], primary: 'email' } }), 11);
    throwsCode(() => fw.planFormsWrite({ target, forms: { id: 'contact', primary: 'service' } }), 11);
    // r4 —— 在 fields 里但不是联系字段（teaser 只露这一格、提交要电话或邮箱）⟹ 同样 11。
    throwsCode(() => fw.planFormsWrite({ target, forms: { id: 'contact', primary: 'message' } }), 11);
    throwsCode(() => fw.planFormsWrite({ target, forms: { id: 'contact', fields: ['name', 'email'], primary: 'name' } }), 11);
    const w = fw.planFormsWrite({ target, forms: { id: 'contact', primary: 'email' } });
    for (const loc of ['zh', 'en']) assert.strictEqual(contactIn(w, loc).primary, 'email', loc);
  });
  check('空 fields / 重复字段 / 词表外字段 ⟹ 11；fields 不是字符串数组 ⟹ 5', () => {
    throwsCode(() => fw.planFormsWrite({ target, forms: { id: 'contact', fields: [] } }), 11);
    throwsCode(() => fw.planFormsWrite({ target, forms: { id: 'contact', fields: ['email', 'email'] } }), 11);
    throwsCode(() => fw.planFormsWrite({ target, forms: { id: 'contact', fields: ['email', 'company'] } }), 11);
    throwsCode(() => fw.planFormsWrite({ target, forms: { id: 'contact', fields: 'email' } }), 5);
  });
  check('字段名 40 字放行、41 字拒收 11；词表外的字段 ⟹ 11；labels 不是对象 ⟹ 5', () => {
    assert.strictEqual(contactIn(fw.planFormsWrite({ target, forms: { id: 'contact', labels: { email: '邮'.repeat(40) } } }), 'zh').labels.email, '邮'.repeat(40));
    throwsCode(() => fw.planFormsWrite({ target, forms: { id: 'contact', labels: { email: '邮'.repeat(41) } } }), 11);
    throwsCode(() => fw.planFormsWrite({ target, forms: { id: 'contact', labels: { company: 'Firm' } } }), 11);
    throwsCode(() => fw.planFormsWrite({ target, forms: { id: 'contact', labels: 'Name' } }), 5);
  });
  check('只改字段名 ⟹ 只回 zh 一份（en 不在写入里）', () => {
    const w = fw.planFormsWrite({ target, forms: { id: 'contact', labels: { phone: '电话号码' } } });
    assert.deepStrictEqual(w.map((x) => path.relative(SITE, x.file)), [path.join('zh', 'forms.json')]);
  });
}

// ── ⑪ 各语言一致那条检查：磁盘上本来就不一致 ⟹ 拒收，状态栏是英文人话，原话进 stderr ──
// 🔴 这一格盯的是 `formsProblems` 里那条 `formsConsistencyProblems`：去掉它，这一笔会被收下，这一格红。
console.log('── ⑪ en 的 booking.fields 顺序被人改得跟 zh 不一样，再改 contact 文案 ⟹ exit 11');
{
  const enFile = path.join(SITE, 'en', 'forms.json');
  const enRaw = fs.readFileSync(enFile);
  const en = JSON.parse(enRaw);
  const q = en.find((f) => f.id === 'booking');
  // r4 —— 只动顺序（primary 仍是 phone）：改 primary 的话会同时撞上「primary 只能是联系字段」，这一格就不只盯一致性了。
  q.fields = [...q.fields].reverse();
  fs.writeFileSync(enFile, `${JSON.stringify(en, null, 2)}\n`);
  const before = snapshot();
  const r = save({ forms: { id: 'contact', buttonText: '发送' } }, 'zh');
  check('exit 11，状态栏那句没有中文；stderr 带着「fields / primary 在 zh 与 en 不一样」那句原话', () => {
    assert.strictEqual(r.rc, 11, r.stderr);
    assert.strictEqual(r.out.ok, false);
    assert.ok(!hasCjk(r.out.message), r.out.message);
    assert.match(r.stderr, /"booking" 的 fields \/ primary 在 zh 与 en 不一样/);
  });
  check('site/ 下每一份 .json 的 sha256 都没变', () => assert.deepStrictEqual(snapshot(), before));
  fs.writeFileSync(enFile, enRaw);
}

// ── ⑫ r4 验收「一次删除不再造出死表单」：primary 只能是联系字段（`site-forms.js` §primaryChoices）──
// 🔴 这一格在 r3 上是红的：那时只带 fields 删掉 phone，primary 落到「剩下的第一个」= name；直发 primary:name 也被收下。
console.log('── ⑫ 默认表单删 phone ⟹ primary 落到 email；直发 primary:name ⟹ exit 11、一个字节不写');
{
  const DEFAULT = siteForms.DEFAULT_SITE_FORMS[0];
  const reset = save({ forms: { id: 'contact', fields: [...DEFAULT.fields], primary: DEFAULT.primary } }, 'en');
  check(`起点：contact 回到新站默认 ${JSON.stringify([DEFAULT.fields, DEFAULT.primary])}`, () => {
    assert.strictEqual(reset.rc, 0, reset.stderr);
    for (const loc of ['en', 'zh']) {
      assert.deepStrictEqual(contactOf(loc).fields, ['name', 'phone', 'email', 'message'], loc);
      assert.strictEqual(contactOf(loc).primary, 'phone', loc);
    }
  });
  const r = save({ forms: { id: 'contact', fields: ['name', 'email', 'message'] } }, 'en');
  check('只交 fields（删掉 phone）⟹ rc=0，两个语言的 primary 都是 email，不是 name', () => {
    assert.strictEqual(r.rc, 0, r.stderr);
    for (const loc of ['en', 'zh']) assert.strictEqual(contactOf(loc).primary, 'email', loc);
  });
  const back = save({ forms: { id: 'contact', fields: [...DEFAULT.fields], primary: DEFAULT.primary } }, 'en');
  assert.strictEqual(back.rc, 0, back.stderr);
  const before = snapshot();
  const dead = save({ forms: { id: 'contact', fields: ['name', 'email', 'message'], primary: 'name' } }, 'en');
  check('直发 {"fields":["name","email","message"],"primary":"name"} ⟹ exit 11，回执是英文、说出 Phone / Email', () => {
    assert.strictEqual(dead.rc, 11, dead.stderr);
    assert.strictEqual(dead.out.ok, false);
    assert.match(dead.out.message, /Phone or Email/);
    assert.ok(!hasCjk(dead.out.message), dead.out.message);
  });
  check('site/ 下每一份 .json 的 sha256 都没变', () => assert.deepStrictEqual(snapshot(), before));
  check('校验层同一判据：formListProblems 对 primary 是 name 的表单报一条「不是联系字段」', () => {
    const p = siteForms.formListProblems([{ ...DEFAULT, fields: ['name', 'email', 'message'], primary: 'name' }]);
    assert.strictEqual(p.length, 1, p.join(' | '));
    assert.match(p[0], /不是联系字段/);
  });
}

console.log(`\n${fail === 0 ? '✅' : '❌'} #1634 / #1637 forms-write：${pass} 通过 · ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
