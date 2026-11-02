# kata — 型

The design library. `tokens.json` is the source of truth; `build.mjs` generates every stylesheet that consumes it.

    node projects/kata/build.mjs        # regenerate ui/tokens.css + the showroom + yoru theme
    node projects/kata/index.mjs        # http://127.0.0.1:4600

Mounted at `/kata` behind the door.
