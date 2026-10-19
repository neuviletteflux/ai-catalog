# dsh-draft-rows

**English** | [简体中文](README.zh.md)

Unsent **New Sessions** stay visible in the DSH sidebar as draft rows, and New
Session stops minting a fresh session id every time.

![Draft rows in the DSH sidebar](assets/dsh-draft-rows.png)

- Draft rows show a live preview of the unsent composer text (`草稿｜…`).
- New Session reuses the workspace's **empty** draft; only when every draft
  carries text does it mint a new one (Cursor / Telegram behavior).
- Typed drafts stay as their own rows; clicking one reopens it with the text
  intact.
- Switching away and back, or reloading, keeps the draft.
- The stock row menu's **Archive** discards a draft and removes its preview.

## Install

This package is a DSH Profile Bundle. Because the `desktop` profile is owned by
the Electron application, install it from the app:

**Settings → Plugins → Add plugin → paste the local directory path**, e.g.
`/Users/lives/Github/ai-catalog/plugins/dsh-draft-rows`, then restart DSH.

The CLI channel is available for non-desktop profiles:

```bash
dsh plugin --profile web add link:/path/to/ai-catalog/plugins/dsh-draft-rows
```

Uninstall: remove the plugin in the same settings page, or remove
`dsh-draft-rows` from the profile's dependencies and bundle list, then restart.

## New Session mode

The default is **multi** (reuse an empty draft, mint when all are occupied).
The pre-0.2.1 **single** behavior (reuse the workspace's blank even when it has
text) is one localStorage switch:

```js
localStorage["dsh.drafts.mode"] = "single"; // then reload
```

Remove the key (or set `"multi"`) to return to the default.

## Storage

- Draft text: `dsh.conversation.<sessionId>` (stock conversation store).
- Preview mirror: `dsh.drafts.v1` (sessionId → `{ p, at }`), capped at 200
  entries. On first install it also scans `dsh.conversation.*`, surfacing
  drafts orphaned by the stock 0.2.1 behavior.
- The plugin never deletes a session; discarding a draft archives it through
  the stock host archive.

## Compatibility and failure behavior

Verified against DSH `0.2.1-rc.2`. Every patch is instance-level and feature
detected; when a service or shape is missing, the plugin leaves stock behavior
untouched and logs one warning. The client bundle is loaded through
`window.__ModuleLoader__.load`, the same channel as other DSH client plugins.

Known limits:

- Draft attachments are not persisted by the stock conversation snapshot;
  attachment-only drafts show `[附件]` as their preview and are treated as
  occupied, but the attachment itself is still lost on switch.
- Draft rows are projected through `sessions.list.getSnapshot`; a future
  renderer change may require re-verification. The preview text, titles, and
  New Session rule do not depend on DOM classes.
- Double-click rename is blocked on draft rows (the preview owns the title);
  the row menu's Rename may still open but the preview remains the label.

## Catalog metadata

`plugin.yaml` carries the catalog record for this plugin (id, version, status,
maintainers, tags) and is validated by the repository's
`scripts/validate_metadata.py`. The installable package is this same directory:
`package.json`, `cordis.patch.yml` and `lib/` are the DSH Profile Bundle.

## Verification

Unit tests: `node --test tests/logic.test.mjs tests/apply.test.mjs`.
Implementation and real-UI E2E notes: [VERIFICATION.md](VERIFICATION.md).
