import fs from 'node:fs';
import path from 'node:path';
import {battleFontAssets} from './client-battle-font-patch.mjs';
import {applyFashionIcons} from './fashion-icons.mjs';
import {applyLocalPetAssets} from './local-pet-assets.mjs';

export const nativeUiRevision='native-windows-town-map-20260922-v2';

// An empty local storefront is valid. Keep the original parser, cache and
// window notification; do not invent products to satisfy its old size check.
export function patchEmptyNativeShop(source){
 const from='if(p=255&r.getShort(),0>=p)return console.error("ShopItem.getShopItemList() item size = 0???"),[2,null];';
 if(source.split(from).length!==2)throw Error('v305 empty-shop patch mismatch');
 return source.replace(from,'p=65535&r.getShort();');
}

// Add extracted, identical atlas frames to the served manifest. The archived
// official manifest and all map geometry remain byte-for-byte unchanged.
export function nativeResourceManifest(root,raw){
 const manifest=JSON.parse(fs.readFileSync(path.join(raw,'v/gd/305.json')));
 const slices=JSON.parse(fs.readFileSync(path.join(root,'data/native-map-slices.json')));
 for(const item of slices.restored){
  const parts=item.logical.split('/');let node=manifest.url;
  for(const part of parts.slice(0,-1))node=node[part]??=( {} );
  node[parts.at(-1)]??=item.md5;
 }
 // Battle damage / recovery digits: the original pixel glyphs live in
 // client/assets/<hh>/<hash>.png, so register them under url.assets.num the
 // same way the restored atlas frames are. The archived manifest itself is
 // left byte-for-byte untouched (its SHA256 is asserted in tests).
 manifest.url.assets.num??=battleFontAssets();
 // 美容院造型道具的图标图集：子键就是道具编号（900101… / 900201…），
 // 商店列表按 bagIcon 取图时会在这里命中。归档清单同样保持字节不变。
 applyFashionIcons(manifest,root);
 // 自制宠物的换皮贴图与 model：名字补进 sprite 表即可，实体在 client/assets/<hh>/<hash>。
 // 没有产出文件（data/local-pet-assets.json 不存在）时会安静返回 0。
 applyLocalPetAssets(manifest,root);
 return manifest;
}
