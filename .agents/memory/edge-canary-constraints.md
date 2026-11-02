---
name: Edge canary constraints
description: Spending, isolation, device scope and Cloudflare credential-verification constraints.
---

The earlier **Workers Free / $3/month** restriction was superseded by the
user's explicit approval of the **$5/month Workers Paid subscription**; see
[shared delivery boundary](shared-delivery-boundary.md) for its spending limits.
Approval is not proof that a subscription has been purchased.
The user permits only the private `ayamai-edge-canary` bucket and
its synthetic `benign-test-pattern.mp4`; no production data connection, public
bucket access or production edge-routing changes. Verify isolation, costs,
ingress and deployment authority before deploying. Android is deferred to the
backlog; physical iPhone Safari is the current device scope.

**Why:** These are the user's explicit canary constraints.

**How to apply:** Fail closed on unverified plan, scope, cost or ingress.
Preparation is not deployment approval, and local tests are not physical-device
measurements. A synthetic D1/Worker authority does not establish performance of
the production PostgreSQL/Express relay.

The connected Cloudflare credential can be an **account-owned token**. Verify
it through the account token endpoint, not the user token endpoint.

**Why:** User-token verification returned 401 while account-token verification
reported active and ordinary scoped reads succeeded. Permission-policy and
billing reads were separately denied.

**How to apply:** Distinguish invalid credentials from the wrong verification
endpoint and missing read permissions. Successful metadata reads do not prove
write/deployment privileges; denied policy reads do not prove writes are absent.

For the owner's mobile workflow, follow the
[direct collection rule](shared-delivery-boundary.md): a private launch link,
guided buttons and direct retrieval, not operator-credential or JSON handoffs.
