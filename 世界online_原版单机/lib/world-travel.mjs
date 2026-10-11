import {official,officialMaps} from './official-data.mjs';
import {maps} from './content.mjs';
import fs from 'node:fs';

const recordedLinks=JSON.parse(fs.readFileSync(new URL('../data/world-travel-links.json',import.meta.url)));
export const worldTravelRevision=recordedLinks.revision;
const directoryScene=new Map(recordedLinks.links.map(x=>[x.directoryId,x.mapId]));

// 10522 directory IDs are not scene IDs (e.g. directory 57 = scene 37).
// Exact recorded names link directory entries; scene families supply the areas
// whose directory response was not captured. Special instances remain in All.
const areaScenes={
 1:[920,921,922,923,924],2:[926,927,928,929,930],3:[263,907,265],
 4:[906,914,915,916,917],5:[900],6:[254,251,908,909],7:[22,23,24,27,293],
 8:[303,4,16,17,11,905],9:[14,5,19,813,814,815,818,7],10:[824,20,301],
 11:[825,826,827,828],12:[820,819,821,822,823,279],15:[960],16:[37]
};
const clean=name=>String(name).replaceAll(/[（(][^（）()]*[）)]/g,'').replaceAll(/\s/g,'');
export function worldTravelMaps(area){
 if(area===0)return [maps[1],...officialMaps.values()];
 const ids=new Set(areaScenes[area]||[]);
 for(const entry of official.mapList.filter(m=>m.sources?.some(s=>s.areaId===area))){
  const recorded=directoryScene.get(entry.id);
  if(recorded&&officialMaps.has(recorded)){ids.add(recorded);continue;}
  const matches=[...officialMaps.values()].filter(m=>clean(m.name)===clean(entry.name));if(matches.length===1)ids.add(matches[0].id);
 }
 return [...ids].filter(id=>officialMaps.has(id)).map(id=>maps[id]);
}
