// Queue writes are synchronous; drains serialize per file and preserve appends.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
export const VERDICT_MAP = {like:'like', pass:'dislike', dislike:'dislike', neutral:'neutral', cant_judge:'cant_judge', skip:'skip'};
export const clientEventId = () => crypto.randomUUID();
export const outboxPath = dir => path.join(dir, 'outbox.jsonl');
const rows = file => fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) : [];
function append(file,record) {
  const fd=fs.openSync(file,'a',0o600);
  try { fs.writeSync(fd,JSON.stringify(record)+'\n'); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
export function enqueue(dir, record) {
  append(path.join(dir,'sync-journal.jsonl'), record);
  append(outboxPath(dir),record);
  return record;
}
// Receipts are durable in Ayamai; replay is safe even after a crash during acknowledgment.
export function recover(dir, decisions=[]) {
  const journal=rows(path.join(dir,'sync-journal.jsonl')).map(line=>JSON.parse(line));
  const pending=rows(outboxPath(dir)).map(line=>JSON.parse(line));
  const unique=new Map();
  for(const record of [...decisions,...journal,...pending]) {
    if(record.clientEventId) unique.set(record.clientEventId,record);
  }
  const payload=[...unique.values()].map(record=>JSON.stringify(record));
  const file=outboxPath(dir),temporary=file+'.tmp';
  fs.writeFileSync(temporary,payload.length?payload.join('\n')+'\n':'',{mode:0o600});fs.renameSync(temporary,file);
}
export const pendingCount = dir => rows(outboxPath(dir)).length;
export function readToken(cfg, dir) {
  if (process.env.CURATOR_API_TOKEN) return process.env.CURATOR_API_TOKEN;
  const file = path.resolve(dir, cfg?.api?.tokenFile ?? 'api-token');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim() || null : null;
}
const drains = new Map();
export function drain(dir, cfg) {
  const file = outboxPath(dir);
  if (drains.has(file)) return drains.get(file);
  const pending = drainOnce(dir, cfg).finally(() => drains.delete(file));
  drains.set(file, pending);
  return pending;
}
async function drainOnce(dir, cfg) {
  try {
    if (cfg?.api?.enabled !== true || !cfg.api.baseUrl) return {sent:0, remaining:pendingCount(dir), skipped:true};
    const token = readToken(cfg, dir);
    if (!token) return {sent:0, remaining:pendingCount(dir), error:'no-token'};
    const file = outboxPath(dir), snapshot = rows(file), batch = snapshot.slice(0,200);
    if (!batch.length) return {sent:0, remaining:0};
    const labels = batch.map(line => JSON.parse(line));
    const response = await fetch(`${cfg.api.baseUrl.replace(/\/$/,'')}/api/curator/labels/batch`, {
      method:'POST', headers:{'content-type':'application/json', authorization:`Bearer ${token}`},
      body:JSON.stringify({labels}), signal:AbortSignal.timeout(20000)
    });
    if (!response.ok) return {sent:0, remaining:pendingCount(dir), error:`HTTP ${response.status}`};
    const body = await response.json();
    if (!Array.isArray(body.results) || body.results.length !== batch.length) return {sent:0, remaining:pendingCount(dir), error:'invalid-acknowledgment'};
    const live = rows(file);
    // Refuse a queue rewritten during the request (for example by undo).
    if (!snapshot.every((line,i) => live[i] === line)) return {sent:0, remaining:live.length, error:'queue-changed'};
    const keep = live.filter((_,i) => i >= batch.length || body.results[i]?.ok !== true);
    const temporary = file+'.tmp';
    fs.writeFileSync(temporary, keep.length ? keep.join('\n')+'\n' : '', {mode:0o600});
    fs.renameSync(temporary, file);
    return {sent:live.length-keep.length, remaining:keep.length};
  } catch {
    return {sent:0, remaining:pendingCount(dir), error:'sync-failed'};
  }
}
export async function drainObservations() { return {sent:0}; }
