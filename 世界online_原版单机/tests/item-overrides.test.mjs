// 装备属性覆盖层（第 86 版）：data/local-item-overrides.json + lib/item-overrides.mjs + 装备编辑器.html
//
// 守的几件事：
//   1. 官方 2134 件装备的定义字节能被 equipmentBytes **逐字节**重编码 —— 这是「改字段后
//      重写 definitionBase64」能安全落地的前提（编码器少写/多写一个字节，客户端就解析错位）。
//   2. 覆盖只动点名的字段，其它字段与客户端解码结果不变（用主包模块 0032 的真解码器读回）。
//   3. 非法字段 / 越界值 / 改 id、type 一律点名抛错 —— 覆盖文件写错要立刻看得见，
//      静默失效等于「改了没反应」。
//   4. 把每件装备的现有值原样覆盖一遍，定义字节必须**一个字节都不变**（字段范围与真实数据对齐）。
//   5. 装备编辑器.html 里内嵌的目录与当前 data/ 一致（tools/build-item-editor-data.mjs --check）。
//   6. 鉴定范围（第 87 版）：1008 行抓包字节能被 identifyWire 逐字节重编码；覆盖只改点名
//      的槽位并同时重写 slots 与 wireBase64（客户端 12060 回包 = 服务端随机读的那一行）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {equipmentBytes} from '../lib/character-import-codec.mjs';
import {
 compileItemOverrides,applyItemOverrides,applyOverrideToItem,itemOverrides,hasItemOverride,
 compileIdentifyOverrides,applyIdentifyOverrides,identifyWire,identifyOverrides,
 ITEM_FIELDS,OVERRIDABLE_FIELDS,isEquipmentType,isWeaponType,
 IDENTIFY_FIELDS,IDENTIFY_FIELD_LABELS
} from '../lib/item-overrides.mjs';
import {officialItems} from '../lib/official-data.mjs';
import {itemWithAffixes,identifySlots,starValue} from '../lib/item-affixes.mjs';
import {enchantments,enchantmentFields} from '../lib/enchantment-data.mjs';
import {spiritData,spiritRunes,rollSpiritPowers} from '../lib/spirit-seal-data.mjs';
import {decoders,Reader} from '../tools/capture-decoders.mjs';
import {Writer,Reader as WireReader} from '../lib/codec.mjs';
import {buildPayload,readFromHtml,EDITOR_HTML} from '../tools/build-item-editor-data.mjs';

const root=fileURLToPath(new URL('..',import.meta.url));
const official=JSON.parse(fs.readFileSync(path.join(root,'data','official-v305.json'),'utf8'));
const equips=official.items.filter(i=>i.definitionBase64&&isEquipmentType(i.type));
const weapons=equips.filter(i=>isWeaponType(i.type));
const identification=official.identification||[];
const hasClient=fs.existsSync(path.join(root,'analysis','modules','0032.js'));
const skip={skip:hasClient?false:'没有 analysis/（反编译产物不入库），跳过客户端解码断言'};
const d=hasClient?decoders(root):null;
if(hasClient){
 for(const name of ['isTimeItem','isBinded','isAutoBinding'])d.Item.prototype[name]=d.native(32,name,{e:d.Item});
}
const bytesOf=item=>Buffer.from(item.definitionBase64,'base64');
/**
 * definitionBase64 只是「定义」那一段；客户端解码器 fromBytesAtts1 读的是 itemPacket
 * 写在定义**前面**的实例尾巴（数量 / 耐久 / 宝石 / 槽位 / 标记位，见 lib/restoration-packets.mjs
 * 的 itemPacket）。补一段空尾巴再喂给 0032 的原函数，才能把定义读回来；
 * 顺带断言「一个字节不多不少」—— 覆盖后定义字节写歪一点，这里就会红。
 */
