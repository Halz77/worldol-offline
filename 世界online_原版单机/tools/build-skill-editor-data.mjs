// 生成「技能编辑器.html」里内嵌的游戏标签表（效果编号 → 中文名、状态编号 → 状态名）。
//
// 为什么要生成而不是手抄：
//   1. 效果编号（POWER_*）与状态编号（BUFFER_*）是游戏自己的枚举，
//      抄错一个数字就等于改错一个技能。这里从 analysis/modules/0004.js 的 Tool 对象
//      直接取枚举，再执行主包里 getPowerDesc() 的 case 分支拿到官方文案。
//   2. 状态名来自主包的 e.bufferText 数组（索引 = 状态编号），短名与面板一致。
//   3. 生成结果写回 HTML 的 <script id="game-labels">，游戏换包后重跑一次即可。
//
// 用法：node tools/build-skill-editor-data.mjs [--check]
//   --check 只校验 HTML 里的标签表与当前游戏数据是否一致（不写文件），供测试调用。
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('..',import.meta.url));
export const EDITOR_HTML=path.join(root,'技能编辑器.html');

/** 少数 getPowerDesc 分支拿不到完整文案（引用运行时对象 / 依赖状态编号），
 *  以及游戏内本来就不显示文字的「内部标记」编号 —— 这里补成中文短名。
 *  note 会随标签表发给编辑器，选中该效果时显示在数值框下方。 */
const MANUAL_FIX={
 0:{n:'无'},
 36:{n:'伤害反射',p:true,note:'原版没有使用这个编号'},
 50:{n:'按生命上限百分比扣血',p:true},
 66:{n:'伤害反射',note:'原版没有使用这个编号'},
 79:{n:'清除目标状态',note:'数值填状态编号：0 无 / 1 中毒 / 25 增益 / 26 减益…'},
 80:{n:'战斗中复活并回复生命和法力'},
 82:{n:'技能附带命中'},
 85:{n:'附加强制命中率',p:true},
 86:{n:'无视目标法术防御点数'},
 87:{n:'无视物理防御（破甲）',p:false},
 88:{n:'清除自身状态',note:'数值填状态编号：0 无 / 1 中毒 / 25 增益 / 26 减益…'},
 97:{n:'复活并回复体力及法力',p:true},
 98:{n:'战斗后自动恢复生命和法力',p:true},
 99:{n:'开通仓库存放格数'},
 103:{n:'需求槽位（内部标记）'},
 105:{n:'传送到指定坐标（ToXY）'},
 106:{n:'有效期（内部标记）'},
 108:{n:'宝箱钥匙等级（内部标记）'},
 109:{n:'宠物蛋（内部标记）'},
 110:{n:'时装（内部标记）'},
 111:{n:'传送（内部标记）'},
 112:{n:'称号'},
 113:{n:'替目标抵挡劈砍攻击',p:true},
 114:{n:'替目标抵挡穿刺攻击',p:true},
 115:{n:'替目标抵挡魔法攻击',p:true},
 116:{n:'替目标抵挡诅咒攻击',p:true},
 117:{n:'替目标抵挡所有攻击',p:true},
 120:{n:'战斗经验倍数',note:'数值÷10 才是倍率（10 = 1.0 倍）'},
 121:{n:'未鉴定属性'},
 131:{n:'合成（内部标记）'},
 157:{n:'主人受劈砍时替其承伤',p:true},
 158:{n:'主人受穿刺时替其承伤',p:true},
 159:{n:'主人受魔法时替其承伤',p:true},
 160:{n:'主人受诅咒时替其承伤',p:true},
 161:{n:'主人受攻击时替其承伤',p:true},
 162:{n:'宠物替其承受劈砍伤害',p:true},
 163:{n:'宠物替其承受穿刺伤害',p:true},
 164:{n:'宠物替其承受魔法伤害',p:true},
 165:{n:'宠物替其承受诅咒伤害',p:true},
 166:{n:'宠物替其承受所有伤害',p:true},
 167:{n:'任务经验倍数',note:'数值÷10 才是倍率（10 = 1.0 倍）'},
 176:{n:'技能卷轴（内部标记）'},
 177:{n:'宠物技能卷轴（内部标记）'},
 179:{n:'获得新宠物（内部标记）'},
 180:{n:'获得新道具（内部标记）'},
 181:{n:'附魔卡（内部标记）'},
 182:{n:'阵型书（内部标记）'},
 185:{n:'变身怪物卡（内部标记）'},
 186:{n:'宠物技能书（内部标记）'},
 196:{n:'法术百分比',p:true,note:'原版没有使用这个编号'},
 197:{n:'能量',note:'197 同时是物理百分比标记，原版文案显示为「能量」'},
 301:{n:'增加铜币'},
 302:{n:'增加银币'},
 303:{n:'增加金币'},
 304:{n:'获得道具（内部标记）'}
};

