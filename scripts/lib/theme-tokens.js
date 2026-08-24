// ══════════════════════════════════════════════════════════════════════════════════════════════════
// theme-tokens.js — 主题的颜色 / 字体 / 风格设定按 JSON schema 校验（#1003，spec §5.1 / D9）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 「能声明的就别让 AI 自由写」：颜色、字体、settings 是 tokens，进 schema；只有「图在左还是在上」
// 这种表达不成 token 的东西才留给受限 CSS。配套的另一半在 `theme-css-lint.js`：受限 CSS 里不许出现
// 字面色值和字面字体名，否则 AI 可以绕开这份 schema 直接把 `#ff0000` 写进样式表。
//
// 🔴 两种 settings 形状二选一，不许混写（本票定死的一处）：
//   · 枚举形状（#961 那 30 套手写主题，今天 `themes.js` 里的 `retiredThemes`）：radius: 'sharp' · …
//     🔴 #1161（2026-08-23）之后这两组不再住在同一个导出里：`themes` 就是池子那 80 套（全是数值
//     形状），枚举形状的那 30 套在并列的 `retiredThemes` 里。这一行说的仍然是那 30 套 —— 只是它们
//     现在按名字就分得开，不必再靠「110 套里恰好这 30 套」这种说法。（上一版写的就是那句。）
//   · 数值形状（生成的主题用）：radius: 16 · density: 1.0 · shadowStrength: 0.12 · buttonShape: 'pill'
//   逐键混用会把「这套主题吃不吃得动日后的微调」变成逐个键的问题，而微调（#1006）是整套缩放。
//
// 🔴 为什么自己写校验器而不 `require('ajv')`：ajv 今天在 node_modules 里，但它是 eslint 的**传递**
//   依赖，不在我们的 package.json 里。把产线校验建在别人的传递依赖上，某天那棵树一变就静默换行为
//   （站容器跑的是 `npm ci`，装的正是那棵树）。下面这个解释器只认这份 schema 真正用到的关键字，
//   多一个关键字就当场报「schema 用了我不认识的关键字」——不认识的东西不许静默放过。
const fs = require('fs');
const path = require('path');

const SCHEMA_PATH = path.join(__dirname, '..', '..', 'schemas', 'theme-tokens.schema.json');

let schemaCache = null;
function loadSchema(file = SCHEMA_PATH) {
  if (!schemaCache || schemaCache.file !== file) {
    schemaCache = { file, schema: JSON.parse(fs.readFileSync(file, 'utf-8')) };
  }
  return schemaCache.schema;
}

const KNOWN_KEYWORDS = new Set([
  '$schema', '$id', 'title', 'description', 'type', 'required', 'properties', 'items', 'minItems',
  'enum', 'minimum', 'maximum', 'pattern', 'oneOf', 'additionalProperties', 'propertyNames',
]);

const typeOf = (v) => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);

