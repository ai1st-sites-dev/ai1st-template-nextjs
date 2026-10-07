'use strict';
// ══════════════════════════════════════════════════════════════════════════════════════════════════
// site-forms.js —— 站级表单库（#1471，总纲 #1422 的 T5.3）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// Chris 2026-09-28：**表单是站的资产，不在块里定义。** 每个语言一份 `site/<locale>/forms.json`（跟 services.json
// 同构、同目录），`sync-config.js` 读进 `config-data.ts`。hero / footer / contact / cta 的 `form`
// 槽只有 `{ id? }`（选哪一张），露多少是旋钮 `data.options.form`（none | teaser | full）。
//
//   [ { id: "contact", name: "Contact us", fields: ["name","phone","email","message"], primary: "phone",
//       buttonText, successMessage, redirect? } ]
//
// 🔴 这一份被三处用：渲染（`src/components/BlockLeadForm.tsx` 选表单）、校验（`block-manifest.js §validateSite`）、
//    建站（`create-site.js` 写默认那一张）。三处各写一份的话，分歧那天谁都不会红。
// 🔴 `id` / `fields` / `primary` 各语言必须一致（`formsProblems`）：块里写的是 `id`，某个语言少一张 = 那个语言下指空。
//    `name` / `buttonText` / `successMessage` / `labels`（#1637，字段名 = 输入框占位符）是给访客看的文字，各语言各自翻。

/** 字段词表 —— 每个字段对应客户记录（Customers）的一列（对照表见 BlockLeadForm.tsx 头注释）。本票不扩。 */
const FORM_FIELDS = ['name', 'phone', 'email', 'message', 'service'];
/** #1637 —— `labels`（老板写的字段名）每条的上限。 */
const LABEL_CAP = 40;
/** 旋钮 `form` 的取值（四个块的 manifest 里同一串）。 */
const FORM_MODES = ['none', 'teaser', 'full'];

/**
 * 新站默认的表单：#1635 起只有一张 `contact`（Chris 2026-10-06「一个 contact 就够了」）。块里 `form.id` 为空时取第一张，也就是它。
 * 短版（teaser）只露 `primary` 那一格 = 电话 + 按钮，跟原来 `quote` 那张的「回电请求」一样；长版是整张四格。
 * 「电话和邮箱至少填一个」由 BlockLeadForm.tsx §submit 管，两格都不是必填。
 * 以前是两张（`quote`：姓名 / 电话 / 需求下拉，在前；`contact`：姓名 / 邮箱 / 留言）—— 从旧的 quote-form / contact-form 两个块搬来的。
 * 「需求」下拉的选项来自服务清单，AI 建站时写不准，默认不再用；`service` 字段仍在 FORM_FIELDS 里（manager/form_channel.go 认它）。
 * 文字是英文底稿，建站提示词让 AI 按行业改文案、不改字段。
 */
const DEFAULT_SITE_FORMS = [
  {
    id: 'contact',
    name: 'Contact us',
    fields: ['name', 'phone', 'email', 'message'],
    primary: 'phone',
    buttonText: 'Get in touch',
    successMessage: 'Thanks — we will get back to you shortly.',
  },
];

const { hrefAllowed } = require('./href-allowed');
// #1631 —— 默认表单那几句按站的语言（AI 没给时的落点）。
const { formWords } = require('./locale-words');

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * #1511 —— 提交前要求「电话和邮箱至少填一个」（BlockLeadForm.tsx §submit）⟹ 两个框都没有的表单永远提交不了。
 * #1637 —— 抽成一个函数：这里的校验、存盘（`forms-write.js`）和编辑器里那颗删除按钮（`FormCopyEditor.tsx`）用同一个判据。
 */
const lacksContactField = (fields) => !fields.includes('phone') && !fields.includes('email');

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
      if (lacksContactField(f.fields)) {
        out.push(`${me}: fields 里既没有 phone 也没有 email —— 访客提交时这两样至少要填一个，否则永远提交不了；加上其中一个`);
      }
    }
    // #1637 —— `labels`：{ 字段: 非空字符串 ≤ LABEL_CAP }，可缺。键只能是词表里的（不要求在 fields 里：删掉的字段再加回来，名字还在）。
    if (f.labels !== undefined) {
      if (!isObj(f.labels)) {
        out.push(`${me}: labels 必须是对象 { 字段: 字段名 }`);
      } else {
        for (const [k, v] of Object.entries(f.labels)) {
          if (!FORM_FIELDS.includes(k)) out.push(`${me}: labels 里有词表外的字段 ${JSON.stringify(k)}`);
          else if (typeof v !== 'string' || !v.trim() || [...v].length > LABEL_CAP) out.push(`${me}: labels.${k} 必须是 1~${LABEL_CAP} 字的字符串`);
        }
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
 * #1631 —— `locale`：传了它，文字只从两处来 —— AI 给的（`copy`）> `locale-words.js` 里这种语言那一行（表里没有的语言
 *    回英文那一行）。`base` 这时**只供结构**（哪几张、`id` / `fields` / `primary`），它的字不用：副语言那处传的 `base`
 *    是主语言那份，字全是主语言的，继承过来就是「英文站拿到中文按钮」。只有 `id` 不在字表里的那张才留 `base` 自己的字
 *    （没有别的字可用）。不传 `locale` ⟹ 跟改之前一模一样（`base` 连字一起继承）。
 */
const COPY_CAPS = { name: 60, buttonText: 40, successMessage: 200 };
function siteFormsFrom(copy, base, locale) {
  const given = new Map((Array.isArray(copy) ? copy : []).filter((f) => isObj(f) && typeof f.id === 'string').map((f) => [f.id, f]));
  return (Array.isArray(base) ? base : DEFAULT_SITE_FORMS).map((b) => {
    const out = { ...b, fields: [...b.fields] };
    if (locale) Object.assign(out, formWords(locale, b.id) || {});
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

module.exports = { FORM_FIELDS, FORM_MODES, LABEL_CAP, lacksContactField, DEFAULT_SITE_FORMS, COPY_CAPS, formListProblems, formsProblems, formsConsistencyProblems, formIds, pickForm, siteFormsFrom, formIdOptions };
