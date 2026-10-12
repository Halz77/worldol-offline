/**
 * 宠物改名 —— CG_PET_CHANGE_NAME（15511）。
 *
 * 客户端那条链路一直在，只是服务端从来没接过：
 *   宠物面板「改名」→ showInput("修改宠物名字","请输入新宠物名字") →
 *   doPetChangeNameMsg() → createPetChangeName(petItem.slotPos, name) → 15511。
 * 服务端以前既不在分派链里、也没有这个号的分支，所以点确认之后石沉大海。
 *
 * 包结构（`createPetChangeName`：`putShort(slotPos); putString(name)`）：
 *   入站   short 宠物所在的背包槽位（1 = 出战，30+ = 休息） / string 新名字
 *   回包   byte 状态（负数 = 失败，后面跟错误串）
 *          int 黄金 / int 银 / int 铜   —— 客户端 `ModelVo.setPlayerMoney(m1,m2,m3)`
 *
 * 名字存在**宠物自己身上**（`pet.name`）：`petDetail()` 第一段就是 `string(p.name)`，
 * 背包里的宠物道具（`petItemDefinition`）也直接写 `p.name`。所以改名只要改这一处，
 * 下次发背包/宠物详情就带过去了；客户端收到回包后自己也 `setName()` 再刷新一次。
 *
 * 有意**不加「请先结束战斗」这道门**：战斗是客户端本地跑完再把结算包发上来的，
 * 改名只动宠物名字，不碰血量/技能/背包，改成战斗里也能改（玩家要的正是这个）。
 * 与宠物封印、逐级遗忘那些会改数值的操作不是一回事。
 */
import {Writer} from './codec.mjs';

/** 名字长度上限。客户端输入框默认 12 字（`InputAlert` 的 `maxChars || 12`），
 *  这里放宽到 16，与角色改名同一条口径 —— 服务端不比客户端更严。 */
export const PET_NAME_LIMIT=16;

/** 把槽位解析成宠物：出战宠物的槽位是 1，休息中的是 30 起的背包槽。 */
export function petAtSlot(p,slot){
 return p.inventory.find(i=>i.slot===slot&&i.pet)?.pet||null;
}

export function normalizePetName(name){
 const trimmed=name.trim();
 if(!trimmed)throw Error('宠物名字不能为空。');
 if([...trimmed].length>PET_NAME_LIMIT)throw Error(`宠物名字最多 ${PET_NAME_LIMIT} 个字。`);
 // 名字会原样进背包条目与宠物详情，控制字符（换行、制表…）会把列表排版冲掉。
 if(/[\u0000-\u001f\u007f]/.test(trimmed))throw Error('宠物名字不能包含换行等特殊字符。');
 return trimmed;
}

export function handlePetRename(type,r,context,{store,send,log}){
 if(type!==15511)return false;
 const p=context.role;
 try{
  if(!p)throw Error('请先进入角色再给宠物改名。');
  const slot=r.short(),name=r.string();
  if(r.pos!==r.b.length)throw Error('宠物改名请求格式有误，请重试。');
  const pet=petAtSlot(p,slot);
  if(!pet)throw Error('这个位置没有宠物。');
  const renamed=normalizePetName(name);

  const previous=pet.name;
  try{pet.name=renamed;store.save();}
  catch(error){pet.name=previous;throw error;}
  send(type,new Writer().byte(0).int(p.gold||0).int(p.silver||0).int(p.coins||0));
  log('pet-renamed',{role:p.id,slot,pet:pet.uid,name:renamed});
 }catch(error){
  send(type,new Writer().byte(-1).string(error.message));
  log('pet-rename-rejected',{role:p?.id,error:error.message});
 }
 return true;
}
