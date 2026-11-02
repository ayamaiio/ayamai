# ayamai — browser tool

Load unpacked from `chrome://extensions` (Developer mode → Load unpacked → this
folder). Chrome, Edge and Brave.

Paste the agent token from `{data}/agent-token` into the popup once; it is kept
in extension storage. The tool reads the active page with the permissions it was
granted and asks `POST /agent/task` — it never holds a model key.
