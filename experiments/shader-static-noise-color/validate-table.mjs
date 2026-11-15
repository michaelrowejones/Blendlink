import assert from'node:assert/strict';
import{readFile}from'node:fs/promises';
import{dirname,join,resolve}from'node:path';
import{createHash}from'node:crypto';
import{pathToFileURL}from'node:url';
import{exportTable,requireProfile}from'../native-shader-constant-table-pilot/export.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
export const authority='69278565ef2726c77ecc98d7fb496496922cca91e067d19202b44b456fbfb0f0';
export async function validateTable(tablePath,closedPath,generationPath){
 const tableBytes=await readFile(tablePath),table=JSON.parse(tableBytes),closedBytes=await readFile(closedPath),closed=JSON.parse(closedBytes),generation=JSON.parse(await readFile(generationPath));
 assert.equal(sha(closedBytes),authority,'This pilot requires the declared native constant authority');
 const rebuilt=await exportTable(closedPath,authority);assert.deepEqual(table,rebuilt,'Table must reproduce exact closed native raw data');
 requireProfile(table,{nativeVersion:[5,3,0],nativeBuild:'02f0899d78e3',backend:'METAL',vendor:'Apple M5 Pro',nativeLibrarySha256:generation.nativeMetalPreprocess.sha256});
 assert.equal(table.helper,'random_vec3_offset');assert.deepEqual(table.table.map(r=>r.seed),[3,4]);
 const pins={};
 const paths=[tablePath,closedPath,closed.pins.report.path,join(dirname(closed.pins.report.path),'literal-offset.rgba32f'),join(dirname(closed.pins.report.path),'uniform-offset.rgba32f'),new URL('../native-shader-constant-table-pilot/export.mjs',import.meta.url),new URL('./validate-table.mjs',import.meta.url)];
 for(const p of paths)pins[p instanceof URL?p.pathname:resolve(p)]=sha(await readFile(p));
 return{table,pins};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const[t,c,g]=process.argv.slice(2);assert.ok(t&&c&&g);console.log(JSON.stringify(await validateTable(t,c,g)));}