const decodeDefinition=item=>{
 const bytes=Buffer.concat([
  new Writer().short(1).int(0).int(item.durMax||0).byte(0).short(0).short(0).short(30).byte(0).done(),
  bytesOf(item)
 ]);
 const r=new Reader(bytes),parsed=new d.Item();
 d.native(32,'fromBytesAtts1',{e:d.Item})(parsed,r);
 d.Item.fromBytesAtts2(parsed,r);
 assert.equal(r.pos,bytes.length,`道具 ${item.id} 的定义字节没被完整消费（${r.pos}/${bytes.length}）`);
 return parsed;
};

test('官方装备定义能被 equipmentBytes 逐字节重编码（改属性的前提）',()=>{
 assert.ok(equips.length>2000,`装备条目太少：${equips.length}`);
 const bad=[];
 for(const item of equips){
  const out=equipmentBytes(item);
  if(!out.equals(bytesOf(item)))bad.push(`${item.id} ${item.name}（type ${item.type}）`);
 }
 assert.deepEqual(bad,[],`以下装备重编码后字节不一致：${bad.slice(0,8).join('、')}`);
});

test('覆盖只改点名字段，客户端解码结果与其余字段不变',skip,()=>{
 const item=official.items.find(i=>i.id===28003);
 assert.ok(item&&isWeaponType(item.type),'样本 28003 应该是武器');
 const before=decodeDefinition(item);
 const next=applyOverrideToItem(item,{fields:{atkMin:1234,atkMax:5678,power1:58,powerValue1:300}},`道具 ${item.id}`);
 assert.notEqual(next,item,'命中覆盖时要返回新对象');
 assert.notEqual(next.definitionBase64,item.definitionBase64,'定义字节必须重写');
 assert.deepEqual(next.powers,[[58,300],[item.power2,item.powerValue2],[item.power3,item.powerValue3]],'powers 派生数组要跟着重算，其余附加属性保留');
 assert.equal(next.attackTimes,item.atk_time+1);

 const after=decodeDefinition(next);
 assert.equal(after.atkMin,1234);
 assert.equal(after.atkMax,5678);
 assert.equal(after.power1,58);
 assert.equal(after.powerValue1,300);
 for(const key of ['id','name','type','grade','reqLv','reqStr','durMax','price','attachCount','itemSet','atkType','atk_time','hitrate','ascensionStar','star','bindPower1','bindPowerValue1','enchantPower1','skillDesc'])
  assert.deepEqual(after[key],before[key],`未覆盖的字段 ${key} 被改动了`);

 // 非武器：换防御类字段
 const armor=official.items.find(i=>i.id===25);
 const nextArmor=applyOverrideToItem(armor,{fields:{def_str:99,def_agi:88,def_mag:77}},`道具 ${armor.id}`);
 const armorAfter=decodeDefinition(nextArmor);
 assert.deepEqual([armorAfter.def_str,armorAfter.def_agi,armorAfter.def_mag],[99,88,77]);
 assert.equal(armorAfter.hitrate,decodeDefinition(armor).hitrate,'防具没有 hitrate 段，不能被写坏');
});

