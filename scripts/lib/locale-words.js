'use strict';

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// locale-words.js —— 代码自己写的那几句话，按站的语言（#1631）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 建站时有几处字不是 AI 写的，是代码兜底写的：AI 没给就用它。改之前这些全是英文常量，于是一个中文站的联系页、
// 顶栏「Contact」、表单按钮在 AI 漏写时是英文（Chris 2026-10-06 在 site-f7a34357 上撞到的）。这里给每种语言一行：
//
//   contactPage   代码补的联系页 7 句（形状同 #1633 那份 `contactPage`：title · navLabel · description ·
//                 headline · subheadline · formHeadline · formBody）。`description` 是函数，吃品牌名。
//   forms         默认那一张表单（`site-forms.js` §DEFAULT_SITE_FORMS 的 `contact`；#1635 起只有这一张）的
//                 name · buttonText · successMessage。字段、`id` 不在这里 —— 那是骨架，各语言必须一致。
//
// 🔴 优先级：AI 给了 > 这张表 > 英文（表里没有的语言）。这张表只是「AI 没给」时的落点，**不覆盖 AI 的字**。
// 🔴 语言集合同 `keyword-pages.js` 的 `LABELS`（15 种，含 zh-tw）；查不到先退到基础语言（pt-BR → pt），再退英文。
//    渲染期的输入框占位符在另一张表（`src/lib/component-labels.ts`，14 种、**没有 zh-tw**）——
//    所以繁体站联系页是繁体、输入框是英文，跟改之前一样，这是已知的，不当缺陷报（票面「做什么」3）。
// 🔴 `en` 那一行逐字等于改之前的英文常量 —— 英文站的产物一个字节不变。`forms.contact` 那一句逐字等于 `DEFAULT_SITE_FORMS`
//    （#1635 换了默认表单的英文底稿，这一行跟着换；site-forms.test.js「传 en：逐字等于英文默认」守着）。

