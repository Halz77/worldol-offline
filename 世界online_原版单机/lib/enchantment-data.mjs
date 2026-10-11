import {growthData} from './character-feature-data.mjs';
import {Writer} from './codec.mjs';
import fs from 'node:fs';
export const localEnchantments=growthData.enchantments.map(row=>{
 const [a,b]=row.attributes,e={id:row.id,type:28,name:row.name,bagIcon:26,grade:2,autoBinding:0,stackNum:99,reqLv:0,price:0,round:0,area:-1,
  power1:181,powerValue1:0,power2:a.k,powerValue2:a.v,power3:b.k,powerValue3:b.v,vipLevelReq:0,needShowRate:false,
  info:'免费八级附魔。可用于身上或背包中的装备，无等级、绑定、附魔点或货币要求。每次使用一张，替换原有附魔。',native:true,localPrice:0,level:0,durability:0};
 e.definitionBase64=new Writer().byte(28).bool(false).int(e.id).string(e.name).int(e.bagIcon).string(e.info).byte(e.grade).byte(0).byte(99).bool(false)
  .byte(0).short(0).int(0).int(0).byte(0).byte(-1).short(181).short(0).short(a.k).short(a.v).byte(0).short(b.k).short(b.v).bool(false).done().toString('base64');
 return e;
});
const recorded=JSON.parse(fs.readFileSync(new URL('../data/manual-item-grants.json',import.meta.url),'utf8')).enchantments;
export const enchantments=new Map([...recorded,...localEnchantments].map(e=>[e.id,e]));
export function enchantmentFields(itemId){
 const e=enchantments.get(itemId);if(!e||e.power1!==181)throw Error('无效的附魔道具。');
 return {enchantLevel:Number(e.name.match(/^(\d+)级/)[1]),enchantPower1:e.power2,enchantPowerValue1:e.powerValue2,enchantPower2:e.power3,enchantPowerValue2:e.powerValue3};
}
