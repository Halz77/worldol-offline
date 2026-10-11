import {Reader,Writer} from './codec.mjs';

export const bossHubRevision='boss-hub-277-20260923-v1';
export const BOSS_HUB_MAP_ID=277;

// 「boss直达」入口：风雪之城（37）的传送 NPC 小白（10）。
// 原版 wire 里这个 npcType=5 的传送菜单只有一项（征战广场 945），这里补上 277。
// 只改菜单与两句招呼文案，不动其它 NPC、也不动原件里已录到的任何字节。
const PORTAL={mapId:37,npcId:10};
const ENTRY={label:'boss直达入口',target:BOSS_HUB_MAP_ID,gx:20,gy:37};
const PORTAL_TEXT={
 welcome:'挑战霸天虎可通过我进行传送哦！也可以直达千万级 BOSS 会场。',
 talkDetail:'可通过我进入征战广场挑战霸天虎，或直达「boss直达」挑战千万级 BOSS 哦~副本有些难度，建议组队进行。'
};

// v305 的 NPC 传送 wire 布局（与 lib/open-portals.mjs 的解析一一对应）：
//   [14 字节固定头] 名字(utf) 招呼(utf) 对话(utf) 状态(byte) 朝向,x,y,范围x,范围y
//   菜单数(byte) { 菜单名(utf) 目标地图(short) 目标x(byte) 目标y(byte) 3 字节需求条件 } ×N
//   末尾 3 字节填充
// 完全按原 wire 自己解析出来的菜单重建，不依赖 npc 上的 jumpMap* 数组（调用方会在
// 改名之前先改数组，直接读数组会前后不一致）。改完之后先用原菜单重建一次，必须与
// 原 wire 逐字节相同 —— 这样能证明字段顺序的假设成立，不会写出坏包。
function rebuildPortalWire(npc){
 const body=Buffer.from(npc.wireBase64,'base64'),r=new Reader(body);
 const header=Buffer.from(body.subarray(0,14));
 r.take(14);
 const name=r.utf(),welcome=r.utf(),talkDetail=r.utf();
 const status=r.byte()&255,direction=r.byte()&255,x=r.byte()&255,y=r.byte()&255,rangeX=r.byte()&255,rangeY=r.byte()&255;
 if(status!==npc.status||direction!==npc.direction||x!==npc.x||y!==npc.y)throw Error(`boss hub portal fields mismatch: ${npc.mapId}:${npc.id}`);
 if(status&8)throw Error(`boss hub portal ${npc.mapId}:${npc.id} has an unsupported optional block`);
 const count=r.byte()&255,menu=[];
 for(let i=0;i<count;i++){
  const label=r.utf(),target=r.short(),gx=r.byte()&255,gy=r.byte()&255,pad=r.take(3);
  if(body.subarray(pad,pad+3).some(byte=>byte!==0))throw Error(`boss hub portal ${npc.mapId}:${npc.id} has a non-zero requirement block`);
  menu.push({label,target,gx,gy});
 }
 if(r.pos!==body.length-3||body.subarray(r.pos).some(byte=>byte!==0))throw Error(`boss hub portal ${npc.mapId}:${npc.id} has an unexpected trailer`);
 // 解析结果必须与 npc 上已录到的菜单一致，否则说明这份 wire 不是这个 npc 的。
 if(count!==npc.menuJumpMap.length)throw Error(`boss hub portal ${npc.mapId}:${npc.id} menu count mismatch`);
 for(let i=0;i<count;i++)if(menu[i].label!==npc.menuJumpMap[i]||menu[i].target!==npc.jumpMapID[i]||menu[i].gx!==npc.jumpMapGx[i]||menu[i].gy!==npc.jumpMapGy[i])throw Error(`boss hub portal ${npc.mapId}:${npc.id} menu entry ${i} mismatch`);
 const build=(rows,welcomeText,talkText)=>{
  const w=new Writer().raw(header).utf(name).utf(welcomeText).utf(talkText)
   .byte(status).byte(direction).byte(x).byte(y).byte(rangeX).byte(rangeY)
   .byte(rows.length);
  for(const row of rows)w.utf(row.label).short(row.target).byte(row.gx).byte(row.gy).raw(Buffer.alloc(3));
  return w.raw(Buffer.alloc(3)).done();
 };
 if(!build(menu,welcome,talkDetail).equals(body))throw Error(`boss hub portal ${npc.mapId}:${npc.id} rebuild mismatch`);
 return build([...menu,{label:ENTRY.label,target:ENTRY.target,gx:ENTRY.gx,gy:ENTRY.gy}],PORTAL_TEXT.welcome,PORTAL_TEXT.talkDetail).toString('base64');
}

export function applyBossHub(official){
 const map=official.maps.find(m=>m.id===PORTAL.mapId);
 const npc=map?.npcs.find(n=>n.id===PORTAL.npcId);
 if(!npc||npc.npcType!==5||!npc.jumpMapID?.length)throw Error('boss hub portal npc is missing or changed');
 const hub=official.maps.find(m=>m.id===BOSS_HUB_MAP_ID);
 if(!hub)throw Error('boss hub map '+BOSS_HUB_MAP_ID+' is missing');
 // 幂等：已经补过菜单就只做校验，不再重排一次 wire。
 if(!npc.menuJumpMap.includes(ENTRY.label)){
  // 先按原 wire 重建一次（内部会校验解析结果与自己一致），拿到新 wire 再改数组：
  // 反过来做，重建时的「解析结果 vs npc 数组」校验就会对不上。
  const wire=rebuildPortalWire(npc);
  npc.menuJumpMap=[...npc.menuJumpMap,ENTRY.label];
  npc.jumpMapID=[...npc.jumpMapID,ENTRY.target];
  npc.jumpMapGx=[...npc.jumpMapGx,ENTRY.gx];
  npc.jumpMapGy=[...npc.jumpMapGy,ENTRY.gy];
  npc.jumpMapReqMissionID=[...npc.jumpMapReqMissionID,0];
  npc.jumpMapReqMissionState=[...npc.jumpMapReqMissionState,0];
  npc.welcome=PORTAL_TEXT.welcome;
  npc.talkDetail=PORTAL_TEXT.talkDetail;
  npc.wireBase64=wire;
  npc.localBossHubEntry=true;
 }
 const index=npc.jumpMapID.indexOf(BOSS_HUB_MAP_ID);
 if(index<0||npc.jumpMapGx[index]!==ENTRY.gx||npc.jumpMapGy[index]!==ENTRY.gy)throw Error('boss hub portal entry mismatch');
 return official;
}
