# tsukai — 使い

The browser extension. Catalog entry: `tsukai`, kind `project`; manifest
`projects/tsukai/project.json`.

## What it is

A manifest-v3 extension that reaches into the page you are on, captures it, and
sends it to the local door — or asks the configured model through `/agent/task`.
It has no model key of its own and no network beyond `ayamai.local`.

## Where the code is

```
projects/tsukai/extension/     manifest.json · popup.html · popup.js  ← load THIS folder
projects/tsukai/server.mjs     the page at /tsukai/
```

## Installing it

1. `brave://extensions` (or `chrome://extensions`) → Developer mode → **Load unpacked**
2. choose `projects/tsukai/extension`

The page at `/tsukai/` prints the absolute path with a copy button, and reads the
version and permissions straight from the manifest — the page cannot drift from
the extension.

## Permissions, and why

| permission | why |
|---|---|
| `activeTab` | read the page you are on, only when you ask |
| `scripting` | run the capture script in that tab |
| `storage` | remember the door's address |

Hosts are the door only: `http://ayamai.local/*`, `http://localhost:25222/*`,
`http://127.0.0.1:25222/*`.
