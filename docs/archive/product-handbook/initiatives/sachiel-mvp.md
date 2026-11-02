# Sachiel — MVP Definition

**Status:** Defining
**Owner approval:** Initial product scope and interaction preferences captured; full MVP specification not yet approved.
**Origin:** Product HQ, October 2026.

## Product purpose

Sachiel is Ayamai's planned browser extension for saving supported media from websites into the user's Ayamai collection. Its first release targets Pixiv and aims to make saving a post nearly effortless.

## Agreed initial environment

- Primary browser: Brave.
- Operating system: Windows 10 desktop.
- Extension platform: Chromium-compatible.
- Initial source website: Pixiv.

## Agreed v1 content scope

**In scope:**
- Static Pixiv illustration posts.
- Single-image and multi-image illustration posts.
- Original image files where accessible.
- Available post and creator metadata, including Pixiv tags.

**Out of scope for v1:**
- Ugoira / animated illustrations.
- Pixiv videos.
- Novels or text-based posts.
- Other source websites.
- Bulk crawling or unattended collection.

## Agreed interaction direction

The owner selected a hybrid of immediate saving and optional inspection:

- A primary one-action **Save to Ayamai** action starts saving immediately, without a mandatory confirmation step.
- An optional preview/inspection experience should be available without making it a prerequisite for saving.
- The exact placement and timing of preview/inspection (before, during, or after saving) remain to be defined.

## Proposed capabilities to validate

- Detect supported Pixiv illustration posts.
- Retrieve all static images belonging to a supported post.
- Capture available title, description, tags, creator identity, Pixiv post ID, and source URL.
- Upload original media to Ayamai.
- Persist media and metadata using existing Ayamai infrastructure where practical.
- Show useful saving/upload/processing status.
- Detect duplicate posts.
- Explain failures and offer retry where safe.

These are proposed MVP capabilities, not yet a complete approved acceptance-criteria set. Technical feasibility, Pixiv access constraints, and existing Ayamai integration points must be verified before implementation.

## Design principles

- One-action saving is the default.
- Preserve source provenance and original post identity.
- Prefer the existing Ayamai backend and storage architecture over creating a parallel system.
- Keep Pixiv-specific extraction separate from reusable capture and ingestion responsibilities.
- Respect website access controls, applicable terms, copyright, and rate limits; do not design around bypassing restrictions.

## Open decisions

- Where should Sachiel be available: only on a Pixiv post detail page, or also on feed/search/gallery surfaces?
- How should optional preview/inspection be exposed without interrupting one-click saving?
- Exactly which Pixiv post and creator fields are available and reliable?
- How should authentication between the extension and Ayamai work?
- What duplicate behavior should the user see?
- What should happen when a post is partially accessible or some images fail?
- What are the allowed and technically reliable media retrieval paths under Pixiv's current access rules?
- What extension packaging, permissions, and browser compatibility details are required?

## Process note

Continue defining the MVP one decision at a time. Do not create implementation tasks or treat unresolved proposals as approved requirements. Once scope, UX, feasibility, and acceptance criteria are reviewed with the owner, explicitly confirm before promoting this into committed implementation work.
