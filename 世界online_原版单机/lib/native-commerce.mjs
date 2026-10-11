import {nativeCommerce as data} from './native-commerce-data.mjs';
import {Writer} from './codec.mjs';
import {encodeWithSchema} from './feature-protobuf.mjs';
import {dailyKey} from './daily-activity.mjs';
import {planItemRewards} from './restoration.mjs';
import {awardExperience} from './progression.mjs';

const definitions=new Map(data.items.map(x=>[x.id,x]));
const state=p=>({total:0,normalTotal:0,purchases:{},firstDays:[],achievements:[],...(p.nativeCommerce||{})});
function period(type,now){const day=dailyKey(now);if(type===2)return day.slice(0,7);if(type===1){const date=new Date(day+'T00:00:00Z');date.setUTCDate(date.getUTCDate()-(date.getUTCDay()+6)%7);return date.toISOString().slice(0,10);}return day;}
function key(kind,id,now){const gift=data.gifts.find(x=>x.id===String(id));return kind+':'+id+(kind==='normal'?'':':'+period(kind==='gift'?gift?.type:0,now));}
const bought=(p,kind,id,now)=>(state(p).purchases[key(kind,id,now)]||0);
const minLevel=row=>Number(row.desc.match(/等级达到(\d+)级/)?.[1]||0);
const eligible=(p,row)=>state(p).total>=row.threshold&&p.level>=minLevel(row)&&!state(p).achievements.includes(row.id);

export function planCommerceAction(p,request,now=Date.now()){
 const next=structuredClone(p),s=structuredClone(state(p));next.nativeCommerce=s;
 const result={next,action:'commerce',items:[],currencies:{gold:0,silver:0,coins:0}};
 const addRewards=items=>{for(const item of items||[]){if(item.id>0)result.items.push(item);else{const currency={[-1]:'gold',[-2]:'silver',[-3]:'coins'}[item.id];if(!currency)throw Error('奖励账户尚未接入：'+item.id);result.currencies[currency]+=item.quantity;}}};
 const kind=request.kind,id=String(request.id??'');
 if(kind==='achievement'){
  const row=data.achievements.find(x=>x.id===Number(id));if(!row||!eligible(p,row))throw Error('尚未达到这项充值成就的领取条件，或已经领取。');
  if(row.item)addRewards([row.item]);for(const k of ['gold','silver','coins'])result.currencies[k]+=row[k]||0;
  awardExperience(next,row.exp||0,0);s.achievements.push(row.id);s.achievementPoints=(s.achievementPoints||0)+(row.point||0);
 }else if(kind!=='first-rewards'){
  let offer;
  if(kind==='normal'||kind==='daily')offer=data[kind].find(x=>x.defineId===id);
  if(kind==='gift'){const g=data.gifts.find(x=>x.id===id);if(g)offer={defineId:g.id,money:g.price,gold:g.money11||0,silver:g.money12||0,purchaseLimit:g.sumTimes,items:g.items.map(x=>({id:x.itemId,quantity:x.itemCount}))};}
  if(!offer)throw Error('没有这个已录制的档位。');
  const purchaseKey=key(kind,id,now),count=s.purchases[purchaseKey]||0;
  if(offer.purchaseLimit>=0&&count>=offer.purchaseLimit)throw Error('已达到本期领取上限。');
  const first=kind==='normal'&&count===0;
  result.currencies.gold+=Math.floor((offer.gold||0)*(first?1.5:1));result.currencies.silver+=offer.silver||0;addRewards(offer.items);
  s.purchases[purchaseKey]=count+1;s.total+=offer.money;
  if(kind==='normal'){s.normalTotal+=offer.money;if(s.normalTotal>=30&&!s.firstDay)s.firstDay=dailyKey(now);}
  if(!Number.isSafeInteger(s.total)||s.total>2147483647)throw Error('累计金额超过当前存档范围。');
 }
 if(s.firstDay){const days=Math.floor((Date.parse(dailyKey(now))-Date.parse(s.firstDay))/86400000)+1;for(const reward of data.firstRewards)if(reward.day<=days&&!s.firstDays.includes(reward.day)){addRewards(reward.items);s.firstDays.push(reward.day);}}
 for(const[k,n]of Object.entries(result.currencies)){const value=(next[k]||0)+n;if(!Number.isSafeInteger(value)||value<0||value>2147483647)throw Error('货币超过当前存档范围。');next[k]=value;}
 const plan=planItemRewards(next,result.items);next.inventory=plan.inventory;result.added=plan.added;return result;
}

