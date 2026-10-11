import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {petSnapshotDirectory,petSnapshotVitals} from '../lib/pet-snapshot-vitals.mjs';
import {petAttributes} from '../lib/pet-state.mjs';
import {petFromRecord,recordedPets} from '../lib/recorded-content.mjs';
import {normalizeRole} from '../lib/content.mjs';

test('snapshot limits survive persistence while ordinary pets retain skill and owner calculation',()=>{
 const owner=normalizeRole({id:1001,level:97,job:1,race:0,sex:1,mapId:259}),pet=petFromRecord(recordedPets.get(320));
 const ordinary=petAttributes(owner,pet);pet.uid='10010004';pet.recordedSnapshotVitals={hpMax:93014,mpMax:40610};
 const restored=JSON.parse(JSON.stringify(pet)),limits=petAttributes(owner,restored);
 assert.deepEqual(limits.base,ordinary.base);assert.equal(limits.hp,93014);assert.equal(limits.mp,40610);
 owner.inventory.push({slot:32,pet:restored});assert.deepEqual(petSnapshotDirectory([owner]),{'10010004':{hpMax:93014,mpMax:40610,model:320,level:1}});
 delete restored.recordedSnapshotVitals;assert.deepEqual(petAttributes(owner,restored),ordinary);
 assert.throws(()=>petSnapshotVitals({recordedSnapshotVitals:{hpMax:2147483648,mpMax:40610}}),/Invalid/);
});

test('client applies snapshot limits only to matching pet identity in bag and active-pet views',()=>{
 const scope={window:{}};vm.runInNewContext(fs.readFileSync(new URL('../web/pet-snapshot-vitals.js',import.meta.url),'utf8'),scope);
 class Pet{get(k){return k===1?64820:k===2?23338:123;}getPetId(){return this.petItem?.petId;}}
 const profiles={'10010004':{hpMax:93014,mpMax:40610,model:746,level:97}};
 scope.window.installOfflinePetSnapshotVitals(Pet,{HPMAX:1,MPMAX:2},profiles);
 const pet=Object.assign(new Pet(),{modelForPet:746,level:97,petItem:{petId:{toString:()=> '10010004'}}});
 assert.equal(pet.get(1),93014);assert.equal(pet.get(2),40610);assert.equal(pet.get(3),123);
 pet.petItem.petId='another';assert.equal(pet.get(1),64820);
 delete pet.petItem;pet.owner={getPet:()=>pet,bag:{store:{1:{petId:'10010004'}}}};assert.equal(pet.get(1),93014);
 pet.owner.getPet=()=>null;assert.equal(pet.get(1),64820);
 pet.petItem={petId:'10010004'};pet.modelForPet=320;assert.equal(pet.get(1),64820);
});
