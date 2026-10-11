import {activeLegionMembers} from './legion-state.mjs';
import {activePet} from './pet-state.mjs';
export function legionAppearance(w,p){
 const members=activeLegionMembers(p);w.byte(members.length);
 for(const {role,index} of members){
  w.byte(index).int(role.id).long(role.icon1||0).long(role.icon2||0).long(role.icon3||0);
  const pet=activePet(role);
  if(!pet)w.byte(-1);
  else w.byte(0).string(pet.name).long(pet.icon).short(pet.headIcon||0).long(Math.max(0,pet.expiresAt-Date.now()));
 }
 return w;
}
