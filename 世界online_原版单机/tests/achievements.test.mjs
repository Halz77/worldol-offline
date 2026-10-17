import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {Writer} from '../lib/codec.mjs';
import {achievementInfo,achievementList,claimAchievementReward,achievementsSummary} from '../lib/achievements.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const hasData=fs.existsSync(path.join(root,'data','achievements.json'));
const skip={skip:hasData?false:'没有 data/achievements.json，跳过'};

/** 可算属性的最小角色（attributes 需要 baseStats + skills + inventory）。 */
const role=(patch={})=>({
 id:9001,level:30,level2:0,exp:0,coins:0,gold:0,silver:0,
 baseStats:[10,10,10,10,10],skills:{},inventory:[],titleId:0,
 quests:{active:{},completed:[]},battles:{wins:5,losses:0,kills:{1:10},cooldowns:{}},
 vipLevel2:0,hp:1000,mp:500,...patch,
});

test('成就数据：48 条，revision 与文件一致',skip,()=>{
 const raw=JSON.parse(fs.readFileSync(path.join(root,'data','achievements.json'),'utf8'));
 const s=achievementsSummary();
 assert.equal(s.rows,raw.achievements.length,'条数要与数据文件一致');
 assert.equal(s.rows,48);
 assert.equal(s.revision,raw.revision);
});

test('11023 概览包：称号 + 成就点 + 称号数 + 四大类各 3 个 short（共 12 个）',skip,()=>{
 const w=achievementInfo(new Writer(),role()).done();
 // string(3 字节长度 + 每字符 2 字节，空串=3) + int(4) + short(2) + short(2) + 12*short(24)
 assert.equal(w.length,3+4+2+2+24);
});

test('11024 列表包：等级类成就能算出进度，且能按小类型筛选',skip,()=>{
 const p=role({level:30});
 const all=achievementList(new Writer(),p,0,0,200,0).done();
 assert.ok(all.length>100,'全部成就的包应当有内容');
 // 只取小类型 2（任务/成长类，id 1 在这里）
 const only=achievementList(new Writer(),p,0,2,200,0).done();
 assert.ok(only.length>0);
 assert.ok(only.length<all.length,'按类型筛选后应当更短');
 // 分页：每页 5 条
 const page=achievementList(new Writer(),p,0,2,5,0).done();
 assert.ok(page.length>0&&page.length<=only.length);
});

test('11025 领取：发经验与铜币、记录 achievementClaims；重复领取返回 -2',skip,()=>{
 const p=role({level:30,coins:0,exp:0});
 const before={exp:p.exp,coins:p.coins};
 const w=claimAchievementReward(p,1,0).done();
 assert.ok(w.length>10,'领取包要有内容');
 assert.ok(p.coins>before.coins,'要发放铜币');
 assert.ok(p.exp>=before.exp,'要发放经验');
 assert.deepEqual(p.achievementClaims,[1],'要记录已领取');
 // 重复领取：返回单字节 -2（不抛错）
 const again=claimAchievementReward(p,1,0).done();
 assert.equal(again.length,1);
 assert.equal(again.readUInt8(0),254,'-2 的字节是 0xFE');
});

test('11025 领取：未达成的成就抛错，不存在的成就也抛错',skip,()=>{
 const p=role({level:1});
 assert.throws(()=>claimAchievementReward(p,4,0),/尚未达成/,'97 级成就对 1 级角色应当抛错');
 assert.throws(()=>claimAchievementReward(p,99999,0),/没有这项成就/);
 assert.equal(p.achievementClaims,undefined,'抛错时不能写入 claims');
});

test('11025 一键领取（id=-1）：把当前所有可领的都领了',skip,()=>{
 const p=role({level:97,vipLevel2:0});
 const before=p.achievementClaims?.length||0;
 const w=claimAchievementReward(p,-1,0).done();
 assert.ok(w.length>5);
 assert.ok((p.achievementClaims?.length||0)>before,'一键领取应当领到多条');
 // 再领一次：没有可领的就返回 -2
 const again=claimAchievementReward(p,-1,0).done();
 assert.equal(again.length,1);
 assert.equal(again.readUInt8(0),254);
});
