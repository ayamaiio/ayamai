import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {SAMPLE, validateManifest, download, checkDestination} from './import-public-art.mjs';

test('reviewed sample is fixed and rejects unapproved hosts and licenses', () => {
  validateManifest(SAMPLE);
  assert.throws(()=>validateManifest(SAMPLE.slice(1)));
  assert.throws(()=>validateManifest(SAMPLE.map((x,i)=>i?x:{...x,url:'https://example.com/a.png'})));
  assert.throws(()=>validateManifest(SAMPLE.map((x,i)=>i?x:{...x,license:'unknown'})));
});

const bytes = Buffer.from([137,80,78,71,13,10,26,10,1,2,3]);
const item = {...SAMPLE[0],sha1:createHash('sha1').update(bytes).digest('hex')};
const response = (body=bytes,type='image/png')=>new Response(body,{headers:{'content-type':type}});

test('download hashes the bytes and forbids redirects', async () => {
  const result = await download(item,async (url,opts)=>{
    assert.equal(url,item.url); assert.equal(opts.redirect,'error'); return response();
  });
  assert.deepEqual(result.bytes,bytes);
  assert.equal(result.sha256,createHash('sha256').update(bytes).digest('hex'));
});

test('download rejects changed bytes, wrong MIME, and oversized responses',async () => {
  await assert.rejects(download({...item,sha1:'0'.repeat(40)},async()=>response()));
  await assert.rejects(download(item,async()=>response(bytes,'text/html')));
  await assert.rejects(download(item,async()=>response(Buffer.alloc(3*1024*1024+1))));
});

test('apply requires matching destination and complete R2 configuration',()=>{
  const env={DATABASE_URL:'postgresql://user:password@aws-db.example/ayamai',APP_OWNER_EMAIL:'owner@example.com',CLOUDFLARE_ACCOUNT_ID:'a'.repeat(32),CLOUDFLARE_R2_ACCESS_KEY_ID:'test',CLOUDFLARE_R2_SECRET_ACCESS_KEY:'test',CLOUDFLARE_R2_BUCKET_NAME:'rei'};
  checkDestination(env,'aws-db.example');
  assert.throws(()=>checkDestination(env));
  assert.throws(()=>checkDestination(env,'old-db.example'));
  assert.throws(()=>checkDestination({...env,CLOUDFLARE_R2_SECRET_ACCESS_KEY:''},'aws-db.example'));
});
