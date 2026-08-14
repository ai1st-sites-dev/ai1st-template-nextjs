const fs=require('fs'), path=require('path');
const SEC='src/components/sections';
const reg=fs.readFileSync('src/lib/sections/registry.ts','utf8');
// type → 组件文件名
const map={};
for (const m of reg.matchAll(/^\s*'([a-z0-9-]+)':\s*([A-Za-z0-9_]+),?/gm)) map[m[1]]=m[2];
const imports={};
for (const m of reg.matchAll(/import\s+([A-Za-z0-9_]+)\s+from\s+'([^']+)'/g)) imports[m[1]]=m[2];

/** 从 `data: { … }` 那一层里切出「字段名 + 类型文本」，只看最外层的逗号/分号 */
function fields(body){
  const out=[]; let depth=0, cur='';
  for (const ch of body){
    if ('{[('.includes(ch)) depth++;
    if ('}])'.includes(ch)) depth--;
    if ((ch===';'||ch===',') && depth===0){ if(cur.trim()) out.push(cur.trim()); cur=''; continue; }
    cur+=ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.map(s=>{
    const i=s.indexOf(':'); if(i<0) return null;
    const name=s.slice(0,i).trim().replace(/\?$/,'');
    return { name, opt:/\?$/.test(s.slice(0,i).trim()), type:s.slice(i+1).trim() };
  }).filter(Boolean);
}
function synth(name, type, depth=0, defs={}){
  const t=type.trim();
  if (depth>4) return 'x';
  // 联合的字面量：取第一个
  const lit=t.match(/^'([^']*)'/); if (lit && t.includes('|')) return lit[1];
  if (/^'([^']*)'$/.test(t)) return t.slice(1,-1);
  if (t==='string') {
    if (/^(href|url|link)$/i.test(name)) return '/about';
    if (/(image|img|photo|src|logo|icon)/i.test(name)) return name.match(/icon/i) ? 'shield-check' : '/images/grid-pattern.svg';
    if (/(html|content|body)/i.test(name)) return '<p>Body text</p>';
    return name.charAt(0).toUpperCase()+name.slice(1)+' text';
  }
  if (t==='number') return 3;
  if (t==='boolean') return true;
  // 数组
  const arr=t.match(/^(.*)\[\]$/s);
  if (arr) { const inner=arr[1].trim().replace(/^\((.*)\)$/s,'$1');
    return [0,1,2].map((n)=>synth(name.replace(/s$/,'')+n, inner, depth+1, defs)); }
  if (/^Array<(.*)>$/s.test(t)) return [0,1,2].map((n)=>synth(name+n, t.match(/^Array<(.*)>$/s)[1], depth+1, defs));
  // 对象字面量
  if (t.startsWith('{')) {
    const o={}; for (const f of fields(t.slice(1,t.lastIndexOf('}')))) o[f.name]=synth(f.name,f.type,depth+1,defs);
    return o;
  }
  if (defs[t]) { const o={}; for (const f of fields(defs[t])) o[f.name]=synth(f.name,f.type,depth+1,defs); return o; }
  return name+' text';
}
const types=Object.keys(map), page={slug:'allblocks',title:'All Blocks',
  description:'Every registered block, once.',navLabel:'All Blocks',navOrder:9,
  changeFrequency:'monthly',priority:0.1,sections:[]};
const skipped=[];
for (const t of types){
  const rel=(imports[map[t]]||'').replace(/^@\//,'src/');
  const file=rel?rel+'.tsx':path.join(SEC,map[t]+'.tsx');
  if (!fs.existsSync(file)) { skipped.push(t+' (找不到 '+file+')'); continue; }
  const src=fs.readFileSync(file,'utf8');
  const m=src.match(/data:\s*\{/);
  if (!m) { page.sections.push({type:t,data:{}}); continue; }
  // 从 `data: {` 起配对花括号
  let i=m.index+m[0].length-1, depth=0, end=-1;
  for (let j=i;j<src.length;j++){ if(src[j]==='{')depth++; else if(src[j]==='}'){depth--; if(depth===0){end=j;break;}} }
  const body=src.slice(i+1,end);
  const defs={};
  for (const im of src.matchAll(/(?:interface|type)\s+([A-Za-z0-9_]+)\s*=?\s*\{/g)) {
    let k=im.index+im[0].length-1, dep=0, e=-1;
    for (let j=k;j<src.length;j++){ if(src[j]==='{')dep++; else if(src[j]==='}'){dep--; if(dep===0){e=j;break;}} }
    if (e>0) defs[im[1]]=src.slice(k+1,e);
  }
  const d={}; for (const f of fields(body)) d[f.name]=synth(f.name,f.type,0,defs);
  page.sections.push({type:t,data:d});
}
fs.writeFileSync('site/en/pages/allblocks.json', JSON.stringify(page,null,2)+'\n');
console.log('block 种类:', types.length, '· 写进页面:', page.sections.length);
if (skipped.length) console.log('跳过:', skipped.join(' | '));
