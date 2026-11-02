# fude — 筆

The editor extension. Catalog entry: `fude`, kind `project`; manifest
`projects/fude/project.json`.

## What it is

A VS Code extension with two commands: `ayamai.ask` (send a prompt to the door's
model with the project context attached) and `ayamai.status` (what is running).
It talks to `http://ayamai.local` and holds no key.

## Where the code is

```
projects/fude/extension/   package.json · extension.js   ← the extension
projects/fude/server.mjs   the page at /fude/
```

## Running it

- **Run → Run Extension** in VS Code with `projects/fude` open, or
- `code --extensionDevelopmentPath="$PWD/projects/fude/extension"`

Packaging (`vsce package`, then `code --install-extension`) is a follow-up; the
page says so rather than offering a download that does not exist yet.
