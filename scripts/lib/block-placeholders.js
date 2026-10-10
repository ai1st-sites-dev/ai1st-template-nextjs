'use strict';

// block-placeholders.js —— #1660 新块拖到画布那一刻带着的字：按站的语言的占位，以及交给 AI `fill` 的那几格。
//
// 一个块从 Blocks 面板拖下去，今天是空的（`fieldProps(c, {})`：文字槽 undefined、列表槽 []）。这里给它：
//   · 播种：§seedListsOf 算出来的列表各播几条空条目（`editor-schema.js` 那段是规则的全文）；
//   · 占位：块头的文字格、播出来的每条里顶层的纯文字格，只要是 `ai: true`（§inlineSlotsOf），按类别填一句占位；
//     `ai: false`（评分、数字这类事实格）不填 —— AI 不编数字，占位也不编；条目里的 `[string]` 列表和子对象也不填；
//   · 交给 AI：§fillFields 列出这些格（`name` 沿用 T6 的命名：数据里的路径、真实下标，`items.1.title`），
//     `text` 带着占位 —— 全空会撞 manager `validateRewriteFields` 的「全空 → 400」。
// 纯函数，编辑器页（客户端）和测试共用；不碰 DOM、不碰 Puck、不读文件。
//
// 🔴 不用 `scripts/lib/demo-content/` 那份演示文案（Northside Auto Care）：文件头写着它「不进真客户的站」。
// 🔴 语言集合同 `locale-words.js`（15 种，含 zh-tw），回落同它：先基础语言（pt-BR → pt），再 en。
//    选它不选渲染期那张 14 种的表（`src/lib/component-labels.ts`）：占位会存进页面 JSON，是内容，不是界面标签。
// 🔴 列表里每条的占位带序号（「标题 1」「标题 2」）：三条一模一样的话，画布上点其中一条，T6 的点击层
//    （`inline-edit.js` §resolveInlineSlot 按内容找回下标）会判成「对上了不止一条」不让改 —— AI 没写成功时老板就只能去右栏改。

const { fieldProps } = require('./editor-convert');
const { setAt } = require('./inline-edit');

