/**
 * 从 `技能编辑器.html` 的 `game-labels` 生成 `lib/damage-calculator-labels.mjs`。
 *
 * 伤害计算器只拿它把 power 编号翻成中文（例如 81 → 技能附带伤害），
 * 不参与任何战斗数值。技能编辑器改了文案后重跑一次即可：
 *
 *   node tools/build-damage-calculator-labels.mjs
 *   node tools/build-damage-calculator-labels.mjs --check
 */
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('..',import.meta.url));
const editor=fs.readFileSync(new URL('../技能编辑器.html',import.meta.url),'utf8');
const match=editor.match(/<script[^>]*id="game-labels"[^>]*>([\s\S]*?)<\/script>/);
if(!match)throw Error('技能编辑器.html 里没有 game-labels');
const labels=JSON.parse(match[1]);
const lines=[];
for(const key of Object.keys(labels.powers).map(Number).sort((a,b)=>a-b)){
 const power=labels.powers[key];
 lines.push(`  ${key}: {name: ${JSON.stringify(power.n)}, percent: ${power.p?'true':'false'}},`);
}
const output=`// 由 技能编辑器.html 的 game-labels 生成；只用于伤害计算器把 power 编号翻成中文。\n// 重新生成：node tools/build-damage-calculator-labels.mjs（--check 只比对）\n// 这里不参与战斗计算，改文案不影响实际伤害。\nexport const POWER_LABELS = {\n${lines.join('\n')}\n};\n`;
const target=new URL('../lib/damage-calculator-labels.mjs',import.meta.url);
if(process.argv.includes('--check')){
 const current=fs.readFileSync(target,'utf8');
 if(current!==output)throw Error('lib/damage-calculator-labels.mjs 与技能编辑器不一致，请重跑 node tools/build-damage-calculator-labels.mjs');
 console.log(`damage-calculator labels: ${lines.length} 条，一致`);
}else{
 fs.writeFileSync(target,output,'utf8');
 console.log(`damage-calculator labels: 写入 ${lines.length} 条 → ${fileURLToPath(target)}`);
}