/** schema 的一个子式对一个值 → string[]（空 = 通过）。`where` 是给人看的字段路径。 */
function check(schema, value, where) {
  const problems = [];
  for (const k of Object.keys(schema)) {
    if (!KNOWN_KEYWORDS.has(k)) {
      problems.push(`${where || '(根)'}: schema 用了这个校验器不认识的关键字 "${k}" —— 加关键字要同时教会它`);
    }
  }
  const at = (msg) => problems.push(`${where || '(根)'}: ${msg}`);

  if (schema.oneOf) {
    const results = schema.oneOf.map((s) => ({ title: s.title || '', errs: check(s, value, where) }));
    const passing = results.filter((r) => r.errs.length === 0);
    if (passing.length === 0) {
      // 🔴 报「最接近的那一支」的全部错，不要报「两种都不符合」。AC5 要的是**点名字段**，而
      // `radius: 25` 在枚举支上的错是「缺字段 shadow」——把两支的第一条错并排贴出来，真正的原因
      // （越界的那个数）会被埋在后半句里。选最接近的一支（错最少），把它的错逐条报出来。
      const best = results.slice().sort((a, b) => a.errs.length - b.errs.length)[0];
      at(`按【${best.title}】判：${best.errs.join('；')}`);
      const others = results.filter((r) => r !== best).map((r) => r.title).join(' / ');
      if (others) at(`（另一种形状【${others}】也不符合；同一套主题只能整套用其中一种，不许混写）`);
    } else if (passing.length > 1) {
      at('同时符合不止一种形状,schema 有歧义');
    }
    return problems;   // oneOf 自己就说明了一切，别再拿外层关键字重复报一遍
  }

  if (schema.type && typeOf(value) !== schema.type) {
    at(`应该是 ${schema.type}，实际是 ${typeOf(value)}`);
    return problems;   // 类型都不对，再往下查只会刷屏
  }
  if (schema.enum && !schema.enum.includes(value)) {
    at(`"${value}" 不在允许的取值里（${schema.enum.join(' / ')}）`);
  }
  if (typeof value === 'number') {
    // 🔴 先判「是不是一个有限的数」，再谈边界（QA3 在 #1003 终审量的）：`NaN` 跟任何数比大小都是
    // false，所以只靠 min / max 的话 `radius: NaN` 一路通过。`Infinity` 今天恰好被上界拦住 —— 但那
    // 是因为这三个数值字段都写了上界，判据不该建在「以后每个数值字段都会有上界」上。注册表是 JS
    // 文件，写得出这两个值。
    if (!Number.isFinite(value)) {
      at(`${value} 不是一个有限的数`);
    } else {
      if (schema.minimum !== undefined && value < schema.minimum) at(`${value} 小于下界 ${schema.minimum}`);
      if (schema.maximum !== undefined && value > schema.maximum) at(`${value} 大于上界 ${schema.maximum}`);
    }
  }
  if (typeof value === 'string' && schema.pattern && !new RegExp(schema.pattern).test(value)) {
    at(`"${value}" 不符合 ${schema.pattern}`);
  }
  if (schema.type === 'array') {
    if (schema.minItems !== undefined && value.length < schema.minItems) at(`至少要 ${schema.minItems} 项，实际 ${value.length} 项`);
    if (schema.items) value.forEach((v, i) => problems.push(...check(schema.items, v, `${where}[${i}]`)));
  }
  if (schema.type === 'object' || (!schema.type && value && typeOf(value) === 'object')) {
    for (const req of schema.required || []) {
      if (!Object.prototype.hasOwnProperty.call(value, req)) at(`缺字段 "${req}"`);
    }
    for (const [k, v] of Object.entries(value)) {
      const sub = (schema.properties || {})[k];
      if (sub) { problems.push(...check(sub, v, where ? `${where}.${k}` : k)); continue; }
      if (schema.propertyNames && schema.propertyNames.pattern
        && !new RegExp(schema.propertyNames.pattern).test(k)) {
        at(`键 "${k}" 不符合 ${schema.propertyNames.pattern}`);
        continue;
      }
      if (schema.additionalProperties === false) {
        at(`多了一个不认识的字段 "${k}"`);
      } else if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        problems.push(...check(schema.additionalProperties, v, where ? `${where}.${k}` : k));
      }
    }
  }
  return problems;
}

/** 一套主题的 tokens 合不合法 → string[]（空 = 合法）。 */
function validateTokens(tokens, { file } = {}) {
  if (!tokens || typeOf(tokens) !== 'object') return ['tokens 不是一个对象'];
  return check(loadSchema(file), tokens, '');
}

/** `scripts/themes.js` 导出的整张注册表 → { id: string[] }，只收有问题的那几套。 */
function validateRegistry(themes) {
  const bad = {};
  for (const [id, t] of Object.entries(themes || {})) {
    // 🔴 `settings` 缺席时不要把这个键放进去。schema 说它是可选的（不带这个键校验通过），但
    // `{settings: undefined}` 是"键存在、值不合法"：两种形状都不符合，于是报的是「不许混写」，
    // 而 `sync-config.js` 见到任何一条就 `process.exit(1)` —— 构建当场死，错误信息说的还是另一回事。
    // 今天 30 套都写了 settings 所以碰不到，但 `settingsToCssVars` 是支持它缺席的（#961：落回
    // `globals.css` 的 `:root` 默认值），下一套那样的主题会把构建卡死。
    const tokens = { colors: t.colors, fonts: t.fonts };
    if (t.settings !== undefined) tokens.settings = t.settings;
    const problems = validateTokens(tokens);
    if (problems.length) bad[id] = problems;
  }
  return bad;
}

/** settings 是哪种形状（'enum' / 'numeric' / null）—— 给需要分支的消费者用，判据只有一处。 */
function settingsShape(settings) {
  if (!settings || typeOf(settings) !== 'object') return null;
  if (typeof settings.radius === 'number') return 'numeric';
  if (typeof settings.radius === 'string') return 'enum';
  return null;
}

module.exports = { SCHEMA_PATH, loadSchema, validateTokens, validateRegistry, settingsShape };
