// #1352 —— manifest 说「这几处是老板能直接改的字」，组件真的把钩子挂上去了吗。
//
// 两边各有一半，而**两边都绿并不等于对得上**：
//   · manifest 标了 `editLabel` 而组件没挂 `data-slot` ⟹ 面板列出一个输入框，点了改不动任何东西；
//   · 组件挂了而 manifest 没标 ⟹ 那个钩子谁都不读，白挂（而且它会跟着进主题契约那张拒绝表）。
// 两个方向都是**静默**的：构建绿、页面正常、没有任何东西会报错。所以这道守卫做的是**差集**，
// 两个方向各报一次，并且点名是哪几条路径。
//
// 🔴 **判据两边都不是手抄的**：
//   · manifest 那一侧走 `block-manifest.js` 的 §editableSlotPaths —— 面板将来列输入框用的是同一个函数
//     （一份实现两个调用方；两份实现的失败形态是「面板列的和组件挂的对不上」而两边各自都绿）。
//   · 组件那一侧**真把组件渲染出来再从产物里抠**，不是拿正则扫源码。扫源码看不见「这个属性其实在
//     一条走不到的分支里」，也看不见 `blog-preview` 那种「这一次画的根本不是 `data.posts`」——
//     而那一格正是本票实测抓到的（它按 `fromBlog` 决定挂不挂）。
//
// 🔴 **夹具按 manifest 自己造，不用 `block-migration/gen-allblocks.js`**（票里 做什么 #5）：那个脚本从
//    组件的 TS 类型里抠字段，而 `contact-form` / `services-list` / `services-nav` 三个 .tsx 里没有
//    `data: {` 可解析，它给这三个写 `data: {}` —— 用它当夹具，contact-form 那四个文字槽整块看不见。
//    （这不是推测：那两句话就写在 `gen-allblocks.js` 自己的注释里。）

const fs = require('fs');
const path = require('path');
const Module = require('module');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const NEXT = path.resolve(__dirname, '..');
const SRC = path.join(NEXT, 'src');
const SECTIONS = path.join(SRC, 'components', 'sections');

let pass = 0;
let fail = 0;
const ok = (m) => { pass += 1; console.log(`  ✅ ${m}`); };
const bad = (m) => { fail += 1; console.log(`  ❌ ${m}`); };
const die = (m) => { console.error(`🔴 跑不起来: ${m}`); process.exit(2); };

const manifestLib = require(path.join(NEXT, 'scripts', 'lib', 'block-manifest.js'));
const { editableSlotPaths, stripSlotIndex, NO_SLOT_PATH_BLOCKS } = manifestLib;

// ── 让 node 能 require 这些 .tsx ────────────────────────────────────────────────────────────────
//
// 🔴 源码**从字符串来**，不是直接读文件 —— 下面那两条「证明它真会红」的反向对照要在内存里把
//    源码改坏一处再渲染一次。改文件的话，一次失败的跑会把仓库留在改坏的状态里。
const sourceOverride = new Map();

function compile(filename) {
  const src = sourceOverride.get(filename) ?? fs.readFileSync(filename, 'utf-8');
  return ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    fileName: filename,
  }).outputText;
}

for (const ext of ['.tsx', '.ts']) {
  require.extensions[ext] = (mod, filename) => mod._compile(compile(filename), filename);
}

