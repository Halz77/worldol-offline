import {homeFeatureData as data,homeFeatureCatalogs,homeFeatureRevision,vipBenefits,vipPending,towerPreviews} from './home-feature-data.mjs';
import {dailyKey,dailySnapshot} from './daily-activity.mjs';
import {equipment,planItemRewards} from './restoration.mjs';
import {official,officialMaps,origins} from './official-data.mjs';
import {isNewbieMission} from './newbie-missions.mjs';
import {planCommerceAction} from './native-commerce.mjs';

export const homeEntries=[
 ['charge','充值','原版首充、每日首充、特惠礼包和充值奖励；单机免费领取并保存。'],
 ['welfare','福利','在线奖励、VIP每日礼包与成长礼包。'],
 ['special','特惠','已录制的每日、每周和每月礼包，单机免费领取并保存限购次数。'],
 ['lottery','抽奖','已恢复录制奖池和价格；概率与抽奖结算待补。'],
 ['notice','公告','单机版欢迎公告与非商用说明。'],
 ['tower','永泽塔','普通120层、困难12关及160种怪物属性预览；阵容、技能、AI与场景待补。'],
 ['mine','矿洞','已采集5个矿点入口及次数配置；产出、宠物驻守与战斗规则待补。'],
 ['trial','试炼','试炼关卡、战斗配置与奖励结算待补。'],
 ['bulk','超值','超值商品目录、价格与奖励配置待补。'],
 ['buddy','聚义酒馆','伙伴招募、成长、技能及抽取概率待补；可使用已实装的军团五人队伍。'],
 ['daily','日常','日常任务、前置任务、完成进度和活跃奖励。'],
 ['newbie','新手','查看已录制的新手任务及当前完成进度。'],
 ['mail','邮件','本地系统收件箱；其他玩家邮件与附件投递待补。'],
 ['country','国家','个人城市已可使用；国家建设、成员管理、国战与国家奖励待补。'],
 ['bag','背包','使用、穿戴、强化、合成、鉴定、镶嵌与整理。'],
 ['role','人物','属性、技能、自动技能、天赋、神器与VIP。'],
 ['pet','宠物','宠物出战、装备、技能及属性。'],
 ['map','地图','进入已恢复的地图。'],
 ['shop','商店','已收录的装备、材料与技能商店。'],
 ['city','主城','个人城市、等级、繁荣度、军力、金库及城市任务。'],
].map(([id,name,description])=>({id,name,description,pending:['lottery','mine','trial','bulk','buddy','country'].includes(id)}));
export function homeState(p,now=Date.now()){
 const stored=p.homeFeatures||{},day=dailyKey(now);
 return {version:1,vipGrowthClaimed:!!stored.vipGrowthClaimed,vipExperience:stored.vipExperience||0,
  day,...(stored.day===day?{vipDailyClaimed:!!stored.vipDailyClaimed,onlineClaimed:[...(stored.onlineClaimed||[])],onlineSeconds:stored.onlineSeconds||0}:{vipDailyClaimed:false,onlineClaimed:[],onlineSeconds:0})};
}
export function onlineSeconds(p,context,now=Date.now()){
 const state=homeState(p,now),start=context?.homeOnlineStart;
 const midnight=Date.parse(state.day+'T00:00:00+08:00');
 return Math.min(86400,state.onlineSeconds+(Number.isFinite(start)?Math.max(0,Math.floor((now-Math.max(start,midnight))/1000)):0));
}
export function checkpointOnline(p,context,now=Date.now()){
 const seconds=onlineSeconds(p,context,now);p.homeFeatures={...homeState(p,now),onlineSeconds:seconds};if(context)context.homeOnlineStart=now;
}
const itemSummary=i=>({id:i.id,name:i.name||equipment.get(i.id)?.name||String(i.id),quantity:i.quantity||1});
export function homeSnapshot(p,context,now=Date.now()){
 const state=homeState(p,now),vip=vipBenefits(p),seconds=onlineSeconds(p,context,now);
 return {revision:homeFeatureRevision,role:p.id,entries:homeEntries,day:state.day,
  balance:{gold:p.gold||0,silver:p.silver||0,coins:p.coins||0},vip:{...vip,experience:state.vipExperience,nextLevelExp:vip.level<=1?data.vip.nextLevelExp:null,pending:vipPending,dailyClaimed:state.vipDailyClaimed,growthClaimed:state.vipGrowthClaimed,gift:itemSummary(data.vip.items[2]),growthGift:itemSummary(data.vip.items[1])},
  online:{seconds,rewards:(data.online?.levels||[]).map(r=>({minutes:r.minutes,items:r.items.map(itemSummary),currencies:r.currencies,claimed:state.onlineClaimed.includes(r.minutes),ready:seconds>=r.minutes*60,pending:r.currencies.some(c=>![-1,-2,-3].includes(c.id))})).sort((a,b)=>a.minutes-b.minutes)},
  tower:data.tower.map(t=>({mode:t.mode,levels:t.levels.map(f=>({...f,previewAvailable:towerPreviews.has(f.id)}))})),
  dungeons:official.maps.filter(m=>!m.cityTemplate).map(m=>({id:m.id,name:m.name,npcs:m.npcs.length,missions:official.missions.filter(q=>origins(q).some(o=>o.mapId===m.id)).length})),
  daily:dailySnapshot(p,now),mail:[],lottery:homeFeatureCatalogs.lottery,mine:homeFeatureCatalogs.mine,
  newbie:official.missions.filter(q=>isNewbieMission(q.id)).map(q=>({id:q.id,name:q.name,level:q.level,completed:(p.quests?.completed||[]).includes(q.id),active:!!p.quests?.active?.[q.id],locations:origins(q).map(o=>({...o,mapName:officialMaps.get(o.mapId)?.name}))})),
 };
}
function money(p,key,amount){
 if(!['gold','silver','coins'].includes(key)||!Number.isSafeInteger(amount)||amount<=0)throw Error('请输入有效的货币和正整数数量。');
 const value=(p[key]||0)+amount;if(!Number.isSafeInteger(value)||value>2147483647)throw Error('超过当前存档可保存的货币范围。');p[key]=value;
}
export function planHomeAction(p,request,context,now=Date.now()){
 if(request?.action==='commerce'){const result=planCommerceAction(p,request,now);result.next.homeFeatures=homeState(result.next,now);return result;}
 if(!request||!['charge','vip-daily','vip-growth','online','vip-exp'].includes(request.action))throw Error('未知功能操作。');
 const next=structuredClone(p),state=homeState(next,now);next.homeFeatures=state;
 const result={next,items:[],currencies:{gold:0,silver:0,coins:0},action:request.action};
 if(request.action==='charge'){money(next,request.currency,request.amount);result.currencies[request.currency]=request.amount;}
 else if(request.action==='vip-exp'){
  if(vipBenefits(p).level!==1)throw Error('已核实的经验升级仅包含VIP1至VIP2，其他等级待补。');
  if(state.vipExperience>=data.vip.nextLevelExp)throw Error('VIP1经验已满，请将VIP等级设置为2。');
  if((p.gold||0)<500)throw Error('需要500黄金兑换500VIP经验。');
  next.gold-=500;state.vipExperience=Math.min(data.vip.nextLevelExp,state.vipExperience+500);if(state.vipExperience===data.vip.nextLevelExp)next.vipLevel2=2;
  result.currencies.gold=-500;
 }else if(request.action.startsWith('vip-')){
  if(!vipBenefits(p).level)throw Error('请先开通VIP。');
  const daily=request.action==='vip-daily',field=daily?'vipDailyClaimed':'vipGrowthClaimed';if(state[field])throw Error(daily?'今天已经领取VIP礼包。':'这个角色已经领取成长礼包。');
  // Only the VIP1 gift definition is known. Higher ranks can claim this same
  // explicitly labelled base gift; their unrecorded reward table stays pending.
  result.items=[{id:data.vip.items[daily?2:1].id,quantity:1}];state[field]=true;
 }else{
  const reward=data.online?.levels.find(r=>r.minutes===request.minutes);if(!reward)throw Error('没有这档在线奖励。');
  if(state.onlineClaimed.includes(reward.minutes))throw Error('今天已经领取这档在线奖励。');
  if(onlineSeconds(p,context,now)<reward.minutes*60)throw Error('当前在线时长不足。');
  if(reward.currencies.some(c=>![-1,-2,-3].includes(c.id)))throw Error('这档奖励的能量精华账户尚待补齐，暂不领取。');
  result.items=reward.items.map(i=>({id:i.id,quantity:i.quantity}));
  for(const c of reward.currencies){const key={[-1]:'gold',[-2]:'silver',[-3]:'coins'}[c.id];money(next,key,c.quantity);result.currencies[key]+=c.quantity;}
  state.onlineClaimed.push(reward.minutes);
 }
 const plan=planItemRewards(next,result.items);next.inventory=plan.inventory;result.added=plan.added;return result;
}
export function towerInfo(mode){
 const tower=data.tower.find(t=>t.mode===mode);if(!tower)throw Error('没有这个爬塔模式。');
 return {id:0,leftCount:0,totalCount:0,score:0,modeType:mode,isMock:false,isChallenge:false,sweepItem:tower.sweepItem,
  infos:tower.levels.map(f=>({...f,state:1,receivedFirst:false,receivedNormal:false,info:f.info+'\n【待补】战斗阵容、技能、AI和场景尚未录全，可查看已采集的怪物属性。'}))};
}
