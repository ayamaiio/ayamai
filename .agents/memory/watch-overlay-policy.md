---
name: Watch overlay behavior
description: Keep passive viewing unobstructed without breaking media gestures or making hidden controls interactive.
---

Watch navigation, filters, captions, tags and action controls should fade during
passive viewing, and reappear for interaction. Preserve the existing dark-blue
design. Auto-hide is the default; viewers may explicitly choose account-scoped
always-visible controls in Watch settings, shared by Feed and Saved.

**Why:** The user reported that For You, Collection and tags obscured subjects'
faces while videos played.
The user also requested an always-visible preference, so passive fading must
not override that explicit choice.

**How to apply:** Keep controls available while paused, using menus, hovering
over controls or navigating by keyboard. Hidden controls must be inert, not
invisible click targets. A first tap on unobstructed media should reveal without
pausing; double-tap liking, native vertical scrolling and bottom hold-to-seek
must remain intact. Capture whether a tap started hidden before an ancestor
reveals the controls, so event ordering does not accidentally turn it into pause.
