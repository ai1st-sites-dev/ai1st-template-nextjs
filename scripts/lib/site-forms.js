'use strict';
// ══════════════════════════════════════════════════════════════════════════════════════════════════
// site-forms.js —— 站级表单库（#1471，总纲 #1422 的 T5.3）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// Chris 2026-09-28：**表单是站的资产，不在块里定义。** 每个语言一份 `site/<locale>/forms.json`（跟 services.json
// 同构、同目录），`sync-config.js` 读进 `config-data.ts`。hero / footer / contact / cta 的 `form`
// 槽只有 `{ id? }`（选哪一张），露多少是旋钮 `data.options.form`（none | teaser | full）。
//
//   [ { id: "quote", name: "Get a free quote", fields: ["name","phone","service"], primary: "phone",
//       buttonText, successMessage, redirect? } ]
//
// 🔴 这一份被三处用：渲染（`src/components/BlockLeadForm.tsx` 选表单）、校验（`block-manifest.js §validateSite`）、
//    建站（`create-site.js` 写默认那两张）。三处各写一份的话，分歧那天谁都不会红。
// 🔴 `id` / `fields` / `primary` 各语言必须一致（`formsProblems`）：块里写的是 `id`，某个语言少一张 = 那个语言下指空。
//    `name` / `buttonText` / `successMessage` 是给访客看的文字，各语言各自翻。

/** 字段词表 —— 每个字段对应客户记录（Customers）的一列（对照表见 BlockLeadForm.tsx 头注释）。本票不扩。 */
const FORM_FIELDS = ['name', 'phone', 'email', 'message', 'service'];
/** 旋钮 `form` 的取值（四个块的 manifest 里同一串）。 */
const FORM_MODES = ['none', 'teaser', 'full'];

/**
 * 新站默认的两张（做什么 3）：`quote` 在前 —— 块里 `form.id` 为空时取第一张。
 * 文字是英文底稿，建站提示词让 AI 按行业改文案、不改字段。
 */
const DEFAULT_SITE_FORMS = [
  {
    id: 'quote',
    name: 'Get a free quote',
    fields: ['name', 'phone', 'service'],
    primary: 'phone',
    buttonText: 'Get a free quote',
    successMessage: "Thanks! We've got your details and will be in touch.",
  },
  {
    id: 'contact',
    name: 'Contact us',
    fields: ['name', 'email', 'message'],
    primary: 'email',
    buttonText: 'Send message',
    successMessage: 'Thanks for your message — we will get back to you shortly.',
  },
];

const { hrefAllowed } = require('./href-allowed');

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * 一个语言那份表单库的毛病（`where` 是报文前缀，如 `forms.json [en]`）。不改数据，只说。
 */
function formListProblems(forms, where = 'forms.json') {
  const out = [];
  if (!Array.isArray(forms)) {
    out.push(`${where}: 必须是数组（今天是 ${forms === null ? 'null' : typeof forms}）`);
    return out;
  }
  const seen = new Set();
  forms.forEach((f, i) => {
    const at = `${where} 第 ${i + 1} 张`;
    if (!isObj(f)) { out.push(`${at}: 不是对象`); return; }
    if (typeof f.id !== 'string' || !f.id.trim()) { out.push(`${at}: 缺 id（非空字符串）`); return; }
    const me = `${where} "${f.id}"`;
    if (seen.has(f.id)) out.push(`${me}: id 重复`);
    seen.add(f.id);
    if (!Array.isArray(f.fields) || !f.fields.length) {
      out.push(`${me}: fields 必须是非空数组`);
    } else {
      const bad = f.fields.filter((x) => !FORM_FIELDS.includes(x));
      if (bad.length) out.push(`${me}: fields 里有词表外的值 ${JSON.stringify(bad)} —— 只能是 ${FORM_FIELDS.join(' / ')}`);
      if (!f.fields.includes(f.primary)) {
        out.push(`${me}: primary ${JSON.stringify(f.primary)} 不在 fields 里 —— teaser 只露这一个字段，它得是表单里有的那一格`);
      }
      // #1511 —— 提交前要求「电话和邮箱至少填一个」（BlockLeadForm.tsx §submit）⟹ 两个框都没有的表单永远提交不了。
      if (!f.fields.includes('phone') && !f.fields.includes('email')) {
        out.push(`${me}: fields 里既没有 phone 也没有 email —— 访客提交时这两样至少要填一个，否则永远提交不了；加上其中一个`);
      }
    }
    // #1511 —— 提交成功后 BlockLeadForm 直接 `window.location.assign(redirect)`：判据跟块里的按钮链接同一份（href-allowed.js）。
    //    没写 / null / 空串 = 不跳（BlockLeadForm 只在有值时跳），不报。
    if (f.redirect != null && (typeof f.redirect !== 'string' || !hrefAllowed(f.redirect))) {
      out.push(`${me}: redirect ${JSON.stringify(f.redirect)} 不是能跳的地址 —— 只收 https:// / http:// / mailto: / tel: 或站内路径（/ 开头，如 /thanks）；不跳就删掉这一项`);
    }
  });
  return out;
}

