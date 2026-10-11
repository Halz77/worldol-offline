import fs from 'node:fs';
const read=name=>JSON.parse(fs.readFileSync(new URL('../data/'+name,import.meta.url),'utf8'));
export const growthData=read('community-growth.json');
export const featureData=read('city-character-v1.json');
featureData.revision='free-character-growth-v3-20260924';
featureData.talents.push(...growthData.talents);
for(const row of featureData.talents)row.items=[];
for(const kind of ['skills','decorations']){
 const list=featureData.artifact[kind];list.push(...growthData.artifact[kind]);
 for(const row of list){row.lvCost=[];row.pending=false;row.attributeNext=list.find(r=>r.type===row.type&&r.lv===row.lv+1)?.attribute||[];}
 list.sort((a,b)=>a.type-b.type||a.lv-b.lv);
}
// Stage two/three names were not captured; use explicit stage labels rather
// than borrowing another character's progress or inventing official names.
for(const stage of [2,3])if(!featureData.artifact.stages.some(r=>r.stage===stage))featureData.artifact.stages.push({stage,name:`神器${stage}阶`,exp:0,needExp:0,power:0});
for(const row of featureData.artifact.stages){row.lvCost=[];row.needExp=0;}
featureData.artifact.stages.sort((a,b)=>a.stage-b.stage);