// 替身：这三样要么是 Next 自己的，要么是构建期生成的（`config-data.ts` 由 sync-config 写，
// 这棵树上不一定有）。它们跟被测的那一维（钩子挂在哪儿）无关。
const STUB_DIR = path.join(NEXT, 'scripts', '.block-slots-stubs');
fs.mkdirSync(STUB_DIR, { recursive: true });
const stub = (name, body) => {
  const p = path.join(STUB_DIR, `${name}.js`);
  fs.writeFileSync(p, body);
  return p;
};
const STUBS = {
  'next/link': stub('link', "const React=require('react');"
    + "const L=({href,children,...r})=>React.createElement('a',{href,...r},children);"
    + 'module.exports=L;module.exports.default=L;\n'),
  '@/components/ServiceIcon': stub('icon', "const React=require('react');"
    + "const C=()=>React.createElement('span');module.exports=C;module.exports.default=C;\n"),
  // 🔴 `pagesByLocale` 里要真有几页：`service-related-pages` 在「这个服务底下一页都没有」时
  //    **直接 return null**，那时它一个钩子都挂不出来 —— 夹具给空数组的话，这道守卫会把它报成
  //    「组件漏挂了」，而那是夹具的毛病不是组件的。slug 跟 §fixtureFor 给 `serviceSlug` 造的值对齐。
  '@/lib/config': stub('config', 'module.exports={'
    + 'getServices:()=>[],'
    + 'pagesByLocale:{en:[{slug:"serviceSlug-text/a",title:"A"},{slug:"serviceSlug-text/b",title:"B"}]},'
    + 'localeUrl:(s)=>"/"+s,siteId:"t",leadApi:"",'
    + 'getBlogPosts:()=>[],brand:{locations:[],email:"a@b.c"}};\n'),
};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function resolve(req, ...rest) {
  if (STUBS[req]) return STUBS[req];
  if (req.startsWith('@/')) return origResolve.call(this, path.join(SRC, req.slice(2)), ...rest);
  return origResolve.call(this, req, ...rest);
};
process.on('exit', () => { try { fs.rmSync(STUB_DIR, { recursive: true, force: true }); } catch (e) { /* 收尾，别掩盖真失败 */ } });

// ── 块类型 → 组件文件 ───────────────────────────────────────────────────────────────────────────
//
// 🔴 从 `registry.ts` 现读，不手抄一份清单。手抄的那份漏掉一个块时，那个块在这道检查里
//    **按构造隐身** —— 而「漏了一个」跟「全都对上了」在输出里长得一模一样。
function componentFileFor(type) {
  const reg = fs.readFileSync(path.join(SRC, 'lib', 'sections', 'registry.generated.ts'), 'utf-8');
  const esc = type.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!new RegExp(`'${esc}':\\s*\\w+`).test(reg)) return null;
  // #1387 —— 组件住在块自己的文件夹里，注册表 import 的就是 `@blocks/<type>/Section`。
  if (!new RegExp(`import\\s+\\w+\\s+from\\s+'@blocks/${esc}/Section'`).test(reg)) return null;
  return path.join(NEXT, 'blocks', type, 'Section.tsx');
}

// ── 夹具：按 manifest 自己造 ────────────────────────────────────────────────────────────────────
//
// 列表槽每项造 **3** 项（票里 做什么 #5 定的下限）。造的值只要「画得出来」就行 —— 这道检查问的是
// 钩子挂在哪儿，不问内容对不对。
const LIST_ITEMS = 3;

// 有些字段不带 `editLabel`，但**不给就画不出来**（组件读它决定画不画、或者 `.map` 它）。
// 这里只补这一类，每一条都写清为什么 —— 补多了会让这道检查看起来比实际覆盖得宽。
const EXTRA = {
  'blog-preview': { fromBlog: false },        // 为真时画的是站里真实的博客文章，不是 data.posts
  'testimonials': { _item: { id: 'x', rating: 5 } }, // rating 用来画星星（Array.from 要一个数）
  'pricing-table': { _item: { features: ['f1', 'f2'] } }, // tier.features.map
  'social-proof': { _item: { rating: '4.9', reviews: '100' } },
  'content-split': { _item: { value: 'v', label: 'l' } },
};

function fixtureFor(type, manifest) {
  const data = {};
  const extra = EXTRA[type] || {};
  for (const [slot, s] of Object.entries(manifest.slots || {})) {
    const subs = (s.editLabel && typeof s.editLabel === 'object') ? Object.keys(s.editLabel) : [];
    switch (s.kind) {
      case 'list': {
        data[slot] = Array.from({ length: LIST_ITEMS }, (_, i) => {
          if (!subs.length) return `${slot}-${i}`;       // 裸字符串列表
          const item = { ...(extra._item || {}) };
          for (const k of subs) item[k] = `${slot}-${i}-${k}`;
          return item;
        });
        break;
      }
      case 'link':
        data[slot] = { href: '/x', ...Object.fromEntries(subs.map((k) => [k, `${slot}-${k}`])) };
        if (!subs.includes('label')) data[slot].label = `${slot}-label`;
        break;
      case 'object':
        data[slot] = Object.fromEntries(subs.map((k) => [k, `${slot}-${k}`]));
        break;
      case 'image':
        data[slot] = s.shape && s.shape.startsWith('[') ? ['/a.png'] : '/a.png';
        break;
      case 'flag':
        data[slot] = true;
        break;
      default:
        data[slot] = `${slot}-text`;
    }
  }
  for (const [k, v] of Object.entries(extra)) if (k !== '_item') data[k] = v;
  return data;
}

