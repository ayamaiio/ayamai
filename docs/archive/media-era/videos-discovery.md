# Videos discovery — 2026-10-31

The Videos screen defaults to **All videos**. **My videos** and **Saved** remain explicit filters. The collection is ordered by duration and uses keyset pagination; it does not implement YouTube-style ranking.

Ordinary signed-in adults can discover their own videos and other members' public-eligible videos, subject to publication consent, moderation, and blocking rules. The server grants global read access only to the verified owner membership; it is never inferred from the Itachi display name. That read access does not grant editing or deletion ownership. Revocation is checked on each page.

Existing private videos remain private. Older imports defaulted to private and cannot reliably be distinguished from an explicit privacy choice. No existing visibility values, upload defaults, schema, or public storage settings change.

Long-form personalized discovery remains exploratory in [AYA-14](https://linear.app/ayamaiio/issue/AYA-14/explore-long-form-video-discovery-and-a-youtube-style-viewing); this fix does not expand recommendation data collection.
