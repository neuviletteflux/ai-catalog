# dsh-primary-session

**English** | [简体中文](https://github.com/neuviletteflux/ai-catalog/blob/main/plugins/dsh-primary-session/README.zh.md)

Mark one pinned **primary session** per workspace in the DSH sidebar.

![The primary badge and the row menu](https://raw.githubusercontent.com/neuviletteflux/ai-catalog/main/plugins/dsh-primary-session/assets/primary-badge.png)

![Set as primary in the session row menu](https://raw.githubusercontent.com/neuviletteflux/ai-catalog/main/plugins/dsh-primary-session/assets/dsh-primary-session.png)

| Item | Value |
|---|---|
| Version | `0.1.0` |
| DSH host | `0.2.1-rc.2` verified (web client) |
| Status | experimental |
| Node.js | 22.19+ or 24+ |
| Network | none |
| Storage | Host pin set; `dsh.primary.badge.style` |

Community plugin, not an official DeepSeek product.

## What it does

DSH already has **Pin**: a pinned session moves to the top of its workspace
group and keeps a pin icon at the end of the row. It allows several pins per
workspace, though, so with many parallel sessions the pinned section can become
just as homogeneous as the normal list.

This plugin adds one row-menu item on top of Pin:

| Menu item | Behavior |
|---|---|
| **Set as primary** | Unpins every other pinned session **in the same workspace** (or in the ungrouped bucket), then pins the selected session |
| **Clear primary** | Unpins only the selected session; other workspaces are untouched |

The list keeps **one primary per workspace**: the first id of the Host-ordered
pin list that belongs to that workspace. That row gets a compact accent **主**
badge in the row-leading seat (the stock pin icon stays at the row end), and the
row is fronted ahead of normal rows. No new schema or session event; the
optional badge style is the only new localStorage key. Archived rows do not
offer the menu item (pin and archive are mutually exclusive on the Host).

### Badge styles

The badge visual is selectable through localStorage and applies after a reload:

```js
localStorage["dsh.primary.badge.style"] = "soft"; // solid | soft | outline | circle | star | bar
```

`bar` is the default; `star` and `bar` carry no text (accessible name stays
“Primary session”), `bar` is a 3px accent bar at the row start. Remove the key to
fall back to `bar`. The color is the theme accent.

![Badge style options](https://raw.githubusercontent.com/neuviletteflux/ai-catalog/main/plugins/dsh-primary-session/assets/badge-styles.png)

## Install

This package is a DSH Profile Bundle. No clone is required.

### Desktop app (recommended)

**Settings → Plugins → Add plugin**, paste:

```text
github:neuviletteflux/ai-catalog#path:/plugins/dsh-primary-session
```

Then restart DSH. The same dialog also accepts npm package names, Git URLs, and
absolute local directories.

### CLI (non-desktop profiles)

```bash
dsh plugin --profile web add 'github:neuviletteflux/ai-catalog#path:/plugins/dsh-primary-session'
```

The `desktop` profile is owned by the app: plain
`dsh plugin --profile desktop …` is rejected. Use the app entry above for
Desktop.

### Pin a revision

The commands above follow `main`. To freeze an install, replace
`<full-commit>` with a full commit hash:

```text
github:neuviletteflux/ai-catalog#<full-commit>&path:/plugins/dsh-primary-session
```

### Local development

```bash
dsh plugin --profile web add link:/path/to/ai-catalog/plugins/dsh-primary-session
```

Do not install the GitHub bundle and the local link into the same profile: both
would resolve as the same package.

#### Development mount (mutually exclusive with the bundle install)

While iterating, the home-layer patch can mount the package directly:

```yaml
- insert:
    - id: dsh-primary-session
      name: /path/to/ai-catalog/plugins/dsh-primary-session/lib/index.js
```

Do **not** combine this with the Profile Bundle install: the same package would
resolve from two active Loader sources and client-module composition would fail.

## Upgrade

GitHub installs follow a Git ref, so remove the old copy and install again
before restarting:

```bash
dsh plugin --profile web remove dsh-primary-session
dsh plugin --profile web add 'github:neuviletteflux/ai-catalog#path:/plugins/dsh-primary-session'
```

In the desktop app, remove the plugin in Settings, add the address again, and
restart. Upgrade does not change the Host pin set.

## Use

1. Open the session row menu.
2. Choose **Set as primary**. Other pinned sessions in the same workspace are
   unpinned; the selected row moves to the top and shows the **主** badge.
3. Choose **Clear primary** to unpin only that row.

## Uninstall

Remove the plugin in Settings, or run:

```bash
dsh plugin --profile web remove dsh-primary-session
```

Then restart DSH. If you used the development mount, delete its home-patch row
instead. Unpinning is not required; the Host pin set remains as it was.

## Compatibility and failure behavior

Verified against DSH `0.2.1-rc.2` (desktop). Requires the
`sidebar.workspaces.session.menu.item` slot and the client `workspaces` service
(`list` + `pinSession` / `unpinSession`). If either surface is missing the menu
item does not register; if a Host call fails the plugin logs one warning to the
console and the pin state stays as the Host reported it (there is no toast
channel). The `engines.dsh` range is a target, not a compatibility guarantee;
only the version above is verified.

## Storage

The primary choice reuses the Host's existing pin set
(`<DSH_HOME>/storages/workspace.json` → `global.pinnedSessionIds`), so it
survives reloads and is shared across browsers talking to the same Host. The
optional badge style is stored per browser in localStorage under
`dsh.primary.badge.style`.

## Limits

- Uniqueness is **per workspace** (the ungrouped bucket counts as one), not
  global.
- Manually pinning a second session breaks uniqueness; the most recent pin
  becomes primary (the badge moves), and choosing **Set as primary** again
  converges the workspace back to one.
- The badge sits in the row-leading seat, which is rendered only while the row
  is idle; a running row shows its status dot there instead. The trailing pin
  icon still marks it.
- Calling the `workspaces` service directly updates the Host pin set and the
  pinned section, but does not rewrite the locally saved manual drag order the
  way the stock Pin button does.

## How it works

- Registers one `sidebar.workspaces.session.menu.item` entry.
- Reads the Host pin list and renders a leading **主** badge for the first pinned
  row of each workspace.
- Setting a primary calls the existing `pinSession` / `unpinSession` services;
  no new schema or session event.
- No DSH core file is modified.

## Data and security

The plugin makes no network requests, has no telemetry, and reads no
credentials. It changes the Host's existing pin set and, only when you choose a
non-default style, one localStorage key. Uninstalling leaves the pins in place.

## Troubleshooting

- **The menu item is missing.** Confirm the plugin is enabled and DSH is on
  `0.2.1-rc.2` or a compatible build; restart after installing. Archived rows
  intentionally do not offer it.
- **The badge did not move.** Manually pinning another session also changes the
  primary; choose **Set as primary** again to converge.
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

Tests and real-UI notes: [VERIFICATION.md](https://github.com/neuviletteflux/ai-catalog/blob/main/plugins/dsh-primary-session/VERIFICATION.md).

## Distribution status

No npm package is published yet. GitHub is the supported channel; pin a full
commit for reproducible installs. Changes are recorded in
[CHANGELOG.md](https://github.com/neuviletteflux/ai-catalog/blob/main/plugins/dsh-primary-session/CHANGELOG.md);
the maintainer release path is in
[RELEASING.md](https://github.com/neuviletteflux/ai-catalog/blob/main/RELEASING.md).

## License

MIT. See [LICENSE](https://github.com/neuviletteflux/ai-catalog/blob/main/plugins/dsh-primary-session/LICENSE).
