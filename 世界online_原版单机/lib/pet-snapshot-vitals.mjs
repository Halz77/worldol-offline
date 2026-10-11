// Explicit per-instance snapshot limits for pets copied from observed gameplay.
// Unmarked pets keep the normal owner/skill/equipment calculation.
export function petSnapshotVitals(pet){
 const value=pet?.recordedSnapshotVitals;if(!value)return null;
 if(!Number.isSafeInteger(value.hpMax)||value.hpMax<1||value.hpMax>2147483647||!Number.isSafeInteger(value.mpMax)||value.mpMax<1||value.mpMax>2147483647)throw Error('Invalid recorded pet vital limits');
 return {hpMax:value.hpMax,mpMax:value.mpMax};
}
export function petSnapshotDirectory(characters){
 const profiles={};
 for(const owner of characters)for(const item of owner.inventory||[]){const pet=item.pet,vitals=petSnapshotVitals(pet);if(pet?.uid&&vitals)profiles[String(pet.uid)]={...vitals,model:pet.model,level:pet.level};}
 return profiles;
}
