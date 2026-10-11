import {official,officialItems} from './official-data.mjs';
import {Writer} from './codec.mjs';
const ranges=new Map((official.identification||[]).map(i=>[i.itemId,i]));
export function identificationPreview(id){const row=ranges.get(id);if(row)return Buffer.from(row.wireBase64,'base64');const w=new Writer();if(officialItems.get(id)?.type===41)w.string('1').int(0);return w.short(0).done();}
