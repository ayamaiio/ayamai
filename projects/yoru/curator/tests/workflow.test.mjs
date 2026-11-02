import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {enqueue,drain,recover,pendingCount} from '../lib/api.mjs';
import {pair} from '../pair.mjs';
import {RangedTar} from '../lib/tar.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function port(){const s=net.createServer();s.listen(0,'127.0.0.1');await once(s,'listening');const p=s.address().port;await new Promise(r=>s.close(r));return p;}
function temp(t){const d=fs.mkdtempSync(path.join(os.tmpdir(),'ayamai-curator-test-'));t.after(()=>fs.rmSync(d,{recursive:true,force:true}));return d;}
test('outbox serializes drains, keeps in-flight appends, retains rejects and retries',async t=>{
 const d=temp(t); const original=globalThis.fetch;t.after(()=>globalThis.fetch=original);
 enqueue(d,{clientEventId:'first'});enqueue(d,{clientEventId:'second'});
 let release;const blocked=new Promise(r=>release=r);let calls=0;
 globalThis.fetch=async()=>{calls++;await blocked;return {ok:true,json:async()=>({results:[{ok:true},{ok:false}]})};};
 fs.writeFileSync(path.join(d,'api-token'),'synthetic-test-token');
 const cfg={api:{enabled:true,baseUrl:'http://synthetic.invalid'}};
 const first=drain(d,cfg);const second=drain(d,cfg);assert.equal(first,second);
 enqueue(d,{clientEventId:'third'});release();assert.deepEqual(await first,{sent:1,remaining:2});assert.equal(calls,1);
 assert.match(fs.readFileSync(path.join(d,'outbox.jsonl'),'utf8'),/second.*\n.*third/);
 globalThis.fetch=async()=>({ok:false,status:503});assert.equal((await drain(d,cfg)).remaining,2);
 globalThis.fetch=async()=>({ok:true,json:async()=>({results:[{ok:true},{ok:true}]})});assert.equal((await drain(d,cfg)).remaining,0);
 enqueue(d,{clientEventId:'fourth'});assert.equal((await drain(d,{api:{enabled:false}})).skipped,true);assert.equal(pendingCount(d),1);recover(d);assert.equal(pendingCount(d),4);
});
test('ranged tar reads bounded synthetic image without whole-shard download',async()=>{
 const tar=Buffer.alloc(2048);tar.write('123.jpg');tar.write('00000000003',124);tar[156]=48;tar.write('abc',512);let ranges=[];
 const reader=new RangedTar('https://synthetic.invalid/shard',{fetchImpl:async(_u,o)=>{const range=o.headers.Range;ranges.push(range);const [,a,b]=range.match(/bytes=(\d+)-(\d+)/);return {status:206,headers:new Headers({'content-range':`bytes ${a}-${b}/${tar.length}`}),arrayBuffer:async()=>tar.subarray(Number(a),Number(b)+1)};}});
 const entry=await reader.nextEntry(0);assert.equal(entry.name,'123.jpg');assert.equal((await reader.readEntry(entry)).toString(),'abc');assert.deepEqual(ranges,['bytes=0-0','bytes=0-511','bytes=512-514']);
});
test('folder workflow: label final item, collection isolation, restart/resume, undo and stale request refusal',async t=>{
 const d=temp(t),a=path.join(d,'a'),b=path.join(d,'b');fs.mkdirSync(a);fs.mkdirSync(b);
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=','base64');
 fs.writeFileSync(path.join(a,'1.png'),png);fs.writeFileSync(path.join(b,'1.png'),png);
 const config=path.join(d,'config.json');fs.writeFileSync(config,JSON.stringify({metadata:false,collections:[{id:'a',kind:'folder',path:a},{id:'b',kind:'folder',path:b}],api:{enabled:false},duel:{enabled:true}}));
 let child,base;
 async function stop(){if(child&&child.exitCode===null){const done=once(child,'exit');child.kill('SIGTERM');await done;}child=null;}
 t.after(stop);
 async function start(){const p=await port();base=`http://127.0.0.1:${p}`;child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{PATH:process.env.PATH,PORT:String(p),CURATOR_CONFIG:config,CURATOR_DATA_DIR:path.join(d,'state')},stdio:'ignore'});for(let i=0;i<100;i++){try{const r=await fetch(base+'/api/healthz');if(r.ok)return;}catch{}await delay(30);}throw Error('not ready');}
 const req=async(url,body)=>{const r=await fetch(base+url,body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
 await start();assert.equal((await fetch(base+'/api/state',{headers:{Origin:'https://foreign.invalid'}})).status,403);
 const concurrent=await Promise.all([req('/api/next'),req('/api/next')]);assert.equal(concurrent[0].body.id,'1');assert.equal(concurrent[1].body.id,'1');
 assert.equal((await req('/api/decide',{id:'wrong',collection:'a',verdict:'like'})).status,409);
 const label={id:'1',collection:'a',verdict:'like'};assert.equal((await req('/api/decide',label)).status,200);assert.equal((await req('/api/decide',label)).status,409);
 assert.equal((await req('/api/next')).body.complete,true);assert.ok(fs.existsSync(path.join(d,'state/likes/a/1.png')));
 await stop();await start();assert.equal((await req('/api/state')).body.collections[0].counts.like,1);
 assert.equal((await req('/api/collection',{id:'b'})).status,200);assert.equal((await req('/api/next')).body.collection,'b');assert.equal((await fetch(base+'/api/keep/1')).status,404);
 const undo=await req('/api/undo',{});assert.equal(undo.status,200);assert.equal(undo.body.active,'a');assert.ok(fs.existsSync(path.join(a,'1.png')));assert.ok(!fs.existsSync(path.join(d,'state/likes/a/1.png')));
 assert.equal((await req('/api/next')).body.id,'1');
});

test('one-time local pairing stores new credentials privately and preserves existing credentials',async t=>{
 const d=temp(t),local=path.join(d,'.local');fs.mkdirSync(path.join(local,'curator'),{recursive:true});
 fs.writeFileSync(path.join(local,'dev.json'),JSON.stringify({mode:'local-founder',web:25222,db:5434,database:'ayamai_local',api:8081}));
 fs.writeFileSync(path.join(local,'curator/config.json'),'{}');
 const original=globalThis.fetch;t.after(()=>globalThis.fetch=original);
 globalThis.fetch=async url=>url.endsWith('/session')?{ok:true,headers:new Headers({'set-cookie':'synthetic=value; HttpOnly'})}:{ok:true,json:async()=>({token:'cur_synthetic_new_token',id:'synthetic-token-id'})};
 await pair(d);const token=path.join(local,'curator/data/api-token');assert.equal(fs.statSync(token).mode&0o777,0o600);
 assert.equal(JSON.parse(fs.readFileSync(path.join(local,'curator/config.json'))).api.enabled,true);
 await assert.rejects(pair(d),/Existing token preserved/);
});
