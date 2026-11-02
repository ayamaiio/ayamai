#!/usr/bin/env node
// Deliberately bounded, private CC0 sample import. No schema or access changes.
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const SAMPLE = [
  {title:'Anime illustration — oksmith', artist:'oksmith', file:'Anime_girl_publicdomainq.png', mime:'image/png', sha1:'f2743c2ead67b6be09a8b39fa0259ae6bfb431af', url:'https://upload.wikimedia.org/wikipedia/commons/e/e7/Anime_girl_publicdomainq.png'},
  {title:'Red suit illustration — jsks', artist:'jsks', file:'Red_suit_anime_girl_with_board.png', mime:'image/png', sha1:'5397f9a709da3b4fec40bbf1c13f9fa45119854f', url:'https://upload.wikimedia.org/wikipedia/commons/5/5c/Red_suit_anime_girl_with_board.png'},
  {title:'Anime portrait — Artbreeder', artist:'Artbreeder (AI-generated)', file:'Anime_girl_portrait.jpg', mime:'image/jpeg', sha1:'973ce398d4ab40a759ac9c6a17a203cc8d57832a', url:'https://upload.wikimedia.org/wikipedia/commons/5/5d/Anime_girl_portrait.jpg'},
].map(x => ({...x, license:'CC0-1.0', source:`https://commons.wikimedia.org/wiki/File:${encodeURIComponent(x.file)}`}));

export function validateManifest(items) {
  if (items.length !== 3) throw new Error('Expected the reviewed three-image sample.');
  for (const item of items) {
    const u = new URL(item.url);
    if (u.origin !== 'https://upload.wikimedia.org' || u.username || u.password || u.search || u.hash || !u.pathname.startsWith('/wikipedia/commons/')) throw new Error('Unexpected image source.');
    if (item.license !== 'CC0-1.0' || !/^[a-f0-9]{40}$/.test(item.sha1) || !['image/png','image/jpeg'].includes(item.mime)) throw new Error('Invalid reviewed manifest entry.');
  }
}

export async function download(item, fetcher = fetch) {
  const response = await fetcher(item.url, {redirect:'error', signal:AbortSignal.timeout(30000), headers:{'User-Agent':'AyamaiPublicArtSample/1.0 (three reviewed Commons files)'}});
  if (!response.ok || response.headers.get('content-type')?.split(';')[0] !== item.mime) throw new Error('Image request failed or has an unexpected content type.');
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 3 * 1024 * 1024) throw new Error('Image exceeds sample size limit.');
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks);
  const signatureOk = item.mime === 'image/png'
    ? bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
    : bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (!signatureOk || createHash('sha1').update(bytes).digest('hex') !== item.sha1) throw new Error('Reviewed file checksum or image signature does not match.');
  return {...item, bytes, sha256:createHash('sha256').update(bytes).digest('hex')};
}

export function checkDestination(env, expectedHost) {
  if (!expectedHost) throw new Error('--expected-db-host is required with --apply.');
  const url = new URL(env.DATABASE_URL);
  if (!['postgresql:','postgres:'].includes(url.protocol) || url.hostname !== expectedHost) throw new Error('Database host does not match the explicit destination.');
  if (!env.APP_OWNER_EMAIL || !env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_R2_ACCESS_KEY_ID || !env.CLOUDFLARE_R2_SECRET_ACCESS_KEY || !env.CLOUDFLARE_R2_BUCKET_NAME) throw new Error('Missing owner, database, or R2 configuration.');
  if (!/^[a-f0-9]{32}$/.test(env.CLOUDFLARE_ACCOUNT_ID)) throw new Error('Invalid R2 account identifier.');
}