// 类别：块头用前四个；列表条目用后七个（带 `{n}` = 第几条）。
const WORDS = {
  en: {
    eyebrow: 'Short tagline', title: 'Write a title here', text: 'Use a sentence or two to describe this.', label: 'Label',
    itemTitle: 'Title {n}', itemText: 'Describe item {n} in a sentence or two.', itemLabel: 'Label {n}',
    question: 'Question {n} that customers often ask?', quote: 'What customer {n} said about you goes here.', name: 'Name {n}', role: 'Role {n}',
  },
  zh: {
    eyebrow: '简短标语', title: '这里写标题', text: '用一两句话介绍这里的内容。', label: '标签',
    itemTitle: '标题 {n}', itemText: '用一两句话介绍第 {n} 项。', itemLabel: '标签 {n}',
    question: '客户常问的第 {n} 个问题？', quote: '这里写第 {n} 位客户对你们的评价。', name: '姓名 {n}', role: '职位 {n}',
  },
  'zh-tw': {
    eyebrow: '簡短標語', title: '這裡寫標題', text: '用一兩句話介紹這裡的內容。', label: '標籤',
    itemTitle: '標題 {n}', itemText: '用一兩句話介紹第 {n} 項。', itemLabel: '標籤 {n}',
    question: '客戶常問的第 {n} 個問題？', quote: '這裡寫第 {n} 位客戶對你們的評價。', name: '姓名 {n}', role: '職位 {n}',
  },
  fr: {
    eyebrow: 'Courte accroche', title: 'Écrivez un titre ici', text: 'Décrivez ceci en une ou deux phrases.', label: 'Libellé',
    itemTitle: 'Titre {n}', itemText: "Décrivez l'élément {n} en une ou deux phrases.", itemLabel: 'Libellé {n}',
    question: 'Question {n} que vos clients posent souvent ?', quote: 'Ce que le client {n} a dit de vous.', name: 'Nom {n}', role: 'Fonction {n}',
  },
  es: {
    eyebrow: 'Lema breve', title: 'Escribe un título aquí', text: 'Describe esto en una o dos frases.', label: 'Etiqueta',
    itemTitle: 'Título {n}', itemText: 'Describe el elemento {n} en una o dos frases.', itemLabel: 'Etiqueta {n}',
    question: '¿Pregunta {n} que tus clientes hacen a menudo?', quote: 'Lo que el cliente {n} dijo de ti.', name: 'Nombre {n}', role: 'Cargo {n}',
  },
  ja: {
    eyebrow: '短いキャッチコピー', title: 'ここに見出しを入力', text: 'ここの内容を一、二文で紹介してください。', label: 'ラベル',
    itemTitle: 'タイトル {n}', itemText: '項目 {n} を一、二文で紹介してください。', itemLabel: 'ラベル {n}',
    question: 'お客様からよくある質問 {n}？', quote: 'お客様 {n} の声をここに入力。', name: '名前 {n}', role: '役職 {n}',
  },
  ko: {
    eyebrow: '짧은 문구', title: '여기에 제목을 입력하세요', text: '한두 문장으로 이 내용을 소개하세요.', label: '라벨',
    itemTitle: '제목 {n}', itemText: '항목 {n}을(를) 한두 문장으로 소개하세요.', itemLabel: '라벨 {n}',
    question: '고객이 자주 묻는 질문 {n}?', quote: '고객 {n}의 후기를 여기에 입력하세요.', name: '이름 {n}', role: '직책 {n}',
  },
  de: {
    eyebrow: 'Kurzer Slogan', title: 'Hier steht die Überschrift', text: 'Beschreiben Sie dies in ein, zwei Sätzen.', label: 'Bezeichnung',
    itemTitle: 'Titel {n}', itemText: 'Beschreiben Sie Punkt {n} in ein, zwei Sätzen.', itemLabel: 'Bezeichnung {n}',
    question: 'Frage {n}, die Kunden oft stellen?', quote: 'Was Kunde {n} über Sie sagt.', name: 'Name {n}', role: 'Funktion {n}',
  },
  it: {
    eyebrow: 'Breve slogan', title: 'Scrivi qui un titolo', text: 'Descrivi questo in una o due frasi.', label: 'Etichetta',
    itemTitle: 'Titolo {n}', itemText: "Descrivi l'elemento {n} in una o due frasi.", itemLabel: 'Etichetta {n}',
    question: 'Domanda {n} che i clienti fanno spesso?', quote: 'Cosa ha detto di voi il cliente {n}.', name: 'Nome {n}', role: 'Ruolo {n}',
  },
  pt: {
    eyebrow: 'Slogan curto', title: 'Escreva um título aqui', text: 'Descreva isto em uma ou duas frases.', label: 'Rótulo',
    itemTitle: 'Título {n}', itemText: 'Descreva o item {n} em uma ou duas frases.', itemLabel: 'Rótulo {n}',
    question: 'Pergunta {n} que os clientes fazem com frequência?', quote: 'O que o cliente {n} disse sobre você.', name: 'Nome {n}', role: 'Cargo {n}',
  },
  ru: {
    eyebrow: 'Короткий слоган', title: 'Напишите здесь заголовок', text: 'Опишите это в одном-двух предложениях.', label: 'Метка',
    itemTitle: 'Заголовок {n}', itemText: 'Опишите пункт {n} в одном-двух предложениях.', itemLabel: 'Метка {n}',
    question: 'Вопрос {n}, который часто задают клиенты?', quote: 'Что о вас сказал клиент {n}.', name: 'Имя {n}', role: 'Должность {n}',
  },
  vi: {
    eyebrow: 'Khẩu hiệu ngắn', title: 'Viết tiêu đề ở đây', text: 'Mô tả nội dung này trong một hai câu.', label: 'Nhãn',
    itemTitle: 'Tiêu đề {n}', itemText: 'Mô tả mục {n} trong một hai câu.', itemLabel: 'Nhãn {n}',
    question: 'Câu hỏi {n} khách hàng thường hỏi?', quote: 'Nhận xét của khách hàng {n} về bạn.', name: 'Tên {n}', role: 'Chức vụ {n}',
  },
  ar: {
    eyebrow: 'شعار قصير', title: 'اكتب العنوان هنا', text: 'صف هذا القسم في جملة أو جملتين.', label: 'تسمية',
    itemTitle: 'العنوان {n}', itemText: 'صف العنصر {n} في جملة أو جملتين.', itemLabel: 'تسمية {n}',
    question: 'السؤال {n} الذي يطرحه العملاء كثيرًا؟', quote: 'ما قاله العميل {n} عنك.', name: 'الاسم {n}', role: 'المنصب {n}',
  },
  hi: {
    eyebrow: 'छोटी टैगलाइन', title: 'यहाँ शीर्षक लिखें', text: 'इसे एक-दो वाक्यों में बताएँ।', label: 'लेबल',
    itemTitle: 'शीर्षक {n}', itemText: 'आइटम {n} को एक-दो वाक्यों में बताएँ।', itemLabel: 'लेबल {n}',
    question: 'ग्राहकों का अक्सर पूछा जाने वाला सवाल {n}?', quote: 'ग्राहक {n} ने आपके बारे में क्या कहा।', name: 'नाम {n}', role: 'पद {n}',
  },
  th: {
    eyebrow: 'สโลแกนสั้น ๆ', title: 'เขียนหัวข้อที่นี่', text: 'อธิบายส่วนนี้ในหนึ่งหรือสองประโยค', label: 'ป้ายกำกับ',
    itemTitle: 'หัวข้อ {n}', itemText: 'อธิบายรายการที่ {n} ในหนึ่งหรือสองประโยค', itemLabel: 'ป้ายกำกับ {n}',
    question: 'คำถามที่ {n} ที่ลูกค้ามักถาม?', quote: 'คำพูดของลูกค้าคนที่ {n} ที่มีต่อคุณ', name: 'ชื่อ {n}', role: 'ตำแหน่ง {n}',
  },
};

