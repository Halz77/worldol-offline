import fs from 'node:fs';
export const nativeCommerce=JSON.parse(fs.readFileSync(new URL('../data/native-commerce.json',import.meta.url),'utf8'));