// 🔴 **这道守卫够不着的那几条，连同【为什么】一起写在这里。**
//
// 它们只在「表单提交成功之后」那一屏上出现，而那一屏由组件自己的 `useState` 决定 ——
// 静态渲染一次拿不到那个状态，给再好的夹具也一样。
//
// 🔴 **不是把它们从检查里划掉**：下面对这几条改用一条**弱一级**的判据（组件源码里有没有这个
//    `data-slot`）。弱在哪儿写在明处 —— 源码里有，不等于那条分支真的会被走到。两句话都要说，
//    因为「这一维没量到」和「这一维量过了」在一份全绿的报告里长得一模一样。
//
// ⟹ 留给 QA2 的那一半：这两条要在**真浏览器**上填一次表、提交，看那一屏上有没有这个属性
//    （AC3 / AC4 本来就要在真站上走一遍，顺带就能看）。
const STATE_ONLY = {
  'contact-form.successMessage': '只在表单提交成功那一屏出现（ContactFormSection 的 useState）',
  'hero-with-form.form.successMessage': '同上，在 HeroLeadForm 里',
};

// ── 渲染一个块，把产物里的 data-slot 抠出来 ─────────────────────────────────────────────────────
function slotsInOutput(type, manifest) {
  const file = componentFileFor(type);
  if (!file || !fs.existsSync(file)) return { error: `找不到 ${type} 的组件文件` };
  delete require.cache[file];
  let html;
  try {
    const C = require(file).default;
    html = renderToStaticMarkup(React.createElement(C, {
      data: fixtureFor(type, manifest),
      locale: 'en',
      block: { id: `${type}-0`, type, role: manifest.roleDefault, region: 'content', data: {} },
    }));
  } catch (e) {
    return { error: `渲染 ${type} 抛了：${e.message}` };
  }
  const raw = [...html.matchAll(/data-slot="([^"]*)"/g)].map((m) => m[1]);
  return { raw, paths: new Set(raw.map(stripSlotIndex)) };
}

// ── 跑 ──────────────────────────────────────────────────────────────────────────────────────────
let manifests;
try {
  manifests = manifestLib.loadManifests(path.join(NEXT, 'blocks'));
} catch (e) {
  die(`manifest 读不出来：${e.message}`);
}

console.log('\n── ① manifest 上标的 editLabel，跟产物里挂的 data-slot 两边差集都为空');
const noSlotBlocks = [];
const skipped = [];
{
  const onlyManifest = [];
  const onlyOutput = [];
  let blocks = 0;
  for (const [type, m] of manifests) {
    // 🔴 外壳区那两个块（#1353）不经 `SectionRenderer`，没有组件文件可渲染 —— 它们整块不在这一维里
    //    （理由写在 `block-manifest.js` 的 §NO_SLOT_PATH_BLOCKS 旁边）。跳过它们之前先证明它们**真的**
    //    一条 editLabel 都没标：不然「跳过」就成了一个能把漏标藏起来的洞。
    if (NO_SLOT_PATH_BLOCKS.includes(type)) {
      const labelled = editableSlotPaths(m).map((x) => x.path);
      if (labelled.length) {
        bad(`${type} 在 NO_SLOT_PATH_BLOCKS 里（没有 data-slot 这条路），却标了 editLabel：${labelled.join(' / ')}`);
      } else skipped.push(type);
      continue;
    }
    const want = new Set(editableSlotPaths(m).map((x) => x.path));
    const got = slotsInOutput(type, m);
    if (got.error) { bad(got.error); continue; }
    blocks += 1;
    if (got.paths.size === 0) noSlotBlocks.push(type);
    for (const p of want) {
      if (got.paths.has(p)) continue;
      if (STATE_ONLY[`${type}.${p}`]) continue;   // 下面第 ④ 节用弱一级的判据单独查它们
      onlyManifest.push(`${type}.${p}`);
    }
    for (const p of got.paths) if (!want.has(p)) onlyOutput.push(`${type}.${p}`);
  }
  if (onlyManifest.length) {
    bad(`manifest 标了 editLabel 而组件没挂 data-slot（面板会给一个改不动任何东西的输入框）：\n     `
      + onlyManifest.join('\n     '));
  } else {
    ok(`${blocks} 个块：manifest 上每一条 editLabel，组件里都挂上了 data-slot`
      + (skipped.length ? `（另有 ${skipped.join(' / ')} 整块不在这一维里，它们一条 editLabel 都没标）` : ''));
  }
  if (onlyOutput.length) {
    bad(`组件挂了 data-slot 而 manifest 没标 editLabel（这个钩子谁都不读）：\n     ` + onlyOutput.join('\n     '));
  } else ok('反方向也空：组件里没有一个 data-slot 是 manifest 不认识的');
}

