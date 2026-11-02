import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import express from "express";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { eq, like } from "drizzle-orm";
import {
  db,
  pool,
  accessMembershipsTable as memberships,
  curatorDuelsTable as duels,
  curatorItemTagsTable as itemTags,
  curatorItemsTable as items,
  curatorLabelsTable as labels,
  curatorObservationsTable as observations,
  mediaItemsTable as media,
  socialRateLimitsTable as rateLimits,
  curatorTokensTable as tokens,
} from "@workspace/db";
import curatorRouter from "../routes/curator";
import { createLocalFounderAuth, LOCAL_DEV_SUBJECT } from "./local-dev-auth";
import { tagKey, tagKeyFellBack } from "./tag-key";

test("tag key contract: canonical when possible, conservative fallback otherwise", () => {
  assert.equal(tagKey(" #ＡＱＵＡ "), "aqua");
  assert.equal(tagKey("Aqua Blue"), "aqua-blue");
  assert.equal(tagKey("long_hair"), "long_hair");
  // Danbooru-style keys fall back without throwing or rewriting the content.
  assert.equal(tagKey("amano_misao_(battle_programmer_shirase)"), "amano_misao_(battle_programmer_shirase)");
  assert.equal(tagKey(":o"), ":o");
  assert.equal(tagKeyFellBack(":o"), true);
  assert.equal(tagKeyFellBack("aqua"), false);
  assert.equal(tagKey("K-ON!"), "k-on!");
});

