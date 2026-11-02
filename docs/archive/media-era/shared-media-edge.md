# Shared-media edge delivery

## Status and decision

**Opt-in implementation; not deployed or enabled.** Keep the relay as the default until a real edge/mobile canary passes. No bucket permissions, object keys, uploads, private URLs, database schema, or production configuration changed. No public bucket, media copying, payout feature, quality selection or thumbnail generation is involved.

An anonymous post's UUID is its public opaque locator. The existing R2 path can contain a sign-in account ID. Do **not** return that path, a presigned R2 URL, original filename, provider error, ETag or R2 metadata to a shared viewer.

Transport:

1. Authenticated `/api/media/{id}/view-url` still checks access. Public posts receive `https://<approved-edge-origin>/streams/{uuid}?ticket=<encrypted-five-minute-ticket>` when enabled, otherwise `/api/streams/...`. Private posts retain their existing short-lived owner-only direct R2 URL.
2. Worker accepts GET/HEAD only. It sends `{id,ticket}` in a POST body to the fixed `/api/edge/media-authorize` endpoint, authenticating with `X-Edge-Authorization: Bearer <service-secret>`. It forwards neither browser cookies nor browser authorization headers. The custom header avoids confusing Clerk's session-token parser.
3. API validates the service secret in constant time, decrypts the existing ID-bound expiring ticket, and checks adult/policy acceptance, current visibility, active moderation state, rights confirmation, publisher acceptance, and blocking in either direction. Owners cannot bypass the shared age gate. A missing/deleted post fails too. The same eligibility helper protects the original relay.
4. Only this server-to-server grant returns `{objectKey,contentType}`. The Worker reads that key using its private R2 binding and emits only safe, explicit response headers and a streamed body. The Worker does **not** need `SESSION_SECRET`, Clerk secrets, R2 S3 credentials or the database connection.
5. Every request repeats authorization, even if it has a valid old ticket. Grants and media responses have `private, no-store`; no Worker cache, positive-grant cache, public CDN caching or ETag revalidation bypass is allowed. Auth failures, timeouts, database errors, missing objects and provider exceptions fail closed. No automatic fallback to direct R2 URLs.

The edge adds an authorization round trip; it does **not** remove the API/DB from the availability path. A regional API far from a viewer can increase startup latency. First-version priority is offloading media bandwidth and long-lived connections without weaker revocation. Authorization failures deliberately return an empty 404 or 503, not internal errors.

### Revocation and ticket limits

- A ticket is a five-minute **bearer credential**, just like the existing relay ticket: possession permits replay while still eligible. It is encrypted with domain-separated AES-GCM; it is neither a public account identifier nor a durable session.
- Privacy, moderation, policy withdrawal, deletion and blocks stop the **next** authorized request. No already-streaming response or downloaded/buffered copy can be recalled; a full GET already authorized can finish after a change. This is unchanged from the relay. Do not promise instant deletion or per-byte revocation.
- Signing out alone does not invalidate a ticket; it expires within five minutes. Private direct R2 URLs have their existing separate five-minute lifetime.
- Nothing treats adult self-attestation as identity verification or third-party age assurance.
- Ticket query strings are sensitive. API logs omit queries. Worker observability is disabled in the example; before enabling any provider access logs, tracing, analytics, WAF logging or error reporting, confirm full URLs, request bodies and credentials are not captured. Never log grants or copy browser tickets into reports.

### HTTP behavior

- GET: 200 for the full body, 206 for a satisfiable single byte range, correct `Content-Length`, `Content-Range`, `Accept-Ranges: bytes`, media MIME and neutral inline filename.
- Closed (`bytes=2-4`), open (`bytes=2-`) and suffix (`bytes=-3`) ranges work. Endpoints clamp at object size. Empty, zero-length suffix, reversed, multiple, out-of-bounds and unsafe-integer ranges return 416 with `Content-Range: bytes */<size>` **only after authorization**.
- HEAD repeats access checks and returns equivalent headers without reading a body. Other methods return 405. Missing/ineligible media returns 404.
- R2 HEAD supplies current size, then GET supplies the requested range, without buffering the object in Worker memory. This deliberately costs two Class B reads per successful GET versus the relay's one; HEAD costs one.
- The relay now aborts the underlying R2 read when the browser disconnects; Worker streams rely on standard response-body cancellation. The browser already detaches offscreen video sources. These changes do not alter the Watch gesture, autoplay or Data saver contract.
- Existing `<video playsInline>`/image elements consume absolute URLs without credentials or a `crossOrigin` attribute. Cross-origin embedding needs no cookie sharing or public bucket CORS change. A future canvas/credentialed-fetch consumer would require an explicit narrow CORS policy; do not add wildcard CORS as an authorization substitute.