/** 兜底对象：任何属性访问/调用都返回一个可字符串化的空值。 */
function fallback(){
 const f=function(){};
 return new Proxy(f,{
  get(t,k){if(k===Symbol.toPrimitive)return()=>'';if(k==='toString'||k==='valueOf')return()=>'';return fallback();},
  apply(){return fallback();}
 });
}

function loadModule(id){
 const file=path.join(root,'analysis','modules',String(id).padStart(4,'0')+'.js');
 if(!fs.existsSync(file))throw Error(`缺少 ${file}（analysis/ 是反编译产物，不入库）`);
 const raw=fs.readFileSync(file,'utf8');
 const ex={};
 vm.runInNewContext(raw.startsWith('(')?raw:'('+raw+')',{})({},ex,()=>({}));
 return ex;
}

function mainBundle(){
 const dir=path.join(root,'client','js','ff');
 if(!fs.existsSync(dir))throw Error('缺少 client/js/ff/（主包不入库）');
 const files=fs.readdirSync(dir).filter(f=>f.endsWith('.js'));
 if(files.length!==1)throw Error('client/js/ff/ 里应当只有一个主包，实际 '+files.length+' 个');
 return fs.readFileSync(path.join(dir,files[0]),'utf8');
}

/** 把 getPowerDesc 的返回值归一成 {n:名称, p:是否百分比}。 */
function normalize(text){
 let s=String(text).replace(/#/g,'').replace(/\s+/g,' ').trim();
 let p=false;
 if(/[+\-]%$/.test(s)){p=true;s=s.slice(0,-2);}
 else if(/[+\-]$/.test(s))s=s.slice(0,-1);
 return {n:s.trim(),p};
}

/** 从主包取一张「编号 → 文案」的数组表（客户端自己就是用它显示技能信息的）。 */
function grabArray(main,name){
 const m=main.match(new RegExp('e\\.'+name+'=\\[([^\\]]*)\\]'));
 if(!m)throw Error('主包里没找到 e.'+name);
 return m[1].split(',').map(s=>s.trim().replace(/^"/,'').replace(/"$/,''));
}

/* 怪物自带技能的来源：这几份数据里 sources 带 monsterAI 的记录就是怪物用的技能。
   怪物技能与人技能共用 id，所以要单独拎出 id 清单给编辑器做「怪物」标记；
   同时把它们的等级定义也带上 —— 怪物专属技能（不在人物/装备表里）只有这里有定义。 */
const MONSTER_SOURCES=['official-v305.json','recorded-expansion-20260922.json','boss-challenges-v1.json','yunruo-temple-v1.json'];
const MONSTER_FIELDS=['id','level','name','type','info','skillWeapon','power1','powerValue1','power2','powerValue2','power3','powerValue3',
 'skillAtkType','area','round','atk_time','useMP','useHP','anime1','anime2','anime3','position','statusBit1','statusBit2','statusBit3'];

export function buildMonsterSkills(){
 const byId=new Map();
 for(const file of MONSTER_SOURCES){
  const target=path.join(root,'data',file);
  if(!fs.existsSync(target))continue;
  const data=JSON.parse(fs.readFileSync(target,'utf8'));
  for(const skill of data.skills||[]){
   if(!(skill.sources||[]).some(x=>/monster/i.test(x.origin||'')))continue;
   const rec=byId.get(skill.id)||{name:skill.name||'',type:skill.type,levels:new Map()};
   if(!rec.levels.has(skill.level)){
    const row={};
    for(const key of MONSTER_FIELDS)if(skill[key]!==undefined)row[key]=skill[key];
    rec.levels.set(skill.level,row);
   }
   if(!rec.name&&skill.name)rec.name=skill.name;
   byId.set(skill.id,rec);
  }
 }
 const out={};
 for(const [id,rec] of [...byId.entries()].sort((a,b)=>a[0]-b[0])){
  out[id]={name:rec.name,type:rec.type,levels:[...rec.levels.values()].sort((a,b)=>a.level-b.level)};
 }
 return out;
}

export function buildLabels(){
 const Tool=loadModule(4).default;
 const main=mainBundle();

 // --- 效果文案：执行 getPowerDesc 的 case 分支 ---
 // 压缩包里两种写法都有：`return "..."` 与 `return"..."`（无空格），
 // 而且 return 后面可能没有分号（紧接 `}`）→ 这里两种都要吃。
 // 早先只写 `return `（带空格），结果 53 个直接返回字符串字面量的效果名全部退回英文常量。
 const scope=vm.createContext({c:'#',p:100,d:'',u:fallback(),a:fallback(),s:fallback(),r:fallback(),e:Tool,n:0,i:100,o:null,l:true});
 const re=/case e\.(POWER_[A-Z_0-9]+):\s*return\s*([^;{}]{1,500}?)\s*[;}]/g;
 let m;
 const rawText=new Map();
 while((m=re.exec(main))){
  let text='';
  try{text=String(vm.runInContext('('+m[2]+')',scope));}catch{text='';}
  const hit=normalize(text);
  if(!rawText.has(m[1])||(!rawText.get(m[1]).n&&hit.n))rawText.set(m[1],hit);
 }

 const powers={};
 for(const [key,id] of Object.entries(Tool)){
  if(!key.startsWith('POWER_')||!Number.isInteger(id))continue;
  const fix=MANUAL_FIX[id];
  const hit=fix||rawText.get(key)||{n:'',p:false};
  // 同一编号有多个别名时，优先保留有文案的那个
  if(powers[id]&&powers[id].n&&!hit.n)continue;
  const entry={k:key,n:hit.n||key.replace(/^POWER_/,''),p:!!hit.p};
  if(hit.note)entry.note=hit.note;
  powers[id]=entry;
 }

 // --- 状态名：主包的 e.bufferText 数组，索引即状态编号 ---
 const bt=main.match(/e\.bufferText=\[([^\]]*)\]/);
 if(!bt)throw Error('主包里没找到 e.bufferText');
 const buffers=bt[1].split(',').map(s=>s.replace(/^"|"$/g,'').trim());

 // --- 技能参数的文案表（客户端自己显示技能信息时用的就是这几张）---
 //   skillTypeText / skillWeaponText / AtkTypeText / skillAreaText / skillPositionText
 const skillTypes=grabArray(main,'skillTypeText');
 const skillWeapons=grabArray(main,'skillWeaponText');
 const skillAtkTypes=grabArray(main,'AtkTypeText');
 const skillAreas=grabArray(main,'skillAreaText');
 const skillPositions=grabArray(main,'skillPositionText');

 // --- 怪物自带技能 ---
 const monsters=buildMonsterSkills();

 const missing=Object.values(powers).filter(x=>x.k&&x.n===x.k.replace(/^POWER_/,'')).length;
 const monsterLevels=Object.values(monsters).reduce((a,r)=>a+r.levels.length,0);
 return {
  powers:Object.fromEntries(Object.entries(powers).sort((a,b)=>Number(a[0])-Number(b[0]))),
  buffers,
  skillTypes,skillWeapons,skillAtkTypes,skillAreas,skillPositions,monsters,
  stats:{powers:Object.keys(powers).length,buffers:buffers.length,missing,
   skillTypes:skillTypes.length,skillWeapons:skillWeapons.length,skillAtkTypes:skillAtkTypes.length,
   skillAreas:skillAreas.length,skillPositions:skillPositions.length,
   monsters:Object.keys(monsters).length,monsterLevels}
 };
}

