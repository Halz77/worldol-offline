import fs from 'node:fs';
import {randomInt} from 'node:crypto';
import {Writer,Reader} from './codec.mjs';
export const spiritData=JSON.parse(fs.readFileSync(new URL('../data/spirit-seals.json',import.meta.url),'utf8'));
export const spiritRunes=new Map(spiritData.items.map(e=>[e.id,e]));
export const SPIRIT_SHOP_ID=23723;
export const spiritRules=Object.freeze({boxId:890120,boxIds:[890121,890122,890123,890124],boxPrice:100000,installCoins:1000000});
// v305 power IDs. Each family keeps its own primary stat, attack type and
// penetration effects; attack speed and defensive affixes are not mixed in.
export const spiritFamilies=[
 {name:'力量',primary:1,pool:[2,58,28,54,24,57,27,168,173,69,39,170]},
 {name:'敏捷',primary:5,pool:[6,59,29,54,24,57,27,168,173,69,39,170]},
 {name:'智力',primary:7,pool:[8,56,26,75,45,60,30,171,172,169,173]},
 {name:'感知',primary:9,pool:[10,56,26,75,45,60,30,171,172,169,173]}
];
export const spiritBoxes=spiritFamilies.map((family,index)=>({id:spiritRules.boxIds[index],family:index,name:family.name+'灵符箱'}));
export const isSpiritBox=id=>id===spiritRules.boxId||spiritRules.boxIds.includes(id);
const percentPowers=new Set([2,6,8,10,24,26,27,28,29,30,39,45]);
const largePowers=new Set([58,59,60,69,75]);
function spiritRollInt(size,random){
 if(!random)return randomInt(size);
 const value=random();if(!Number.isFinite(value)||value<0||value>=1)throw Error('无效随机数。');
 return Math.floor(value*size);
}
export function spiritPowerRange(itemId,power){
 const rune=spiritRunes.get(itemId);if(!rune)throw Error('未知赋灵符。');
 const family=spiritFamilies[(rune.seal_type-1)%4],base=(rune.seal_type<=4?1:2)*(rune.seal_grade+1);
 if(power!==family.primary&&!family.pool.includes(power))throw Error('这个词条不属于该系赋灵符。');
 // Authorized local curve: preserve the existing primary ceiling, use half
 // to full rolls, and distinguish percent, attack/penetration and other units.
 const max=power===family.primary?base:percentPowers.has(power)?Math.ceil(base/3):base*(largePowers.has(power)?10:2);
 return {min:Math.max(1,Math.ceil(max/2)),max};
}
export function rollSpiritPowers(itemId,random){
 const rune=spiritRunes.get(itemId);if(!rune)throw Error('未知赋灵符。');
 const family=spiritFamilies[(rune.seal_type-1)%4],pool=[...family.pool],keys=[family.primary];
 for(let n=0;n<Math.floor(rune.seal_grade/4);n++)keys.push(pool.splice(spiritRollInt(pool.length,random),1)[0]);
 return Object.fromEntries(keys.map(power=>{const {min,max}=spiritPowerRange(itemId,power);return [power,min+spiritRollInt(max-min+1,random)];}));
}
// seal_type 1–4 是力量/敏捷/智力/感知四系的黄阶，5–8 是同系的玄阶，
// 两者用 (seal_type-1)%4 都能算出同一个系别。
export const isSpiritRuneXuan=rune=>rune.seal_type>4;
// 宝箱固定只给十二级玄阶。
export const SPIRIT_BOX_LEVEL=12;
export function drawSpiritRune(random,family){
 if(family!==undefined&&(!Number.isInteger(family)||family<0||family>3))throw Error('未知灵符系别。');
 const pool=spiritData.items.filter(e=>e.seal_grade===SPIRIT_BOX_LEVEL&&isSpiritRuneXuan(e)&&(family===undefined||(e.seal_type-1)%4===family));
 if(!pool.length)throw Error('没有可用的赋灵符。');
 return pool[spiritRollInt(pool.length,random)].id;
}
export function spiritBoxDefinition(box){
 const range=box?`随机获得1枚${spiritFamilies[box.family].name}系十二级赋灵符（玄阶）。售价10万铜币。`:'旧版综合箱，随机获得四系十二级玄阶灵符之一，已有箱子仍可使用。';
 const e={id:box?.id??spiritRules.boxId,type:28,name:box?.name??'灵符随机箱',bagIcon:7,grade:4,autoBinding:1,stackNum:99,reqLv:0,ownTime:0,durMax:0,price:100,round:0,area:-1,power1:100,powerValue1:1,power2:0,powerValue2:0,vipLevelReq:0,needShowRate:false,
  info:range+'保留本系主属性，4/8/12级分别增加1/2/3条随机附加属性，数值随机，开出后固定。装入每枚100万铜币，刻印与取下免费。'};
 e.definitionBase64=new Writer().byte(e.type).bool(false).int(e.id).string(e.name).int(e.bagIcon).string(e.info)
  .byte(e.grade).byte(e.autoBinding).byte(e.stackNum).bool(false).byte(0).short(0).int(0).int(e.price)
  .byte(0).byte(-1).short(e.power1).short(e.powerValue1).short(0).short(0).byte(0).bool(false).done().toString('base64');
 return e;
}
export function applySpiritNpcs(official){
 for(const map of official.maps)for(const npc of map.npcs){
  if(!npc.shopID?.includes(SPIRIT_SHOP_ID)||!npc.wireBase64)continue;
  const bytes=Buffer.from(npc.wireBase64,'base64'),r=new Reader(bytes);r.take(14);r.utf();r.utf();const start=r.pos;r.utf();
  npc.talkDetail='少侠，可在此为人物防具和首饰免费刻印。装入每枚赋灵符收取100万铜币，取下免费并原样返还。无需等级、附魔或绑定条件。VIP商店装备页出售力量、敏捷、智力、感知四系灵符箱，每箱10万铜币，只开本系十二级玄阶赋灵符。';
  npc.wireBase64=Buffer.concat([bytes.subarray(0,start),new Writer().utf(npc.talkDetail).done(),bytes.subarray(r.pos)]).toString('base64');
 }
}
export function validateSpiritPowers(powers){
 const entries=Object.entries(powers||{});
 if(!entries.length||entries.length>4||entries.some(([k,v])=>!Number.isInteger(Number(k))||Number(k)<1||Number(k)>32767||!Number.isInteger(v)||v<1||v>32767))throw Error('赋灵符属性无效。');
 return Object.fromEntries(entries);
}
export function spiritRuneDefinition(template,instance){
 const record=spiritRunes.get(template?.id);if(!record)throw Error('没有此赋灵符资料。');
 const values=validateSpiritPowers(instance?.spiritRune?.powers||record.powers),result={...template},w=new Writer();
 // The rune definition finishes with a count and at most four signed-short pairs.
 const original=Buffer.from(template.definitionBase64,'base64'),oldCount=[1,2,3,4].filter(n=>template['power'+n]).length;
 if(original[original.length-1-oldCount*4]!==oldCount)throw Error('赋灵符属性位置不匹配。');
 w.byte(Object.keys(values).length);for(const [power,value]of Object.entries(values))w.short(Number(power)).short(value);
 for(const n of [1,2,3,4]){delete result['power'+n];delete result['powerValue'+n];}
 Object.entries(values).forEach(([power,value],i)=>{result['power'+(i+1)]=Number(power);result['powerValue'+(i+1)]=value;});
 result.definitionBase64=Buffer.concat([original.subarray(0,original.length-1-oldCount*4),w.done()]).toString('base64');return result;
}
export function applySpiritSeals(result,instance){
 if(instance.spiritSeals===undefined)return result;
 if(!instance.spiritSeals||typeof instance.spiritSeals!=='object'||Array.isArray(instance.spiritSeals)||Object.keys(instance.spiritSeals).some(s=>!['Left','Right'].includes(s)))throw Error('无效赋灵槽存档。');
 const before=(result.cssLeftPowerPer||0)+(result.cssRightPowerPer||0);
 for(const [side,seal]of Object.entries(instance.spiritSeals)){
  if(!seal||seal.open!==true||seal.basePercent!==spiritData.basePercent[side])throw Error('无效刻印属性。');
  result['css'+side+'Channel']=true;result['css'+side+'PowerPer']=seal.basePercent;result['css'+side+'HasItem']=!!seal.item;
  result['css'+side+'ItemPower']={};
  if(seal.item){const rune=spiritRunes.get(seal.item.itemId);if(!rune)throw Error('未知赋灵符。');result['css'+side+'ItemId']=rune.id;result['css'+side+'ItemGrade']=rune.grade;result['css'+side+'ItemIcon']=rune.bagIcon;result['css'+side+'ItemPower']=validateSpiritPowers(seal.item.powers);}
 }
 const after=(result.cssLeftPowerPer||0)+(result.cssRightPowerPer||0);
 if(after!==before)for(const key of ['def_str','def_agi','def_mag','atkMin','atkMax'])if(Number.isInteger(result[key]))result[key]=Math.min(32767,Math.trunc(result[key]*(100+after)/(100+before)));
 return result;
}
