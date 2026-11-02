---
name: Cloud import SDK upgrades
description: Security-sensitive compatibility checks for third-party cloud download SDKs.
---

Treat MEGAJS upgrades as security-sensitive rather than routine dependency bumps.

**Why:** A custom API on a shared-folder root did not propagate to SDK-created child files, silently bypassing the protected network client. Published identifier types also differed from actual folder-child identifiers. Root-client configuration and mocked worker streams were insufficient evidence that folder imports were correct.

**How to apply:** When upgrading a provider SDK or changing its adapter, verify that descendant metadata and byte-download operations all use the protected transport, and that persisted identifiers still match a reconstructed provider tree. Retain a regression using the actual SDK and harmless synthetic encrypted bytes, not only mocked worker inputs.