async function apply(items, expectedHost) {
  checkDestination(process.env, expectedHost);
  // Resolve the application's existing dependencies; no new runtime packages.
  const require = createRequire(new URL('../artifacts/api-server/package.json', import.meta.url));
  const {Client} = require('pg');
  const {S3Client, HeadObjectCommand, PutObjectCommand} = require('@aws-sdk/client-s3');
  const client = new Client({connectionString:process.env.DATABASE_URL, connectionTimeoutMillis:10000});
  const s3 = new S3Client({region:'auto', endpoint:`https://${process.env.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`, credentials:{accessKeyId:process.env.CLOUDFLARE_R2_ACCESS_KEY_ID, secretAccessKey:process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY}});
  let inserted = 0; let skipped = 0;
  try {
    await client.connect();
    const owners = await client.query("SELECT user_id FROM access_memberships WHERE role='owner' AND status='active' AND email=$1", [process.env.APP_OWNER_EMAIL.trim().toLowerCase()]);
    if (owners.rows.length !== 1) throw new Error('Expected one active configured founder. No membership changes were made.');
    const owner = owners.rows[0].user_id;
    for (const item of items) {
      const key = `media/${owner}/public-art/${item.sha256}`;
      const Bucket = process.env.CLOUDFLARE_R2_BUCKET_NAME;
      let exists = false;
      try {
        const head = await s3.send(new HeadObjectCommand({Bucket, Key:key}));
        if (head.Metadata?.sha256 !== item.sha256 || Number(head.ContentLength) !== item.bytes.length || head.ContentType !== item.mime) throw new Error('Existing sample object differs; refusing to overwrite.');
        exists = true;
      } catch (error) { if (error.$metadata?.httpStatusCode !== 404) throw error; }
      if (!exists) {
        try {
          await s3.send(new PutObjectCommand({Bucket, Key:key, Body:item.bytes, ContentType:item.mime, Metadata:{sha256:item.sha256}, IfNoneMatch:'*'}));
        } catch (error) {
          if (error.$metadata?.httpStatusCode !== 412) throw error;
          const head = await s3.send(new HeadObjectCommand({Bucket, Key:key}));
          if (head.Metadata?.sha256 !== item.sha256 || Number(head.ContentLength) !== item.bytes.length || head.ContentType !== item.mime) throw new Error('Concurrent object conflicts with sample.');
        }
      }
      const description = `Artist: ${item.artist}\nLicense: CC0 1.0\nSource: ${item.source}\nLicense terms: https://creativecommons.org/publicdomain/zero/1.0/\nSHA-256: ${item.sha256}`;
      const r = await client.query(`INSERT INTO media_items
        (user_id,title,collection,description,tags,visibility,attribution,moderation_state,original_name,object_key,content_type,media_type,size)
        VALUES ($1,$2,'Public art sample',$3,$4,'private','anonymous','active',$5,$6,$7,'image',$8)
        ON CONFLICT (object_key) DO NOTHING RETURNING id`,
        [owner,item.title,description,['anime','non-explicit','cc0','public-art-sample'],item.file,key,item.mime,item.bytes.length]);
      if (r.rowCount) inserted++; else {
        const duplicate = await client.query('SELECT user_id FROM media_items WHERE object_key=$1',[key]);
        if (duplicate.rows.length !== 1 || duplicate.rows[0].user_id !== owner) throw new Error('Existing record ownership conflicts with sample.');
        skipped++;
      }
    }
    console.log(JSON.stringify({inserted,skipped,collection:'Public art sample',visibility:'private'}));
  } finally { await client.end().catch(()=>{}); s3.destroy(); }
}

export async function main(args = process.argv.slice(2)) {
  if (args.some(x=>x !== '--apply' && !x.startsWith('--expected-db-host='))) throw new Error('Usage: import-public-art.mjs [--apply --expected-db-host=HOST]');
  validateManifest(SAMPLE);
  const expectedHost = args.find(x=>x.startsWith('--expected-db-host='))?.split('=')[1];
  if (args.includes('--apply')) checkDestination(process.env,expectedHost);
  const items = [];
  for (const item of SAMPLE) items.push(await download(item));
  console.log(JSON.stringify({reviewed:items.length,bytes:items.reduce((n,x)=>n+x.bytes.length,0),mode:args.includes('--apply')?'apply':'check-only'}));
  if (args.includes('--apply')) await apply(items,expectedHost);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {console.error('Public art import failed. Check source availability, destination, configuration, and permissions locally. Credentials and database error details are suppressed. Completed items are safe to retry.'); process.exitCode=1;});
}
