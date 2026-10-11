(function(scope){
 'use strict';
 scope.installOfflinePetSnapshotVitals=function(Pet,model,profiles){
  const original=Pet.prototype.get;
  Pet.prototype.get=function(key){
   if(key===model.HPMAX||key===model.MPMAX){
    let id=this.getPetId?.();
    if(id==null){const owner=this.owner;if(owner?.getPet?.()===this)id=owner.bag?.store?.[1]?.petId;}
    const profile=id==null?null:profiles[String(id)];
    if(profile&&profile.model===this.modelForPet&&profile.level===this.level)return key===model.HPMAX?profile.hpMax:profile.mpMax;
   }
   return original.call(this,key);
  };
 };
})(window);