test('非法字段 / 越界值 / 改 id 与 type / 空条目一律点名抛错',()=>{
 assert.throws(()=>compileItemOverrides({28003:{nope:1}}),/不可覆盖字段/);
 assert.throws(()=>compileItemOverrides({28003:{id:1}}),/不允许覆盖/);
 assert.throws(()=>compileItemOverrides({28003:{type:1}}),/不允许覆盖/);
 assert.throws(()=>compileItemOverrides({28003:{handBookItem:true}}),/不允许覆盖/);
 assert.throws(()=>compileItemOverrides({28003:{atkMax:99999}}),/超出范围/);
 assert.throws(()=>compileItemOverrides({28003:{atkMax:1.5}}),/必须是整数/);
 assert.throws(()=>compileItemOverrides({28003:{name:1}}),/必须是字符串/);
 assert.throws(()=>compileItemOverrides({28003:{autoBinding:1}}),/必须是 true \/ false/);
 assert.throws(()=>compileItemOverrides({28003:{}}),/空的/);
 assert.throws(()=>compileItemOverrides({abc:{atkMax:1}}),/非法道具 id/);
 assert.throws(()=>compileItemOverrides({28003:'x'}),/必须是对象/);
 assert.throws(()=>applyItemOverrides(official.items.slice(),new Map([[999999,{note:null,fields:{atkMax:1}}]])),/找不到道具 999999/);

 // 给防具写武器字段、给非装备写覆盖都要拒
 const armor=official.items.find(i=>i.id===25);
 assert.throws(()=>applyOverrideToItem(armor,{fields:{atkMax:1}},`道具 ${armor.id}`),/不是武器/);
 const gem=official.items.find(i=>i.type===30&&i.definitionBase64);
 assert.throws(()=>applyItemOverrides(official.items.slice(),new Map([[gem.id,{note:null,fields:{durMax:1}}]])),/不是装备/);
});

test('没有覆盖时不改任何东西；命中的条目原地替换、别的不动',()=>{
 const items=official.items.slice(),snapshot=JSON.stringify(items);
 assert.deepEqual(applyItemOverrides(items,new Map()),[]);
 assert.equal(JSON.stringify(items),snapshot,'空覆盖不许碰任何条目');

 const compiled=compileItemOverrides({28003:{atkMax:5678,_note:'测试'}});
 const applied=applyItemOverrides(items,compiled);
 assert.deepEqual(applied,['28003']);
 const index=official.items.findIndex(i=>i.id===28003);
 assert.notEqual(items[index],official.items[index],'命中条目应换成新对象');
 assert.equal(items[index].atkMax,5678);
 assert.equal(JSON.stringify(items.filter((_,i)=>i!==index)),JSON.stringify(official.items.filter((_,i)=>i!==index)),'其它条目必须原样');
});

test('把每件装备的现有值原样覆盖一遍，定义字节必须一个字节都不变',()=>{
 // 这条同时守住「字段表 ↔ wire 类型」对得上：kind 写错（byte/short 混了）就会有值越界。
 const bad=[];
 for(const item of equips){
  const fields={};
  for(const field of ITEM_FIELDS){
   const value=item[field.key];
   if(value===undefined||value===null)continue;
   fields[field.key]=field.kind==='bool'?!!value:value;
  }
  let next;
  try{
   next=applyOverrideToItem(item,{fields},`道具 ${item.id}`);
  }catch(error){
   bad.push(`${item.id} ${item.name}：${error.message}`);
   continue;
  }
  if(!bytesOf(next).equals(bytesOf(item)))bad.push(`${item.id} ${item.name}：字节发生变化`);
 }
 assert.deepEqual(bad,[],`以下装备「覆盖成原值」后数据变了：${bad.slice(0,6).join('；')}`);
});

test('data/local-item-overrides.json 结构合法，且每条都能命中官方目录',()=>{
 const raw=JSON.parse(fs.readFileSync(path.join(root,'data','local-item-overrides.json'),'utf8'));
 assert.ok(Array.isArray(raw._readme)&&raw._readme.length,'_readme 说明要保留');
 const compiled=compileItemOverrides(raw.items);
 assert.equal(compiled.size,Object.keys(raw.items).length);
 for(const id of compiled.keys())
  assert.ok(official.items.some(i=>i.id===id),`道具 ${id} 不在官方目录里（服务端启动会报错）`);
 // 真实文件也要能被服务端路径读到（itemOverrides() 会走 fs.readFileSync）
 assert.equal(itemOverrides().size,compiled.size);
});

