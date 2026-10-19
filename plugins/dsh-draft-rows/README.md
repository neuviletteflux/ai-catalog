# dsh-draft-rows

**English** | [简体中文](https://github.com/neuviletteflux/ai-catalog/blob/main/plugins/dsh-draft-rows/README.zh.md)

Unsent **New Sessions** stay visible in the DSH sidebar as draft rows. Each
workspace keeps one **New Session** row, typed drafts keep their own rows, and
New Session stops minting a fresh session id every time.

![Draft rows in the DSH sidebar](https://raw.githubusercontent.com/neuviletteflux/ai-catalog/main/plugins/dsh-draft-rows/assets/dsh-draft-rows.png)

| Item | Value |
|---|---|
| Version | `0.2.0` |
| DSH host | `0.2.1-rc.2` verified (web client, 0.2.0 E2E) |
| Status | experimental |
| Node.js | 22.19+ or 24+ |
| Network | none |
| Storage | `dsh.conversation.*`, `dsh.drafts.v1`, `dsh.drafts.mode` |

Community plugin, not an official DeepSeek product.

## What it does

- Draft rows show a live preview of the unsent composer text (`草稿｜…`).
- Each workspace has **one New Session row**: extra empty drafts collapse into
  the current empty draft, or the newest one when the current row is not empty.
- New Session reuses that empty draft; only when every draft carries text does
  it mint a new session id (Cursor / Telegram behavior).
- Typed drafts stay as their own rows; clicking one reopens it with the text
  intact.
- Draft rows are sorted above ordinary **and pinned** sessions inside their
  workspace.
- Switching away and back, or reloading, keeps the draft.
- The stock row menu's **Archive** discards a draft and removes its preview.

## Install

This package is a DSH Profile Bundle. No clone is required.

### Desktop app (recommended)

**Settings → Plugins → Add plugin**, paste:

```text
github:neuviletteflux/ai-catalog#path:/plugins/dsh-draft-rows
```

Then restart DSH. The same dialog also accepts npm package names, Git URLs, and
absolute local directories.

### CLI (non-desktop profiles)

```bash
dsh plugin --profile web add 'github:neuviletteflux/ai-catalog#path:/plugins/dsh-draft-rows'
```

The `desktop` profile is owned by the app: plain
`dsh plugin --profile desktop …` is rejected. Use the app entry above for
Desktop.

### Pin a revision

The commands above follow `main`. To freeze an install, replace
`<full-commit>` with a full commit hash:

```text
github:neuviletteflux/ai-catalog#<full-commit>&path:/plugins/dsh-draft-rows
```

### Local development

```bash
dsh plugin --profile web add link:/path/to/ai-catalog/plugins/dsh-draft-rows
```

Do not install the GitHub bundle and the local link into the same profile: both
would resolve as the same package.

## Upgrade

GitHub installs follow a Git ref, so remove the old copy and install again
before restarting:

```bash
dsh plugin --profile web remove dsh-draft-rows
dsh plugin --profile web add 'github:neuviletteflux/ai-catalog#path:/plugins/dsh-draft-rows'
```

In the desktop app, remove the plugin in Settings, add the address again, and
restart. Upgrade does not delete drafts or session data.

## Use

1. Start a new session, type text, and switch to another session without
   sending.
2. The draft stays in the sidebar as `草稿｜…`; click it to continue.
3. Pressing **New Session** returns to the single visible empty draft; a new id
   is minted only when every draft carries text.
4. Use the row menu's **Archive** to discard a draft.

### Single-slot mode

The default is **multi** (reuse an empty draft; typed drafts keep their own
rows). The pre-0.2.1 **single** behavior — reuse the workspace's blank even when
it has text — is one localStorage switch:

```js
localStorage["dsh.drafts.mode"] = "single"; // then reload
```

Remove the key (or set `"multi"`) to return to the default.

## Uninstall

Remove the plugin in Settings, or run:

```bash
dsh plugin --profile web remove dsh-draft-rows
```

Then restart DSH. Uninstalling does not delete drafts, sessions, or the
localStorage keys listed above; reinstalling may surface the same drafts again.

## Compatibility and limits

0.2.0 was verified end-to-end against DSH `0.2.1-rc.2` in an isolated web host:
duplicate empty drafts collapse to one row, New Session reuses it, and draft
rows render above pinned rows. Every patch is instance-level and feature
detected; when a service or shape is missing, the plugin leaves stock behavior
untouched and logs one warning. The client bundle is loaded through
`window.__ModuleLoader__.load`, the same channel as other DSH client plugins.
The `engines.dsh` range is a target, not a compatibility guarantee; only the
version above is verified.

Known limits:

- Collapsed empty drafts still exist on the Host and are reused; they are not
  deleted. The one-row rule applies per workspace, with the ungrouped bucket
  counting as one workspace.
- Ordering is visual only (`CSS order`): DOM and keyboard navigation keep the
  stock order, and the selectors depend on the stock tree's HoverCard wrapper
  spans and `data-row-key` attributes.
- Draft attachments are not persisted by the stock conversation snapshot;
  attachment-only drafts show `[附件]` as their preview and are treated as
  occupied, but the attachment itself is still lost on switch.
- Draft rows are projected through `sessions.list.getSnapshot`; a future
  renderer change may require re-verification. The preview text, titles, and
  New Session rule do not depend on DOM classes.
- Double-click rename is blocked on draft rows (the preview owns the title);
  the row menu's Rename may still open, but the preview remains the label.

## How it works

- `uiWorkspace.startSession` is patched so New Session reuses an empty draft.
- `sessions.list.getSnapshot` is shadowed to project each blank draft as an
  ordinary row with a preview title.
- Extra empty drafts are collapsed to one visible row per workspace; the
  current empty draft wins, otherwise the newest one.
- CSS `order` lifts draft rows above ordinary and pinned rows; the single New
  Session row is marked separately.
- `conversation.input` is subscribed to mirror the current composer text into
  `dsh.drafts.v1`, so previews survive reloads.
- No DSH core file is modified.

## Data and security

- Draft text: `dsh.conversation.<sessionId>` (the stock conversation store).
- Preview mirror: `dsh.drafts.v1` (sessionId → `{ p, at }`), capped at 200
  entries. On first install it also scans `dsh.conversation.*`, surfacing drafts
  orphaned by the stock 0.2.1 behavior.
- The plugin makes no network requests, has no telemetry, and reads no
  credentials. It never deletes a session; discarding a draft uses the stock
  Host archive.

## Troubleshooting

- **A draft row is missing.** Confirm the plugin is enabled, restart DSH, and
  make sure the session has no turn yet. Sessions with a turn are ordinary
  sessions, not drafts.
- **Draft text disappeared.** Attachments are not persisted by the stock
  snapshot (see Limits). localStorage is also per browser and per Host; check
  that you are on the same profile and origin.
- **New Session still mints every time.** Check the installed version and that
  no second copy is active (GitHub bundle plus local link). Restart after
  installing.
- **`dsh plugin --profile desktop …` fails.** Expected: the Desktop profile is
  managed by the app. Install from Settings instead.
- **After a DSH upgrade.** Reinstall and re-verify; this build is tested only
  against `0.2.1-rc.2`.

## Development

```bash
node --test tests/logic.test.mjs tests/apply.test.mjs
```

From the catalog root, validate metadata with:

```bash
python3 scripts/validate_metadata.py
```

Tests and real-UI notes: [VERIFICATION.md](https://github.com/neuviletteflux/ai-catalog/blob/main/plugins/dsh-draft-rows/VERIFICATION.md).

## Distribution status

No npm package is published yet. GitHub is the supported channel; pin a full
commit for reproducible installs. Changes are recorded in
[CHANGELOG.md](https://github.com/neuviletteflux/ai-catalog/blob/main/plugins/dsh-draft-rows/CHANGELOG.md);
the maintainer release path is in
[RELEASING.md](https://github.com/neuviletteflux/ai-catalog/blob/main/RELEASING.md).

## License

MIT. See [LICENSE](https://github.com/neuviletteflux/ai-catalog/blob/main/plugins/dsh-draft-rows/LICENSE).
