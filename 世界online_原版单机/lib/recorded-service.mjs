import {Writer} from './codec.mjs';
import {recorded,recordedTitles,recordedPets,recordedPetSamples,recordedFinishedPets,petSources,selectedTitle,petFromRecord,recordedSummary,growthNotice} from './recorded-content.mjs';
import {claimRecordedPet,activePet} from './pet-state.mjs';
import {petDetail} from './pet-packets.mjs';
import {itemPacket} from './restoration-packets.mjs';
import {official,officialMaps,officialItems} from './official-data.mjs';
import {missionBlockers,missionRewards,missionNotes,missionConditions} from './official-rules.mjs';
import {VIP_MAX,localVipLevel} from './equipment-sets.mjs';
import {hpMax,mpMax} from './content.mjs';
import {dropCatalog,dropDirectory} from './loot.mjs';
import {handleDaily} from './daily-service.mjs';
import {dailyData} from './daily-activity.mjs';
import {homeFeatureData,vipBenefits,vipPending} from './home-feature-data.mjs';
import {petCatalogSummary,petCatalog,LEGENDARY_EGG_ID} from './pet-catalog.mjs';
export function recordedDirectory(){
 const strip=(value)=>JSON.parse(JSON.stringify(value,(key,v)=>['sources','variants','wireBase64','definitionBase64','petUid'].includes(key)?undefined:v));
 const {groups:drops,...dropInfo}=dropDirectory();
 return {
  ...recordedSummary,growthNotice,petCatalog:petCatalogSummary,petProfiles:strip(petCatalog.profiles),dropInfo,drops,taskRewards:dropCatalog.tasks,
  vitality:strip({...dailyData.legacy,mode:'local-progress-and-rewards',revision:dailyData.revision}),
  pets:strip(recorded.pets),petSamples:strip([...recordedPetSamples.values()]),finishedPets:strip([...recordedFinishedPets.values()]),petSkills:strip(petCatalog.skills),petEggs:strip([officialItems.get(LEGENDARY_EGG_ID)]).map(e=>({...e,canOpen:true})),
  petEquipment:strip(recorded.petEquipment),titles:strip(recorded.titles),vip:strip(recorded.vip),sets:strip(recorded.sets),gems:strip(recorded.gems),guides:strip(recorded.guides),
  maps:official.maps.map(m=>({id:m.id,name:m.name,npcs:m.npcs.map(n=>({id:n.id,name:n.name,type:n.npcType,x:n.x,y:n.y,welcome:n.welcome,talk:n.talkDetail}))})),
  missions:official.missions.map(q=>{const reward=missionRewards(q),notes=missionNotes(q);return {id:q.id,name:q.name,level:q.level,mapId:q.mapId,map:officialMaps.get(q.mapId)?.name,npcId:q.npcId,exp:reward.exp,money2:reward.money2,money3:reward.money3,desc:q.desc+(notes.length?'\n【单机】'+notes.join('；')+'。':''),dialogStartFinish:q.dialogStartFinish,acceptCondition:missionConditions(q,'acceptCondition'),submitCondition:missionConditions(q,'submitCondition'),rewardItems:reward.rewardItems,selectItems:reward.selectItems,blockers:missionBlockers(q)};}),
  items:official.items.map(i=>({id:i.id,name:i.name,type:i.type,grade:i.grade,reqLv:i.reqLv,itemSet:i.itemSet})),
 };
}
export function titleList(w){w.short(recordedTitles.size);for(const t of recordedTitles.values())w.short(t.id).string(t.name).byte(t.power1).short(t.value1).byte(t.power2).short(t.value2);return w;}
export function titleSelected(w,p){const t=selectedTitle(p);return w.byte(0).string(t?.name||'').short(t?.power1||0).short(t?.value1||0).short(t?.power2||0).short(t?.value2||0);}
export function handleRecorded(type,r,context,{store,send,log}){
 const p=context.role;if(!p)return false;
 if(handleDaily(type,r,context,{store,send,log}))return true;
 const commit=fn=>{const before=structuredClone(p);try{const result=fn();p.hp=Math.min(p.hp,hpMax(p));p.mp=Math.min(p.mp,mpMax(p));store.save();return result;}catch(e){for(const k of Object.keys(p))if(!(k in before))delete p[k];Object.assign(p,before);throw e;}};
 if(type===11026){send(type,titleList(new Writer()));return true;}
 if(type===11023){const w=new Writer().string(selectedTitle(p)?.name||'').int(0).short(-1).short(recordedTitles.size);for(let i=0;i<12;i++)w.short(0);send(type,w);return true;}
 if(type===11024){send(type,new Writer().int(0).short(0));return true;}
 if(type===11025){send(type,new Writer().byte(-1).string('成就进度与奖励规则待补。'));return true;}
 // The native social window queries each relationship tab independently.
 // A single-player save has no recorded relationships; answer with its native
 // empty-list shape so opening the restored entrance cannot time out.
 if(type===13529){r.byte();r.byte();r.short();send(type,new Writer().short(0));return true;}
 if(type===11163){send(type,new Writer().int(0).byte(0));return true;}
 if(type===13541){send(type,new Writer().short(1).byte(1).string('本地等级排行').byte(1).byte(1).string('当前角色'));return true;}
 if(type===13542){
  r.byte();r.byte();const size=Math.max(1,Math.min(30,r.byte()&255)),requestedPage=r.short(),page=requestedPage===127?0:Math.max(0,requestedPage);
  const all=store.data.characters.filter(c=>c.accountId===p.accountId).sort((a,b)=>b.level-a.level||a.id-b.id),rows=all.slice(page*size,(page+1)*size);
  const w=new Writer().short(all.length).byte(1).string('等级').short(rows.length);
  for(const c of rows)w.byte(c.vipLevel2||0).int(c.id).string(c.name).byte(c.sex||0).byte(c.job||0).byte(c.race||0).byte(0).short(all.indexOf(c)+1).byte(1).string(String(c.level)).byte(0);
  send(type,w);return true;
 }
 if(type===13543){const rank=store.data.characters.filter(c=>c.accountId===p.accountId).sort((a,b)=>b.level-a.level||a.id-b.id).findIndex(c=>c.id===p.id)+1;send(type,new Writer().string(`本地等级排行：第 ${rank} 名，等级 ${p.level}。`));return true;}
 if(type===11027){try{if(context.battle)throw Error('请先结束战斗。');const id=r.short();if(id!==-1&&!recordedTitles.has(id))throw Error('称号资料尚未录到。');commit(()=>{p.titleId=id;});send(type,titleSelected(new Writer(),p));log('title-selected',{role:p.id,id});}catch(e){send(type,new Writer().byte(-1).string(e.message));}return true;}
 if(type===90004){try{if(context.battle)throw Error('请先结束战斗。');const id=r.int(),item=commit(()=>claimRecordedPet(p,id));send(type,itemPacket(new Writer().byte(0),item));log('recorded-pet-claimed',{role:p.id,template:item.pet.templateId});}catch(e){send(type,new Writer().byte(-1).string(e.message));}return true;}
 if(type===15514){try{const t=petSources.get(r.int());if(!t)throw Error('这只宠物的详情尚未录到。');send(type,petDetail(new Writer().byte(0),petFromRecord(t)).string(t.description||''));}catch(e){send(type,new Writer().byte(-1).string(e.message));}return true;}
 if(type===15512){const pet=activePet(p);send(type,pet?petDetail(new Writer().byte(0),pet):new Writer().byte(-1).string('请先让宠物出战。'));return true;}
 if(type===16009){
  // The original raiders list contains 75 detailed summary rows. All 143
  // templates are additionally exposed through the handbook and local gallery.
  const rows=recorded.petCatalog.filter(p=>p.type!==undefined&&p.skills?.length>=2),w=new Writer().int(rows.length).byte(rows.length);
  for(const t of rows){w.int(t.id).short(t.type).string(t.name).byte(t.job).byte(t.grade).byte(t.attackType);for(const k of ['strength','constitution','agility','intelligence','wisdom'])w.short(t.attributes[k]);w.byte(t.grow).byte(t.comprehension);for(const s of t.skills.slice(0,2))w.raw(Buffer.from(s.wireBase64,'base64'));w.long(t.icon).long(t.bornStatus).string(t.description||'');}send(type,w);return true;
 }
 if(type===12052){send(type,new Writer().byte(VIP_MAX));return true;}
 if(type===11055){const v=homeFeatureData.vip,b=vipBenefits(p),info=`当前 VIP ${b.level}，${b.permanent?'单机永久有效':'未开通'}。\n已接入VIP1基础权益：任务经验1.1倍、战后回复最大生命和法力5%、每日活跃度+100。\n礼包在“VIP福利”领取。500黄金可兑换500经验，已知VIP1升2需2000经验。\n${vipPending}\n\n原版权益说明：\n${v.description}`,w=new Writer().string(info).int(p.homeFeatures?.vipExperience||0).int(b.level<=1?v.nextLevelExp:0).byte(v.items.length);for(const i of v.items){w.raw(Buffer.from(i.definitionBase64,'base64'));if(i.id>=41000&&i.id<=41008)w.int(0);}send(type,w);return true;}
 if([11053,11160].includes(type)){const v=recorded.vip.find(v=>v.protocol===type),w=new Writer().byte(0).short(v?.offers.length||0);for(const o of v?.offers||[])w.short(o.id).string(o.description).byte(o.moneyType).int(o.price);send(type,w);return true;}
 if([11054,11161].includes(type)){send(type,new Writer().byte(-1).string('原版付费与经验升级规则待定；请在游戏内VIP页面免费设置等级，未消耗货币。'));return true;}
 return false;
}
