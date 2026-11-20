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

`extensions/permissions.ts` guards `read`, `edit`, and `write` file operations, including nested calls, using separate **read** and **write** permissions. `edit` and `write` share write rules; allowing writes does not allow reads, or vice versa.

When no saved rule matches, the prompt shows the working directory, resolved target path, complete tool arguments, and these choices:

- **Allow once** — selected by default; Enter approves only this call.
- **Deny once** — denies only this call.
- **Always Allow Reading/Writing /target/file** — saves an exact-path allow rule.
- **Always Deny Reading/Writing /target/file** — saves an exact-path deny rule.
- **Always Allow Reading/Writing In /parent/directory** — saves an allow rule for the displayed parent directory and all descendants.

In the terminal, arguments appear in a screen-height-bounded, wrapped preview with approval choices kept below it. **Page Up / Page Down** scroll the preview; **Home / End** jump to its beginning/end. **↑ / ↓** select an approval choice, **Enter** confirms, and **Esc** cancels (denies). The preview adapts when the terminal is resized; very short terminals show only the currently selected choice. RPC clients continue to receive standard selection dialogs.

For example, **Always Allow Reading /home/you/.ssh/hosts** does not grant write access or access to other files in `.ssh`. Choosing the parent-directory option would grant read access throughout `.ssh`.

`bash`, `powershell`, and user shell commands (`!` / `!!`) **always prompt** with only Allow once / Deny once. File rules never authorize shell commands. Approved shell commands are unrestricted by these file rules.

### Saved rules

Rules are stored globally in `~/.pi/agent/permissions.json` (or the configured Pi agent directory), outside this repository. The policy is re-read before every file approval check. Deny rules take precedence over allow rules. Paths are absolute and symlink-resolved, including existing ancestors of new files; directory matching respects path boundaries.

Example policy:

```json
{
  "version": 1,
  "rules": [
    {
      "access": "read",
      "effect": "allow",
      "path": "/home/you/.ssh/hosts",
      "scope": "exact"
    },
    {
      "access": "write",
      "effect": "allow",
      "path": "/home/you/projects/example",
      "scope": "tree"
    }
  ]
}
```

Edit this file manually to remove/revoke rules or add directory-wide denies (`"effect": "deny", "scope": "tree"`). File tools cannot write the policy itself. New policy files are written atomically with owner-only permissions. Approval checks/dialogs/saves are serialized within each Pi process; avoid simultaneously updating rules from multiple Pi processes, since concurrent saves can overwrite each other's changes.

Missing policies start with no rules. Malformed/unreadable policies and failed saves deny the operation and report an error. Cancellation and unavailable approval UI also deny by default. In print/JSON mode, saved file rules still apply, but unmatched file operations and all shell commands are denied. RPC clients must support approval dialogs.

**This is a tool gate, not an OS sandbox.** Other tools (including `grep`, `find`, `ls`, custom/MCP tools), extension-internal I/O, and approved shell commands are outside the file-rule enforcement. Path checks are not race-proof against filesystem changes between approval and execution. Only load extensions you trust.

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

Run `npm test` for permission-policy tests. To also run terminal preview tests against Pi's real text-wrapping implementation, set `PI_TUI_MODULE` to the absolute path of your installed `@earendil-works/pi-tui/dist/index.js`.

## Layout

```text
pi-extensions/
├── extensions/
│   ├── ice-cream.ts
│   └── permissions.ts
├── lib/
│   └── permission-rules.ts
├── tests/
│   └── permissions.test.mjs
├── package.json
├── README.md
└── LICENSE.md
```

## License

MIT — see [LICENSE.md](LICENSE.md).
