# iPhone Safari canary — partial evidence

## Source and status

Operator-supplied export: `attached_assets/0_ayamai-iphone-canary_1793320765715.json`.
SHA-256: `f1da55a1d1589a04469383f2fff478afb190e4805e5d471e6dc7a8d40c561b7f`.
Export timestamp: 2026-10-30T00:36:00.753Z.
Schema: `ayamai-safari-canary-v1`.

The operator reports physical iPhone Safari testing on Wi-Fi and cellular.
The exported user agent reports iPhone OS 18_7 and Safari 27.0.1.
Physical-device provenance is operator-declared, not independently established.
The fixture is 895,998 bytes.

**Timing collection passed: 240/240 main samples succeeded and reported playback
advancing. The subsequent guided functional pass and provider CPU retrieval
are recorded below. Overall verification remains incomplete because the canary
uses a synthetic relay/policy authority and cancellation is not fully
correlated. Do not enable edge routing.**
Four additional warmups are excluded below. Android remains deferred to its
separate backlog task, not passed.

## Accepted phase boundary

The owner explicitly selected **“Merge iPhone canary phase”** when offered a
choice between closing this evidence-collection phase and completing every
original rollout gate. This report and the guided harness are the accepted
deliverable for that narrowed phase.

**Go:** merge the isolated guided test setup and the recorded iPhone evidence.
**No-go:** enable production edge routing or claim that the real application
relay, SQL-backed authorization and upstream cancellation gates have passed.
Those gates remain blocking follow-up work. Android remains in its existing
separate backlog item.

The preserved raw timing export's `completed: false` and the guided harness's
`overallVerified: false` are intentional: accepting this phase must not rewrite
historical evidence or bypass the remaining gates.

The product is **ayamai**. Existing `ayamai-edge-canary` Worker/bucket/service
identifiers are legacy resource names, not the preferred product spelling.
They remain unchanged to preserve working bindings, private storage and the
collected evidence. Renaming a bucket or service independently is not part of
this merge and must not be requested of the owner.

Merge checks for this phase: the existing Worker/session unit checks passed;
anonymous and cross-session requests were rejected; invitation replay and
cross-origin mutation checks passed; evidence collection was exercised on the
owner's iPhone; no new dependencies or secret values were introduced. Changes
are additive to isolated canary storage and do not migrate the app database.
No production publication, public storage access or billing change occurs.

## Readiness timings

Times start at source assignment; ticket issuance is measured separately.
Each row has 30 attempts and 30 successes. Median here is the average of the
middle two sorted values; p95 is nearest rank. The export's own summary uses
the upper middle value for its median, so small differences are expected.

| Network | Transport | Phase | Median ms | p95 ms |
| --- | --- | --- | ---: | ---: |
| Wi-Fi | Relay | Startup | 853.5 | 1143 |
| Wi-Fi | Edge | Startup | 898 | 1246 |
| Wi-Fi | Relay | Swipe | 901.5 | 1386 |
| Wi-Fi | Edge | Swipe | 863.5 | 1301 |
| Cellular | Relay | Startup | 839.5 | 1082 |
| Cellular | Edge | Startup | 949 | 1251 |
| Cellular | Relay | Swipe | 830 | 1504 |
| Cellular | Edge | Swipe | 763 | 1133 |

Edge startup is slower on both networks in these observations; swipe readiness
is faster. These runs do not establish a blanket edge speed improvement.

## Server snapshot

| Metric | Relay | Edge |
| --- | ---: | ---: |
| Requests | 254 | 250 |
| Application API body bytes | 110,813,910 | 16,250 |
| Application media body bytes | 110,813,910 | 111,482,281 |
| Reported R2 reads | 508 | 500 |
| Authorization median ms | 103 | 113 |
| Authorization p95 ms | 260 | 148 |
| Authorization maximum ms | 476 | 579 |
| Recorded cancellations | 0 | 0 |

These are cumulative application-emitted body counters, not scenario-specific
wire, browser-received, radio, or invoice bytes. They exclude control,
telemetry and request bodies. All 504 server observations have status 206.
That establishes observed partial responses, not correctness of all range
forms or successful seek behavior. Zero recorded cancellations is not proof
that cancellation was exercised successfully.

## Subsequent guided functional pass

The owner reported finishing the physical iPhone test. Results were retrieved
directly through the connected Cloudflare API from the private canary D1
database; no manual report transfer was needed.

Synthetic run: `af3c35af-360c-42f5-96b1-db0937ca11f5`.
Saved observation interval: **2026-10-30 01:04:45.237–01:06:34.899 UTC**.
Both stored network-stage flags are complete.

