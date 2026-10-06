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
//   forms         两张默认表单（`site-forms.js` §DEFAULT_SITE_FORMS 的 `quote` / `contact`）的
//                 name · buttonText · successMessage。字段、`id` 不在这里 —— 那是骨架，各语言必须一致。
//
// 🔴 优先级：AI 给了 > 这张表 > 英文（表里没有的语言）。这张表只是「AI 没给」时的落点，**不覆盖 AI 的字**。
// 🔴 语言集合同 `keyword-pages.js` 的 `LABELS`（15 种，含 zh-tw）；查不到先退到基础语言（pt-BR → pt），再退英文。
//    渲染期的输入框占位符在另一张表（`src/lib/component-labels.ts`，14 种、**没有 zh-tw**）——
//    所以繁体站联系页是繁体、输入框是英文，跟改之前一样，这是已知的，不当缺陷报（票面「做什么」3）。
// 🔴 `en` 那一行逐字等于改之前的英文常量 —— 英文站的产物一个字节不变。

const WORDS = {
  en: {
    contactPage: {
      title: 'Contact Us', navLabel: 'Contact', description: (b) => `Get in touch with ${b}`,
      headline: 'Contact Us', subheadline: "Send us a message and we'll get back to you shortly.",
      formHeadline: 'Get in touch', formBody: 'Leave your details and we will reach out soon.',
    },
    forms: {
      quote: { name: 'Get a free quote', buttonText: 'Get a free quote', successMessage: "Thanks! We've got your details and will be in touch." },
      contact: { name: 'Contact us', buttonText: 'Send message', successMessage: 'Thanks for your message — we will get back to you shortly.' },
    },
  },
  zh: {
    contactPage: {
      title: '联系我们', navLabel: '联系我们', description: (b) => `联系${b}`,
      headline: '联系我们', subheadline: '给我们留言，我们会尽快回复您。',
      formHeadline: '与我们联系', formBody: '留下您的联系方式，我们会尽快与您联系。',
    },
    forms: {
      quote: { name: '免费获取报价', buttonText: '免费获取报价', successMessage: '谢谢！我们已收到您的信息，会尽快与您联系。' },
      contact: { name: '联系我们', buttonText: '发送留言', successMessage: '感谢您的留言，我们会尽快回复您。' },
    },
  },
  'zh-tw': {
    contactPage: {
      title: '聯絡我們', navLabel: '聯絡我們', description: (b) => `聯絡${b}`,
      headline: '聯絡我們', subheadline: '給我們留言，我們會盡快回覆您。',
      formHeadline: '與我們聯絡', formBody: '留下您的聯絡方式，我們會盡快與您聯絡。',
    },
    forms: {
      quote: { name: '免費取得報價', buttonText: '免費取得報價', successMessage: '謝謝！我們已收到您的資料，會盡快與您聯絡。' },
      contact: { name: '聯絡我們', buttonText: '送出留言', successMessage: '感謝您的留言，我們會盡快回覆您。' },
    },
  },
  fr: {
    contactPage: {
      title: 'Contactez-nous', navLabel: 'Contact', description: (b) => `Contactez ${b}`,
      headline: 'Contactez-nous', subheadline: 'Envoyez-nous un message et nous vous répondrons rapidement.',
      formHeadline: 'Écrivez-nous', formBody: 'Laissez vos coordonnées et nous vous recontacterons bientôt.',
    },
    forms: {
      quote: { name: 'Devis gratuit', buttonText: 'Obtenir un devis gratuit', successMessage: 'Merci ! Nous avons bien reçu vos coordonnées et vous recontacterons.' },
      contact: { name: 'Nous contacter', buttonText: 'Envoyer le message', successMessage: 'Merci pour votre message — nous vous répondrons rapidement.' },
    },
  },
  es: {
    contactPage: {
      title: 'Contáctenos', navLabel: 'Contacto', description: (b) => `Póngase en contacto con ${b}`,
      headline: 'Contáctenos', subheadline: 'Envíenos un mensaje y le responderemos en breve.',
      formHeadline: 'Escríbanos', formBody: 'Déjenos sus datos y nos pondremos en contacto pronto.',
    },
    forms: {
      quote: { name: 'Presupuesto gratis', buttonText: 'Pedir presupuesto gratis', successMessage: '¡Gracias! Hemos recibido sus datos y nos pondremos en contacto.' },
      contact: { name: 'Contáctenos', buttonText: 'Enviar mensaje', successMessage: 'Gracias por su mensaje: le responderemos en breve.' },
    },
  },
  ja: {
    contactPage: {
      title: 'お問い合わせ', navLabel: 'お問い合わせ', description: (b) => `${b}へのお問い合わせ`,
      headline: 'お問い合わせ', subheadline: 'メッセージをお送りください。折り返しご連絡いたします。',
      formHeadline: 'ご連絡ください', formBody: 'ご連絡先をご記入いただければ、こちらからご連絡いたします。',
    },
    forms: {
      quote: { name: '無料お見積もり', buttonText: '無料で見積もりを依頼', successMessage: 'ありがとうございます。内容を確認のうえご連絡いたします。' },
      contact: { name: 'お問い合わせ', buttonText: '送信する', successMessage: 'お問い合わせありがとうございます。折り返しご連絡いたします。' },
    },
  },
  ko: {
    contactPage: {
      title: '문의하기', navLabel: '문의하기', description: (b) => `${b}에 문의하기`,
      headline: '문의하기', subheadline: '메시지를 보내 주시면 곧 답변드리겠습니다.',
      formHeadline: '연락 주세요', formBody: '연락처를 남겨 주시면 곧 연락드리겠습니다.',
    },
    forms: {
      quote: { name: '무료 견적', buttonText: '무료 견적 받기', successMessage: '감사합니다! 정보를 받았으며 곧 연락드리겠습니다.' },
      contact: { name: '문의하기', buttonText: '메시지 보내기', successMessage: '문의해 주셔서 감사합니다. 곧 답변드리겠습니다.' },
    },
  },
  de: {
    contactPage: {
      title: 'Kontakt', navLabel: 'Kontakt', description: (b) => `Kontaktieren Sie ${b}`,
      headline: 'Kontakt', subheadline: 'Schreiben Sie uns – wir melden uns in Kürze bei Ihnen.',
      formHeadline: 'Schreiben Sie uns', formBody: 'Hinterlassen Sie Ihre Kontaktdaten und wir melden uns bald.',
    },
    forms: {
      quote: { name: 'Kostenloses Angebot', buttonText: 'Kostenloses Angebot anfordern', successMessage: 'Danke! Wir haben Ihre Angaben erhalten und melden uns bei Ihnen.' },
      contact: { name: 'Kontakt', buttonText: 'Nachricht senden', successMessage: 'Danke für Ihre Nachricht – wir melden uns in Kürze.' },
    },
  },
  it: {
    contactPage: {
      title: 'Contattaci', navLabel: 'Contatti', description: (b) => `Contatta ${b}`,
      headline: 'Contattaci', subheadline: 'Inviaci un messaggio e ti risponderemo a breve.',
      formHeadline: 'Scrivici', formBody: 'Lasciaci i tuoi dati e ti ricontatteremo presto.',
    },
    forms: {
      quote: { name: 'Preventivo gratuito', buttonText: 'Richiedi un preventivo gratuito', successMessage: 'Grazie! Abbiamo ricevuto i tuoi dati e ti ricontatteremo.' },
      contact: { name: 'Contattaci', buttonText: 'Invia messaggio', successMessage: 'Grazie per il tuo messaggio: ti risponderemo a breve.' },
    },
  },
  pt: {
    contactPage: {
      title: 'Fale conosco', navLabel: 'Contato', description: (b) => `Entre em contato com ${b}`,
      headline: 'Fale conosco', subheadline: 'Envie-nos uma mensagem e responderemos em breve.',
      formHeadline: 'Entre em contato', formBody: 'Deixe seus dados e entraremos em contato em breve.',
    },
    forms: {
      quote: { name: 'Orçamento grátis', buttonText: 'Pedir orçamento grátis', successMessage: 'Obrigado! Recebemos seus dados e entraremos em contato.' },
      contact: { name: 'Fale conosco', buttonText: 'Enviar mensagem', successMessage: 'Obrigado pela sua mensagem — responderemos em breve.' },
    },
  },
  ru: {
    contactPage: {
      title: 'Контакты', navLabel: 'Контакты', description: (b) => `Свяжитесь с ${b}`,
      headline: 'Свяжитесь с нами', subheadline: 'Напишите нам, и мы скоро ответим.',
      formHeadline: 'Напишите нам', formBody: 'Оставьте свои контакты, и мы скоро с вами свяжемся.',
    },
    forms: {
      quote: { name: 'Бесплатный расчёт', buttonText: 'Получить бесплатный расчёт', successMessage: 'Спасибо! Мы получили ваши данные и свяжемся с вами.' },
      contact: { name: 'Связаться с нами', buttonText: 'Отправить сообщение', successMessage: 'Спасибо за сообщение — мы скоро ответим.' },
    },
  },
  vi: {
    contactPage: {
      title: 'Liên hệ', navLabel: 'Liên hệ', description: (b) => `Liên hệ với ${b}`,
      headline: 'Liên hệ với chúng tôi', subheadline: 'Hãy gửi tin nhắn, chúng tôi sẽ phản hồi sớm.',
      formHeadline: 'Liên hệ ngay', formBody: 'Để lại thông tin, chúng tôi sẽ liên hệ với bạn sớm.',
    },
    forms: {
      quote: { name: 'Báo giá miễn phí', buttonText: 'Nhận báo giá miễn phí', successMessage: 'Cảm ơn bạn! Chúng tôi đã nhận được thông tin và sẽ liên hệ sớm.' },
      contact: { name: 'Liên hệ', buttonText: 'Gửi tin nhắn', successMessage: 'Cảm ơn tin nhắn của bạn — chúng tôi sẽ phản hồi sớm.' },
    },
  },
  ar: {
    contactPage: {
      title: 'اتصل بنا', navLabel: 'اتصل بنا', description: (b) => `تواصل مع ${b}`,
      headline: 'اتصل بنا', subheadline: 'أرسل لنا رسالة وسنرد عليك قريبًا.',
      formHeadline: 'تواصل معنا', formBody: 'اترك بياناتك وسنتواصل معك قريبًا.',
    },
    forms: {
      quote: { name: 'عرض سعر مجاني', buttonText: 'احصل على عرض سعر مجاني', successMessage: 'شكرًا! استلمنا بياناتك وسنتواصل معك.' },
      contact: { name: 'اتصل بنا', buttonText: 'إرسال الرسالة', successMessage: 'شكرًا على رسالتك — سنرد عليك قريبًا.' },
    },
  },
  hi: {
    contactPage: {
      title: 'संपर्क करें', navLabel: 'संपर्क', description: (b) => `${b} से संपर्क करें`,
      headline: 'संपर्क करें', subheadline: 'हमें संदेश भेजें, हम जल्द ही जवाब देंगे।',
      formHeadline: 'हमसे संपर्क करें', formBody: 'अपना विवरण छोड़ें, हम जल्द ही आपसे संपर्क करेंगे।',
    },
    forms: {
      quote: { name: 'मुफ़्त कोटेशन', buttonText: 'मुफ़्त कोटेशन पाएँ', successMessage: 'धन्यवाद! हमें आपका विवरण मिल गया है, हम जल्द संपर्क करेंगे।' },
      contact: { name: 'संपर्क करें', buttonText: 'संदेश भेजें', successMessage: 'आपके संदेश के लिए धन्यवाद — हम जल्द ही जवाब देंगे।' },
    },
  },
  th: {
    contactPage: {
      title: 'ติดต่อเรา', navLabel: 'ติดต่อเรา', description: (b) => `ติดต่อ ${b}`,
      headline: 'ติดต่อเรา', subheadline: 'ส่งข้อความถึงเรา แล้วเราจะติดต่อกลับโดยเร็ว',
      formHeadline: 'ติดต่อเรา', formBody: 'ฝากข้อมูลติดต่อไว้ แล้วเราจะติดต่อกลับโดยเร็ว',
    },
    forms: {
      quote: { name: 'ขอใบเสนอราคาฟรี', buttonText: 'ขอใบเสนอราคาฟรี', successMessage: 'ขอบคุณ! เราได้รับข้อมูลของคุณแล้วและจะติดต่อกลับ' },
      contact: { name: 'ติดต่อเรา', buttonText: 'ส่งข้อความ', successMessage: 'ขอบคุณสำหรับข้อความ เราจะตอบกลับโดยเร็ว' },
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

/** 一张默认表单（`quote` / `contact`）的 name · buttonText · successMessage；`id` 不认识 ⟹ null。 */
function formWords(locale, id) {
  const f = wordsFor(locale).forms[id];
  return f ? { ...f } : null;
}

module.exports = { WORDS, wordsFor, contactPageWords, formWords };
