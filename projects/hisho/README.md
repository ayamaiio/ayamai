# hisho — 秘書

The secretary. An MCP server: an agent connects, receives the brief, claims the
next item, and does the work with tools that stay inside the repo.

    node projects/hisho/stdio.mjs        # the entry an MCP client spawns
    node projects/hisho/index.mjs        # the desk at http://127.0.0.1:4650/hisho/

Connect:

    claude mcp add ayamai -- node $HOME/ayamai-deepseek/projects/hisho/stdio.mjs

stdio is unauthenticated by design (if you can spawn it, you are the user).
HTTP requires the agent token from `{data}/agent-token`.
