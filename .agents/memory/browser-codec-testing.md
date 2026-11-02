---
name: Browser codec testing
description: Distinguish automated-browser codec limitations from application streaming failures.
---

An automated browser can lack H.264 support even when it can request and receive
a valid MP4. Check codec capability and native media errors before treating a
blank video as a delivery or authorization failure.

**Why:** A valid H.264 clip returned a complete HTTP 206 response but the testing
runtime rejected its codec. A benign VP8 WebM played successfully through the
same application delivery path.

**How to apply:** Use a browser-supported benign fixture for a positive player
check, and retain real-device checks for the actual codec/device matrix. Do not
transcode a user's collection or weaken authorization to work around a
test-runtime codec limitation.