// 🔴 防「两边都空也算相等」。一个 `data-slot` 都没有的块只许是那两个 —— 它们的 `slots` 本来就是空的
//    （自己从 services.json 取内容）。少了这一格，一次把全部钩子删光的改动会让上面两格**全绿**。
console.log('\n── ② 防「两边都空」：产物里一个 data-slot 都没有的块，只许是那两个');
{
  const allowed = ['services-list', 'services-nav'];
  const unexpected = noSlotBlocks.filter((t) => !allowed.includes(t));
  const missing = allowed.filter((t) => !noSlotBlocks.includes(t));
  if (unexpected.length) bad(`这些块的产物里一个 data-slot 都没有：${unexpected.join(' / ')}`);
  else if (missing.length) bad(`${missing.join(' / ')} 竟然挂上了 data-slot —— 它们的 slots 是空的，不该有`);
  else ok(`没有钩子的块恰好是 ${allowed.join(' 和 ')}（这两份 manifest 的 slots 本来就是空的）`);
}

// ── ③ 证明它真会红（AC1 点名的两处，各弄坏一次）──────────────────────────────────────────────
//
// 🔴 改的是**内存里那份源码**，不是磁盘上的文件：一次失败的跑不该把仓库留在改坏的状态里。
console.log('\n── ③ 证明这道守卫真会红：两个方向各弄坏一次');
{
  // 方向一：组件里删掉一个 data-slot ⟹ 必须红，而且点名那一条路径。
  const file = componentFileFor('team-grid');
  const src = fs.readFileSync(file, 'utf-8');
  const marker = ' data-slot="headline"';
  if (!src.includes(marker)) {
    bad(`夹具不成立：team-grid 的组件里找不到 ${marker}`);
  } else {
    sourceOverride.set(file, src.replace(marker, ''));
    const got = slotsInOutput('team-grid', manifests.get('team-grid'));
    sourceOverride.delete(file);
    if (got.error) bad(`弄坏之后渲染抛了：${got.error}`);
    else if (got.paths.has('headline')) bad('把 data-slot="headline" 删掉之后，产物里居然还有它 —— 这把尺子读的不是产物');
    else ok('删掉组件里一个 data-slot ⟹ 差集里会出现它（这道守卫会红）');
  }

  // 方向二：manifest 上多一个没人渲染的 editLabel ⟹ 必须红。
  const m = manifests.get('team-grid');
  const before = editableSlotPaths(m).map((x) => x.path);
  const fake = JSON.parse(JSON.stringify(m));
  fake.slots.headline.editLabel = { nobodyRendersThis: 'Ghost' };
  const after = editableSlotPaths(fake).map((x) => x.path);
  const got = slotsInOutput('team-grid', m);
  if (got.error) {
    bad(`渲染 team-grid 抛了：${got.error}`);
  } else if (!after.includes('headline.nobodyRendersThis')) {
    bad(`夹具不成立：加了假 editLabel 之后路径里没有它（${after.join(' ')}）`);
  } else if (got.paths.has('headline.nobodyRendersThis')) {
    bad('产物里居然有这条谁都没渲染的路径 —— 这把尺子读的不是产物');
  } else if (before.includes('headline.nobodyRendersThis')) {
    bad('改之前就有这条路径 —— 夹具不成立');
  } else {
    ok('manifest 上加一个没人渲染的 editLabel ⟹ 它落在「只有 manifest 有」那一栏（这道守卫会红）');
  }
}

