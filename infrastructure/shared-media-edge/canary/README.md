# Isolated iPhone Safari canary

**Current status:** the owner completed the guided iPhone pass. Use the
[guided workflow below](#guided-iphone-canary) and
[the measured results](../../../docs/shared-media-edge-iphone-results.md).
The original provisioning material is preserved below as historical reference,
not instructions to redeploy over the guided wrapper. It predates the saved
physical-device evidence, provider CPU retrieval and approval of Workers Paid.
Production edge enablement remains prohibited.

## Historical provisioning reference

**Provisioned and smoke-checked; ready for physical-iPhone measurements.** Never point this tool at the
application API, either application database, the production bucket, or a
production edge route. Provisioning is an explicit CLI action, not an automatic
hook. The current provider-backed readiness check passes; it does not prove
physical Safari playback, Worker CPU or production-stack performance.

Verified gateway: https://ayamai-edge-canary.markfoster314.workers.dev

## Architecture and evidence limits

- `gateway.mjs`: separate `ayamai-edge-canary` Worker; serves only the harness
  and synthetic media endpoints. `/control/*` requires the operator secret.
- `authority.mjs`: separate `ayamai-edge-canary-api` Worker with **no public
  route, workers.dev URL or preview URL**. It is reachable only through the
  gateway's private `AUTHORITY` service binding, plus service authentication.
- `schema.sql`: dedicated synthetic-only `ayamai-edge-canary-db` D1 database. The local
  tests execute it against a fresh in-memory SQLite database, not managed
  development/production PostgreSQL.
- Both R2 bindings are limited to **ayamai-edge-canary**. Capability wrappers
  permit only **benign-test-pattern.mp4**, Standard storage, `video/mp4`, maximum
  16 MiB. No R2 S3 credentials or production secrets are needed.
- Edge media requests use the existing `../worker.mjs` handler unchanged, with
  private service-binding authorization. The relay-shaped path streams through
  the isolated authority. Every GET, HEAD and range reauthorizes against the
  current synthetic run state. Bearer tickets expire after five minutes.
- Different operator runs have independent synthetic visibility, rights,
  acceptance, removal, deletion and blocking states. Nothing changes a real
  account, post or fixture object.

This is a **Cloudflare/D1 synthetic authority**, not the deployed Express/
PostgreSQL application. The relay-shaped path also uses HEAD+GET, unlike the
production relay's one S3 GET. It can establish transport, iPhone compatibility,
range/cancellation and synthetic revocation behavior. Its latency and API-byte
results **cannot establish the production baseline**, production SQL latency,
regional application RTT or permission parity. Passing it does not authorize
production edge enablement; that still needs an approved isolated replica of
the real API/database and a separate performance assessment.

## Current provider checks

After the user granted Billing Read and approved conditional canary creation:

- Subscription reads now succeed. The account lists only its existing R2 Paid
  subscription, not Workers Paid. Together with the reported 100,000/day Free
  allowance, this clears the Workers Free account-plan check. No plan changed.
- Created `ayamai-edge-canary-db`, verified its exact three-table schema and
  initial empty state, then used it only for isolated synthetic smoke runs.
  Neither application DB was accessed.
- Both named canary Workers were uploaded using the connected scoped credential.
  The authority's workers.dev and preview URLs were explicitly disabled and
  checked. Gateway→authority service binding, private fixture HEAD and
  anonymous-control rejection all passed.
- The fixture is 895,998 bytes with `video/mp4` metadata. Both transports passed
  HEAD 200, a 16-byte range 206, multiple-range rejection 416 and old-ticket
  privacy revocation 404. This is HTTP evidence, not actual iPhone playback.
- The operator credential passed validation. No secret value was written into
  source, reports or logs. Internal service/ticket keys are distinct.
- All readiness gates now pass. Physical-device samples and provider CPU
  measurements remain outstanding; Android remains deferred.

Historical baseline before those updates:

Read-only Cloudflare API checks on 2026-10-29 confirmed:

- Canary bucket exists, is Standard and is located in ENAM.
- Its managed `r2.dev` endpoint is disabled; no custom domains are attached.
- The account currently lists no Worker scripts and no D1 databases.
- The connected account-owned token verifies as active.
- Subscriptions and token-policy detail reads are denied (403). Consequently,
  **Workers Free and deployment/write scopes are not verified**. A user-token
  verification 401 did not diagnose this account-owned token as invalid.

No remote resource was created, uploaded, deleted or reconfigured. The fixture's
existence is user-reported; a private object HEAD, MIME and size check remains
required. Configuration-only private ingress is not live Cloudflare evidence.

## Free-plan and cost guardrails

Sources, checked 2026-10-29:
[Workers](https://developers.cloudflare.com/workers/platform/pricing/),
[D1](https://developers.cloudflare.com/d1/platform/pricing/),
[R2](https://developers.cloudflare.com/r2/pricing/).

| Resource | Constraint / additional estimate |
| --- | --- |
| Workers | Free only: 100,000 requests/day, 10 ms CPU/invocation; no Paid upgrade |
| D1 | Free: 5 million rows read/day, 100,000 written/day, 5 GB account storage |
| R2 requests | Atomic, shared monthly cap of 10,000 successful grants/health reservations; at most 20,000 R2 reads |
| R2 storage | One existing Standard fixture, at most 16 MiB; no copies/uploads |
| Additional services | None: no paid logs, custom domains, VMs, PostgreSQL hosts or device subscriptions |

Conservative additional R2 allowance with **zero available shared free tier**:
one whole million Class B operations at $0.36 plus one whole GB-month at $0.015
= **$0.375/month**. Worker/D1 cost is $0 only on verified Free. This deliberately
rounds up the much smaller canary workload and stays below the user's $3/month
ceiling. The quota is reserved in D1 before touching R2, including health HEADs;
failure/exhaustion closes access instead of upgrading or falling back.

This is not a provider-wide spending cap. Existing account usage, outside
administration and later plan changes are outside the quota. No Class A
operations, object copies or writes should be introduced; they are not included
in the estimate. Recheck plan and account usage before each measurement session.
Do not solve a 10 ms CPU limit failure by enabling Workers Paid.

## Deployment gate and permissions

```sh
pnpm test:edge-canary
pnpm check:edge-canary
```

The second command currently exits **0** with no blockers. It checks the
two example configurations and `readiness-evidence.json`; it never deploys.
Evidence expires after 24 hours, so refresh provider checks before reprovisioning.

Before **any** remote deployment, independently review:

1. Workers Free status and the additional-cost calculation.
2. The connected credential's account-scoped **Workers Scripts Write**, **D1
   Write**, and **Workers R2 Storage Read** capabilities/resource scope. Reading
   Worker metadata is not proof of write permission. Use the integration's
   secure credential settings, not chat or source, for credential updates.
   Subscriptions require **Billing Read** (not Billing Write); an authoritative
   Workers Free dashboard screenshot can be reviewed instead of broadening the
   token's billing access. Permission-policy screenshots must show capability
   names/resource scope, never token values.
3. Explicit account selection, dedicated D1 identity and empty synthetic
   schema, both exact canary bucket bindings, no production secrets or data,
   no production routes, and observability/preview URLs disabled.
4. Private ingress topology: API workers.dev disabled, no routes, no alternate
   public endpoint, and only the named gateway service binding.
5. Explicit approval for canary-only remote provisioning/deployment. The user
   has now approved isolated canary creation **after checks pass**. This does
   not waive the Free-plan/cost checks or authorize production changes.

Live service-binding ingress cannot be proven before those resources exist.
Current readiness therefore remains blocked. Any staged creation needed for
that proof must be explicitly approved after the other checks, must remain
private, and must not be confused with a completed ingress check. Before any
public gateway is made usable, verify the live binding and private API policy.
The final gate additionally requires verified ingress and a private fixture
HEAD. Never fill an evidence field with “verified” merely to make a gate pass.

The configurations now select the verified account and isolated canary D1
identity. `provision.mjs --apply` performs the explicitly approved staged
provisioning through the existing Cloudflare connector. It refuses unexpected
plans, accounts, bindings and schemas; the gateway's probe phase permits only
authenticated health checks until the final readiness gate passes. Failed
verification disables the gateway endpoint. Existing canary Workers require an
explicit `--resume` and matching synthetic-canary bindings before reuse.

The REST-upload packaging embeds the exact local harness HTML/JavaScript using
`gateway-runtime.mjs` instead of provisioning a separate assets service. The
existing Wrangler configurations describe the equivalent native-assets setup.
Do not use the general app's Publish action for this canary.

Worker upload success does not prove the active gateway phase has propagated.
The provisioner waits for the authenticated health response's explicit `ready`
phase, not just HTTP 200 (probe health also returns 200). Retries are restricted
to recognized pre-dispatch probe responses; ambiguous control failures are
never blindly replayed. The relay's local authorization dispatch deliberately
constructs only method/headers/body instead of forwarding network-fetch options
into the Workers Request constructor.

## Secret names (future canary workers only)

Create only after prerequisites/permission approval through secure secrets:

| Name | Location | Purpose |
| --- | --- | --- |
| `CANARY_SERVICE_SECRET` | Both canary Workers | Authenticates private gateway→authority calls |
| `CANARY_TICKET_SECRET` | Both canary Workers | Isolated encrypted five-minute synthetic tickets |
| `CANARY_OPERATOR_SECRET` | Replit Secrets/provisioning process and gateway; entered into harness password input | Starts runs and permits test-state controls |
| `CANARY_ONLY` | Both configs, nonsecret | Must equal `synthetic-v1` |
| `CANARY_BUCKET` | Both configs, nonsecret | Must equal `ayamai-edge-canary` |
| `AUTHORITY` | Gateway private service binding | Fixed isolated API; never a public production API URL |
| `DB` | Authority D1 binding only | Fresh isolated canary database |
| `MEDIA` | Both private R2 bindings | Only the canary bucket |

The operator credential must be a unique, strong 32–256-character ASCII password
or passphrase supplied through secure input. The provisioner derives the two
distinct 64-character service/ticket keys from it with HMAC-SHA256 and different
canary-only domain labels. It consumes all values in memory and uploads them
directly into Cloudflare secret bindings, without writing or logging them.
The operator credential is therefore the canary root credential; rotating it
and rerunning provisioning rotates the derived credentials and old tickets.
Never reuse `SESSION_SECRET`, Clerk, R2 S3 or existing edge-service
secrets. The operator secret lives only in page memory and request headers,
not browser storage, media URLs, exports or logs. All media URLs contain bearer
tickets: do not copy them into reports or enable URL/request tracing.

## Physical-iPhone operator procedure

After all gates and explicit deployment approval:

1. Open only the **verified canary gateway origin** on a physical iPhone in
   Safari. Do not use the application preview `/library` or claim desktop
   WebKit/Chromium emulation as iPhone evidence.
2. Enter the canary operator secret; check private ingress/fixture readiness,
   start a new synthetic run and confirm the physical-device declaration.
3. Use four scenarios: Wi-Fi/relay, Wi-Fi/edge, cellular/relay, cellular/edge.
   Disable the other radio in iOS Settings, record iPhone/iOS/browser version,
   Low Power/Data Mode and date, and alternate transport order across runs.
   The browser cannot independently prove the radio or physical device.
4. For each scenario collect **at least 30 successful startup and 30 successful
   swipe-to-ready samples**. Startup uses a fresh video element. Swipes replace
   the playing source on the same element after warmup. Timing begins at source
   assignment and ends at `canplay`; playback must start/advance too. Ticket
   issuance latency is recorded separately. Failures and interrupted attempts
   remain in raw results and do not count toward the 30 successes.
5. Run functional checks on both transports on each network. They test HEAD,
   closed/open/suffix/invalid/multiple ranges, a real seek, reader cancellation,
   and old-ticket revocation after privacy, removal, deletion, rights withdrawal,
   viewer/publisher acceptance withdrawal and blocking in both directions.
   Baseline is restored after each mutation. Only synthetic database state is
   changed; neither the fixture object nor production state is deleted.
6. Keep Safari foregrounded. Stop retains partial observations. Confirm the
   phone actually renders the benign clip; a codec failure is not a passing
   measurement. Re-run incomplete scenarios after diagnosing failures.
7. Wait for in-flight streams to settle, export sanitized JSON, and retain raw
   failures, all scenario/phase medians/p95 and paginated API observations.
   Server counters cover transport media/grant response bodies and R2 reads;
   they exclude control/telemetry/request bodies, TLS and radio traffic. Client
   Resource Timing sizes may be absent or incomplete for cancelled video loads.
8. Obtain Worker **CPU** metrics separately from Cloudflare's aggregated
   dashboard/approved analytics, for both Workers and the exact test window.
   Do not turn on full-URL tracing/tail logging. `authMs` includes wait time and
   is **not CPU**. CPU is exported as null until real provider evidence exists.
   Client cancellation alone is not proof of upstream cancellation: correlate
   the emitted-body/cancel counters, requests and provider observations.

Exports always say `completed: false`; a human evidence review is required.
There are currently **zero physical-device samples**. Android stays in the
existing backlog, not passed, waived or tested by this harness.

## Teardown / emergency stop

Stop the device run and revoke the canary operator/service secrets. When
approved, remove only the two named canary Workers and the explicitly recorded
canary D1 ID. Do not delete or expose the R2 bucket/fixture without separate
approval. Never change production edge routing as part of canary teardown.
## Guided iPhone canary

This is the approved **isolated synthetic** Cloudflare test setup, not the
application deployment. No production routing, bucket policy, subscription or
application database is changed.

## Owner experience

The operator issues a single-use private invitation. The owner opens that link
in physical iPhone Safari, sets Wi-Fi/cellular as instructed, and presses Start.
The page runs both transports, saves each observation to isolated D1 with a
durable acknowledgement, then asks for the network change and Continue.
Reloading the same Safari tab resumes the saved network stage. There is no
operator-secret input, report download, or upload in this flow.

Invitations expire after 24 hours; redeemed sessions expire after two hours.
Invitation tokens live in the URL **fragment**, are removed immediately, and
are stored only as SHA-256 hashes server-side. Sessions use Secure, HttpOnly,
SameSite=Strict host-only cookies. Treat invitation links as private. Never
commit invitation tokens or cookies, and never log request URLs or bodies.
Only an authorized operator with Cloudflare D1 access can issue invitations
or retrieve all reports. There is no unauthenticated creation or report-list
endpoint.

## Source and storage

- `gateway-baseline.mjs` and `authority-baseline.mjs` are source snapshots
  retrieved from the pre-existing deployed canary. Secret values were not
  retrieved: they remain provider bindings. The gateway snapshot includes the
  actual shared media Worker handler, but **the relay and policy authority are
  synthetic substitutes**, not the real application API.
- The guided Worker wraps the existing gateway. The existing authority is
  unchanged. `guided-schema.sql` is additive in the existing **canary-only D1**
  database; do not apply it to the application's PostgreSQL database.
- `guided_invites`: hashed single-use invitations and expiry.
- `guided_sessions`: hashed session credentials, synthetic run ID, expiry,
  network checkpoints, and persistent per-session throttling.
- `guided_evidence`: sanitized observations, idempotently keyed by network,
  transport and check. Cross-session access is scoped server-side.
- `guided_historical`: the already supplied timing export, split into small
  chunks and keyed by source SHA-256. It is not merged with new run counters.

No IP address, account identity, raw media URL, ticket, operator credential or
cookie is saved in evidence. Client observations are claims, not trusted
attestations; provider metrics and policy review remain separate gates.

## Build and authorized canary update

Run from workspace root:

```sh
node --test infrastructure/shared-media-edge/canary/guided-session.test.mjs
node infrastructure/shared-media-edge/canary/build-guided.mjs
```

The builder only writes an ignored upload manifest under
`generated-artifacts/shared-delivery/`. It uses the existing design-system CSS
variables, native text modules, and no new packages. The authorized agent can
upload that manifest through the connected Cloudflare API to the exact
`ayamai-edge-canary` script. Preserve secret bindings with `keep_bindings`;
do not read or replace their values. No application publication is involved.
The word `production` in the existing AUTHORITY **service-binding environment**
is Cloudflare's default Worker environment name; the target service remains
the isolated `ayamai-edge-canary-api`.

Before an upload, confirm the target script, canary bucket, and D1 database ID
match the existing isolated setup. Do not substitute an application resource.
Only the gateway is updated; restoring the retrieved gateway snapshot and its
previous bindings reverses the guided UI update without dropping evidence.

## Agent retrieval, issuance and cleanup

Use the attached Cloudflare API connection, not owner-supplied credentials:

- D1 query route:
  `/v4/accounts/{account}/d1/database/{canary_database}/query`.
- To issue a link: generate 32 cryptographically random bytes as hex, insert
  its SHA-256 hash and 24-hour expiry into `guided_invites`, and give the owner
  the canary root URL with `#invite=<token>`. Do not persist the raw token.
- To find collected runs: read session expiry, run ID and network checkpoint
  flags. Read evidence via its session hash. Then retrieve the matching
  `canary_metrics` rows by synthetic `run_id` for application-emitted
  byte/auth/cancellation counters. The agent can do this directly; the owner
  never transfers files.
- Emulated browser QA sessions must be identified and excluded from physical
  device evidence. Revoke those sessions after QA, without revoking the
  owner's unused invitation.
- During operator maintenance, remove expired invitations and sessions older
  than seven days, deleting their dependent evidence first. Retain reviewed,
  sanitized measurement reports in project documentation. Cleanup is an
  operator responsibility, not an installed scheduled job.

## Limits and remaining verification

The server limits each session to 240 control calls/minute, accepts at most
4 KiB JSON per request, validates explicit field/enumeration allowlists, uses
parameterized SQL, and bounds evidence to fixed check keys. Media grants
retain the existing canary-wide 10,000/month quota and benign-fixture size cap.
Calls have 10–15 second timeouts. Save failures stop progression and remain
visible. The server does not mark a network stage collected unless required
observations are present; it never marks overall verification complete.

This guided pass collects previously missing functional observations, not
another 240 timing samples. It tests exact range lengths/headers/statuses,
seek followed by continued playback, and old-ticket GET, HEAD and range
denials after all eight synthetic eligibility changes. Failed checks remain
saved and keep the stage open for retry. Client-side cancellation is recorded
as **upstream unverified**, not silently passed.

The remaining overall gates still include fully correlated upstream
cancellation evidence, actual application relay/authorization behavior,
and the deferred Android work. Provider CPU aggregates have since been
retrieved and recorded in the results report. The guided screen's “collected”
state is not permission to enable production edge routing.
