import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

export const battleFontRevision='battle-font-num-v1';

// 把战斗飘字（伤害 / 暴击 / HP 回复 / MP 回复）从 egret.TextField + Arial
// 换成原始像素数字图。素材来自「世界OL字体替换工具包」：
//   - client/assets/<hh>/<hash>.png          41 张字形图（4 套 0-9 + 暴击爆炸图）
//   - client/v/gd/305.json 的 url.assets.num 逻辑名 -> hash 映射
//   - 本目录下的 module180 文件               改好的 0180 渲染模块
//
// 0180 模块原本是一个 egret.TextField 子类，靠 fontFamily="Arial" 画数字；
// 替换版改成 DisplayObjectContainer，按位图拼接数字，并保留 text /
// textWidth / textHeight 三个对外接口。字形资源没加载出来时会走 tfmode()
// 退回原来的文字渲染，不会崩、不会白屏。
//
// 调参在 client-battle-font-module180.js 顶部：
//   NSC   整体缩放（1 = 原始大小，2 = 大字版）
//   NBOW/NBOH  爆炸图宽高；f.x=-NBOW*NSC+30*NSC 里的 30 控制爆炸图左置重叠量
//
// 模块文本含大量转义与引号，所以不做字符串内嵌，改为同目录文件读取，
// 保证字节级一致。两份文件成对保存（orig 是锚点快照，不是运行时依赖）。
const here=path.dirname(fileURLToPath(import.meta.url));
const ORIG=path.join(here,'client-battle-font-module180.orig.js');
const REPL=path.join(here,'client-battle-font-module180.js');
const MAP=path.join(here,'client-battle-font-manifest.json');

// 41 张字形图的「逻辑名 -> 引擎 hash」映射，供 nativeResourceManifest() 并入
// 下发的资源清单（url.assets.num）。官方存档清单 client/v/gd/305.json 保持
// 字节不变，由 native-restoration 测试用 SHA256 守着，不能往里写。
export function battleFontAssets(){
  return JSON.parse(fs.readFileSync(MAP,'utf8'));
}

export function patchBattleFont(source){
  const from=fs.readFileSync(ORIG,'utf8').trim();
  const to=fs.readFileSync(REPL,'utf8').trim();
  const hits=source.split(from).length-1;
  if(hits!==1)throw Error('battle font 0180 module mismatch: 锚点出现 '+hits+' 次');
  return source.replace(from,to);
}