test('装备编辑器.html 的内嵌目录与当前 data/ 一致',()=>{
 const html=fs.readFileSync(EDITOR_HTML,'utf8');
 assert.ok(html.length>200000,'编辑器 HTML 太小，内嵌数据可能没写进去');
 const embedded=readFromHtml(html);
 const payload=buildPayload();
 assert.equal(embedded.length>1&&JSON.parse(embedded).items.length,payload.items.length);
 assert.equal(embedded,JSON.stringify(payload),'内嵌数据过期：跑 node tools/build-item-editor-data.mjs');
 // 字段表必须与服务端校验共用同一份（编辑器能改的，服务端一定认）
 const keys=new Set(payload.fields.map(f=>f.key));
 assert.deepEqual([...keys],[...ITEM_FIELDS.map(f=>f.key)]);
 assert.deepEqual(new Set(OVERRIDABLE_FIELDS),new Set([...ITEM_FIELDS.map(f=>f.key),'_note']));
 assert.ok(!keys.has('id')&&!keys.has('type')&&!keys.has('handBookItem'),'布局字段不许进编辑器');
});

/* ==========================================================================
   第 87 版：鉴定范围覆盖（identify 段）
   ========================================================================== */

const decodeIdentify=row=>{
 const buf=Buffer.from(row.wireBase64,'base64'),r=new WireReader(buf);
 if(row.petScale!==undefined){r.string();r.int();}
 const count=r.short(),slots=[];
 for(let i=0;i<count;i++){
  const field=r.string(),n=r.short(),options=[];
  for(let j=0;j<n;j++)options.push({power:r.short(),min:r.short(),max:r.short()});
  slots.push({field,options});
 }
 assert.equal(r.pos,buf.length,`道具 ${row.itemId} 的鉴定范围字节没被完整消费`);
 return slots;
};

test('鉴定范围：1008 行抓包字节能被 identifyWire 逐字节重编码',()=>{
 assert.ok(identification.length>900,`鉴定范围行太少：${identification.length}`);
 const bad=[];
 for(const row of identification)
  if(!identifyWire(row).equals(Buffer.from(row.wireBase64,'base64')))bad.push(row.itemId);
 assert.deepEqual(bad,[],`以下鉴定范围重编码后字节不一致：${bad.slice(0,8).join('、')}`);
 assert.deepEqual(IDENTIFY_FIELDS,['power1','power2','power3','bindPower1','bindPower2','power4','power5','power6','power7']);
 for(const field of IDENTIFY_FIELDS)assert.ok(IDENTIFY_FIELD_LABELS[field],`槽位 ${field} 缺中文名`);
});

test('鉴定范围覆盖：只改点名的槽位，slots 与 wireBase64 一起重写',()=>{
 const rows=identification.slice();
 const compiled=compileIdentifyOverrides({28003:{power1:[{power:58,min:100,max:200},{power:1,min:10,max:20}]}});
 assert.deepEqual(applyIdentifyOverrides(rows,compiled),['28003']);
 const index=identification.findIndex(row=>row.itemId===28003);
 assert.ok(index>=0,'样本 28003 应该有鉴定范围');
 assert.notEqual(rows[index],identification[index],'命中行要换成新对象');
 const before=decodeIdentify(identification[index]),after=decodeIdentify(rows[index]);
 assert.deepEqual(after.find(slot=>slot.field==='power1').options,[{power:58,min:100,max:200},{power:1,min:10,max:20}]);
 for(const slot of before)
  if(slot.field!=='power1')assert.deepEqual(after.find(x=>x.field===slot.field),slot,`没点名的槽位 ${slot.field} 被改动了`);
 assert.equal(JSON.stringify(rows.filter((_,i)=>i!==index)),JSON.stringify(identification.filter((_,i)=>i!==index)),'别的行必须原样');

 // 空数组 = 去掉这个槽位（界面上这个鉴定格就没了）
 const rows2=identification.slice();
 applyIdentifyOverrides(rows2,compileIdentifyOverrides({28003:{power1:[]}}));
 const row2=rows2.find(row=>row.itemId===28003);
 assert.equal(row2.slots.length,identification[index].slots.length-1);
 assert.ok(!row2.slots.some(slot=>slot.field==='power1'));
 assert.ok(!decodeIdentify(row2).some(slot=>slot.field==='power1'),'wire 里也要真的没有这个槽位');

 // 覆盖成原值 → 一个字节都不变
 const rows3=identification.slice();
 const same={};
 for(const slot of identification[index].slots)same[slot.field]=slot.options;
 applyIdentifyOverrides(rows3,compileIdentifyOverrides({28003:same}));
 assert.equal(rows3.find(row=>row.itemId===28003).wireBase64,identification[index].wireBase64);
});