// ── ④ 这道守卫够不着的那几条：改用弱一级的判据，并且把「弱在哪儿」说出来 ──────────────────────
console.log('\n── ④ 渲染一次够不着的那几条（只在提交成功那一屏出现）');
{
  for (const [ref, why] of Object.entries(STATE_ONLY)) {
    const [type, ...rest] = ref.split('.');
    const slotPath = rest.join('.');
    // 源码里找 —— 这几条的钩子写成字面量，所以字面量查得到。
    // #1387 —— 组件搬进了 `blocks/<块>/Section.tsx`，所以扫的是那一批（外加 `src/components/sections/`
    // 里剩下的那些不是块的零件，例如 HeroLeadForm.tsx）。
    const files = [
      ...fs.readdirSync(path.join(NEXT, 'blocks'), { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => path.join(NEXT, 'blocks', e.name, 'Section.tsx'))
        .filter((f) => fs.existsSync(f)),
      ...(fs.existsSync(SECTIONS)
        ? fs.readdirSync(SECTIONS).filter((f) => f.endsWith('.tsx')).map((f) => path.join(SECTIONS, f))
        : []),
    ];
    const hit = files.filter((f) => fs.readFileSync(f, 'utf-8').includes(`data-slot="${slotPath}"`));
    if (hit.length) {
      ok(`${ref}：源码里挂着（${path.relative(NEXT, hit[0])}）—— 🔴 弱判据，只证「写了」不证「那条分支会被走到」`
        + `；够不着的原因：${why}`);
    } else {
      bad(`${ref}：源码里都找不到 data-slot="${slotPath}"（${why}）`);
    }
  }
  console.log(`  📌 覆盖边界：上面第 ① 节的差集**不含**这 ${Object.keys(STATE_ONLY).length} 条，`
    + '它们要在真浏览器上提交一次表单才量得到（留给 QA2）。');
}

// ── ⑤ 外壳区没漏进来（#1352 v3 正文 做什么 #3）────────────────────────────────────────────────
//
// 🔴 上面第 ① 节只查了一半：顶栏页脚的 manifest 没标 `editLabel`。另一半是**组件那一侧** ——
//    `Header.tsx` / `Footer.tsx` 里不该出现 `data-slot`。两件事会分头发生：有人给组件挂上钩子而
//    manifest 一个字没动，第 ① 节按构造看不见（它跳过这两个块），而那个钩子会跟着进主题契约的
//    拒绝表、面板却永远列不出它。
// 🔴 这一格用的是**源码**不是产物，而且理由跟第 ④ 节那条弱判据不同：这两个块**不经**
//    `SectionRenderer`（`registry.ts` 里没有 `header` / `footer` 这两个键 —— 现取 0 命中），
//    一份「按 manifest 造页面」的夹具按构造产不出它们 ⟹ 在产物上量这一条，读到的 0 是
//    「这里根本没有这个块」而不是「这个块上没有钩子」。源码这一侧读到的 0 才是真的那个 0。
console.log('\n── ⑤ 外壳区（header / footer）没漏进来：组件里没有 data-slot，manifest 那两个文字槽原样');
{
  for (const f of ['header', 'footer']) {
    const file = path.join(NEXT, 'blocks', f, 'Section.tsx');
    if (!fs.existsSync(file)) { bad(`${f} 的组件不在 ${file}`); continue; }
    const hits = (fs.readFileSync(file, 'utf-8').match(/data-slot/g) || []).length;
    if (hits) bad(`blocks/${f}/Section.tsx 里有 ${hits} 处 data-slot —— 外壳区本轮不在这一维里（它们渲染出来没有 data-block-id，检查器点不中）`);
    else ok(`blocks/${f}/Section.tsx：data-slot 命中 0`);
  }
  // `footer.copyright` / `footer.description` 是 `kind: text` 却没有 `editLabel` —— 这两个槽位正是
  // 「跳过外壳区」那条规则在挡的那一格。它们要是被人顺手标上，第 ① 节会红；这里钉的是反过来那句：
  // 今天它们没标，而校验器（上面 loadManifests 已经跑过一遍）**没有**因此红。
  const footer = manifests.get('footer');
  if (!footer) bad('blocks/footer/ 读不出来');
  else {
    const both = ['copyright', 'description'].map((k) => [k, footer.slots && footer.slots[k]]);
    const wrong = both.filter(([, spec]) => !spec || spec.kind !== 'text' || spec.editLabel !== undefined);
    if (wrong.length) bad(`footer 的 ${wrong.map(([k]) => k).join(' / ')} 不是「kind: text 且没有 editLabel」了 —— 外壳区这一轮不该动`);
    else ok('footer.copyright / footer.description 仍是 kind: text 且没有 editLabel，而校验器没红（跳过外壳区那条规则在起作用）');
  }
}

console.log(`\n══ ${pass} 过 / ${fail} 败 ══`);
process.exit(fail ? 1 : 0);