## Local verification and measurements

### Isolated iPhone preparation

The synthetic-only, undeployed canary now lives in
[`infrastructure/shared-media-edge/canary/`](../infrastructure/shared-media-edge/canary/README.md).
It has a separate private authority/D1 schema, real-device measurement harness,
usage limits and a blocked readiness gate. It does not use the application
database or alter this production Worker. Cloudflare Free status, write
permissions, private live ingress and the fixture HEAD remain prerequisites.
Its Cloudflare relay-shaped baseline is not the production PostgreSQL relay;
no physical Safari result or production-performance improvement is established.

Commands:

```sh
pnpm test:shared-delivery
pnpm test:social
pnpm test:validation
pnpm run typecheck
pnpm --filter @workspace/api-server run benchmark:shared-delivery
```

The deterministic Worker tests exercise range math, safe response metadata, GET/HEAD, service exchange, denied/revoked access, outages, missing storage, invalid methods/configuration, and repeated authorization. API/DB integration tests use isolated synthetic accounts/posts and test valid grants, wrong service secrets, swapped/tampered tickets, age withdrawal (including owners), publisher withdrawal, blocks both ways, private/removed/rights-withdrawn/deleted posts, and opaque URL selection. Ticket tests check encryption, ID binding, tampering and five-minute expiry. No real media is touched.

### Reproducible transport microbenchmark — 2026-10-29

`artifacts/api-server/scripts/benchmark-shared-delivery.mjs` generates a benign six-second moving FFmpeg test pattern: H.264/yuv420p, 720×1280, no audio, 895,998 bytes, fast-start MP4. Generated video and JSON live under ignored `generated-artifacts/shared-delivery/`, not Git or R2.

The harness compares a relay-shaped Node streaming pipeline with the **actual Worker handler** plus a file-backed R2 adapter and real encrypted ticket checks. Both paths get the same application-level 80ms media-response delay and 500,000 bytes/s (4Mbps) pacing, without cache reuse. Three fresh Pixel 7 mobile Chromium contexts each load a first video and replace the source four times (15 loads total). Each load plays for 300ms after `canplay`, then detaches the source. Startup means source assignment→`canplay`; swipe-to-ready means replacing the old video/source→`canplay`, not completion of an app swipe animation.

| Local mobile Chromium metric | Relay-shaped baseline | Worker handler/adapter |
| --- | ---: | ---: |
| Startup median / p95, 3 samples | 355.1 / 355.7 ms | 361.9 / 367.8 ms |
| Swipe-to-ready median / p95, 12 samples | 359.2 / 385.4 ms | 356.7 / 368.3 ms |
| Media response bodies emitted, 15 loads | 3,932,160 B | 3,932,160 B |
| API response bodies attributable to transport | 3,932,160 B media | 1,005 B internal grants |
| R2-equivalent read operations | 15 GET | 15 HEAD + 15 GET |

Interpretation: **no meaningful local startup improvement is established**. The architecture moves media-response bytes out of the API (~99.97% fewer API response-body bytes in this small fixture) but does not reduce the viewer's media bytes. Seek/retry/range patterns can multiply requests and authorization work. Measurements count application body bytes, not TLS, headers, request bodies, browser buffers or invoice bytes.

**Not measured:** real CDN locality, Worker CPU, live R2 latency, API/SQL latency, Worker→API network RTT, TLS setup, radio behavior, packet loss, physical-phone decoding or production billing. The local callback adapter has no network RTT or database, so these timings cannot predict real edge startup. Three startup samples do not establish a reliable population p95.

**Local Safari gap:** iPhone WebKit was attempted using Playwright WebKit 27.2 but could not launch because this NixOS host lacks the runtime's compatible system libraries. This local benchmark supplies no Safari numbers or physical-device support claim. Mobile Chromium is viewport/touch/UA emulation, not an Android hardware run. A subsequent operator-supplied physical iPhone export has 240/240 successful timing samples; see [the partial iPhone evidence report](shared-media-edge-iphone-results.md). Its functional checks, provider CPU and actual application-stack provenance remain unverified. Android is deferred, not passed. Edge enablement remains gated.

### Bandwidth/cost comparison

