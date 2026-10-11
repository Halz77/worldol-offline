export const INITIAL_BAG_CAPACITY=300;

// Upgrade old save files on load. Only the capacity field is changed; keep
// inventory positions, account data, progression, and unknown fields intact.
export function expandSavedBags(data){
 const changes=[];
 for(const p of data.characters){
  if(Number.isInteger(p.bagLimit)&&p.bagLimit>=INITIAL_BAG_CAPACITY)continue;
  changes.push({role:p.id,before:p.bagLimit??24,after:INITIAL_BAG_CAPACITY});
  p.bagLimit=INITIAL_BAG_CAPACITY;
 }
 return changes;
}
