#!/usr/bin/env node
/**
 * 第 93 版「技能自定义特效」· 出包守门。
 *
 * 用法：node tools/verify-skill-fx-release.mjs [站点目录]
 *   默认站点目录：安卓打包/app/www（不存在则报错退出）。
 *
 * 断言全部读**包内内容**（不读工作区 gradle/版本号——对旧包必过，不能当反证）。
 * 反证要求（手册第七节）：对不含本功能的旧包跑必须 FAIL 才算数。
 */
import fs from 'node:fs';
import path from 'node:path';

const site = process.argv[2] || path.join('..', '安卓打包', 'app', 'www');
const read = f => { try { return fs.readFileSync(path.join(site, f), 'utf8'); } catch (_) { return null; } };
const fails = [];
const ok = [];
const check = (cond, label) => { (cond ? ok : fails).push(label); };

if (!fs.existsSync(site)) {
  console.error(`站点目录不存在：${site}\n先跑 安卓打包/一键打包.bat 或传入已有站点目录。`);
  process.exit(2);
}

const index = read('index.html');
const fxJs = read('skill-fx.js');
const coreJs = read('skill-fx-core.js');
const thumbsJs = read('worldol-fx-thumbs.js');
const main = read('js/ff/fff570bb4753f056432680e781d827dc.js');

check(!!index, 'index.html 可读');
check(!!fxJs, 'skill-fx.js 在包内');
check(!!coreJs, 'skill-fx-core.js 在包内');
check(!!thumbsJs, 'worldol-fx-thumbs.js 在包内');
check(!!main, 'ff 主包在包内');

if (index) {
  check(index.includes('worldol-fx-thumbs.js'), 'index.html 引入缩略图内嵌表');
  check(index.includes('skill-fx-core.js'), 'index.html 引入核心层');
  check(/skill-fx\.js\?v=/.test(index), 'index.html 带 ?v= 引入 skill-fx.js（防缓存吃旧版）');
}
if (fxJs) {
  check(fxJs.includes('skill-fx-ui-20261025-v4'), 'skill-fx.js 含 rev 标记');
  check(fxJs.includes('__worldolSkillFxUI'), 'skill-fx.js 挂测试钩子');
  check(fxJs.includes('go.gameStage'), 'skill-fx.js 舞台查找含 go.gameStage（同源实证）');
  check(fxJs.includes('__worldolMyRoleId'), 'skill-fx.js 挂角色 id 全局（core resolver 依赖）');
  check(fxJs.includes('bar.x = x + w - BAR_W'), '滚动条位置已算滚动区 x 偏移（v4 真机反馈：漏算会跑到面板中部）');
}
if (coreJs) {
  check(coreJs.includes('skill-fx-core-20261025-v1'), 'skill-fx-core.js 含 rev 标记');
  check(coreJs.includes('worldol.skillFx'), '核心层落盘键存在');
  check(coreJs.includes('SETTLE_EXCLUDED'), '核心层含结算特例排除');
  check((coreJs.match(/29999/g) || []).length >= 2, '段护栏上限 29999 两处以上');
}
if (thumbsJs) {
  // 精确解析 icons 对象（括号配平）——base64 dataURL 里含引号，正则数不准
  let iconCount = 0;
  try {
   const at = thumbsJs.indexOf('icons:{');
   let depth = 0, start = thumbsJs.indexOf('{', at), end = -1;
   for (let k = start; k < thumbsJs.length; k++) {
    if (thumbsJs[k] === '{') depth++;
    else if (thumbsJs[k] === '}') { depth--; if (depth === 0) { end = k; break; } }
   }
   iconCount = end > start ? Object.keys(JSON.parse(thumbsJs.slice(start, end + 1))).length : 0;
  } catch (_) {}
  check(iconCount >= 170, `内嵌缩略图张数 >= 170（实际 ${iconCount}）`);
  check(iconCount === 181, `内嵌缩略图张数 = 181（实际 ${iconCount}）`);
}
if (main) {
  check(main.includes('__worldolSkillFxPatch'), 'ff 主包含战斗替换补丁标记');
  check(main.includes('skill-fx-switch-20261025-v1'), 'ff 主包含补丁 rev');
}

for (const line of ok) console.log('  ✓ ' + line);
for (const line of fails) console.log('  ✗ ' + line);
console.log(`\n${ok.length} 过 / ${fails.length} 败 —— ${fails.length ? 'FAIL' : 'PASS'}`);
process.exit(fails.length ? 1 : 0);
