// Local-founder pairing only. Generate a new scoped token; never print it.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
export async function pair(root) {
const local=path.join(root,'.local');
const dev=JSON.parse(fs.readFileSync(path.join(local,'dev.json'),'utf8'));
if(dev.mode!=='local-founder'||dev.web!==25222||dev.db!==5434||dev.database!=='ayamai_local') throw Error('Automatic pairing requires the guarded local-founder environment.');
const configPath=path.join(local,'curator/config.json');
const config=JSON.parse(fs.readFileSync(configPath,'utf8'));
const tokenPath=path.join(local,'curator/data/api-token');
if(fs.existsSync(tokenPath)) throw Error('Existing token preserved. Revoke it through your session before pairing again.');
const base=`http://127.0.0.1:${dev.api}`;
const session=await fetch(base+'/api/dev-auth/session',{method:'POST',headers:{Origin:process.env.AYAMAI_PUBLIC_ORIGIN ?? 'http://ayamai.local'}});
if(!session.ok) throw Error(`Local founder session unavailable (HTTP ${session.status}).`);
const cookie=session.headers.get('set-cookie')?.split(';')[0];
if(!cookie) throw Error('No local session issued.');
const response=await fetch(base+'/api/curator/tokens',{method:'POST',headers:{Cookie:cookie,'content-type':'application/json'},body:JSON.stringify({label:'local-curator'})});
if(!response.ok) throw Error(`Curator pairing unavailable (HTTP ${response.status}); use the integrated API and fresh schema.`);
const credential=await response.json();
if(typeof credential.token!=='string'||!credential.token.startsWith('cur_')) throw Error('Invalid pairing response.');
process.umask(0o077);
fs.mkdirSync(path.dirname(tokenPath),{recursive:true,mode:0o700});
fs.writeFileSync(tokenPath,credential.token,{mode:0o600,flag:'wx'});
config.api={enabled:true,baseUrl:base,tokenFile:'api-token',tokenId:credential.id};
const temporary=configPath+'.tmp';fs.writeFileSync(temporary,JSON.stringify(config,null,2)+'\n',{mode:0o600});fs.renameSync(temporary,configPath);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
 await pair(path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..'));
 console.log('Curator paired locally; token stored privately. Restart an already-running Curator to enable synchronization.');
}
