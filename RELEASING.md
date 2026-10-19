# Releasing the DSH plugins

The two plugins in `plugins/` are versioned independently. Keep
`package.json.version` and `plugin.yaml.version` in sync.

## Current distribution

GitHub subdirectory install is the supported channel; no npm package is
published yet. Users can pin a full commit for reproducible installs:

```text
github:neuviletteflux/ai-catalog#<full-commit>&path:/plugins/<plugin-id>
```

## Release checklist

1. Decide the npm identity before the first publish. Prefer a scope
   (`@neuviletteflux/dsh-draft-rows`) over an unscoped, generic name. If the
   package name changes, update `package.json`, the README install commands, and
   the `cordis.patch.yml` comment in the same change.
2. Bump `package.json.version` and `plugin.yaml.version`; update
   `CHANGELOG.md`; keep `plugin.yaml.status` at `experimental` until real-use
   verification supports a change.
3. Run the checks:
   - `python3 scripts/validate_metadata.py`
   - `npm test` in each plugin directory
   - `npm pack --dry-run` and inspect the file list (`LICENSE`, `CHANGELOG.md`,
     `assets`, `lib`, `cordis.patch.yml` must be present)
4. Install the packed tarball into a disposable profile and verify load,
   behavior, and uninstall:
   ```bash
   dsh plugin --profile scratch add /absolute/path/dsh-draft-rows-<version>.tgz
   dsh plugin --profile scratch remove dsh-draft-rows
   ```
5. Commit and tag the plugin, for example `dsh-draft-rows-v<version>`.
6. After `npm login` (with 2FA where enabled), publish the exact version from
   the plugin directory, then verify the registry:
   ```bash
   npm publish --access public
   npm view dsh-draft-rows@<version>
   ```
   Publish from a clean tree, never from a moving branch.
7. Update the README install command to the exact published version and record
   the verified DSH host. Do not claim compatibility with an untested host.
8. If the DSH host changes, re-run the install, load, behavior, upgrade, and
   uninstall checks before widening `engines.dsh` or the README compatibility
   line.

## Compatibility rule

These plugins patch instance-level DSH client internals (`uiWorkspace`,
`sessions.list`, session-row menu/badge seats). A DSH release may change those
shapes. Treat every DSH upgrade as a new verification target: update the README's
verified version only after the checks above pass.
