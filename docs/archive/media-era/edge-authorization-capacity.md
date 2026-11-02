# Shared-media authorization capacity

## Boundary and isolation

Every new edge GET, HEAD and range request still calls the API and makes a fresh
PostgreSQL access decision. The API relay uses the same decision. One SQL
statement checks the viewer's adult/policy acceptance, the owner's acceptance,
public visibility, active moderation, rights confirmation and blocks in either
direction. Owners do not bypass shared-post eligibility. Supported media types
are checked before a grant is returned.

No positive-grant cache, public R2 access, storage redirect, deployment change or
real media transfer was introduced. Storage keys remain server-to-server.
Authorization responses, denials and overload responses remain `private, no-store`.

## Deliberately conservative per-process budget

| Control | Bound |
| --- | --- |
| Edge ingress before service authentication/ticket decryption | 256 burst, 128 requests/second refill |
| Shared authorization, across viewers and transports | 128 burst, 64 requests/second refill |
| Active shared database decisions | 4; no application wait queue |
| One viewer, across media IDs/tickets/transports | 24 burst, 8 requests/second refill, 2 active decisions |
| Viewer-rate memory | At most 4,096 hashed keys; idle entries expire after 60 seconds; no live-debt eviction |
| Dedicated read-only DB pool | 4 connections, separate from the normal application's pool |
| Connection acquisition deadline | 500 ms |
| PostgreSQL statement deadline | 1,000 ms |
| Client query deadline | 1,500 ms |
| Worker authority fetch deadline (existing) | 5,000 ms |

The process can therefore use **four additional DB connections**. Budget all
replicas' application and authorization pools against the database connection
limit before scaling. These are per-process limits, not a coordinated global
account quota. Restarting a process clears rate debt, never access permissions.
Limits do not bound already-streaming media bytes or replace network-level
protection against unauthenticated HTTP/body floods.

Viewer overload returns 429; edge service/concurrency/DB overload returns 503.
Admission overload includes a fixed `Retry-After: 1`; the Worker propagates only
that fixed safe hint and never an upstream body or arbitrary headers. The relay
also preserves 429/503 admission responses. Database errors fail closed; there
is no automatic query replay. A subsequent request must authorize again.

The limits protect responsiveness rather than promising uninterrupted playback
at arbitrary concurrency. Players may show a temporary error under overload;
`Retry-After` is a protocol hint, not a claim that every browser retries.
Do not raise limits simply to remove 503s without sustained-load measurements.

## Reproduce locally

```
pnpm run test:edge-authorization
pnpm --filter @workspace/api-server run benchmark:edge-authorization
```

The benchmark creates uniquely named synthetic accounts and one synthetic
metadata row in the **development** database, cleans them up in `finally`, starts
an ephemeral loopback Express server using the real edge route, and drives the
actual Worker handler with alternating single ranges and HEADs. The R2 adapter
contains 4 KiB of zero bytes; no R2 writes, real content, external authority,
Cloudflare deployment or browser is used. This is an authorization/transport
test, not a video decoding test.

Output is aggregate JSON under ignored `generated-artifacts/edge-authorization/`.
Never run this fixture-creating script against production. A baseline was
captured before the protection was added; the optional `baseline` argument only
labels an output file, it does not disable protection in the current code.

### Measurements from this workspace

Three immediate waves per concurrency level, 64 distinct synthetic viewers.
Cold connections, host scheduling and concurrent development activity affect
these small samples. Each successful ranged GET/HEAD is 206.

| Concurrent requests | Requests | Before queries | Before auth p95 / p99 ms | After queries | After auth p95 / p99 ms | After 206 / 503 | Overload fraction |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 4 | 12 | 36 | 76.97 / 76.97 | 12 | 88.07 / 88.07 | 12 / 0 | 0% |
| 16 | 48 | 144 | 51.64 / 56.21 | 23 | 39.12 / 39.94 | 23 / 25 | 52.1% |
| 64 | 192 | 576 | 122.86 / 132.92 | 59 | 87.82 / 96.72 | 59 / 133 | 69.3% |

Before protection, all these requests succeeded; p99 improvements at higher
concurrency partly reflect **load shedding**, not increased serving capacity.
At low concurrency the cold-start tail did not improve. A direct successful
`sharedStreamMedia` check fell from three SQL queries to exactly one.
Rejected admission performs zero DB queries, and rejected edge access performs
zero R2 reads. At 64 concurrency the adapter saw 104 R2 operations versus 336
before protection (HEAD plus optional ranged GET for authorized requests).

Additional checks:

- A 32-request same-viewer burst: 24 authorized, 8 returned 429, 24 queries.
- Four real `pg_sleep(2)` statements substituted solely on the dedicated test
  pool: all failed closed with 503 in 1,036.81 ms; next request returned 200.
  The script asserts a lower time bound so fixture/bind errors cannot masquerade
  as a successful statement-timeout exercise.
- Four occupied dedicated connections: request returned 503 in 502.64 ms;
  release followed by another request returned 200. No queued waiter remained.
- An existing ticket after viewer acceptance revocation returned 404.
  Regression tests also cover owner acceptance, private/deleted/removed content,
  lost rights, both block directions and owner tickets.
- Worker tests confirm overload does not access R2, forward a grant body,
  arbitrary Retry-After, or a Location header.

This does **not** establish deployed regional RTT, sustained capacity, physical
device playback or multi-replica fairness. No production capacity number or
permission to enable edge routing follows from these results.

## Operational warning alerts

Every nonempty 60-second process window emits `media_authorization_window`:
fixed counters for allowed, denied, viewer-limited, service-limited, unavailable
and ingress-limited requests; measured query-path count; and a bounded p95 upper
estimate. Fast admission rejections do not dilute the query-path latency
histogram. Buckets are 10, 25, 50, 100, 250, 500, 1,000, 2,000 ms plus overflow.
The overflow upper estimate is a conservative sentinel, not an exact percentile.

The window is warning-level, with `alert: true`, for:

- Any unavailable database decision or idle-pool error.
- Query-path p95 upper estimate above 500 ms.
- At least 20 outcomes and either 10% admission limits or 20% access denials.

Otherwise it is info-level. At most one aggregate log record per process per
minute; counters reset, cardinality is fixed, no individual failures are logged
here. These are operational **log alerts**, not an installed email/pager service.
When collecting them centrally, filter the fixed event and `alert: true`.

Investigate unavailable outcomes and latency first: connection availability,
DB pressure, and read-query duration. Investigate service-limited spikes by
comparing legitimate traffic and capacity; viewer-limited spikes suggest rapid
seeking or automation. High access denial counts may indicate expired/tampered
tickets or revocations; do not debug by dumping request payloads.

Never attach URLs/query strings, tickets, service headers, account/media IDs,
raw SQL/errors, object keys, storage grants or credentials to these records.
Existing HTTP request serialization strips query strings and does not serialize
request bodies or headers. Keep infrastructure request tracing equally strict.