test('鉴定范围覆盖：原版没采到范围的装备可以新建，但只认真正的鉴定格/合成格',()=>{
 // 13590「经验加成披风（普通）」power1/power2 都是 121，老抓包里却没有范围行
 const item=official.items.find(i=>i.id===13590);
 assert.ok(item&&item.power1===121&&!identification.some(row=>row.itemId===13590),'样本 13590 的前提变了');
 const rows=identification.slice();
 const applied=applyIdentifyOverrides(rows,compileIdentifyOverrides({
  13590:{power1:[{power:53,min:3,max:30}],power2:[{power:54,min:4,max:40}]}
 }),official.items);
 assert.deepEqual(applied,['13590']);
 const row=rows.find(x=>x.itemId===13590);
 assert.ok(row&&row.slots.length===2,'新建的行要带两个槽位');
 assert.deepEqual(decodeIdentify(row),[
  {field:'power1',options:[{power:53,min:3,max:30}]},
  {field:'power2',options:[{power:54,min:4,max:40}]}
 ]);
 // 宠物装备不许新建（客户端回包形状要多两个字段，抓包没给就没有可靠值）
 const petRow=identification.find(row=>official.items.find(i=>i.id===row.itemId)?.type===41);
 assert.ok(petRow,'抓包里应该有宠物装备的鉴定范围');
 const rowsWithoutPet=identification.filter(row=>row.itemId!==petRow.itemId);
 assert.throws(()=>applyIdentifyOverrides(rowsWithoutPet,compileIdentifyOverrides({
  [petRow.itemId]:{power1:[{power:1,min:1,max:2}]}
 }),official.items),/宠物装备/);
 // 不是鉴定格/合成格的槽位不许新建（写进去也只有客户端认、服务端不认）
 const plain=equips.find(i=>!identification.some(row=>row.itemId===i.id)
  &&![121,131].includes(i.power1)&&![121,131].includes(i.power2));
 assert.ok(plain,'找不到一件没有范围行、也没标鉴定格的装备');
 assert.throws(()=>applyIdentifyOverrides(identification.slice(),compileIdentifyOverrides({
  [plain.id]:{power1:[{power:1,min:1,max:2}]}
 }),official.items),/不是鉴定格/);
});

