import fs from 'node:fs';
import path from 'node:path';

// 美容院造型道具的图标图集（data/fashion-icons.json，由 tools/build-fashion-icons.mjs 生成）。
//
// 商店列表里的道具图标是这样来的：Tool.getIconByData(item) 把 item.bagIcon 转成字符串当
// **资源名**用（analysis/modules/0008.js），所以只要把一个图集注册进资源清单、并让它的
// 子键就是道具编号，列表里就会显示对应的发型/脸型图。
//
// 这里负责把图集补进服务端 / 构建期生成的资源清单（lib/native-ui-restoration.mjs 调用）。
// 注意：client/v/gd/305.json 是归档的原版清单，字节不能动（tests 会断言它的 sha256），
// 所有补充都只发生在内存里生成的那份清单上。
export function fashionIconData(root){
 const file=path.join(root,'data','fashion-icons.json');
 if(!fs.existsSync(file))return null;
 return JSON.parse(fs.readFileSync(file,'utf8'));
}

export function fashionAssetPath(root,hash,extension){
 return path.join(root,'client','assets',hash.slice(0,2),hash+extension);
}

/** 把图集注册进清单；产出文件缺失时返回 null，让调用方保持原样（不影响游戏启动）。 */
export function applyFashionIcons(manifest,root){
 const data=fashionIconData(root);
 if(!data)return null;
 const atlas=fashionAssetPath(root,data.atlas.hash,'.png');
 const table=fashionAssetPath(root,data.sheetTable.hash,'.json');
 if(!fs.existsSync(atlas)||!fs.existsSync(table))return null;
 manifest.url.resource??={};
 manifest.url.resource.ui??={};
 manifest.url.resource.ui[`${data.sheet}.png`]=data.atlas.hash;
 manifest.url.resource.ui[`${data.sheet}.json`]=data.sheetTable.hash;
 manifest.url.assets.data??={};
 manifest.url.assets.data['sheet.json']=data.sheetTable.hash;
 manifest.res.resources.push({
  name:data.sheet,
  type:'sheet',
  url:data.url,
  subkeys:Object.keys(data.atlas.frames).join(','),
 });
 // 把图集挂到每一个资源组上：商店、背包这些界面各自加载的组不一样，挂满之后无论先打开
 // 哪个界面图集都会一起就绪（第一次加载过后 getRes 命中缓存，后面各组几乎零成本）。
 // 同时保留一个同名独立组，方便客户端主动预载。
 for(const group of manifest.res.groups){
  if(!group.keys)group.keys=data.sheet;
  else if(!group.keys.split(',').includes(data.sheet))group.keys+=','+data.sheet;
 }
 manifest.res.groups.push({name:data.sheet,keys:data.sheet});
 return data;
}
