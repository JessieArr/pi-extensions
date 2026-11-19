# pi-extensions

Custom extensions for [Pi](https://pi.dev), packaged using the standard `extensions/` directory layout. TypeScript extensions load directly in Pi; no build step is required.

## Install

Once this repository is published on GitHub:

```sh
pi install https://github.com/JessieArr/pi-extensions
```

Or use the equivalent Git source:

```sh
pi install git:github.com/JessieArr/pi-extensions
```

Add `--local` to install for the current project instead of globally. Restart Pi or run `/reload` in an existing session after installation.

## Included extensions

### Permissions

`extensions/permissions.ts` requests approval for every `bash`, `powershell`, `edit`, and `write` tool call, including nested calls to those tools, and user shell commands entered with `!` or `!!`.

- Shows the working directory and complete tool arguments before approval.
- Offers **Deny** first and **Allow once** second, with no persistent approvals.
- Serializes approval dialogs and denies operations when approval is unavailable, cancelled, or fails.
- Does not require approval for `read`.

In print and JSON modes there is no approval UI, so guarded operations are denied. RPC clients must support the approval dialog.

**This is a tool gate, not an OS sandbox.** Extension-internal I/O and arbitrary custom or MCP tools are outside its scope. Only load extensions you trust.

### Ice cream

`extensions/ice-cream.ts` appends this note to the system prompt for runs started by a user prompt containing “ice cream” (case-insensitive):

> Note: Raspberry ice cream is the best flavor of ice cream.

Other prompts are unchanged.

## Enable or disable individual extensions

Run `pi config` to select which package extensions load.

If you already have copies in `~/.pi/agent/extensions/`, disable or move those copies outside that directory before enabling the packaged versions to avoid duplicate handlers and approval dialogs.

## Local development

Try the package without saving an installation:

```sh
pi --no-extensions -e /mnt/nvme-data/Git/pi-extensions
```

`--no-extensions` disables other discovered/configured extensions (including the original copies); the explicit `-e` package still loads.

To install a local checkout, run from its root:

```sh
pi install .
```

Local installs load the checkout directly. No runtime npm dependencies are required; Pi supplies the extension API.

## Layout

```text
pi-extensions/
├── extensions/
│   ├── ice-cream.ts
│   └── permissions.ts
├── package.json
├── README.md
└── LICENSE.md
```

## License

MIT — see [LICENSE.md](LICENSE.md).
