import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Writer} from '../lib/codec.mjs';
import {towerShopList,towerShopBuy,towerShopSummary,TOWER_SHOP_ID} from '../lib/tower-shop.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const hasData=fs.existsSync(path.join(root,'data','tower-shop.json'));
const skip={skip:hasData?false:'没有 data/tower-shop.json，跳过'};

const money=()=>({id:9001,inventory:[],towerPoint:1000,coins:0,gold:0,silver:0,hp:1000,mp:500,level:90,skills:{}});

test('永泽塔商店：shopId 23722，商品表能解析出条目（缺定义的会自动跳过）',skip,()=>{
 assert.equal(TOWER_SHOP_ID,23722,'客户端常量 SHOP_TOWER_ID');
 const s=towerShopSummary();
 assert.equal(s.shopId,23722);
 assert.equal(s.rows,4,'移植后保留 4 件（御宠圣物依赖未引入的装备包，已移除）');
 for(const it of s.items){
  assert.ok(it.point>0,'每件都要有勋章价格');
  assert.ok(it.name,'每件都要能取到名字');
 }
});

test('12020 列表包：先发余额与条数，每条带完整物品定义',skip,()=>{
 const p=money();
 const w=towerShopList(new Writer(),p).done();
 assert.ok(w.length>100,'列表包要有内容');
 // byte(0) + int(余额) + short(条数)
 assert.equal(w.readUInt8(0),0);
 assert.equal(w.readInt32BE(1),1000,'余额要原样下发');
 assert.equal(w.readUInt16BE(5),4,'条数');
});

test('12021 购买：扣勇气勋章、物品进背包、余额写回角色',skip,()=>{
 const p=money();
 const r=towerShopBuy(p,TOWER_SHOP_ID,28005,1);
 assert.equal(r.ok,true,r.message);
 assert.equal(p.towerPoint,700,'扣 300');
 assert.ok((p.inventory||[]).length>=1,'物品要进背包');
 assert.equal(p.inventory[0].itemId,28005);
 assert.ok(Number.isInteger(r.slot)||r.slot===-1);
});

test('12021 购买：勋章不足 / 商店号不对 / 商品不存在都要拒绝且不改角色',skip,()=>{
 const poor={id:9001,inventory:[],towerPoint:10,coins:0,gold:0,silver:0,hp:1000,mp:500,level:90,skills:{}};
 const before=JSON.stringify(poor);
 const r1=towerShopBuy(poor,TOWER_SHOP_ID,28005,1);
 assert.equal(r1.ok,false);
 assert.match(r1.message,/勇气勋章不足/);
 assert.equal(JSON.stringify(poor),before,'失败时不能扣款也不能加物品');

 const r2=towerShopBuy(poor,99999,28005,1);
 assert.equal(r2.ok,false);
 assert.match(r2.message,/尚未接入/);

 const p=money();
 const r3=towerShopBuy(p,TOWER_SHOP_ID,1,1);
 assert.equal(r3.ok,false);
 assert.match(r3.message,/不存在/);
 assert.equal(p.towerPoint,1000,'失败不能扣款');
});

test('12021 购买：数量被夹在 1..99',skip,()=>{
 const p=money();
 p.towerPoint=100000;
 const r=towerShopBuy(p,TOWER_SHOP_ID,28005,999);
 assert.equal(r.ok,true);
 assert.equal(r.n,99,'上限 99');
 assert.equal(p.towerPoint,100000-300*99);
});
