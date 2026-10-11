import {officialMissions} from './official-data.mjs';

// Captured category 6 is the beginner story through obtaining the first city.
// Optional skill/city tutorials and the local tutorial also remain one-time.
const tutorialMissionIds=new Set([1181,2552,9001,9002,9003]);
export const isNewbieMission=id=>officialMissions.get(Number(id))?.type===6||tutorialMissionIds.has(Number(id));
