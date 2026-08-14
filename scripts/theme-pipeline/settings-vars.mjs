// ══════════════════════════════════════════════════════════════════════════════════════════════════
// settings-vars.mjs — 把 settings 翻成 CSS 变量，用的是**产品自己那份翻译器**（#1004 AC7）
// ══════════════════════════════════════════════════════════════════════════════════════════════════
//
// 读 stdin 的一个 JSON 数组（每项是一份 settings，或 null），写回一个等长的数组，
// 每项是 `settingsToCssVars()` 的结果（`["--radius-lg: 0.5rem;", …]`）。
//
// 🔴 为什么要多这一个文件：`settingsToCssVars` 住在 `src/lib/themeSettings.ts`，而闸是普通
//    CommonJS 脚本，`require` 不了 `.ts`。两条出路里选了这条：
//      · 在 gates.js 里抄一份档位表 —— 不行。那是**第二份**真相，跟 `themeSettings.ts` 必然分叉，
//        而分叉的方向是「闸算的像不像」和「站上真正长什么样」对不上，静默。
//      · 起一个 node 子进程，让它把那个 .ts 原样 import 进来 —— 就是这个文件。表还是那一份。
//    把这个函数搬进 `scripts/` 是 #1002 的活（还没落 main），那张票落地后这个桥可以删掉，
//    换成一句 require。
//
// 调用方式由 gates.js 决定（node 22 要 `--experimental-strip-types`，node ≥23 默认就会剥）。
import { settingsToCssVars } from '../../src/lib/themeSettings.ts';

let raw = '';
for await (const chunk of process.stdin) raw += chunk;
const input = JSON.parse(raw || '[]');
process.stdout.write(JSON.stringify(input.map((s) => settingsToCssVars(s))));