| Observation | Wi-Fi relay | Wi-Fi edge | Cellular relay | Cellular edge |
| --- | ---: | ---: | ---: | ---: |
| HEAD metadata assertions passed | 1 | 1 | 1 | 1 |
| Range assertions passed | 5 | 5 | 5 | 5 |
| Old-ticket revocation assertions passed | 24 | 24 | 24 | 24 |
| Seek then continued playback passed | 1 | 1 | 1 | 1 |
| Client cancellation recorded, upstream unverified | 1 | 1 | 1 | 1 |

**124/124 pass/fail functional assertions passed**, plus four separately
recorded client cancellations. The latter intentionally have `passed: false`
and `upstreamCancellationVerified: false`; do not describe this as 128 passed
checks.

Range tests assert actual body lengths, Content-Range, Accept-Ranges and status
for closed, open-ended, suffix, unsatisfiable and multiple ranges. For each
transport/network, all eight synthetic eligibility changes deny the old ticket
on a new GET, HEAD and range request: privacy, removal, deletion, rights
withdrawal, viewer-policy withdrawal, publisher-policy withdrawal and both
block directions. An authorized HEAD baseline is established immediately
before each change and restored afterwards.

All four seeks were followed by advancing playback, with final positions
2.328–2.336 seconds. Network/device provenance remains the owner's declaration;
the browser cannot independently attest to the radio used.

### Guided run server counters

These totals include retries and all request types within the synthetic run;
they are not paired per-scenario timing measurements.

| Metric | Relay | Edge |
| --- | ---: | ---: |
| Observed media requests | 123 | 98 |
| Application API body bytes | 5,073,320 | 3,250 |
| Application media body bytes | 5,073,320 | 3,411,198 |
| Authorization median ms | 98 | 102 |
| Authorization p95 ms | 123 | 129 |
| Server stream cancellations recorded | 1 | 1 |

Server-side response monitors recorded one cancellation for each transport,
after 786,432 relay bytes and 720,896 edge bytes respectively. The monitors
forward cancellation to the source reader. However, observations have no
per-probe correlation identifier or network label, so these cannot establish
upstream cancellation for each of the four explicit client probes, or prove
how much data R2 had already delivered internally.

### Provider CPU evidence

Retrieved directly from Cloudflare GraphQL `workersInvocationsAdaptive`,
filtered by the two exact canary script names and test time windows. Logs
were not enabled. Schema introspection confirms CPU quantiles are in
**microseconds**; the table converts them to **milliseconds**.

| UTC window | Worker | Requests | Provider errors | CPU median ms | CPU p95 ms | CPU p99 ms |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| 00:22:00–00:36:10 | Gateway | 768 | 0 | 0.882 | 15.003 | 22.919 |
| 00:22:00–00:36:10 | Authority | 992 | 0 | 1.599 | 14.994 | 21.739 |
| 01:04:00–01:07:00 | Gateway | 521 | 0 | 1.844 | 3.458 | 7.309 |
| 01:04:00–01:07:00 | Authority | 479 | 0 | 1.552 | 4.598 | 11.889 |

These are provider-sampled, script/time-window aggregates, including control,
telemetry and media requests. They are not per-media-request, per-network or
per-transport CPU measurements and are not exact billed CPU totals. Do not
confuse them with the run-scoped media counters above. Zero provider execution
errors does not mean every deliberate HTTP denial was a successful media
response.

References: Cloudflare
[GraphQL Worker metrics example](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/configuration/observability/)
and [sampling/CPU metric definitions](https://developers.cloudflare.com/workers/observability/metrics-and-analytics/).

## Remaining gates and next actions

- The original export's empty `checks` and missing CPU values are historical:
  the guided pass and provider evidence above now fill those evidence classes
  for this synthetic canary, with the stated limits.
- Source retrieval established that the gateway includes the actual shared
  edge Worker handler, but the relay and policy authority are synthetic
  substitutes. `productionStack: false` is accurate. Measure an isolated
  instance of the real application relay and authorization rules before
  treating the timing comparison and synthetic revocation results as an
  application-stack enablement gate.
- Add per-probe correlation for source cancellation and collect server-side
  evidence without representing pooled response cancellations as a complete
  four-scenario upstream check.
- Record remaining run context: device model, approximate region, foreground
  play duration, cold/warm conditions, and confirmation of physical cellular
  service. The export labels network type but does not independently verify it.

The export itself says `completed: false`. Preserve the successful timing
samples; do not rerun them merely to fill functional-check or CPU gaps.
If handler provenance reveals a different implementation, separately identify
which measurements need repetition against the actual handlers.

No production enablement, publication, or bucket-policy change is authorized
by this report. Workers Paid was separately approved by the owner, but no
subscription purchase was performed here. Follow the gates in
[shared-media-edge.md](shared-media-edge.md).
