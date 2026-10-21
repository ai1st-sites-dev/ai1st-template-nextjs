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
const { setAt, getAt } = require('./inline-edit');
const { platformKey } = require('./review-platforms');
const { mainLocationFacts } = require('./locations');

// #1767 —— 示例数 / 示例图标：`editor-schema.js` 的 §NUMBER_EXAMPLES / §SEED_ICONS 的副本（那个文件读 fs，进不了浏览器包；
//    同 `blockMedia.tsx` 的 PLACEHOLDER_IMAGE_URL 那一对）。`scripts/block-seed.test.js` 钉两份相等。
const NUMBER_EXAMPLES = Object.freeze({
  value: Object.freeze(['10+', '500+', '98%']),
  price: Object.freeze(['$29', '$59', '$99']),
  rating: Object.freeze([5, 4, 3]),
  count: Object.freeze([120, 85, 64]),
  number: Object.freeze(['01', '02', '03']),
});
const SEED_ICONS = Object.freeze(['star', 'shield-check', 'lightning-charge', 'heart', 'clock', 'trophy']);

// 类别：块头用前四个；列表条目用后八个（带 `{n}` = 第几条）。`logo`（#1766）= 拖下的 logos 块每一项的名字（「Logo 1」）。
const WORDS = {
  en: {
    eyebrow: 'Short tagline', title: 'Write a title here', text: 'Use a sentence or two to describe this.', label: 'Label',
    itemTitle: 'Title {n}', itemText: 'Describe item {n} in a sentence or two.', itemLabel: 'Label {n}',
    question: 'Question {n} that customers often ask?', quote: 'What customer {n} said about you goes here.', name: 'Name {n}', role: 'Role {n}', logo: 'Logo {n}',
    callUs: 'Call us', emailUs: 'Email us', contactUs: 'Contact us', allPosts: 'See all posts', feature: 'Feature {n}', statLabel: 'What {v} counts',
    phone: 'Phone', email: 'Email', address: 'Address', hours: 'Opening hours', itemButton: 'Button {n}',
  },
  zh: {
    eyebrow: '简短标语', title: '这里写标题', text: '用一两句话介绍这里的内容。', label: '标签',
    itemTitle: '标题 {n}', itemText: '用一两句话介绍第 {n} 项。', itemLabel: '标签 {n}',
    question: '客户常问的第 {n} 个问题？', quote: '这里写第 {n} 位客户对你们的评价。', name: '姓名 {n}', role: '职位 {n}', logo: 'Logo {n}',
    callUs: '致电我们', emailUs: '给我们发邮件', contactUs: '联系我们', allPosts: '查看全部文章', feature: '功能点 {n}', statLabel: '{v} 指的是什么',
    phone: '电话', email: '邮箱', address: '地址', hours: '营业时间', itemButton: '按钮 {n}',
  },
  'zh-tw': {
    eyebrow: '簡短標語', title: '這裡寫標題', text: '用一兩句話介紹這裡的內容。', label: '標籤',
    itemTitle: '標題 {n}', itemText: '用一兩句話介紹第 {n} 項。', itemLabel: '標籤 {n}',
    question: '客戶常問的第 {n} 個問題？', quote: '這裡寫第 {n} 位客戶對你們的評價。', name: '姓名 {n}', role: '職位 {n}', logo: 'Logo {n}',
    callUs: '致電我們', emailUs: '寄信給我們', contactUs: '聯絡我們', allPosts: '查看全部文章', feature: '功能點 {n}', statLabel: '{v} 指的是什麼',
    phone: '電話', email: '電子郵件', address: '地址', hours: '營業時間', itemButton: '按鈕 {n}',
  },
  fr: {
    eyebrow: 'Courte accroche', title: 'Écrivez un titre ici', text: 'Décrivez ceci en une ou deux phrases.', label: 'Libellé',
    itemTitle: 'Titre {n}', itemText: "Décrivez l'élément {n} en une ou deux phrases.", itemLabel: 'Libellé {n}',
    question: 'Question {n} que vos clients posent souvent ?', quote: 'Ce que le client {n} a dit de vous.', name: 'Nom {n}', role: 'Fonction {n}', logo: 'Logo {n}',
    callUs: 'Appelez-nous', emailUs: 'Écrivez-nous', contactUs: 'Contactez-nous', allPosts: 'Voir tous les articles', feature: 'Atout {n}', statLabel: 'Ce que représente {v}',
    phone: 'Téléphone', email: 'E-mail', address: 'Adresse', hours: "Horaires d'ouverture", itemButton: 'Bouton {n}',
  },
  es: {
    eyebrow: 'Lema breve', title: 'Escribe un título aquí', text: 'Describe esto en una o dos frases.', label: 'Etiqueta',
    itemTitle: 'Título {n}', itemText: 'Describe el elemento {n} en una o dos frases.', itemLabel: 'Etiqueta {n}',
    question: '¿Pregunta {n} que tus clientes hacen a menudo?', quote: 'Lo que el cliente {n} dijo de ti.', name: 'Nombre {n}', role: 'Cargo {n}', logo: 'Logo {n}',
    callUs: 'Llámanos', emailUs: 'Escríbenos', contactUs: 'Contáctanos', allPosts: 'Ver todas las entradas', feature: 'Característica {n}', statLabel: 'Qué representa {v}',
    phone: 'Teléfono', email: 'Correo electrónico', address: 'Dirección', hours: 'Horario', itemButton: 'Botón {n}',
  },
  ja: {
    eyebrow: '短いキャッチコピー', title: 'ここに見出しを入力', text: 'ここの内容を一、二文で紹介してください。', label: 'ラベル',
    itemTitle: 'タイトル {n}', itemText: '項目 {n} を一、二文で紹介してください。', itemLabel: 'ラベル {n}',
    question: 'お客様からよくある質問 {n}？', quote: 'お客様 {n} の声をここに入力。', name: '名前 {n}', role: '役職 {n}', logo: 'ロゴ {n}',
    callUs: '電話する', emailUs: 'メールする', contactUs: 'お問い合わせ', allPosts: 'すべての記事を見る', feature: '特長 {n}', statLabel: '{v} が表すもの',
    phone: '電話', email: 'メール', address: '住所', hours: '営業時間', itemButton: 'ボタン {n}',
  },
  ko: {
    eyebrow: '짧은 문구', title: '여기에 제목을 입력하세요', text: '한두 문장으로 이 내용을 소개하세요.', label: '라벨',
    itemTitle: '제목 {n}', itemText: '항목 {n}을(를) 한두 문장으로 소개하세요.', itemLabel: '라벨 {n}',
    question: '고객이 자주 묻는 질문 {n}?', quote: '고객 {n}의 후기를 여기에 입력하세요.', name: '이름 {n}', role: '직책 {n}', logo: '로고 {n}',
    callUs: '전화하기', emailUs: '이메일 보내기', contactUs: '문의하기', allPosts: '모든 글 보기', feature: '특징 {n}', statLabel: '{v}이(가) 나타내는 것',
    phone: '전화', email: '이메일', address: '주소', hours: '영업시간', itemButton: '버튼 {n}',
  },
  de: {
    eyebrow: 'Kurzer Slogan', title: 'Hier steht die Überschrift', text: 'Beschreiben Sie dies in ein, zwei Sätzen.', label: 'Bezeichnung',
    itemTitle: 'Titel {n}', itemText: 'Beschreiben Sie Punkt {n} in ein, zwei Sätzen.', itemLabel: 'Bezeichnung {n}',
    question: 'Frage {n}, die Kunden oft stellen?', quote: 'Was Kunde {n} über Sie sagt.', name: 'Name {n}', role: 'Funktion {n}', logo: 'Logo {n}',
    callUs: 'Rufen Sie uns an', emailUs: 'Schreiben Sie uns', contactUs: 'Kontakt aufnehmen', allPosts: 'Alle Beiträge ansehen', feature: 'Merkmal {n}', statLabel: 'Wofür {v} steht',
    phone: 'Telefon', email: 'E-Mail', address: 'Adresse', hours: 'Öffnungszeiten', itemButton: 'Schaltfläche {n}',
  },
  it: {
    eyebrow: 'Breve slogan', title: 'Scrivi qui un titolo', text: 'Descrivi questo in una o due frasi.', label: 'Etichetta',
    itemTitle: 'Titolo {n}', itemText: "Descrivi l'elemento {n} in una o due frasi.", itemLabel: 'Etichetta {n}',
    question: 'Domanda {n} che i clienti fanno spesso?', quote: 'Cosa ha detto di voi il cliente {n}.', name: 'Nome {n}', role: 'Ruolo {n}', logo: 'Logo {n}',
    callUs: 'Chiamaci', emailUs: 'Scrivici', contactUs: 'Contattaci', allPosts: 'Vedi tutti gli articoli', feature: 'Caratteristica {n}', statLabel: 'Cosa rappresenta {v}',
    phone: 'Telefono', email: 'Posta elettronica', address: 'Indirizzo', hours: 'Orari di apertura', itemButton: 'Pulsante {n}',
  },
  pt: {
    eyebrow: 'Slogan curto', title: 'Escreva um título aqui', text: 'Descreva isto em uma ou duas frases.', label: 'Rótulo',
    itemTitle: 'Título {n}', itemText: 'Descreva o item {n} em uma ou duas frases.', itemLabel: 'Rótulo {n}',
    question: 'Pergunta {n} que os clientes fazem com frequência?', quote: 'O que o cliente {n} disse sobre você.', name: 'Nome {n}', role: 'Cargo {n}', logo: 'Logo {n}',
    callUs: 'Ligue para nós', emailUs: 'Envie um e-mail', contactUs: 'Fale conosco', allPosts: 'Ver todos os artigos', feature: 'Recurso {n}', statLabel: 'O que {v} representa',
    phone: 'Telefone', email: 'E-mail', address: 'Endereço', hours: 'Horário de funcionamento', itemButton: 'Botão {n}',
  },
  ru: {
    eyebrow: 'Короткий слоган', title: 'Напишите здесь заголовок', text: 'Опишите это в одном-двух предложениях.', label: 'Метка',
    itemTitle: 'Заголовок {n}', itemText: 'Опишите пункт {n} в одном-двух предложениях.', itemLabel: 'Метка {n}',
    question: 'Вопрос {n}, который часто задают клиенты?', quote: 'Что о вас сказал клиент {n}.', name: 'Имя {n}', role: 'Должность {n}', logo: 'Логотип {n}',
    callUs: 'Позвонить нам', emailUs: 'Написать нам', contactUs: 'Связаться с нами', allPosts: 'Все статьи', feature: 'Преимущество {n}', statLabel: 'Что означает {v}',
    phone: 'Телефон', email: 'Эл. почта', address: 'Адрес', hours: 'Часы работы', itemButton: 'Кнопка {n}',
  },
  vi: {
    eyebrow: 'Khẩu hiệu ngắn', title: 'Viết tiêu đề ở đây', text: 'Mô tả nội dung này trong một hai câu.', label: 'Nhãn',
    itemTitle: 'Tiêu đề {n}', itemText: 'Mô tả mục {n} trong một hai câu.', itemLabel: 'Nhãn {n}',
    question: 'Câu hỏi {n} khách hàng thường hỏi?', quote: 'Nhận xét của khách hàng {n} về bạn.', name: 'Tên {n}', role: 'Chức vụ {n}', logo: 'Logo {n}',
    callUs: 'Gọi cho chúng tôi', emailUs: 'Gửi email cho chúng tôi', contactUs: 'Liên hệ', allPosts: 'Xem tất cả bài viết', feature: 'Tính năng {n}', statLabel: '{v} là gì',
    phone: 'Điện thoại', email: 'Thư điện tử', address: 'Địa chỉ', hours: 'Giờ mở cửa', itemButton: 'Nút {n}',
  },
  ar: {
    eyebrow: 'شعار قصير', title: 'اكتب العنوان هنا', text: 'صف هذا القسم في جملة أو جملتين.', label: 'تسمية',
    itemTitle: 'العنوان {n}', itemText: 'صف العنصر {n} في جملة أو جملتين.', itemLabel: 'تسمية {n}',
    question: 'السؤال {n} الذي يطرحه العملاء كثيرًا؟', quote: 'ما قاله العميل {n} عنك.', name: 'الاسم {n}', role: 'المنصب {n}', logo: 'الشعار {n}',
    callUs: 'اتصل بنا', emailUs: 'راسلنا', contactUs: 'تواصل معنا', allPosts: 'عرض كل المقالات', feature: 'الميزة {n}', statLabel: 'ما الذي يمثله {v}',
    phone: 'الهاتف', email: 'البريد الإلكتروني', address: 'العنوان', hours: 'ساعات العمل', itemButton: 'الزر {n}',
  },
  hi: {
    eyebrow: 'छोटी टैगलाइन', title: 'यहाँ शीर्षक लिखें', text: 'इसे एक-दो वाक्यों में बताएँ।', label: 'लेबल',
    itemTitle: 'शीर्षक {n}', itemText: 'आइटम {n} को एक-दो वाक्यों में बताएँ।', itemLabel: 'लेबल {n}',
    question: 'ग्राहकों का अक्सर पूछा जाने वाला सवाल {n}?', quote: 'ग्राहक {n} ने आपके बारे में क्या कहा।', name: 'नाम {n}', role: 'पद {n}', logo: 'लोगो {n}',
    callUs: 'हमें कॉल करें', emailUs: 'हमें ईमेल करें', contactUs: 'संपर्क करें', allPosts: 'सभी लेख देखें', feature: 'विशेषता {n}', statLabel: '{v} किसे दर्शाता है',
    phone: 'फ़ोन', email: 'ईमेल', address: 'पता', hours: 'खुलने का समय', itemButton: 'बटन {n}',
  },
  th: {
    eyebrow: 'สโลแกนสั้น ๆ', title: 'เขียนหัวข้อที่นี่', text: 'อธิบายส่วนนี้ในหนึ่งหรือสองประโยค', label: 'ป้ายกำกับ',
    itemTitle: 'หัวข้อ {n}', itemText: 'อธิบายรายการที่ {n} ในหนึ่งหรือสองประโยค', itemLabel: 'ป้ายกำกับ {n}',
    question: 'คำถามที่ {n} ที่ลูกค้ามักถาม?', quote: 'คำพูดของลูกค้าคนที่ {n} ที่มีต่อคุณ', name: 'ชื่อ {n}', role: 'ตำแหน่ง {n}', logo: 'โลโก้ {n}',
    callUs: 'โทรหาเรา', emailUs: 'ส่งอีเมลถึงเรา', contactUs: 'ติดต่อเรา', allPosts: 'ดูบทความทั้งหมด', feature: 'จุดเด่น {n}', statLabel: '{v} หมายถึงอะไร',
    phone: 'โทรศัพท์', email: 'อีเมล', address: 'ที่อยู่', hours: 'เวลาทำการ', itemButton: 'ปุ่ม {n}',
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

/**
 * `category`（#1766）= 指定用哪一类占位（logos 每一项的名字用 `logo`），不给按路径猜（§categoryOf）。
 * `v` = 同一条里那个数字（`stats[i].value`，#1767 播的示例数）：有它时这一条的 `label` 用「{v} 指的是什么」—— 交给 AI 时
 * 它看得见这一行配的是哪个数（只给「标签 1」的话，「10+」底下会写出一句跟数字无关的话）；AI 没回来时老板也看得懂这一格要填什么。
 */
function placeholderFor(locale, path, n, category, v) {
  const w = placeholderWords(locale);
  if (n !== undefined && /(^|\.)label$/.test(path) && (typeof v === 'string' || typeof v === 'number') && String(v)) {
    return w.statLabel.replace('{v}', String(v));
  }
  const s = w[category || categoryOf(path, n !== undefined)] || w.text;
  return n === undefined ? s.replace(/\s*\{n\}/g, '') : s.replace(/\{n\}/g, String(n));
}

/**
 * 这一块里该写字的格：`[{ path: ['items', 1, 'title'], cell }]` —— 只列 `ai: true`、而且在播出来的条目里或者块头上的那几格。
 * 条目里只认播种给的 `keys`（项形状顶层的纯文字键，§seedListsOf）：`[string]` 列表和子对象（link / cta）不填。
 */
function aiCells(component, props) {
  const fields = new Map((component.fields || []).map((f) => [f.slot, f]));
  // #1766 —— `fill: false` 的列表（logos / gallery / reviews 拖下时播的那几条）不交给 AI：它们的格不在这里。
  const itemKeys = new Map((component.seed || []).filter((s) => s.fill !== false).map((s) => [s.slot, s.keys || []]));
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
 * #1766 —— 站里存的真实评分（建站时抓到的；#1976 起在主地点的 `rating` 上，老站 seo.json 里那份照认 —— `locations.js` §mainLocationFacts；`local-business-facts.js` §ratingFrom）**当且仅当**
 * 它能证明自己来自 Google（`source` 认得出是 Google）时回 `{ rating, count }`；否则 null。
 * 🔴 §ratingFrom 在 Google 没有合格的数时会取下一家（Yelp 4.4 / 37 条），没有 `source` 就会被写成「Google 4.4」——
 *    替 Google 编分数（`create-site.js` 的 FACTS_ONLY_FROM_FORM_RULE 那条红线）。所以 `source` 不是 Google、或者没有
 *    `source`（#1766 之前建的站）⟹ null，Google 那一条照样是示例分。只认 Google：别的平台用真数是另一件事（PM 第三版裁定，B 出局）。
 * 读这个语言的 seo，没有就退主语言那份。分数夹成一位小数（reviews 的 `ranges.rating` 是 `[0, 5, 1]`）。
 */
function realGoogleRating(site, locale) {
  const byLocale = site && site.seoByLocale && typeof site.seoByLocale === 'object' ? site.seoByLocale : {};
  const seo = byLocale[locale] || byLocale[site && site.defaultLocale];
  const r = mainLocationFacts(site && site.brand, seo).rating;
  if (!r || platformKey(r.source) !== 'google') return null;
  const rating = Math.round(Number(r.ratingValue) * 10) / 10;
  const count = Number(r.reviewCount);
  if (!(rating > 0 && rating <= 5) || !Number.isInteger(count) || count < 1) return null;
  return { rating, count };
}

/** #1766 —— manifest 的示例条目（`seedItems`）拷一份；`source` 是 Google 的那一条、站里又有来自 Google 的真实评分（`real` = §realGoogleRating）⟹ 分数和条数换成真的。 */
function seedItemsFor(items, real) {
  return items.map((it) => {
    const copy = JSON.parse(JSON.stringify(it));
    if (real && platformKey(copy.source) === 'google') Object.assign(copy, real);
    return copy;
  });
}

/** 这一格是不是拖下的 logos 块里每一项的名字：成排的图（`imageRow`）、图那一格叫 Logo、这一格是 `alt`（同 editor-schema §imageRowSubs 的判法）。 */
function isLogoName(component, slot, key) {
  const f = (component.fields || []).find((x) => x.slot === slot);
  const url = f && f.imageRow && (f.subs || []).find((x) => x.url);
  return key === 'alt' && !!url && /\blogo\b/i.test(String(url.label || ''));
}

/**
 * #1767 —— 拖下那一刻要用到的站点资料（编辑器在客户端按 `site` 算好交进来；不给 ⟹ 一样都没有，按钮链到首页）：
 *   · `phone` / `email`   站里有没有电话 / 邮箱 —— 有电话，按钮就写 #1506 的电话引用 `{source: "phone"}`（店里换号码按钮跟着变）
 *   · `contactHref`       联系页的站内地址（这个语言有 contact 页才给），没有就是首页
 *   · `blogHref`          博客列表的站内地址（这个语言有文章才给）—— blog 块的按钮链它；没有文章就照别的按钮链
 *   · `rating`            站里来自 Google 的真实评分 `{ rating, count }`（§realGoogleRating —— 同 #1766 的判法：证不出来自 Google
 *                         就是 null），没有 ⟹ 整体评分用示例数
 *   · `facts`             `{ phone, email, address, hours }`（`contact-facts.js` §siteFactsFrom）：contact 的 `items` 照它各播一行
 * @typedef {{ phone?: boolean, email?: boolean, contactHref?: string, blogHref?: string,
 *   rating?: { rating: number, count: number } | null, facts?: Record<string, string> }} SeedContext
 */

const clone = (v) => JSON.parse(JSON.stringify(v));
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isEmpty = (v) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

/**
 * 按钮链到哪儿、按钮字是哪一类：第 `i` 颗（hero / cta 播两颗：一颗实心、一颗描边）。🔴 不会是空链接或 `#`（验收 2）。
 * `n` = 这颗按钮在列表的第几项里（套餐卡的按钮）：那时字用「按钮 1 / 2 / 3」—— 三张卡都写「致电我们」的话，画布上点它
 *    T6 的点击层按内容找不回是哪一张（判「对上不止一条」不让就地改），AI 没写成时老板就只能去右栏改（#1660 同一条规矩）。
 */
function buttonFor(component, i, ctx, w, n) {
  const home = ctx.contactHref || '/';
  if (component.type === 'blog' && ctx.blogHref) return { label: w.allPosts, href: ctx.blogHref };
  const targets = [];
  if (ctx.phone) targets.push({ label: w.callUs, href: { source: 'phone' } });
  targets.push({ label: w.contactUs, href: home });
  if (!ctx.phone && ctx.email) targets.push({ label: w.emailUs, href: { source: 'email' } });
  const out = clone(targets[i % targets.length]);
  // 去处不够两颗分（没电话、没邮箱）：第二颗同样链到联系页，但字写「按钮 2」—— 两颗都写「联系我们」的话，画布上点它
  //    按内容找不回是哪一颗（QA3 r2 量到）。这句也是占位，跟别的按钮字一起交给 AI 改。
  if (n === undefined && i >= targets.length) return { ...out, label: w.itemButton.replace('{n}', String(i + 1)) };
  return n === undefined ? out : { ...out, label: w.itemButton.replace('{n}', String(n)) };
}

/** 一格数字的示例值（§NUMBER_EXAMPLES，同一块里第 i 条）；整体评分有真的用真的。 */
function numberFor(t, i, ctx, examples) {
  if (t.aggregate && ctx.rating && typeof ctx.rating.rating === 'number' && typeof ctx.rating.count === 'number') {
    return t.key === 'count' ? ctx.rating.count : ctx.rating.rating;
  }
  const row = examples[t.key] || examples[t.parent];
  if (t.aggregate && t.key === 'rating') return 4.9; // 整体评分（没有真的时）不跟一条一条的评价共用那一串
  return row ? row[i % row.length] : String(i + 1);
}

/**
 * 把一格目标（`editor-schema.js` §seedTargetsOf）写进 props：路过的列表空着就播那么多条，对象没有就建一个；
 * 那一格已经有值的不碰（播种之后老板 / AI 写过的，或 manifest 的 `demo` 给过的）—— 整体评分例外：有真的就换成真的。
 */
function seedTarget(props, t, component, ctx, w, examples, icons) {
  const walk = (holder, at, i) => {
    const step = t.steps[at];
    const last = at === t.steps.length - 1;
    if (!last) {
      if (step.list) {
        let list = Array.isArray(holder[step.key]) ? holder[step.key] : [];
        if (!list.length) list = Array.from({ length: step.count }, (_, j) => (step.demo && step.demo[j] ? clone(step.demo[j]) : {}));
        holder[step.key] = list.map((item, j) => { const it = isObj(item) ? { ...item } : {}; walk(it, at + 1, j); return it; });
      } else {
        holder[step.key] = isObj(holder[step.key]) ? { ...holder[step.key] } : {};
        walk(holder[step.key], at + 1, i);
      }
      return;
    }
    const cur = holder[step.key];
    switch (t.kind) {
      case 'buttons':
        if (isEmpty(cur)) holder[step.key] = Array.from({ length: step.count }, (_, j) => ({ ...buttonFor(component, j, ctx, w), style: j === 0 ? 'solid' : 'outline' }));
        break;
      case 'button':
        if (!isObj(cur) || !cur.href) holder[step.key] = { ...(isObj(cur) ? cur : {}), ...buttonFor(component, 0, ctx, w, inList ? i + 1 : undefined) };
        break;
      case 'number':
        if (isEmpty(cur) || (t.aggregate && ctx.rating)) holder[step.key] = numberFor(t, i, ctx, examples);
        break;
      case 'icon':
        if (isEmpty(cur)) holder[step.key] = icons[i % icons.length];
        break;
      case 'strings':
        // 序号接着往下数（第二个套餐是 4–6）：两张卡里有一字不差的同一行，画布上点它同样判「对上不止一条」（inline-edit.js 两层序号那一支）。
        if (isEmpty(cur)) holder[step.key] = [1, 2, 3].map((n) => w.feature.replace('{n}', String(i * 3 + n)));
        break;
      case 'row':
        if (isEmpty(cur)) holder[step.key] = Array.from({ length: step.count }, (_, j) => (t.named ? { alt: w.logo.replace('{n}', String(j + 1)) } : {}));
        break;
      default:
        break;
    }
  };
  const inList = t.steps.slice(0, -1).some((s) => s.list);
  const out = { ...props };
  walk(out, 0, 0);
  return out;
}

/**
 * 新块拖下去那一刻的 props（Puck 的 `defaultProps`，不含 `_shape`）：`fieldProps(c, {})` + 播种 + 占位。
 * 每次调用都是新的一份对象（列表、条目都不共享）。
 * #1767 —— 再按 `component.seedTargets` 补上按钮 / 数字 / 图标 / `[string]` 列表 / 成排的小图，按 `component.factLists`
 *    （contact 的 `items`）照站里的资料各播一行。示例数 / 示例图标用文件顶上那两份副本。
 * #1766 —— `fill: false` 的列表只填占位（logos 每一项的名字「Logo 1」），不交给 AI（§fillFields 看不到它们）；
 *    reviews 的示例条目里 Google 那一条用 `ctx.rating`（站里来自 Google 的真实评分，§realGoogleRating）。
 * @param {SeedContext} [ctx]
 */
function seedProps(component, locale, ctx = {}) {
  const examples = NUMBER_EXAMPLES;
  const icons = SEED_ICONS;
  const w = placeholderWords(locale);
  let props = fieldProps(component, {});
  const demos = new Map();
  for (const t of component.seedTargets || []) {
    const s = t.steps[0];
    if (s.list && s.demo && !demos.has(s.key)) demos.set(s.key, s.demo);
  }
  for (const { slot, count, items } of component.seed || []) {
    const demo = demos.get(slot);
    props = { ...props, [slot]: Array.isArray(items) ? seedItemsFor(items, ctx.rating) : Array.from({ length: count }, (_, i) => (demo && demo[i] ? clone(demo[i]) : {})) };
  }
  for (const { slot, key, kinds, text } of component.factLists || []) {
    const facts = ctx.facts || {};
    const have = kinds.filter((k) => typeof facts[k] === 'string' && facts[k].trim());
    props = { ...props, [slot]: have.map((k) => ({ [key]: k, [text]: w[k] || k })) };
  }
  for (const t of component.seedTargets || []) props = seedTarget(props, t, component, ctx, w, examples, icons);
  for (const { path, item } of aiCells(component, props)) {
    if (getAt(props, path) !== undefined) continue; // 演示值（`demo`）、按站里资料播的标题已经在了
    props = setAt(props, path, placeholderFor(locale, path.filter((s) => typeof s === 'string').join('.'), item, undefined, getAt(props, [...path.slice(0, -1), 'value'])));
  }
  // #1833 —— 必填的代码框（Custom HTML 的 `html`）拖下时播一句占位字：一段纯文字也是合法的 HTML，块在画布上不是空的、
  //    存盘过得了 validateSite 的「缺必填槽」。它不在 aiCells 里（不是页面上的字），不交给 AI 改写。
  for (const f of component.fields || []) {
    if (f.control !== 'code' || f.optional || !isEmpty(props[f.slot])) continue;
    props = { ...props, [f.slot]: placeholderFor(locale, f.slot) };
  }
  for (const { slot, keys, fill } of component.seed || []) {
    if (fill !== false) continue;
    for (const key of keys || []) {
      (props[slot] || []).forEach((_, i) => {
        props = setAt(props, [slot, i, key], placeholderFor(locale, `${slot}.${key}`, i + 1, isLogoName(component, slot, key) ? 'logo' : undefined));
      });
    }
  }
  return props;
}

// ── 交给 AI `fill` 的格 ─────────────────────────────────────────────────────────────────────────────────

/** 任一语言的任一句占位（`{n}` 是序号、`{v}` 是数字说明里的那个数）—— §fillFields 只交还是占位的格。 */
const PLACEHOLDER_RE = (() => {
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const alts = new Set();
  for (const row of Object.values(WORDS)) {
    for (const v of Object.values(row)) alts.add(esc(v).replace(/\\\{n\\\}/g, '\\d+').replace(/\\\{v\\\}/g, '.+'));
  }
  return new RegExp(`^(?:${[...alts].join('|')})$`);
})();
function isPlaceholder(text) {
  return typeof text === 'string' && PLACEHOLDER_RE.test(text.trim());
}

/** 一条画布路径（`plans.features`、`ctas.label`）在 props 里展开成每一格：`[[路径], 值]`，路过的列表逐项展开，末端是一列字也逐行展开。 */
function expandCells(props, segs) {
  const out = [];
  const go = (v, at, path) => {
    if (at === segs.length) {
      if (typeof v === 'string') out.push([path, v]);
      else if (Array.isArray(v)) v.forEach((x, j) => { if (typeof x === 'string') out.push([[...path, j], x]); });
      return;
    }
    if (Array.isArray(v)) { v.forEach((x, j) => go(x, at, [...path, j])); return; }
    if (isObj(v)) go(v[segs[at]], at + 1, [...path, segs[at]]);
  };
  go(props, 0, []);
  return out;
}

/**
 * 交给 AI `fill` 的格：`[{ name, text }]`，`name` 是数据里的路径（真实下标），`text` 是那一格现在的字。
 * 画布上每一段 `ai: true` 的字（§inlineSlotsOf）都看，#1767 起只交**还是占位**的那几格 —— 演示值（`Google`）、老板等的时候
 * 已经改过的、空了的都不交（manager 那边全空会 400）。
 */
function fillFields(component, props) {
  const out = [];
  // #1766 —— `fill: false` 的列表（logos 每一项的名字「Logo 1」）只填占位、不交给 AI。
  const noFill = new Set((component.seed || []).filter((x) => x.fill === false).map((x) => x.slot));
  for (const cell of component.inline || []) {
    if (!cell.ai || noFill.has(cell.path.split('.')[0])) continue;
    for (const [path, v] of expandCells(props, cell.path.split('.'))) {
      if (v.trim() && isPlaceholder(v)) out.push({ name: path.join('.'), text: v });
    }
  }
  return out;
}

/**
 * #1767 —— 一次请求最多交几格。🔴 manager 那一侧的真上限是 `manager/ai_rewrite.go` 的 `rewriteMaxFields`（超了直接 400）；
 * 这里只能 ≤ 它，`scripts/editor-placeholders.test.js` ⑤ 从 Go 源码现读那个数来比。拆成几次请求而不是调大上限：
 * 那一路的回话封顶 1024 个 token（`chat_tools.go` 的 `MaxTokens`），一次塞三十几格会被截断、整批作废。
 */
const FILL_BATCH_MAX = 20;

/**
 * 把交给 fill 的格分成几次请求，每次 ≤ `max` 格。同一条（`plans.0.*`、`highlights.2.*`）不拆开 —— AI 一次看见整张套餐卡才写得前后一致；
 * 块头那几格（不在列表里）各自算一份。一条比 `max` 还多的格（今天没有）自成一批 —— manager 会 400，编辑器那句「还是占位」照常出。
 */
function fillBatches(fields, max = FILL_BATCH_MAX) {
  // fillFields 按「格」的顺序交（三个套餐的名字、再三个套餐的周期 ……），同一条的格是隔开的 ⟹ 先按条归拢（照第一次出现的顺序）。
  const units = new Map();
  for (const f of fields) {
    const m = /^([^.]+\.\d+)\./.exec(f.name);
    const key = m ? m[1] : f.name;
    if (!units.has(key)) units.set(key, []);
    units.get(key).push(f);
  }
  const out = [];
  for (const unit of units.values()) {
    const cur = out[out.length - 1];
    if (cur && cur.length + unit.length <= max) cur.push(...unit);
    else out.push(unit.slice());
  }
  return out;
}

/** `items.1.title` → `['items', 1, 'title']`（setAt 要真实下标是数字）。 */
function pathOfName(name) {
  return String(name).split('.').map((s) => (/^\d+$/.test(s) ? Number(s) : s));
}

module.exports = { WORDS, placeholderWords, categoryOf, placeholderFor, realGoogleRating, seedProps, fillFields, fillBatches, FILL_BATCH_MAX, isPlaceholder, pathOfName, NUMBER_EXAMPLES, SEED_ICONS };