Pricing reference checked 2026-10-29:
[R2 pricing](https://developers.cloudflare.com/r2/pricing/) and
[Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/).
Use the account's actual contract, allowances, taxes and hosting invoice before budgeting.

- R2 Standard read operations: $0.36/million Class B; R2 Internet egress is listed as free. Storage is unchanged. Infrequent Access has different read and retrieval prices; do not assume this estimate applies to it.
- Worker paid Standard: $5/month minimum, 10M requests and 30M CPU-ms included, then $0.30/million requests plus $0.02/million CPU-ms. Worker data transfer is listed as free. No Worker CPU billing measurement was made here.
- Ignoring free allowances, **one million GET/range requests** cost $0.36 in R2 reads through the relay, versus $0.72 in R2 reads through this Worker. Additional marginal Worker cost is $0.30 plus `0.02 × average_CPU_ms` per million requests, when over allowances; do not confuse this with a measured total.
- The local fixture's average emitted media per load was 262,144 B. At one million such loads the API would emit about **262.144 GB** of media through the relay, versus **0.067 GB** of grant response bodies with edge delivery (67 B synthetic grant; real keys change the size). Both deliver the same 262.144 GB to viewers. Headers, errors, retries, URL issuance, incoming encrypted tickets and unrelated API traffic are extra.
- If the API host's marginal data-transfer price is `P USD/GB`, avoided body-transfer charges in that example are approximately `(262.144 − 0.067) × P`, **before** Worker/read/CPU and API authorization costs. `P` is intentionally not invented; included bandwidth and compute/connection limits may make the actual savings smaller or zero.
- Every edge request still incurs API authorization and multiple DB checks. Capacity planning must budget for those checks; batching or caching grants without revocation design would change the privacy guarantee and is not included.

## Workers Free canary preparation

**Guided-canary update:** The owner subsequently approved a guided, auto-saving
update to the already-provisioned isolated test Worker. See
[`canary/README.md`](../infrastructure/shared-media-edge/canary/README.md).
This narrowly supersedes the preparation-only hosting restriction below for
that existing canary; production publication and edge enablement remain
prohibited. The owner also approved the $5/month Workers subscription, but
this update neither purchases it nor depends on it.

The approved low-cost approach uses **Workers Free**, not Workers Paid.
Additional test infrastructure must fit within **$3/month**; this is an
approval limit, not an enforced provider spending cap. Confirm current pricing,
account-wide usage and database/API costs before provisioning. Do not assume
included credits are available or that a budget alert stops charges.

`infrastructure/shared-media-edge/wrangler.canary.example.toml` is a
**non-deployed template** for an isolated synthetic-only test. It does not
select an account plan, create a bucket, configure secrets, publish a Worker or
enable app routing. Its API origin is deliberately unusable until configured.
There are no live measurements from this template.

Unlike the production example, this canary may use a Cloudflare-provided
`workers.dev` hostname, avoiding a domain purchase. That hostname is publicly
reachable: it is not a private preview. Retain per-request authorization and a
private R2 binding; do not enable an R2 `r2.dev` public URL, add grant caching or
weaken access checks. The production example must retain `workers_dev = false`.
Do not attach this canary to production data or the production bucket.

Setup prerequisites:

1. Confirm the account is on Workers Free and review remaining R2 allowances.
   Use the Cloudflare API connection for resource inspection; the earlier MCP
   connection exposed account identity but lacked Workers/R2 permissions.
   Successful resource reads are not proof of write permissions or billing
   visibility. Do not reconnect repeatedly when the missing permission is
   unrelated to the test operation.
2. Create a new, empty **Standard** private bucket named `ayamai-edge-canary`.
   If that name already exists, verify its purpose before using it; never
   assume an existing bucket is disposable. Leave public access disabled.
3. Prepare an isolated API and database with synthetic accounts/posts only.
   A code copy is not enough: check database, authentication, storage and
   background-job configuration for production references. Do not reuse the
   published private app as the test API simply because it already exists.
4. Verify Worker-to-API ingress before testing. The current Worker sends
   `X-Edge-Authorization`, not a Replit external access token. A private hosting
   gate needs separately implemented and verified service access; do not
   disable preview privacy or place a bypass token in a URL to make it work.
5. Generate only benign fixtures. The existing local benchmark produces an
   appropriate moving test pattern, but its local relay/adapter measurements
   do not satisfy live-edge, physical-device or authorization gates.
6. Arrange sanitized timing/byte accounting, API authorization latency and
   Worker CPU evidence before the run. Keep request URL/body logging disabled;
   do not enable observability blindly to obtain CPU measurements. Preserve
   raw non-sensitive samples and failures, not only summary percentiles.
7. With the owner/operator, arrange the separately approved canary hosting
   operation. This task branch must not publish the app or provision a live
   Worker. Keep production `SHARED_MEDIA_EDGE_ORIGIN` unset.

For the physical test, use Android Chrome and iPhone Safari, each on Wi-Fi and
actual cellular service, comparing relay and edge: **eight scenarios**, each
with at least **30 startup and 30 swipe-to-ready observations** (480 total).
The user has deferred Android testing to the development backlog because no
Android device is available. The current stage therefore covers physical
iPhone Safari only: four network/transport scenarios and at least 240 timing
observations. This is a scope split, not an Android pass or permission to
enable production routing; the broader mobile gate remains outstanding.
Record device/browser versions, approximate region, connection type, fixture,
play duration, test order and cold/warm conditions. Throttling can supplement,
but cannot replace, physical cellular evidence. Do not substitute emulated
Chromium or desktop WebKit for either physical-device result.

Exercise seeks, closed/open/suffix ranges, invalid ranges and source-detach
cancellation. With old unexpired tickets, separately verify privacy, removal,
deletion, required policy withdrawal and blocking in each direction for new
GET, HEAD and range requests. Re-establish eligibility with fresh fixtures
between destructive cases. Already buffered or streaming bytes are not a
revocation failure; successful new unauthorized requests are.

Keep routing disabled until all correctness, policy and performance gates
pass. A prepared template, approved budget or successful upload is not a
completed playback verification.

## Enablement checklist — a future, explicitly approved operation

This task does not publish a Worker, change production variables or enable a bucket. The following is configuration guidance, not a migration script:

1. Review hosting/content policy, moderation coverage, takedown handling and jurisdiction-specific age assurance. Use **only benign synthetic fixtures** in performance tests.
2. Use `infrastructure/shared-media-edge/worker.mjs` and `wrangler.example.toml` as the reviewed deployment input. Bind `MEDIA` to the existing private bucket. Do not rename or copy objects, expose R2 S3 credentials, change public access, or run schema migrations.
3. Use the workspace secrets controls for API `SHARED_MEDIA_EDGE_SECRET`, and the edge provider's secret controls for Worker `EDGE_SERVICE_SECRET`, with the same independently generated high-entropy value of at least 32 characters. Neither secret belongs in Git or browser bundles. Choose deliberate rotation/revocation procedures.
4. Configure Worker `AUTH_API_ORIGIN` to the approved HTTPS origin serving `/api/edge/media-authorize`. The URL is a fixed origin (no path/query/credentials), and authorization fetches cannot redirect. Keep API ingress TLS protected and grant responses non-cacheable. If app ingress is collaborator-private, make sure a service-authenticated callback is reachable without a browser login; do not weaken the whole app's ingress to accomplish this.
5. Keep `workers_dev = false`, use an approved domain/route and disable URL/query/body logging at every layer. Confirm there are no CDN “cache everything” rules overriding `no-store`. Do not enable public bucket access or grant caching.
6. On a separate approved canary, validate actual R2 GET/HEAD/closed/open/suffix ranges, invalid/expired/tampered tickets, negative access changes, and provider/network failures using synthetic accounts. Verify status, headers, body bytes and cancellation, including browser seeks.
7. Measure cold startup and repeated swipes on physical Android Chrome and iOS Safari, on Wi-Fi and throttled mobile networks, both relay and edge, with the same fixture and foreground watch duration. Collect at least 30 samples/scenario with median/p95, media/API bytes, request count, Worker CPU and API authorization latency/error rate. Check old-ticket revocation after every relevant state change.
8. Only after correctness, policy and performance acceptance, configure API `SHARED_MEDIA_EDGE_ORIGIN` to the approved HTTPS **origin** (no path or query). The API refuses malformed or incomplete edge configuration instead of silently changing delivery. Public URL issuance then selects edge; private URL issuance is unchanged.
9. Roll back routing by removing `SHARED_MEDIA_EDGE_ORIGIN`; newly issued URLs return to the relay. Existing edge tickets can last five minutes and still reauthorize. For emergency edge shutdown revoke the service secret/remove the Worker route. Never “fix” an outage with public R2 or a direct shared-media redirect.

Do not call this production-ready until the real edge/mobile gates pass.
