import fs from 'node:fs';
import path from 'node:path';

/**
 * 自制宠物的换皮贴图 / model（data/local-pet-assets.json，由 tools/build-pet-reskin.mjs 产出）。
 *
 * 客户端拿资源是「资源名 → 内容哈希」两步查：先查清单拿到哈希，再去 client/assets/<hh>/<哈希>
 * 取实体。所以新增贴图只要把名字补进清单、实体丢进 assets 目录即可，与美容院图标同一套规矩。
 *
 * 归档的 client/v/gd/305.json 字节不能动（tests 断言它的 sha256），所有补充只发生在内存里
 * 生成的这份清单上。
 */
export function localPetAssetData(root){
 const file=path.join(root,'data','local-pet-assets.json');
 if(!fs.existsSync(file))return null;
 return JSON.parse(fs.readFileSync(file,'utf8'));
}

export function localPetAssetPath(root,hash,extension){
 return path.join(root,'client','assets',hash.slice(0,2),hash+extension);
}

/**
 * 把换皮资源补进清单。
 * @returns {number} 实际登记的资源个数（0 表示没有可登记的）
 */
export function applyLocalPetAssets(manifest,root){
 const data=localPetAssetData(root);
 if(!data)return 0;
 const sprite=manifest.url.assets.sprite??={};
 let count=0;
 for(const [name,hash] of Object.entries(data.fragments||{})){
  // 缺文件就跳过而不是抛错：client/ 不入库，换台机器重跑工具就能重建，
  // 但绝不能因为少了张贴图就让整个游戏起不来。
  if(!fs.existsSync(localPetAssetPath(root,hash,'.png')))continue;
  (sprite.fragment??={})[name]=hash;count++;
 }
 for(const [name,hash] of Object.entries(data.models||{})){
  if(!fs.existsSync(localPetAssetPath(root,hash,'.json')))continue;
  (sprite.model??={})[name]=hash;count++;
 }
 return count;
}
