'use strict';

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// demo-content/ar.js —— 演示站（skipAI，`create-site.js` §getDemoConfig）的 `ar` 版本（#1473 做什么 6）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 只为渲染一个 RTL 站：机器翻，没人校过稿，别拿去当真站的文案。
// 形状是「英文原句 → 阿拉伯文」的逐字对照表，按**整串相等**替换演示配置里给人读的字符串叶子：
//   · slug / href / icon / 图片地址这类值不在表里 ⟹ 一个都不动（路由与引用照旧）
//   · 表里没有的句子留英文 —— getDemoConfig 加了新句子而这里没跟，页面上是一句英文，不会坏
// 🔴 撑宽那一步（`theme-css-invariants-sample-pages.js`）用的 `DEMO_CONTENT` 仍是英文：它量的是横向滚动和对比度，
//    跟文字是什么语言无关，方向由 `<html dir>` 定。

const AR_STRINGS = {
  'Your trusted local business': 'شريكك المحلي الموثوق',
  'Main Office': 'المكتب الرئيسي',
  'Home': 'الرئيسية',
  'About': 'من نحن',
  'Services': 'الخدمات',
  'Contact': 'اتصل بنا',
  'Get a Quote': 'اطلب عرض سعر',
  'Quick Links': 'روابط سريعة',
  'Welcome to Demo Company': 'مرحبًا بكم في شركتنا',
  'Your trusted local business partner': 'شريكك المحلي الموثوق في كل خدمة',
  'Get Started': 'ابدأ الآن',
  'Learn More': 'اعرف المزيد',
  'Why Choose Us': 'لماذا تختارنا',
  'What sets us apart from the rest': 'ما الذي يميزنا عن غيرنا',
  'Ready to get started?': 'هل أنت مستعد للبدء؟',
  'Contact us today for a free consultation.': 'تواصل معنا اليوم للحصول على استشارة مجانية.',
  'Contact Us': 'اتصل بنا',
  'Contact us': 'اتصل بنا',
  "Leave your details and we'll get back to you shortly.": 'اترك بياناتك وسنعاود الاتصال بك قريبًا.',
  'About Us': 'من نحن',
  'Learn about Demo Company': 'تعرّف على شركتنا',
  'Learn more about our company and mission': 'تعرّف أكثر على شركتنا ورسالتنا',
  'Our Services': 'خدماتنا',
  'Professional services by Demo Company': 'خدمات احترافية من شركتنا',
  'Discover what we can do for you': 'اكتشف ما يمكننا تقديمه لك',
  'What we do': 'ماذا نقدم',
  'Request a free quote from Demo Company': 'اطلب عرض سعر مجانيًا',
  'Get a Free Quote': 'احصل على عرض سعر مجاني',
  'Fill out the form below and we will get back to you within 24 hours': 'املأ النموذج أدناه وسنرد عليك خلال 24 ساعة',
  'Tell us about your project': 'أخبرنا عن مشروعك',
  'We will get back to you within 24 hours.': 'سنرد عليك خلال 24 ساعة.',
  'Get in touch with Demo Company': 'تواصل مع شركتنا',
  "Send us a message and we'll get back to you shortly.": 'أرسل لنا رسالة وسنرد عليك قريبًا.',
  'Get in touch': 'تواصل معنا',
  'Leave your details and we will reach out soon.': 'اترك بياناتك وسنتواصل معك قريبًا.',
  'Demo Service': 'خدمة الصيانة',
  'Our core service offering.': 'خدمتنا الأساسية.',
  'We provide professional demo services to businesses of all sizes.': 'نقدم خدمات احترافية للشركات من جميع الأحجام.',
  'Fast turnaround': 'إنجاز سريع',
  'Quality results': 'نتائج عالية الجودة',
  'Affordable pricing': 'أسعار مناسبة',
  'Demo Company — Professional Services': 'خدمات احترافية',
  'Demo Company provides professional services in the Greater Toronto Area.': 'نقدم خدمات احترافية في منطقة تورنتو الكبرى.',
  '## Our Story\n\nDemo Company was founded with a simple mission: to provide exceptional service to our community. We have been serving the Greater Toronto Area for years, building lasting relationships with our clients.\n\n## Our Mission\n\nWe are committed to delivering quality results with integrity and professionalism.':
    '## قصتنا\n\nتأسست شركتنا برسالة بسيطة: تقديم خدمة استثنائية لمجتمعنا. نخدم منطقة تورنتو الكبرى منذ سنوات، ونبني علاقات دائمة مع عملائنا.\n\n## رسالتنا\n\nنلتزم بتقديم نتائج عالية الجودة بنزاهة واحترافية.',
};

/** 原地把对象里整串等于表中某句的字符串换成译文。回替换了几处（读数用）。 */
function localizeStrings(node, table = AR_STRINGS) {
  let n = 0;
  const walk = (v) => {
    if (Array.isArray(v)) {
      v.forEach((x, i) => { if (typeof x === 'string' && Object.hasOwn(table, x)) { v[i] = table[x]; n += 1; } else walk(x); });
    } else if (v && typeof v === 'object') {
      for (const k of Object.keys(v)) {
        const x = v[k];
        if (typeof x === 'string' && Object.hasOwn(table, x)) { v[k] = table[x]; n += 1; } else walk(x);
      }
    }
  };
  walk(node);
  return n;
}

module.exports = { AR_STRINGS, localizeStrings };