test("curator api: content, preference, revisions, isolation, duels, observations, linking and export", async (t) => {
  const prefix = `curator-test-${randomUUID()}`;
  const owner = `${prefix}-owner`;
  const other = `${prefix}-other`;
  const users = [owner, other];
  const source = `${prefix}`;

  await db.insert(memberships).values([
    { userId: owner, email: `${owner}@example.test`, role: "member", status: "active" },
    { userId: other, email: `${other}@example.test`, role: "member", status: "active" },
  ]);

  const app = express();
  app.use(express.json());
  const localAuth=createLocalFounderAuth();
  app.use(localAuth.middleware);
  app.post("/api/dev-auth/session",localAuth.createSession);
  app.use((req, _res, next) => {
    const uid = req.get("x-test-user") ?? null;
    Object.assign(req, { auth: Object.assign(() => ({ userId: uid, tokenType: "session_token" }), { [Symbol.for("@clerk/express.auth")]: true }) });
    next();
  });
  app.use("/api", curatorRouter);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.on("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api`;
  const request = (uid: string | null, path: string, method = "GET", body?: unknown) =>
    fetch(base + path, {
      method,
      headers: { ...(uid ? { "x-test-user": uid } : {}), "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  try {
    // 1. content and preference are separate calls
    const itemRes = await request(owner, "/curator/items", "POST", {
      source, sourcePostId: "1000", sha256: "a".repeat(64), width: 400, height: 300, rating: "s", score: 21,
      tags: [
        { tag: "long_hair", provenance: "source", state: "present" },
        { tag: ":o", provenance: "model", state: "unknown" },
        { tag: "school_uniform", provenance: "human", state: "absent" },
      ],
    });
    assert.equal(itemRes.status, 201);
    const item = await itemRes.json() as { id: string };

    const labelRes = await request(owner, "/curator/labels", "POST", {
      source, sourcePostId: "1000", verdict: "like", dwellMs: 2400, zooms: 1, mode: "queue",
      clientEventId: "event-000001",
    });
    assert.equal(labelRes.status, 200);
    const first = await labelRes.json() as { revision: number; verdict: string };
    assert.equal(first.revision, 1);

    // 2. idempotent retry returns the same revision
    const retry = await request(owner, "/curator/labels", "POST", {
      source, sourcePostId: "1000", verdict: "like", dwellMs: 2400, zooms: 1, mode: "queue",
      clientEventId: "event-000001",
    });
    assert.equal((await retry.json() as { duplicate: boolean }).duplicate, true);

    // 3. stale revision is rejected
    const stale = await request(owner, "/curator/labels", "POST", {
      source, sourcePostId: "1000", verdict: "dislike", expectedRevision: 7,
    });
    assert.equal(stale.status, 409);

    // 4. correction bumps revision and records history
    const corrected = await request(owner, "/curator/labels", "POST", {
      source, sourcePostId: "1000", verdict: "cant_judge", expectedRevision: 1, mode: "inspect",
    });
    assert.equal(corrected.status, 200);
    assert.equal((await corrected.json() as { revision: number }).revision, 2);

    const detail = await request(owner, `/curator/items/${item.id}`);
    const detailBody = await detail.json() as { label: { verdict: string }; history: unknown[]; tags: Array<{ tag: string; provenance: string; state: string; keyFallback: boolean }> };
    assert.equal(detailBody.label.verdict, "cant_judge");
    assert.equal(detailBody.history.length, 2);
    assert.equal(detailBody.tags.length, 3);
    assert.equal(detailBody.tags.find((tag) => tag.tag === ":o")?.keyFallback, true);
    assert.equal(detailBody.tags.find((tag) => tag.tag === "school_uniform")?.state, "absent");

    // 5. another account sees no label for this item
    const otherView = await request(other, `/curator/items/${item.id}`);
    assert.equal(otherView.status, 404);

    // 6. duels: distinct outcomes, self-duel rejected
    const duel = await request(owner, "/curator/duels", "POST", {
      left: { source, sourcePostId: "1000" }, right: { source, sourcePostId: "1001" },
      outcome: "left", dwellMs: 900, sessionId: "session-1",
    });
    assert.equal(duel.status, 201);
    const selfDuel = await request(owner, "/curator/duels", "POST", {
      left: { source, sourcePostId: "1000" }, right: { source, sourcePostId: "1000" }, outcome: "tie",
    });
    assert.equal(selfDuel.status, 400);

    // 7. observations deduplicate by client event id
    const batch = {
      events: [
        { clientEventId: "obs-000001", type: "shown", occurredAt: new Date().toISOString(), payload: { ms: 10 } },
        { clientEventId: "obs-000002", type: "zoom", occurredAt: new Date().toISOString(), payload: { level: 1.5 } },
      ],
    };
    const firstBatch = await request(owner, "/curator/observations", "POST", batch);
    assert.equal((await firstBatch.json() as { accepted: number }).accepted, 2);
    const replay = await request(owner, "/curator/observations", "POST", batch);
    assert.deepEqual(await replay.json(), { accepted: 0, duplicates: 2 });

    // 8. linking preserves every judgment
    const mediaId = randomUUID();
    await db.insert(media).values({
      id: mediaId, userId: owner, title: "linked fixture", originalName: "fixture.png",
      objectKey: `${prefix}/fixture.png`, contentType: "image/png", mediaType: "image", size: 1024,
    });
    const link = await request(owner, `/curator/items/${item.id}/link`, "POST", { mediaId });
    assert.equal(link.status, 200);
    const afterLink = await request(owner, `/curator/items/${item.id}`);
    assert.equal((await afterLink.json() as { label: { verdict: string } }).label.verdict, "cant_judge");

    // 9. export is newline JSON with provenance intact
    const exported = await request(owner, "/curator/export?limit=10");
    assert.equal(exported.status, 200);
    assert.ok(exported.headers.get("x-curator-cursor"));
    const lines = (await exported.text()).trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
    assert.equal(lines.length, 1);
    assert.equal(lines[0].recordType, "curator_label");
    assert.equal(lines[0].label.verdict, "cant_judge");
    assert.equal(lines[0].item.mediaId, mediaId);
    assert.deepEqual(
      new Set(lines[0].tags.map((tag: { provenance: string }) => tag.provenance)),
      new Set(["source", "model", "human"]),
    );

    // 10. coverage keeps cant_judge separate from preference
    const coverage = await request(owner, "/curator/coverage");
    const coverageBody = await coverage.json() as { cantJudge: number; verdicts: Record<string, number>; tags: { normalizationFallback: number } };
    assert.equal(coverageBody.cantJudge, 1);
    assert.equal(coverageBody.verdicts.cant_judge, 1);
    assert.equal(coverageBody.verdicts.like, undefined);
    assert.equal(coverageBody.tags.normalizationFallback, 1);

    // Scoped token integration: generated test tokens stay in memory.
    const minted = await request(owner, "/curator/tokens", "POST", {label:"synthetic-test"});
    assert.equal(minted.status,201);
    const credential = await minted.json() as {id:string;token:string};
    const tokenRequest = (url:string, body?:unknown) => fetch(base+url, {method:body ? "POST":"GET", headers:{authorization:`Bearer ${credential.token}`,"content-type":"application/json"},body:body ? JSON.stringify(body):undefined});
    assert.equal((await tokenRequest("/curator/export")).status,403);
    assert.equal((await tokenRequest("/curator/tokens",{})).status,403);
    const batchPayload = {labels:[{source,sourcePostId:"2000",verdict:"like",clientEventId:"token-event-one"}]};
    assert.equal((await tokenRequest("/curator/labels/batch",batchPayload)).status,200);
    const repeated = await tokenRequest("/curator/labels/batch",batchPayload);
    assert.equal((await repeated.json() as {results:Array<{duplicate:boolean}>}).results[0].duplicate,true);
    await tokenRequest("/curator/labels/batch",{labels:[{source,sourcePostId:"2000",verdict:"dislike",clientEventId:"token-event-two"}]});
    const delayed = await tokenRequest("/curator/labels/batch",batchPayload);
    assert.equal((await delayed.json() as {results:Array<{duplicate:boolean}>}).results[0].duplicate,true);
    const tokenExport = await request(owner,"/curator/export");
    assert.ok((await tokenExport.text()).includes('"verdict":"dislike"'));
    // Real standalone image -> outbox -> scoped API -> database -> undo.
    const fixture=fs.mkdtempSync(path.join(os.tmpdir(),"curator-linked-test-"));
    const images=path.join(fixture,"images");fs.mkdirSync(images);
    fs.writeFileSync(path.join(images,"3000.png"),Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=","base64"));
    const data=path.join(fixture,"data");fs.mkdirSync(data);fs.writeFileSync(path.join(data,"api-token"),credential.token,{mode:0o600});
    const config=path.join(fixture,"config.json");fs.writeFileSync(config,JSON.stringify({metadata:false,collections:[{id:source,kind:"folder",path:images}],api:{enabled:true,baseUrl:base.replace(/\/api$/,""),tokenFile:"api-token"}}));
    const reserve=net.createServer();reserve.listen(0,"127.0.0.1");await once(reserve,"listening");const port=(reserve.address() as net.AddressInfo).port;await new Promise<void>(resolve=>reserve.close(()=>resolve()));
    const appRoot=fileURLToPath(new URL("../../../../apps/curator/",import.meta.url));
    const child=spawn(process.execPath,["server.mjs"],{cwd:appRoot,env:{PATH:process.env.PATH,PORT:String(port),CURATOR_CONFIG:config,CURATOR_DATA_DIR:data},stdio:"ignore"});
    const curatorBase=`http://127.0.0.1:${port}`;
    const wait=async(fn:()=>Promise<boolean>)=>{for(let i=0;i<100;i++){try{if(await fn())return;}catch{}await new Promise(resolve=>setTimeout(resolve,30));}throw Error("linked curator timeout");};
    try {
      await wait(async()=> (await fetch(curatorBase+"/api/healthz")).ok);
      assert.equal((await fetch(curatorBase+"/api/next")).status,200);
      assert.equal((await fetch(curatorBase+"/api/decide",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id:"3000",collection:source,verdict:"like"})})).status,200);
      await wait(async()=>{const response=await request(owner,"/curator/export");return (await response.text()).includes('"sourcePostId":"3000"');});
      assert.equal((await fetch(curatorBase+"/api/undo",{method:"POST"})).status,200);
      await wait(async()=>{const response=await request(owner,"/curator/export");return (await response.text()).split("\n").some(line=>line.includes('"sourcePostId":"3000"')&&line.includes('"verdict":"skip"'));});
    } finally {
      if(child.exitCode===null){const exited=once(child,"exit");child.kill("SIGTERM");await exited;}
      fs.rmSync(fixture,{recursive:true,force:true});
    }
    const revocation=await request(owner,`/curator/tokens/${credential.id}`,"DELETE");assert.equal(revocation.status,200);
    assert.equal((await tokenRequest("/curator/labels/batch",batchPayload)).status,401);

    // Existing local founder cookie pairs through the real session middleware.
    await db.insert(memberships).values({userId:LOCAL_DEV_SUBJECT,email:"synthetic-founder@example.test",role:"owner",status:"active"});
    const oldMode=process.env.AYAMAI_DEV_AUTH_MODE;
    process.env.AYAMAI_DEV_AUTH_MODE="local-founder";
    try {
      const localSession=await fetch(base+"/dev-auth/session",{method:"POST",headers:{Origin:"http://localhost:25222"}});
      assert.equal(localSession.status,200);
      const cookie=localSession.headers.get("set-cookie")!.split(";")[0];
      const paired=await fetch(base+"/curator/tokens",{method:"POST",headers:{Cookie:cookie,"content-type":"application/json"},body:"{}"});
      assert.equal(paired.status,201);
    } finally {
      if(oldMode===undefined) delete process.env.AYAMAI_DEV_AUTH_MODE;else process.env.AYAMAI_DEV_AUTH_MODE=oldMode;
      await db.delete(tokens).where(eq(tokens.labelerAccountId,LOCAL_DEV_SUBJECT));
      await db.delete(memberships).where(eq(memberships.userId,LOCAL_DEV_SUBJECT));
    }
    // 11. unauthenticated requests are rejected
    const anonymous = await request(null, "/curator/coverage");
    assert.equal(anonymous.status, 401);
  } finally {
    await db.delete(tokens).where(like(tokens.labelerAccountId, `${prefix}%`));
    await db.delete(items).where(eq(items.source, source));
    await db.delete(media).where(like(media.objectKey, `${prefix}/%`));
    await db.delete(rateLimits).where(like(rateLimits.key, `${prefix}%`));
    await db.delete(memberships).where(like(memberships.userId, `${prefix}%`));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("curator schema: preferences cannot express content states", async () => {
  // Guard against future vocabulary drift: the two domains are disjoint.
  const { PREFERENCE_VERDICTS, TAG_STATES } = await import("./curator-labels");
  for (const state of ["present", "absent", "unknown"]) {
    assert.equal((PREFERENCE_VERDICTS as readonly string[]).includes(state), false);
  }
  for (const verdict of ["like", "neutral", "dislike", "skip", "cant_judge"]) {
    assert.equal((TAG_STATES as readonly string[]).includes(verdict), false);
  }
});

test.after(async () => {
  await pool.end().catch(() => {});
});