/** 一张表单的「结构」（各语言必须一致的那三样）。 */
const skeleton = (f) => JSON.stringify({ fields: isObj(f) ? f.fields : undefined, primary: isObj(f) ? f.primary : undefined });

/**
 * 全站表单库的毛病：每个语言各查一遍 + 各语言的 `id` / `fields` / `primary` 一致。
 * 入参 `{ [locale]: forms[] }`；只有一个语言时第二条自然恒空。
 */
function formsProblems(formsByLocale) {
  if (!isObj(formsByLocale)) return [];
  const out = [];
  for (const loc of Object.keys(formsByLocale)) out.push(...formListProblems(formsByLocale[loc], `forms.json [${loc}]`));
  return out.concat(formsConsistencyProblems(formsByLocale));
}

/** 只查「各语言的 id / fields / primary 一致」这一条（构建期逐语言校验完之后单独补这一句用）。 */
function formsConsistencyProblems(formsByLocale) {
  const out = [];
  if (!isObj(formsByLocale)) return out;
  const locales = Object.keys(formsByLocale);
  if (locales.length < 2) return out;
  const [base, ...rest] = locales;
  const byId = (list) => new Map((Array.isArray(list) ? list : []).filter((f) => isObj(f) && typeof f.id === 'string').map((f) => [f.id, f]));
  const ref = byId(formsByLocale[base]);
  for (const loc of rest) {
    const cur = byId(formsByLocale[loc]);
    for (const id of new Set([...ref.keys(), ...cur.keys()])) {
      if (!ref.has(id) || !cur.has(id)) {
        out.push(`forms.json: 表单 "${id}" 只在 ${ref.has(id) ? base : loc} 里有 —— 各语言的 id 必须一致，否则块里的 form.id 会在另一个语言下指空`);
      } else if (skeleton(ref.get(id)) !== skeleton(cur.get(id))) {
        out.push(`forms.json: 表单 "${id}" 的 fields / primary 在 ${base} 与 ${loc} 不一样 —— 这两样各语言必须一致（只有给访客看的文字各自翻）`);
      }
    }
  }
  return out;
}

/** 全站出现过的表单 id（任一语言）。 */
function formIds(formsByLocale) {
  const ids = new Set();
  if (!isObj(formsByLocale)) return ids;
  for (const list of Object.values(formsByLocale)) {
    for (const f of Array.isArray(list) ? list : []) if (isObj(f) && typeof f.id === 'string' && f.id) ids.add(f.id);
  }
  return ids;
}

/**
 * 块里选的那一张：`id` 有值且找得到 → 它；否则第一张（做什么 4：`id` 为空取第一张；指空的 id 已由 validateSite 说过，
 * 渲染这一侧不让整块空掉）。表单库空 → null（调用方退回内置默认字段）。
 */
function pickForm(forms, id) {
  const list = (Array.isArray(forms) ? forms : []).filter((f) => isObj(f) && Array.isArray(f.fields) && f.fields.length);
  if (!list.length) return null;
  if (typeof id === 'string' && id) {
    const hit = list.find((f) => f.id === id);
    if (hit) return hit;
  }
  return list[0];
}

/**
 * 建站用：把 AI 写的文案叠到固定骨架上（做什么 3：「AI 按行业改文案，不改字段词表」）。
 * 骨架决定有哪几张、每张的 `id` / `fields` / `primary`（默认 = DEFAULT_SITE_FORMS；副语言传主语言那份，于是各语言
 * 结构按构造一致）；`copy` 里同 `id` 那张的 `name` / `buttonText` / `successMessage` 是非空字符串才拿来，别的键一律不认。
 */
const COPY_CAPS = { name: 60, buttonText: 40, successMessage: 200 };
function siteFormsFrom(copy, base = DEFAULT_SITE_FORMS) {
  const given = new Map((Array.isArray(copy) ? copy : []).filter((f) => isObj(f) && typeof f.id === 'string').map((f) => [f.id, f]));
  return (Array.isArray(base) ? base : DEFAULT_SITE_FORMS).map((b) => {
    const out = { ...b, fields: [...b.fields] };
    const c = given.get(b.id);
    if (c) {
      for (const [k, cap] of Object.entries(COPY_CAPS)) {
        if (typeof c[k] === 'string' && c[k].trim()) out[k] = c[k].trim().slice(0, cap);
      }
    }
    return out;
  });
}

/**
 * 编辑器（Puck）里 `form.id` 那一格的下拉（做什么 6）：第一项 = 留空（用表单库第一张），其余 = 每张表单的 `name`，值是 `id`。
 */
function formIdOptions(forms) {
  const list = (Array.isArray(forms) ? forms : []).filter((f) => isObj(f) && typeof f.id === 'string' && f.id);
  const first = list[0] ? ` (${list[0].name || list[0].id})` : '';
  return [{ label: `First form${first}`, value: '' }, ...list.map((f) => ({ label: f.name || f.id, value: f.id }))];
}

module.exports = { FORM_FIELDS, FORM_MODES, DEFAULT_SITE_FORMS, COPY_CAPS, formListProblems, formsProblems, formsConsistencyProblems, formIds, pickForm, siteFormsFrom, formIdOptions };