test('鉴定范围覆盖：非法槽位 / 坏候选 / 找不到道具 一律点名抛错',()=>{
 assert.throws(()=>compileIdentifyOverrides({28003:{powerX:[{power:1,min:1,max:2}]}}),/不认识的槽位/);
 assert.throws(()=>compileIdentifyOverrides({28003:{power1:{power:1,min:1,max:2}}}),/必须是数组/);
 assert.throws(()=>compileIdentifyOverrides({28003:{power1:[1]}}),/必须写成 \{ power, min, max \}/);
 assert.throws(()=>compileIdentifyOverrides({28003:{power1:[{power:1,min:1,max:2,foo:3}]}}),/不认识的键/);
 assert.throws(()=>compileIdentifyOverrides({28003:{power1:[{power:1.5,min:1,max:2}]}}),/必须是整数/);
 assert.throws(()=>compileIdentifyOverrides({28003:{power1:[{power:0,min:1,max:2}]}}),/属性编号/);
 assert.throws(()=>compileIdentifyOverrides({28003:{power1:[{power:1,min:9,max:2}]}}),/大于最大值/);
 assert.throws(()=>compileIdentifyOverrides({28003:{power1:[{power:1,min:1,max:40000}]}}),/超出范围/);
 assert.throws(()=>compileIdentifyOverrides({28003:{}}),/没有任何槽位改动/);
 assert.throws(()=>compileIdentifyOverrides({abc:{power1:[]}}),/非法道具 id/);
 assert.throws(()=>compileIdentifyOverrides({28003:'x'}),/必须写成/);
 assert.throws(()=>applyIdentifyOverrides(identification.slice(),compileIdentifyOverrides({
  999999:{power1:[{power:1,min:1,max:2}]}
 }),official.items),/找不到道具 999999/);
 // 行里没有这个槽位 → 拒绝（否则「改了没反应」）
 const row=identification.find(x=>x.itemId===28003);
 const missing=IDENTIFY_FIELDS.find(field=>!row.slots.some(slot=>slot.field===field));
 assert.ok(missing,'28003 应该缺某个槽位');
 assert.throws(()=>applyIdentifyOverrides(identification.slice(),compileIdentifyOverrides({
  28003:{[missing]:[{power:1,min:1,max:2}]}
 })),/原版没有/);
});

test('data/local-item-overrides.json 的 identify 段结构合法，且每条都能对上官方数据',()=>{
 const raw=JSON.parse(fs.readFileSync(path.join(root,'data','local-item-overrides.json'),'utf8'));
 const compiled=compileIdentifyOverrides(raw.identify||{});
 for(const [id,slots] of compiled){
  const row=identification.find(x=>x.itemId===id);
  if(row){
   for(const field of slots.keys())
    assert.ok(row.slots.some(slot=>slot.field===field),`道具 ${id} 原版没有 ${field} 槽位`);
  }else{
   const item=official.items.find(i=>i.id===id);
   assert.ok(item&&item.type!==41,`道具 ${id} 不在官方目录里（服务端启动会报错）`);
  }
 }
 assert.equal(identifyOverrides().size,compiled.size,'真实文件也要能被服务端路径读到');
});

test('official-data.ensure()：鉴定范围覆盖排在装备覆盖之后、建索引之前',()=>{
 const source=fs.readFileSync(path.join(root,'lib','official-data.mjs'),'utf8');
 const itemAt=source.indexOf('applyItemOverrides(official.items)');
 const identifyAt=source.indexOf('applyIdentifyOverrides(');
 const indexAt=source.indexOf('officialItems:new Map');
 assert.ok(itemAt>0&&identifyAt>0&&indexAt>0,'调用点被改名了，同步更新这条守卫');
 assert.ok(itemAt<identifyAt,'鉴定范围覆盖要读覆盖后的装备定义（新建范围时校验标记位），必须排在后面');
 assert.ok(identifyAt<indexAt,'鉴定范围覆盖必须在建索引之前（catalog-packets / item-affixes 都读这份数据）');
});

test('装备编辑器内嵌了鉴定范围，标记位给的是中文说法',()=>{
 const payload=buildPayload();
 assert.equal(payload.identifyFields.length,9);
 assert.ok(Object.keys(payload.identify).length>900,`内嵌的鉴定范围太少：${Object.keys(payload.identify).length}`);
 for(const [id,slots] of Object.entries(payload.identify)){
  const row=identification.find(x=>x.itemId===Number(id));
  assert.ok(row,`编辑器里的道具 ${id} 在 official.identification 里找不到`);
  const expect={};
  for(const slot of row.slots)expect[slot.field]=slot.options.map(o=>[o.power,o.min,o.max]);
  assert.deepEqual(slots,expect,`道具 ${id} 的内嵌鉴定范围与抓包不一致`);
 }
 // 121/131/181 不能再是 IDENTIFY / COMPOSITE / ENCHANT_ITEM
 assert.match(payload.powers['121'].n,/鉴定/);
 assert.match(payload.powers['131'].n,/合成/);
 assert.match(payload.powers['181'].n,/附魔/);
 for(const id of ['98','111','120','167'])assert.ok(payload.powers[id],`属性编号 ${id} 缺中文名`);
});