function serialize(labels){
 const keys=['powers','buffers','skillTypes','skillWeapons','skillAtkTypes','skillAreas','skillPositions','monsters'];
 return JSON.stringify(Object.fromEntries(keys.map(k=>[k,labels[k]])));
}

export function writeIntoHtml(html,labels){
 const re=/(<script id="game-labels"[^>]*>)([\s\S]*?)(<\/script>)/;
 if(!re.test(html))throw Error('技能编辑器.html 里没有 <script id="game-labels"> 占位块');
 return html.replace(re,(all,open,body,close)=>open+serialize(labels)+close);
}

if(import.meta.url===`file://${process.argv[1]?.replace(/\\/g,'/')}`||process.argv[1]?.endsWith('build-skill-editor-data.mjs')){
 const check=process.argv.includes('--check');
 const labels=buildLabels();
 const s=labels.stats;
 console.log(`效果编号 ${s.powers} 条（无文案 ${s.missing} 条）｜状态名 ${s.buffers} 条`
  +`｜技能类型 ${s.skillTypes}｜武器限制 ${s.skillWeapons}｜攻击方式 ${s.skillAtkTypes}`
  +`｜作用范围 ${s.skillAreas}｜站位 ${s.skillPositions}`
  +`｜怪物技能 ${s.monsters} 个（${s.monsterLevels} 条等级定义）`);
 if(check){
  const html=fs.readFileSync(EDITOR_HTML,'utf8');
  const hit=html.match(/<script id="game-labels"[^>]*>([\s\S]*?)<\/script>/);
  const same=hit&&hit[1].trim()===serialize(labels);
  console.log(same?'编辑器内嵌标签表与当前游戏数据一致':'编辑器内嵌标签表与当前游戏数据不一致（重跑本脚本，去掉 --check）');
  process.exitCode=same?0:1;
 }else{
  fs.writeFileSync(EDITOR_HTML,writeIntoHtml(fs.readFileSync(EDITOR_HTML,'utf8'),labels),'utf8');
  console.log('已写入 '+path.relative(root,EDITOR_HTML));
 }
}
