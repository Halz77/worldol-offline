import fs from 'node:fs';import path from 'node:path';import {spawnSync} from 'node:child_process';import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('..',import.meta.url)),captures=path.resolve(root,'../正式服录制数据'),out=path.join(root,'analysis/home-dungeons-qa');
fs.mkdirSync(out,{recursive:true});const results=[];
for(const id of fs.readdirSync(captures).sort()){
 const folder=path.join(captures,id);if(!fs.existsSync(path.join(folder,'events'))||!fs.existsSync(path.join(folder,'session.json')))continue;
 const target=path.join(out,id),child=spawnSync(process.execPath,[path.join(root,'tools/analyze-capture.mjs'),folder,'--snapshot','--out',target],{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:8*1024*1024});
 if(child.status!==0){results.push({id,error:child.stderr.slice(-1600)});continue;}
 const summary=JSON.parse(fs.readFileSync(path.join(target,'summary.json'))),scenes=JSON.parse(fs.readFileSync(path.join(target,'scene-packets.json')));
 results.push({id,counts:summary.counts,failed:summary.decoding?.partialOrFailed||[],maps:[...new Map(scenes.filter(s=>s.complete&&s.name).map(s=>[s.mapId,{id:s.mapId,name:s.name}])).values()]});
 console.log(JSON.stringify({id,maps:results.at(-1).maps.length,failed:results.at(-1).failed.length}));
}
fs.writeFileSync(path.join(out,'all-captures-audit.json'),JSON.stringify(results,null,2)+'\n');console.log(JSON.stringify({captures:results.length,errors:results.filter(r=>r.error).length,withPartial:results.filter(r=>r.failed?.length).length}));
