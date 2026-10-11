import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {patchWeaponIcon,weaponIconRevision} from '../lib/client-weapon-icon-patch.mjs';

const MAIN='client/js/ff/fff570bb4753f056432680e781d827dc.js';
const LEFT_POS=8, RIGHT_POS=10;
const BITS={
 START_WEAPON:8000,START_WEAPON_ADD1:30000,
 LEN_LWEAPON_STYLE:255,LEN_LWEAPON_COLOR:3,LEN_LWEAPON_ADD:3,
 LEN_RWEAPON_STYLE:255,LEN_RWEAPON_COLOR:3,LEN_RWEAPON_ADD:3,
 OFFSET_LWEAPON_STYLE:6,OFFSET_LWEAPON_COLOR:14,OFFSET_LWEAPON_ADD:0,
 OFFSET_RWEAPON_STYLE:16,OFFSET_RWEAPON_COLOR:24,OFFSET_RWEAPON_ADD:2,
 LEN_WEAPON_FLASH:7,OFFSET_WEAPON_FLASH:28
};
const LEFT_ANCHOR=',e=this.bag.getItem(s["default"].WEAPON_LEFT_POS)';
const RIGHT_ANCHOR=',e=this.bag.getItem(s["default"].WEAPON_RIGHT_POS)';

// 取出 `if(` 的完整条件表达式（按括号配平，不依赖注释/空白）
function conditionOf(source,anchor){
 const at=source.indexOf(anchor);
 assert.ok(at>0,'anchor not found: '+anchor);
 const start=source.lastIndexOf('if(',at);
 assert.ok(start>0,'if( not found before: '+anchor);
 let depth=0;
 for(let i=start+2;i<source.length;i++){
  const ch=source[i];
  if(ch==='(')depth++;
  else if(ch===')'){depth--;if(depth===0)return source.slice(start+3,i);}
 }
 throw Error('unbalanced condition');
}

// 用原始条件表达式跑真实求值：条件里的语句会真的执行，于是可以看它有没有放行
function harness(condition){
 const _={ModelConst:BITS};
 const a={Tool:{getBitNum:()=>8}};
 const s={default:{WEAPON_LEFT_POS:LEFT_POS,WEAPON_RIGHT_POS:RIGHT_POS}};
 const run=new Function('s','_','a','e','t','i','o','l','u','var r=!!('+condition+');return {r:r,e:e,t:t};');
 return (left,right)=>{
  const bag={[LEFT_POS]:left,[RIGHT_POS]:right,getItem(pos){return this[pos]||null}};
  const self={bag,icon2:{low:0,high:0},getIllusionItem(id,item){return item&&item.itemInfo?item.itemInfo:null}};
  const out=run.call(self,s,_,a,undefined,undefined,undefined,undefined,undefined,undefined);
  // 客户端把 t 换算成武器样式：i = 1 + ((t-1)/4|0)；>500 表示扩展（ADD1）武器
  return {renders:out.r,item:out.e,t:out.t,style:out.t>0?1+(out.t-1>>2):0};
 };
}

function item(type,icon,illusion){
 const it={id:1000+type,type,icon};
 if(illusion)it.illusionItemId=777,it.itemInfo={id:777,type:illusion.type,icon:illusion.icon,illusionItemId:0};
 return it;
}

test('the weapon icon patch applies once, stays idempotent and drops the broken v1 guard',()=>{
 const source=fs.readFileSync(MAIN,'utf8');
 const patched=patchWeaponIcon(source);
 assert.equal(weaponIconRevision,'weapon-icon-v2');
 assert.ok(patched.length>source.length,'patch should grow the bundle');
 assert.equal(patchWeaponIcon(patched),patched,'patch must be idempotent');
 // v1 把守卫塞进逗号表达式里，结果被丢掉；v2 里不允许再出现那种写法
 assert.ok(!patched.includes('(!function(x){var y=x.getItem(s["default"].WEAPON_LEFT_POS)'),'v1 guard must be gone');
 // 幻化解算必须同时进入左右两槽
 assert.equal(patched.split('getIllusionItem(e.illusionItemId,e))&&(e=t)').length-1,2);
});

test('a left-hand weapon takes its illusion appearance into icon2',()=>{
 const left=harness(conditionOf(patchWeaponIcon(fs.readFileSync(MAIN,'utf8')),LEFT_ANCHOR));
 // 大锤 icon 9030 → t=1030 → style 258；幻化成单手剑 icon 8009 → t=9 → style 3
 const plain=left(item(38,9030),null);
 assert.equal(plain.renders,true);
 assert.equal(plain.style,258,'hammer keeps its own style');
 const meant=left(item(38,9030,{type:13,icon:8009}),null);
 assert.equal(meant.renders,true);
 assert.equal(meant.item.icon,8009,'left weapon must be resolved to the illusion appearance');
 assert.equal(meant.style,3,'illusded left weapon must carry the appearance style');
});

test('the right-hand weapon renders only when the left slot agrees',()=>{
 const rightHand=harness(conditionOf(patchWeaponIcon(fs.readFileSync(MAIN,'utf8')),RIGHT_ANCHOR));
 const cases=[
  ['hammer illusded to a sword + hammer',item(38,9030,{type:13,icon:8009}),item(38,9030),false],
  ['sword + sword (dual swords stay as before)',item(13,8009),item(13,8061),true],
  ['sword + shield (icon 0, sword-and-shield stays)',item(13,8009),item(24,0),false],
  ['empty left + hammer right',null,item(38,9030),true],
  ['two-handed sword + two-handed sword',item(14,8065),item(14,8109),false],
  ['sword + two-handed sword',item(13,8009),item(14,8065),false],
  ['sword + two-handed hammer',item(13,8009),item(38,9030),false],
  ['both slots illusded to the same sword',item(38,9030,{type:13,icon:8009}),item(38,9030,{type:13,icon:8009}),true],
  ['left illusded to a hammer + sword (left wins)',item(13,8009,{type:38,icon:9030}),item(13,8061),false]
 ];
 for(const [name,left,right,expected] of cases){
  assert.equal(rightHand(left,right).renders,expected,`right hand for: ${name}`);
 }
});