const WORDS = {
  en: {
    contactPage: {
      title: 'Contact Us', navLabel: 'Contact', description: (b) => `Get in touch with ${b}`,
      headline: 'Contact Us', subheadline: "Send us a message and we'll get back to you shortly.",
      formHeadline: 'Get in touch', formBody: 'Leave your details and we will reach out soon.',
    },
    forms: {
      contact: { name: 'Contact us', buttonText: 'Get in touch', successMessage: 'Thanks — we will get back to you shortly.' },
    },
  },
  zh: {
    contactPage: {
      title: '联系我们', navLabel: '联系我们', description: (b) => `联系${b}`,
      headline: '联系我们', subheadline: '给我们留言，我们会尽快回复您。',
      formHeadline: '与我们联系', formBody: '留下您的联系方式，我们会尽快与您联系。',
    },
    forms: {
      contact: { name: '联系我们', buttonText: '与我们联系', successMessage: '谢谢！我们会尽快与您联系。' },
    },
  },
  'zh-tw': {
    contactPage: {
      title: '聯絡我們', navLabel: '聯絡我們', description: (b) => `聯絡${b}`,
      headline: '聯絡我們', subheadline: '給我們留言，我們會盡快回覆您。',
      formHeadline: '與我們聯絡', formBody: '留下您的聯絡方式，我們會盡快與您聯絡。',
    },
    forms: {
      contact: { name: '聯絡我們', buttonText: '與我們聯絡', successMessage: '謝謝！我們會盡快與您聯絡。' },
    },
  },
  fr: {
    contactPage: {
      title: 'Contactez-nous', navLabel: 'Contact', description: (b) => `Contactez ${b}`,
      headline: 'Contactez-nous', subheadline: 'Envoyez-nous un message et nous vous répondrons rapidement.',
      formHeadline: 'Écrivez-nous', formBody: 'Laissez vos coordonnées et nous vous recontacterons bientôt.',
    },
    forms: {
      contact: { name: 'Nous contacter', buttonText: 'Prendre contact', successMessage: 'Merci — nous vous recontacterons rapidement.' },
    },
  },
  es: {
    contactPage: {
      title: 'Contáctenos', navLabel: 'Contacto', description: (b) => `Póngase en contacto con ${b}`,
      headline: 'Contáctenos', subheadline: 'Envíenos un mensaje y le responderemos en breve.',
      formHeadline: 'Escríbanos', formBody: 'Déjenos sus datos y nos pondremos en contacto pronto.',
    },
    forms: {
      contact: { name: 'Contáctenos', buttonText: 'Ponerse en contacto', successMessage: 'Gracias: nos pondremos en contacto con usted en breve.' },
    },
  },
  ja: {
    contactPage: {
      title: 'お問い合わせ', navLabel: 'お問い合わせ', description: (b) => `${b}へのお問い合わせ`,
      headline: 'お問い合わせ', subheadline: 'メッセージをお送りください。折り返しご連絡いたします。',
      formHeadline: 'ご連絡ください', formBody: 'ご連絡先をご記入いただければ、こちらからご連絡いたします。',
    },
    forms: {
      contact: { name: 'お問い合わせ', buttonText: '問い合わせる', successMessage: 'ありがとうございます。折り返しご連絡いたします。' },
    },
  },
  ko: {
    contactPage: {
      title: '문의하기', navLabel: '문의하기', description: (b) => `${b}에 문의하기`,
      headline: '문의하기', subheadline: '메시지를 보내 주시면 곧 답변드리겠습니다.',
      formHeadline: '연락 주세요', formBody: '연락처를 남겨 주시면 곧 연락드리겠습니다.',
    },
    forms: {
      contact: { name: '문의하기', buttonText: '연락하기', successMessage: '감사합니다. 곧 연락드리겠습니다.' },
    },
  },
  de: {
    contactPage: {
      title: 'Kontakt', navLabel: 'Kontakt', description: (b) => `Kontaktieren Sie ${b}`,
      headline: 'Kontakt', subheadline: 'Schreiben Sie uns – wir melden uns in Kürze bei Ihnen.',
      formHeadline: 'Schreiben Sie uns', formBody: 'Hinterlassen Sie Ihre Kontaktdaten und wir melden uns bald.',
    },
    forms: {
      contact: { name: 'Kontakt', buttonText: 'Kontakt aufnehmen', successMessage: 'Danke – wir melden uns in Kürze.' },
    },
  },
  it: {
    contactPage: {
      title: 'Contattaci', navLabel: 'Contatti', description: (b) => `Contatta ${b}`,
      headline: 'Contattaci', subheadline: 'Inviaci un messaggio e ti risponderemo a breve.',
      formHeadline: 'Scrivici', formBody: 'Lasciaci i tuoi dati e ti ricontatteremo presto.',
    },
    forms: {
      contact: { name: 'Contattaci', buttonText: 'Mettiti in contatto', successMessage: 'Grazie: ti ricontatteremo a breve.' },
    },
  },
  pt: {
    contactPage: {
      title: 'Fale conosco', navLabel: 'Contato', description: (b) => `Entre em contato com ${b}`,
      headline: 'Fale conosco', subheadline: 'Envie-nos uma mensagem e responderemos em breve.',
      formHeadline: 'Entre em contato', formBody: 'Deixe seus dados e entraremos em contato em breve.',
    },
    forms: {
      contact: { name: 'Fale conosco', buttonText: 'Entrar em contato', successMessage: 'Obrigado — entraremos em contato em breve.' },
    },
  },
  ru: {
    contactPage: {
      title: 'Контакты', navLabel: 'Контакты', description: (b) => `Свяжитесь с ${b}`,
      headline: 'Свяжитесь с нами', subheadline: 'Напишите нам, и мы скоро ответим.',
      formHeadline: 'Напишите нам', formBody: 'Оставьте свои контакты, и мы скоро с вами свяжемся.',
    },
    forms: {
      contact: { name: 'Связаться с нами', buttonText: 'Связаться', successMessage: 'Спасибо — мы скоро свяжемся с вами.' },
    },
  },
  vi: {
    contactPage: {
      title: 'Liên hệ', navLabel: 'Liên hệ', description: (b) => `Liên hệ với ${b}`,
      headline: 'Liên hệ với chúng tôi', subheadline: 'Hãy gửi tin nhắn, chúng tôi sẽ phản hồi sớm.',
      formHeadline: 'Liên hệ ngay', formBody: 'Để lại thông tin, chúng tôi sẽ liên hệ với bạn sớm.',
    },
    forms: {
      contact: { name: 'Liên hệ', buttonText: 'Liên hệ ngay', successMessage: 'Cảm ơn bạn — chúng tôi sẽ liên hệ lại sớm.' },
    },
  },
  ar: {
    contactPage: {
      title: 'اتصل بنا', navLabel: 'اتصل بنا', description: (b) => `تواصل مع ${b}`,
      headline: 'اتصل بنا', subheadline: 'أرسل لنا رسالة وسنرد عليك قريبًا.',
      formHeadline: 'تواصل معنا', formBody: 'اترك بياناتك وسنتواصل معك قريبًا.',
    },
    forms: {
      contact: { name: 'اتصل بنا', buttonText: 'تواصل معنا', successMessage: 'شكرًا — سنتواصل معك قريبًا.' },
    },
  },
  hi: {
    contactPage: {
      title: 'संपर्क करें', navLabel: 'संपर्क', description: (b) => `${b} से संपर्क करें`,
      headline: 'संपर्क करें', subheadline: 'हमें संदेश भेजें, हम जल्द ही जवाब देंगे।',
      formHeadline: 'हमसे संपर्क करें', formBody: 'अपना विवरण छोड़ें, हम जल्द ही आपसे संपर्क करेंगे।',
    },
    forms: {
      contact: { name: 'संपर्क करें', buttonText: 'हमसे संपर्क करें', successMessage: 'धन्यवाद — हम जल्द ही आपसे संपर्क करेंगे।' },
    },
  },
  th: {
    contactPage: {
      title: 'ติดต่อเรา', navLabel: 'ติดต่อเรา', description: (b) => `ติดต่อ ${b}`,
      headline: 'ติดต่อเรา', subheadline: 'ส่งข้อความถึงเรา แล้วเราจะติดต่อกลับโดยเร็ว',
      formHeadline: 'ติดต่อเรา', formBody: 'ฝากข้อมูลติดต่อไว้ แล้วเราจะติดต่อกลับโดยเร็ว',
    },
    forms: {
      contact: { name: 'ติดต่อเรา', buttonText: 'ติดต่อเลย', successMessage: 'ขอบคุณ เราจะติดต่อกลับโดยเร็ว' },
    },
  },
};

/** 这种语言的那一行；查不到先退基础语言（`pt-BR` → `pt`），再退英文。 */
function wordsFor(locale) {
  const l = String(locale || '').toLowerCase();
  return WORDS[l] || WORDS[l.split('-')[0]] || WORDS.en;
}

/**
 * 代码补的联系页 7 句（`description` 已经拼好品牌名）。
 * `brandName` 空 ⟹ 英文那一行用 `us`（逐字等于改之前那句 `Get in touch with us`）；别的语言拼不出一句通顺的话
 * （「联系us」），就用这一行的标题。
 */
function contactPageWords(locale, brandName) {
  const row = wordsFor(locale);
  const w = row.contactPage;
  const b = typeof brandName === 'string' && brandName.trim() ? brandName.trim() : '';
  return { ...w, description: b ? w.description(b) : (row === WORDS.en ? w.description('us') : w.title) };
}

/** 默认表单（`contact`）的 name · buttonText · successMessage；`id` 不认识 ⟹ null。 */
function formWords(locale, id) {
  const f = wordsFor(locale).forms[id];
  return f ? { ...f } : null;
}

module.exports = { WORDS, wordsFor, contactPageWords, formWords };