function definition(w,id){const value=definitions.get(id);if(!value)throw Error('Missing captured reward definition '+id);return w.raw(Buffer.from(value.definitionBase64,'base64'));}
function rewards(w,rows){const items=rows.filter(x=>x.id>0),currencies=rows.filter(x=>x.id<0);w.short(items.length);for(const x of items){w.int(x.quantity);definition(w,x.id);}w.short(currencies.length);for(const x of currencies)w.int(x.id).int(x.quantity);return w;}
function products(w,rows,p,kind,now){w.int(rows.length);for(const row of rows){w.string(row.defineId).string(row.info).int(row.money).int(row.gold).int(row.silver).byte(kind==='daily'?row.items.length:row.items[0]?.quantity||0);for(const x of row.items){definition(w,x.id);if(kind==='daily')w.byte(x.quantity);}if(kind==='daily')w.short(row.purchaseLimit).short(bought(p,kind,row.defineId,now)).long(0).long(0);}return w;}
export function handleNativeCommerce(type,r,context,{send,now=Date.now()}){
 const p=context.role;if(!p)return false;const s=state(p);
 if(type===17001){const w=products(new Writer(),data.normal,p,'normal',now).short(data.firstRewards.length);for(const day of data.firstRewards)rewards(w.int(day.day),day.items);w.int(Math.max(0,...s.firstDays)).bool(s.normalTotal>=30).int(s.normalTotal);send(type,w);return true;}
 if(type===17101){send(type,products(new Writer(),data.daily,p,'daily',now));return true;}
 if(type===17017){const ids=data.normal.filter(x=>bought(p,'normal',x.defineId,now)>0);const w=new Writer().byte(data.normal.length).byte(ids.length);for(const x of ids)w.int(Number(x.defineId));send(type,w);return true;}
 if(type===11172){send(type,new Writer().int(s.total));return true;}
 if(type===24204){send(24205,encodeWithSchema('s2c_DailyGIftPack',{info:data.gifts.map(x=>({...x,buyTimes:bought(p,'gift',x.id,now)}))},data.schemas));return true;}
 if(type===11078){const template=data.publicPackets[type],body=Buffer.from(template.bodyBase64,'base64');body.writeInt32BE(s.total,template.totalOffset);send(type,body);return true;}
 if(type===11083){
  const w=new Writer().int(0).short(data.achievements.length);
  for(const row of data.achievements)w.raw(Buffer.from(row.prefixBase64,'base64')).string(s.achievements.includes(row.id)?'已领取':row.strGet).short(row.id).byte(row.bigType).string(row.name).int(row.point).string(row.title).string(row.desc).int(row.exp).int(row.gold).int(row.silver).int(row.coins).bool(eligible(p,row)).int(row.threshold);
  w.int(s.total).int(p.vipLevel2||0).int(data.achievementNextExp).int(data.achievementPreviews.length);
  for(const row of data.achievementPreviews){w.byte(3).short(row.id).byte(row.category).bool(!!row.item);if(row.item){w.short(row.item.quantity);definition(w,row.item.id);}}
  send(type,w);return true;
 }
 // Native checkout messages are handled only by the local action controller.
 if([17002,17102,17015].includes(type)){send(type,new Writer().int(-1).string('请通过单机页面免费领取。'));return true;}
 return false;
}
