#!/usr/bin/env node
/**
 * add-locale.test.js — #1999：网站建好之后再加一种语言（lib/add-locale.js + `site.js add-locale`）。
 *
 * 跑法:  node scripts/lib/add-locale.test.js   （或 `npm run test:scripts`）
 * 退出码: 0 全过 · 1 有失败
 *
 * ① 产物逐项（验收 3）：4 份站级文件 + 每一页（含 services/<id>）一个不少、slug 不变；块的结构（id / type / shape / options / 图 /
 *    链接）取主语言、字取译文；每页 targetKeyword 是译文且 translated: true；seo.json 不带 targetKeywords、locale = zh_CN
 * ② 共用块库（验收 4）：键集合两向差集为空、visibility（数组）与 weight 原样、data 是译文；反向：主语言没有 ⟹ 产物里也没有
 * ③ 菜单（验收 5）：/blog、/en/blog、/zh/blog 三种写法全去掉，别的链接留着；主语言那份菜单没被动过
 * ④ 主语言不动（验收 12 的脚本那一半）：产物里没有一个主语言的键；传进来的 content 前后逐字相同
 * ⑤ 老板改过的字跟着译（验收 6）：译的是传进来的这一份（hero 改成一句独特的话 ⟹ 译文里是这句）
 * ⑥ 失败不留半套（验收 9）：第 3 页那一次必失败 ⟹ 抛 AddLocaleError、点名那一页；命令行退出码 1、没有 result.json
 * ⑦ 回包结构对不上：问第二次时带着问题；两次都对不上 ⟹ 整个失败；已有的语言 ⟹ 拒
 * ⑧ 品牌：填了店名用它，没填用主语言的；标语是译文
 * ⑨ custom-html 块和 {ref} 原样带过去，不交给 AI
 * ⑩ 提示词用的是 languagesPrompt 的「主语言已定稿」那一支（不许重写主语言）
 * ⑪ 命令行（真 `site.js add-locale`，AI1ST_ADD_LOCALE_FAKE=echo）：按页的进度行、最后一行、result.json 只有新增的那几样
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { addLocale, AddLocaleError, fakeAi } = require('./add-locale');

let pass = 0;
let fail = 0;
function check(name, cond, detail) {
  if (cond) { pass += 1; console.log(`  ✓ ${name}`); } else { fail += 1; console.log(`  ✗ ${name}${detail ? ` —— ${detail}` : ''}`); }
}
const clone = (v) => JSON.parse(JSON.stringify(v));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const SITE_JS = path.join(__dirname, '..', 'site.js');

function page(slug, headline, extra = []) {
  return {
    slug, title: `${slug} title`, description: `About ${slug}.`, navLabel: slug, navOrder: 1, seo: { targetKeyword: `${slug} keyword` },
    blocks: [
      { id: `${slug}-hero`, type: 'hero', role: 'lead', region: 'content', weight: 0, shape: 'split',
        data: { options: { image: 'left' }, bg: '#ffffff', headline, image: { imageUrl: '/images/a.jpg', alt: 'A car on a lift' },
          ctas: [{ label: 'Book now', href: '/contact', style: 'solid' }] } },
      { id: `${slug}-faq`, type: 'faq', data: { headline: 'Questions', items: [{ question: 'Open Sundays?', answer: 'No.' }] } },
      ...extra,
    ],
  };
}

function site({ lib = true } = {}) {
  return {
    'brand.json': { name: { en: 'Northside Auto' }, tagline: { en: 'Fixed right the first time' }, logoIcon: 'wrench' },
    'site_meta.json': { siteId: 'site-t1999', defaultLocale: 'en', locales: ['en'] },
    'theme.json': { themeId: 'azure-29' },
    'en/seo.json': { domain: 'https://x.example', locale: 'en_CA', siteTitle: 'Northside Auto — Repairs', siteDescription: 'Repairs in Toronto.',
      targetKeywords: { primary: 'auto repair' }, schema: { areaServed: [{ type: 'City', name: 'Toronto' }], offerCatalogName: 'Our services' } },
    'en/services.json': [{ id: 'brakes', name: 'Brakes', shortDescription: 'Pads and rotors.', fullDescription: 'Full brake jobs.', icon: 'disc', features: ['Same day', 'Warranty'], products: [] }],
    'en/forms.json': [{ id: 'contact', name: 'Contact us', fields: ['name', 'phone', { id: 'car', type: 'select', options: ['a', 'b'] }], primary: 'phone',
      buttonText: 'Send', successMessage: 'Thanks!', labels: { car: 'Your car', 'car.a': 'Sedan', 'car.b': 'SUV' } }],
    'en/navigation.json': {
      header: { links: [{ label: 'Home', href: '/' }, { label: 'Blog', href: '/blog' }, { label: 'Services', href: '/services', children: [{ label: 'Tips', href: '/en/blog/tips' }] }],
        buttons: [{ label: 'Get a quote', href: '/contact' }] },
      footer: { description: 'Honest repairs.', columns: [{ title: 'Quick Links', links: [{ label: 'Home', href: '/' }, { label: 'Articles', href: '/zh/blog' }] }, { title: 'Reading', links: [{ label: 'Blog', href: '/blog' }] }],
        copyright: '© 2026 Northside Auto.' },
    },
    'en/pages/home.json': page('home', 'Brake service you can trust in Markham', [{ ref: 'shared-cta' }]),
    'en/pages/about.json': page('about', 'About us', [{ id: 'about-html', type: 'custom-html', data: { html: '<p>Keep me</p>', label: 'Hours' } }]),
    'en/pages/contact.json': page('contact', 'Contact'),
    'en/pages/services/brakes.json': page('services/brakes', 'Brakes'),
    'en/blog/tips.json': { slug: 'tips', title: 'Tips' },
    ...(lib ? { 'en/blocks/site-blocks.json': {
      'shared-cta': { type: 'cta', visibility: ['home', 'about'], weight: 90, data: { headline: 'Call Northside today', ctas: [{ label: 'Call', href: 'tel:1' }] } },
      'shared-note': { type: 'content', visibility: ['*'], weight: 10, data: { headline: 'Note', body: 'We are closed on holidays.' } },
    } } : {}),
  };
}

// 假 AI：每个字前面加 `[zh] `（同 AI1ST_ADD_LOCALE_FAKE=echo），另外记下每一次的提示词。
function recordingAi(opts = '') {
  const inner = fakeAi(`echo${opts ? `,${opts}` : ''}`);
  const calls = [];
  const ai = async (a) => { calls.push(a); return inner(a); };
  return { ai, calls };
}

(async () => {
  console.log('① 产物逐项');
  {
    const { ai } = recordingAi();
    const r = await addLocale({ site: site(), locale: 'zh', ai });
    const keys = Object.keys(r.files).sort();
    const want = ['zh/blocks/site-blocks.json', 'zh/forms.json', 'zh/navigation.json', 'zh/pages/about.json', 'zh/pages/contact.json', 'zh/pages/home.json',
      'zh/pages/services/brakes.json', 'zh/seo.json', 'zh/services.json'];
    check('文件清单一个不少、也不多（含 services/brakes）', same(keys, want), keys.join(', '));
    check('页数 = 主语言页数', r.pages === 4, String(r.pages));
    const home = r.files['zh/pages/home.json'];
    const enHome = site()['en/pages/home.json'];
    check('slug 不译', home.slug === 'home' && r.files['zh/pages/services/brakes.json'].slug === 'services/brakes');
    check('title / description / navLabel 是译文', home.title === '[zh] home title' && home.description === '[zh] About home.' && home.navLabel === '[zh] home');
    const hero = home.blocks[0];
    check('块的结构取主语言（id / type / role / shape / weight / options / bg / imageUrl / href / style）',
      hero.id === 'home-hero' && hero.type === 'hero' && hero.role === 'lead' && hero.shape === 'split' && hero.weight === 0
      && same(hero.data.options, { image: 'left' }) && hero.data.bg === '#ffffff' && hero.data.image.imageUrl === '/images/a.jpg'
      && hero.data.ctas[0].href === '/contact' && hero.data.ctas[0].style === 'solid', JSON.stringify(hero));
    check('块里的字是译文（标题 / alt / 按钮 / FAQ）', hero.data.headline.startsWith('[zh] ') && hero.data.image.alt === '[zh] A car on a lift'
      && hero.data.ctas[0].label === '[zh] Book now' && home.blocks[1].data.items[0].answer === '[zh] No.');
    check('块数与主语言相同', home.blocks.length === enHome.blocks.length);
    check('targetKeyword 是译文且 translated: true', same(home.seo, { targetKeyword: '[zh] home keyword', translated: true }), JSON.stringify(home.seo));
    const seo = r.files['zh/seo.json'];
    check('seo.json：不带 targetKeywords、locale = zh_CN、标题是译文、地点不译', !('targetKeywords' in seo) && seo.locale === 'zh_CN'
      && seo.siteTitle === '[zh] Northside Auto — Repairs' && seo.schema.offerCatalogName === '[zh] Our services' && seo.schema.areaServed[0].name === 'Toronto' && seo.domain === 'https://x.example');
    const svc = r.files['zh/services.json'][0];
    check('services.json：id / icon 不动，名字 / 描述 / features 是译文', svc.id === 'brakes' && svc.icon === 'disc' && svc.name === '[zh] Brakes' && same(svc.features, ['[zh] Same day', '[zh] Warranty']));
    const form = r.files['zh/forms.json'][0];
    const enForm = site()['en/forms.json'][0];
    check('forms.json：id / fields / primary 跟主语言逐字相同，字（含 labels）是译文', form.id === 'contact' && same(form.fields, enForm.fields) && form.primary === 'phone'
      && form.buttonText === '[zh] Send' && form.labels['car.b'] === '[zh] SUV', JSON.stringify(form));
  }

  console.log('② 共用块库');
  {
    const { ai } = recordingAi();
    const src = site();
    const r = await addLocale({ site: src, locale: 'zh', ai });
    const en = src['en/blocks/site-blocks.json'];
    const zh = r.files['zh/blocks/site-blocks.json'];
    const a = Object.keys(en).filter((k) => !(k in zh));
    const b = Object.keys(zh).filter((k) => !(k in en));
    check('键集合两向差集都空', a.length === 0 && b.length === 0, `en−zh=${a} zh−en=${b}`);
    check('每块的 visibility（数组）与 weight 与主语言一致', Object.keys(en).every((k) => Array.isArray(zh[k].visibility) && same(zh[k].visibility, en[k].visibility) && zh[k].weight === en[k].weight));
    check('data 里的字是译文、链接不动', zh['shared-cta'].data.headline === '[zh] Call Northside today' && zh['shared-cta'].data.ctas[0].href === 'tel:1' && zh['shared-note'].data.body.startsWith('[zh] '));
    const none = await addLocale({ site: site({ lib: false }), locale: 'zh', ai });
    check('反向：主语言没有共用块库 ⟹ 产物里也没有', !Object.keys(none.files).some((k) => k.includes('/blocks/')), Object.keys(none.files).join(', '));
  }

  console.log('③ 菜单');
  {
    const { ai } = recordingAi();
    const src = site();
    const before = clone(src['en/navigation.json']);
    const r = await addLocale({ site: src, locale: 'zh', ai });
    const nav = JSON.stringify(r.files['zh/navigation.json']);
    const hits = (nav.match(/"href":"\/(?:[a-z]{2}\/)?blog/g) || []).length;
    check('指向博客的条目 0 处（/blog、/en/blog、/zh/blog 三种写法）', hits === 0, nav);
    const zh = r.files['zh/navigation.json'];
    check('别的链接留着、字是译文；被去光的那一栏也去掉', zh.header.links.length === 2 && zh.header.links[1].href === '/services' && !zh.header.links[1].children.length
      && zh.footer.columns.length === 1 && zh.footer.columns[0].links.length === 1 && zh.footer.columns[0].title === '[zh] Quick Links', nav);
    check('主语言那份菜单没被动过', same(src['en/navigation.json'], before));
  }

  console.log('④ 主语言不动');
  {
    const { ai } = recordingAi();
    const src = site();
    const before = clone(src);
    const r = await addLocale({ site: src, locale: 'zh', ai });
    check('产物里没有一个主语言 / 共享的键', Object.keys(r.files).every((k) => k.startsWith('zh/')), Object.keys(r.files).join(', '));
    check('传进来的 content 前后逐字相同', same(src, before));
  }

  console.log('⑤ 老板改过的字跟着译');
  {
    const { ai, calls } = recordingAi();
    const src = site();
    src['en/pages/home.json'].blocks[0].data.headline = 'Honest brakes on Kennedy Road since 1998';
    const r = await addLocale({ site: src, locale: 'zh', ai });
    check('中文首页 hero 是改过之后那句的译文', r.files['zh/pages/home.json'].blocks[0].data.headline === '[zh] Honest brakes on Kennedy Road since 1998');
    check('交给 AI 的就是改过之后那句', calls.some((c) => c.prompt.includes('Honest brakes on Kennedy Road since 1998')));
  }

  console.log('⑥ 失败不留半套');
  {
    const { ai } = recordingAi('fail:3');
    let err = null;
    try { await addLocale({ site: site(), locale: 'zh', ai }); } catch (e) { err = e; }
    check('第 3 页失败 ⟹ 抛 AddLocaleError，点名那一页（按键排序第 3 个 = home）', err instanceof AddLocaleError && err.where === 'en/pages/home.json', err && `${err.where}: ${err.message}`);
    check('给老板的那句话说的是哪一页', err && /home page/.test(err.message), err && err.message);
  }

  console.log('⑦ 回包结构对不上');
  {
    let n = 0;
    const prompts = [];
    const flaky = async ({ input, code, prompt }) => {
      prompts.push(prompt);
      const got = (await fakeAi('echo')({ input, code })).got;
      if (input.slug === 'about' && n++ === 0) got[code].blocks.pop(); // 第一次少一块
      return { got };
    };
    const r = await addLocale({ site: site(), locale: 'zh', ai: flaky });
    check('第一次少一块 ⟹ 再问一次、这次对上了 ⟹ 成功', !!r.files['zh/pages/about.json'] && r.files['zh/pages/about.json'].blocks.length === 3);
    check('第二次的提示词带着问题', prompts.some((p) => /did not match the English page: blocks: 1 items, the main language has 2/.test(p)), prompts.filter((p) => /did not match/.test(p))[0]);
    const broken = async ({ input, code }) => {
      const got = (await fakeAi('echo')({ input, code })).got;
      if (input.slug === 'contact') got[code].blocks[0].type = 'cta';
      return { got };
    };
    let err = null;
    try { await addLocale({ site: site(), locale: 'zh', ai: broken }); } catch (e) { err = e; }
    check('两次都对不上 ⟹ 整个失败', err instanceof AddLocaleError && err.where === 'en/pages/contact.json', err && `${err.where}: ${err.message}`);
    let dup = null;
    try { await addLocale({ site: site(), locale: 'en', ai: broken }); } catch (e) { dup = e; }
    check('已有的语言 ⟹ 拒', dup instanceof AddLocaleError && /already has/.test(dup.message));
  }

  console.log('⑧ 品牌');
  {
    const { ai } = recordingAi();
    const named = await addLocale({ site: site(), locale: 'zh', brandName: '  北区汽修 ', ai });
    const unnamed = await addLocale({ site: site(), locale: 'zh', ai });
    check('填了店名 ⟹ 用它', named.brand.name === '北区汽修', named.brand.name);
    check('没填 ⟹ 主语言的名字', unnamed.brand.name === 'Northside Auto', unnamed.brand.name);
    check('标语是译文', named.brand.tagline === '[zh] Fixed right the first time', named.brand.tagline);
  }

  console.log('⑨ custom-html / {ref}');
  {
    const { ai, calls } = recordingAi();
    const r = await addLocale({ site: site(), locale: 'zh', ai });
    check('custom-html 原样', same(r.files['zh/pages/about.json'].blocks[2], site()['en/pages/about.json'].blocks[2]));
    check('{ref} 原样', same(r.files['zh/pages/home.json'].blocks[2], { ref: 'shared-cta' }));
    check('custom-html 的 HTML 没交给 AI', !calls.some((c) => c.prompt.includes('Keep me')));
  }

  console.log('⑩ 提示词');
  {
    const { ai, calls } = recordingAi();
    await addLocale({ site: site(), locale: 'zh', ai });
    const pagePrompts = calls.filter((c) => c.input && c.input.slug);
    check('每页一次', pagePrompts.length === 4, String(pagePrompts.length));
    check('都说主语言已定稿、不许重写，回包只有 zh', pagePrompts.every((c) => c.prompt.includes('is final — do NOT rewrite') && c.prompt.includes('{ "zh": {') && !c.prompt.includes('"en": {')));
    check('中文带简体提醒', pagePrompts.every((c) => c.prompt.includes('Simplified Chinese characters')));
  }

  console.log('⑪ 命令行');
  {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'add-locale-test-'));
    try {
      const sitePath = path.join(dir, 'site.json');
      fs.writeFileSync(sitePath, JSON.stringify(site()));
      const run = (env, outDir) => spawnSync(process.execPath, [SITE_JS, 'add-locale', '--site', sitePath, '--locale', 'zh', '--brand-name', '北区汽修', '--out-dir', outDir],
        { input: '{"industry":"Auto repair"}', encoding: 'utf-8', env: { ...process.env, ...env }, timeout: 60000 });
      const ok = run({ AI1ST_ADD_LOCALE_FAKE: 'echo' }, path.join(dir, 'ok'));
      const lines = ok.stdout.trim().split('\n').map((l) => JSON.parse(l));
      const prog = lines.filter((l) => l.event === 'add-locale-progress');
      const last = lines[lines.length - 1];
      check('退出码 0', ok.status === 0, ok.stderr);
      check('进度从 0 / 4 到 4 / 4', prog.length === 5 && prog[0].done === 0 && prog[4].done === 4 && prog.every((p) => p.total === 4), JSON.stringify(prog));
      check('最后一行 add-locale，带 result 和文件清单', last.event === 'add-locale' && last.pages === 4 && last.files.length === 9 && fs.existsSync(last.result), JSON.stringify(last));
      const result = JSON.parse(fs.readFileSync(last.result, 'utf-8'));
      check('result.json 只有新增的文件 + 品牌两格', Object.keys(result).sort().join() === 'brand,files' && Object.keys(result.files).every((k) => k.startsWith('zh/')) && result.brand.name === '北区汽修');
      const bad = run({ AI1ST_ADD_LOCALE_FAKE: 'echo,fail:2' }, path.join(dir, 'bad'));
      const badLast = JSON.parse(bad.stdout.trim().split('\n').pop());
      check('第 2 页失败 ⟹ 退出码 1、最后一行 add-locale-failed、没有 result.json', bad.status === 1 && badLast.event === 'add-locale-failed' && badLast.where === 'en/pages/contact.json'
        && !fs.existsSync(path.join(dir, 'bad', 'result.json')), `${bad.status} ${JSON.stringify(badLast)}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
