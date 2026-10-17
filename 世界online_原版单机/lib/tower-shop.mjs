import fs from 'node:fs';
import {equipment} from './restoration.mjs';
import {officialItems} from './official-data.mjs';
import {itemDefinition} from './restoration-packets.mjs';
import {applyLootDelivery} from './loot.mjs';

/**
 * 永泽塔「兑换商店」——客户端原生支持（SHOP_TOWER_ID=23722），协议：
 *   12020 列表：byte(0) int(勇气勋章) short(条数)，每条 itemDefinition + int(价格) byte(0) short(maxBuy) short(allCount)
 *   12021 购买：请求 short(shopId) int(itemId) byte(quantity)
 *               响应 byte(0) int(itemId) short(拿到物品的背包格) byte(数量) int(新余额) short(maxBuy) short(allCount)
 * 货币 = 勇气勋章（角色字段 p.towerPoint）。商品表 data/tower-shop.json（社区按 2026-10-16 用户提供的清单整理）。
 *
 * ⚠️ 商品表必须在**调用时**才去查 equipment / officialItems：本模块被 import 的时候那两张表
 *    可能还没建好（TDZ），社区版的注释里专门踩过这个坑。
 * ⚠️ 读文件不用 fs.existsSync 守门（APK 里 VFS 的 existsSync 恒 false，见第 57 版）。
 */

export const TOWER_SHOP_ID=23722;

let built=null;
function ensure(){
 if(built)return built;
 let raw;
 try{
  raw=JSON.parse(fs.readFileSync(new URL('../data/tower-shop.json',import.meta.url),'utf8'));
 }catch(error){
  if(error&&error.code==='ENOENT'){built={revision:null,items:[]};return built;}
  throw error;
 }
 built={revision:raw.revision||null,items:Array.isArray(raw.items)?raw.items:[]};
 return built;
}

/** 惰性解析商品（缺定义的商品跳过，不让整个商店炸掉）。 */
function rows(){
 const out=[];
 for(const row of ensure().items){
  const itemId=Number(row.itemId);
  const e=equipment.get(itemId)||officialItems.get(itemId);
  if(!e)continue;
  out.push({
   itemId,
   point:Number(row.point)||0,
   maxBuy:Number.isInteger(row.maxBuy)?row.maxBuy:-1,
   allCount:Number.isInteger(row.allCount)?row.allCount:-1,
   e,
  });
 }
 return out;
}

/** 12020：列表。 */
export function towerShopList(w,p){
 const list=rows();
 w.byte(0).int(p.towerPoint||0).short(list.length);
 for(const row of list){
  itemDefinition(w,row.e);
  w.int(row.point).byte(0).short(row.maxBuy).short(row.allCount);
 }
 return w;
}

/**
 * 12021 的业务部分：扣勇气勋章并把物品发进背包。
 * 返回 {ok:true,n,row,slot} 或 {ok:false,message}。不负责存档（调用方套事务）。
 */
export function towerShopBuy(p,shopId,itemId,quantity){
 if(Number(shopId)!==TOWER_SHOP_ID)return {ok:false,message:'这个积分商店尚未接入。'};
 const row=rows().find(x=>x.itemId===Number(itemId));
 if(!row)return {ok:false,message:'这个兑换项不存在。'};
 const n=Math.max(1,Math.min(99,Number(quantity)||1));
 const need=row.point*n;
 if((p.towerPoint||0)<need){
  return {ok:false,message:'勇气勋章不足，需要 '+need+'（现有 '+(p.towerPoint||0)+'）。'};
 }
 p.towerPoint=(p.towerPoint||0)-need;
 const delivery=applyLootDelivery(p,[{id:row.itemId,quantity:n}]);
 const added=(delivery&&delivery.added)||[];
 const instance=added.map(x=>x&&x.instance).filter(Boolean)[0];
 return {ok:true,n,row,slot:instance&&Number.isInteger(instance.slot)?instance.slot:-1};
}

/** 给测试/诊断用：读到了几件商品、余额字段是否可写。 */
export function towerShopSummary(){
 const list=rows();
 return {revision:ensure().revision,shopId:TOWER_SHOP_ID,rows:list.length,
  items:list.map(r=>({itemId:r.itemId,name:r.e.name,point:r.point}))};
}
