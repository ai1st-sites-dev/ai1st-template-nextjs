'use strict';
// #1569 r3 —— 去掉两个汉字 / 假名之间的空格（「剪 发」→「剪发」、「剪 发 店」→「剪发店」）。
//
// 为什么：Google Ads 查量会把中文词切开、加空格再回来，向导翻译出来的种子和联想词就这样带着空格进了
// `sites.payload.keywords`（Chris 2026-10-05 site-ea408218：`{keyword:'剪 发', source:'translated-seed'}`）。
// 进 slug 没事，进 title / H1 / 正文就是「剪 发」。
// 只去【两侧都是】汉字或假名的空格：中英混排（「理发店 near me」）保留；韩文用空格分词，不算在内。
// 纯函数、不碰 fs：dashboard（CreatePage.tsx）和建站脚本（target-keywords.js）共用这一份。

const CJK_SPACE = /(?<=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])\s+(?=[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}])/gu;

function collapseCjkSpaces(s) {
  return typeof s === 'string' ? s.replace(CJK_SPACE, '') : s;
}

module.exports = { collapseCjkSpaces };