/** 这种语言的那一行；查不到先退基础语言（`pt-BR` → `pt`），再退英文（同 `locale-words.js` §wordsFor）。扁平老站 locale 是空串 ⟹ en。 */
function placeholderWords(locale) {
  const l = String(locale || '').toLowerCase();
  return WORDS[l] || WORDS[l.split('-')[0]] || WORDS.en;
}

/**
 * 一格字属于哪一类（按路径最后一段、它的上一段，不按块名）。`inItem` = 这格在列表条目里。
 * 回 WORDS 里的键。
 */
function categoryOf(path, inItem) {
  const segs = String(path).split('.');
  const last = segs[segs.length - 1];
  const parent = segs.length > 1 ? segs[segs.length - 2] : '';
  if (!inItem) {
    if (last === 'text' && /eyebrow$/i.test(parent)) return 'eyebrow';
    if (last === 'headline' || last === 'title') return 'title';
    if (/label$/i.test(last) || last === 'badge' || last === 'period' || last === 'source') return 'label';
    return 'text';
  }
  if (last === 'question') return 'question';
  if (last === 'quote') return 'quote';
  if (last === 'role') return 'role';
  // 套餐的 `name` 是套餐名（一个标题），人名才是「姓名」。
  if (last === 'name') return segs[0] === 'plans' ? 'itemTitle' : 'name';
  if (last === 'title' || last === 'headline') return 'itemTitle';
  if (/label$/i.test(last) || last === 'badge' || last === 'period' || last === 'source') return 'itemLabel';
  return 'itemText';
}

function placeholderFor(locale, path, n) {
  const w = placeholderWords(locale);
  const s = w[categoryOf(path, n !== undefined)] || w.text;
  return n === undefined ? s.replace(/\s*\{n\}/g, '') : s.replace(/\{n\}/g, String(n));
}

/**
 * 这一块里该写字的格：`[{ path: ['items', 1, 'title'], cell }]` —— 只列 `ai: true`、而且在播出来的条目里或者块头上的那几格。
 * 条目里只认播种给的 `keys`（项形状顶层的纯文字键，§seedListsOf）：`[string]` 列表和子对象（link / cta）不填。
 */
function aiCells(component, props) {
  const fields = new Map((component.fields || []).map((f) => [f.slot, f]));
  const itemKeys = new Map((component.seed || []).map((s) => [s.slot, s.keys || []]));
  const out = [];
  for (const cell of component.inline || []) {
    if (!cell.ai) continue;
    const segs = cell.path.split('.');
    const field = fields.get(segs[0]);
    if (!field) continue;
    if (field.control === 'list') {
      const list = props[segs[0]];
      if (!Array.isArray(list)) continue;
      if (segs.length !== 2 || !(itemKeys.get(segs[0]) || []).includes(segs[1])) continue;
      list.forEach((_, i) => out.push({ path: [segs[0], i, ...segs.slice(1)], item: i + 1, cell }));
    } else if (field.control === 'text' || field.control === 'richtext' || field.control === 'object') {
      out.push({ path: segs, item: undefined, cell });
    }
  }
  return out;
}

/**
 * 新块拖下去那一刻的 props（Puck 的 `defaultProps`，不含 `_shape`）：`fieldProps(c, {})` + 播种 + 占位。
 * 每次调用都是新的一份对象（列表、条目都不共享）。
 */
function seedProps(component, locale) {
  let props = fieldProps(component, {});
  for (const { slot, count } of component.seed || []) {
    props = { ...props, [slot]: Array.from({ length: count }, () => ({})) };
  }
  for (const { path, item } of aiCells(component, props)) {
    props = setAt(props, path, placeholderFor(locale, path.filter((s) => typeof s === 'string').join('.'), item));
  }
  return props;
}

/** 交给 AI `fill` 的格：`[{ name, text }]`，`name` 是数据里的路径（真实下标），`text` 是那一格现在的字（占位）。空的不交。 */
function fillFields(component, props) {
  const out = [];
  for (const { path } of aiCells(component, props)) {
    let v = props;
    for (const k of path) v = v !== null && typeof v === 'object' ? v[k] : undefined;
    if (typeof v === 'string' && v.trim()) out.push({ name: path.join('.'), text: v });
  }
  return out;
}

/** `items.1.title` → `['items', 1, 'title']`（setAt 要真实下标是数字）。 */
function pathOfName(name) {
  return String(name).split('.').map((s) => (/^\d+$/.test(s) ? Number(s) : s));
}

module.exports = { WORDS, placeholderWords, categoryOf, placeholderFor, seedProps, fillFields, pathOfName };
