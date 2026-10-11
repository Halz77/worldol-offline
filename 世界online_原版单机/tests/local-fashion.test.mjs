// 美容院本地造型道具（lib/local-fashion.mjs）的守卫测试。
//
// 道具清单来自 data/fashion-icons.json（由 tools/build-fashion-icons.mjs 按
// 「世界OL_源码」下的 face_png_*/hair_png_* 贴图目录生成），一件道具对一张贴图：
//   发型 = 8*style - 7 + 4*gender + color   （gender 0 = 男，1 = 女；color 0..3）
//   脸型 = 1000 + 8*style - 7 + 4*gender
// 贴图本身由 tests/fashion-icons.test.mjs 守着；这里只管「道具」这一侧：
// 数量、编号、外观位域、商店清单。
import test from 'node:test';
import assert from 'node:assert/strict';
import {localFashion,appearanceShops,APPEARANCE_ITEM_IDS,FASHION_ICON_IDS} from '../lib/local-fashion.mjs';
import {officialItems} from '../lib/official-data.mjs';
import {readPayload} from '../tools/build-fashion-icons.mjs';

const catalog=readPayload();

test('一件道具对一张贴图：道具数量 = 贴图清单长度',()=>{
 const added=localFashion([...officialItems.values()]);
 assert.equal(added.length,catalog.hair.length+catalog.faces.length);
 assert.equal(appearanceShops.find(s=>s.id===51).items.length,catalog.hair.length);
 assert.equal(appearanceShops.find(s=>s.id===52).items.length,catalog.faces.length);
 assert.equal(appearanceShops.find(s=>s.id===55).items.length,catalog.hair.length);
 assert.ok(catalog.hair.length>0&&catalog.faces.length>0);
});

test('道具按实际顺序编号，名称就是序号',()=>{
 const added=localFashion([...officialItems.values()]);
 const hair=added.slice(0,catalog.hair.length),face=added.slice(catalog.hair.length);
 for(const [index,item] of hair.entries()){
  assert.equal(item.id,catalog.hair[index].id);
  assert.equal(item.name,`发型 ${index+1}`);
 }
 for(const [index,item] of face.entries()){
  assert.equal(item.id,catalog.faces[index].id);
  assert.equal(item.name,`脸型 ${index+1}`);
 }
});

test('fashIcon1 只写自己的那一段外观位，且能还原出贴图的样式/颜色',()=>{
 const added=localFashion([...officialItems.values()]);
 for(const item of added){
  const fash=Number(item.fashIcon1);
  assert.ok(fash>0&&fash<2**32,'fashIcon1 要落在低 32 位外观域');
  const entry=[...catalog.hair,...catalog.faces].find(x=>x.id===item.id);
  const isHair=catalog.hair.some(x=>x.id===item.id);
  if(isHair){
   assert.equal((fash>>>7)&0xf,entry.style,'发型样式位');
   assert.equal((fash>>>11)&0x3,entry.color,'发色位');
   assert.equal((fash>>>13)&0xf,0,'发型道具不能动脸型位');
  }else{
   assert.equal((fash>>>13)&0xf,entry.style,'脸型样式位');
   assert.equal((fash>>>7)&0x1f,0,'脸型道具不能动发型位');
  }
 }
});

test('道具编号 / 图标号与目录一致，且不与既有道具冲突',()=>{
 const added=localFashion([...officialItems.values()]);
 const ids=added.map(item=>item.id);
 assert.equal(new Set(ids).size,ids.length,'编号不能重复');
 for(const item of added){
  assert.equal(item.bagIcon,item.id,'bagIcon 就是图集子键 = 道具编号');
  assert.ok(FASHION_ICON_IDS.has(item.id));
  assert.ok(officialItems.has(item.id),`道具 ${item.id} 应该在目录里`);
  assert.equal(typeof item.definitionBase64,'string');
 }
});

test('APPEARANCE_ITEM_IDS 与 appearanceShops 的清单一致',()=>{
 const fromShops=new Set(appearanceShops.flatMap(s=>s.items));
 assert.equal(APPEARANCE_ITEM_IDS.size,fromShops.size);
 assert.equal(APPEARANCE_ITEM_IDS.size,catalog.itemIds.length);
 for(const id of fromShops)assert.ok(APPEARANCE_ITEM_IDS.has(id),`${id} 应该在 APPEARANCE_ITEM_IDS 里`);
});