test('装备覆盖后仍能鉴定/强化/附魔/赋灵，定义字节完整重编码',()=>{
 // 第 91 版回归：覆盖层改了 definitionBase64，但 item-affixes 原来按抓包 layouts
 // 的原始 SHA-256 校验字节 → 点「鉴定」会报「物品定义已变化，请重新核验鉴定字段」。
 // 覆盖装备现在改走字段重编码路径，不能再要求原始字节哈希。
 const template=officialItems.get(747);
 assert.ok(template&&hasItemOverride(747),'样本 747 必须仍带本地覆盖');
 const slot=identifySlots(template).find(row=>row.options?.length);
 assert.ok(slot,'样本 747 应该有普通鉴定格');
 const option=slot.options[0],affixField=slot.field;
 const valueField=affixField.replace('Power','PowerValue').replace(/^power/,'powerValue');
 const identified=itemWithAffixes(template,{itemId:747,affixes:{[affixField]:{power:option.power,value:option.max}}});
 assert.equal(identified[affixField],option.power);
 assert.equal(identified[valueField],option.max);
 assert.notEqual(identified.definitionBase64,template.definitionBase64,'覆盖装备的鉴定结果必须重写定义字节');
 assert.equal(identified.definitionBase64,Buffer.from(equipmentBytes(identified)).toString('base64'),'重编码结果要能被同一个编码器读回');
 if(hasClient){
  const parsed=decodeDefinition(identified);
  assert.equal(parsed[affixField],option.power);
  assert.equal(parsed[valueField],option.max);
 }

 // 覆盖还可能改名称/说明这类变长字段；不能用抓包时的偏移，必须整份重编码。
 const renamed=applyOverrideToItem(template,{fields:{name:'圣诞衣服·测试长名字',info:'覆盖后的变长说明文字'}},`道具 ${template.id}`);
 const renamedAffixed=itemWithAffixes(renamed,{itemId:747,affixes:{[affixField]:{power:option.power,value:option.max}}});
 if(hasClient){
  const parsed=decodeDefinition(renamedAffixed);
  assert.equal(parsed.name,'圣诞衣服·测试长名字');
  assert.equal(parsed.info,'覆盖后的变长说明文字');
  assert.equal(parsed[affixField],option.power);
  assert.equal(parsed[valueField],option.max);
 }

 const starred=itemWithAffixes(template,{itemId:747,star:1,bound:true});
 assert.equal(starred.star,1);
 assert.equal(starred.def_str,starValue(template.def_str,template.ascensionStar,1,true),'覆盖后的基础防御要参与强化计算');

 const enchantId=[...enchantments.keys()][0];
 assert.ok(enchantId,'附魔资料不能为空');
 const enchanted=itemWithAffixes(template,{itemId:747,enchantment:{itemId:enchantId}});
 for(const [key,value] of Object.entries(enchantmentFields(enchantId)))assert.equal(enchanted[key],value,`附魔字段 ${key} 没写进去`);

 const rune=[...spiritRunes.values()][0];
 assert.ok(rune,'赋灵符资料不能为空');
 const powers=rollSpiritPowers(rune.id,()=>0);
 const sealed=itemWithAffixes(template,{itemId:747,spiritSeals:{Left:{open:true,basePercent:spiritData.basePercent.Left,item:{itemId:rune.id,powers}}}});
 assert.equal(sealed.cssLeftChannel,true);
 assert.deepEqual(sealed.cssLeftItemPower,powers);
});
