// SiteAsData 夹具：`export-site-json.js` 的往返必须无损 —— JSON 铺回目录再导回 JSON，跟原 JSON 深相等；
// 两个进仓的夹具站都能铺回目录且文件数对得上（T1d / T2a / T2b 的验收拿它们当夹具）。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const here = __dirname;
const script = path.join(here, 'export-site-json.js');

for (const name of ['site-0448c807', 'site-bbc4ff97']) {
  test(`${name}.json 往返无损`, () => {
    const src = path.join(here, `${name}.json`);
    const original = JSON.parse(fs.readFileSync(src, 'utf-8'));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'site-fixture-'));
    execFileSync(process.execPath, [script, 'to-dir', src, dir]);
    const back = path.join(dir, 'back.json');
    execFileSync(process.execPath, [script, 'to-json', dir, back]);
    const again = JSON.parse(fs.readFileSync(back, 'utf-8'));
    // back.json 自己也被扫进去了，剔掉再比
    delete again['back.json'];
    assert.deepStrictEqual(again, original);
    assert.ok(Object.keys(original).length >= 13, `${name} 至少 13 个文件`);
    assert.ok(original['brand.json'] && original['site_meta.json'] && original['en/pages/home.json'], '三个必有的键');
    fs.rmSync(dir, { recursive: true, force: true });
  });
}
