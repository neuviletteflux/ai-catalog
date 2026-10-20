# dsh-session-naming

**English** | [简体中文](README.zh.md)

Make the local DSH **session-naming convention** the default behavior instead of
a prompt-only instruction. The plugin has two halves:

| Half | What it does |
|---|---|
| Agent tools | Adds `set_session_title` (current session), `rename_session` (any session by id), and a read-only `session_title_audit`. |
| Client UI | Optional leading-seat fork icon on Session rows (requires a restart to load the client bundle). |
| Automatic normalizer | Watches `session/title`, waits for the built-in summary to settle, then appends `[Branch｜]MMDD｜类型｜目标`. |

Community plugin, not a DeepSeek product.

| Item | Value |
|---|---|
| Version | `0.4.2` |
| DSH Host | `0.2.1-rc.2` verified |
| Status | experimental |
| Node.js | 22.19+ or 24+ |
| Network | none |
| Storage | title events only; run log under `$DSH_HOME/logs` |

## The convention

```text
ordinary session     MMDD｜类型｜目标
branch (fork)        Branch｜MMDD｜类型｜目标
automation run       MMDD｜AUTO｜任务名称        (repeat runs: -01, -02)
```

- `MMDD` is the **session creation date**, not the day the title is written.
- `类型` is one of `分析｜规划｜实施｜排障｜审计｜查询｜整理｜复盘｜AUTO`.
- `AUTO` is reserved for automation runs; the normalizer never infers it. The
  tool requires `seq` for `AUTO` (emitting `-01`, `-02`), and a title without
  `-NN` is not compliant.
- The budget is the session-title service's `maxTitleBytes` (80 in the desktop
  bundle). The branch prefix counts toward it (`Branch｜` is 9 bytes).

## Why not replace the title provider?

DSH has shipped incompatible `@deepseek-ai/dsh-session-title-llm` interfaces
across releases: one generation exports `registerSessionTitleLlmProvider` /
`generateSessionTitleWithLlm` with a hard-coded system prompt, another exports
`executeSessionTitleLlm` with a provider-supplied prompt. Replacing the provider
therefore breaks on one of the two deployments.

This plugin keeps the built-in summary and **appends** a revision instead:

1. the built-in fallback and LLM provider produce a readable summary;
2. after `settleMs` without a newer title, the normalizer rewrites it;
3. the revision uses `source.kind = "provider"` (provider id
   `session-naming-convention`), so the title is **not pinned** — an agent can
   still correct it with `set_session_title`.

No extra model call is made; the goal text reuses the built-in summary.

## Install

The package is a DSH Profile Bundle. It has no build step and no dependencies.

### Desktop app

**Settings → Plugins → Add plugin**, paste:

```text
github:neuviletteflux/ai-catalog#path:/plugins/dsh-session-naming
```

Restart DSH after installation. The same field accepts npm package names, Git
URLs, and local absolute directories.

### CLI (non-desktop profiles)

```bash
dsh plugin --profile web add 'github:neuviletteflux/ai-catalog#path:/plugins/dsh-session-naming'
```

`desktop` is managed by the app: install from Settings instead of running
`dsh plugin --profile desktop …`.

### Pin a revision

```text
github:neuviletteflux/ai-catalog#<full-commit>&path:/plugins/dsh-session-naming
```

### Local development

```bash
dsh plugin --profile web add link:/path/to/ai-catalog/plugins/dsh-session-naming
```

#### Development mount (mutually exclusive with the Bundle)

A home-level patch can mount the module directly while iterating:

```yaml
- insert:
    - id: session-naming
      name: /path/to/ai-catalog/plugins/dsh-session-naming/lib/index.js
      config:
        settleMs: 10000
```

Do **not** combine this with the Bundle install: both sources would register
`set_session_title` and `rename_session`, and the tool registry would see
duplicates. Pick one.

## Configuration

The bundle's patch inserts one row with:

```yaml
- insert:
    - id: session-naming
      name: 'dsh-session-naming'
      config:
        settleMs: 10000
        tools: true
        normalizer: true
```

| Key | Type | Default | Meaning |
|---|---|---|---|
| `settleMs` | integer `0-600000` | `10000` | Wait this long after the last title event before normalizing. Reset by every newer title. |
| `tools` | boolean | `true` | Register `set_session_title` / `rename_session`. |
| `normalizer` | boolean | `true` | Install the automatic title rewrite. Disable it to keep only the tools (the built-in summary behavior is untouched). |

Unknown keys and wrong types fail at activation instead of being ignored.
`tools: false` + `normalizer: false` is valid but makes the plugin a no-op.

## Behavior details

### Tools

`set_session_title` composes the title from the session's creation date and
returns the accepted title, its byte count, the budget, and whether the service
truncated it. It refuses to overwrite a title whose source is `user` unless
`force: true`; inherited fork titles (`父标题 (1)`) are recognized as not-human
by two independent checks:

1. stripping `(n)` yields the parent's current title;
2. it is the first title event in the branch, with no human `messageSeqs`.

`rename_session` calls the Host's `sessionController.rename`, the same business
method behind the Web GUI's `session.rename` remote, so it can rename inactive
sessions (the Host resumes them). It reads the projection cache to decide
whether the target is a branch; when the cache is unreadable it does **not**
guess and reports that no prefix was added.

`session_title_audit` is read-only. It scans the projection cache and reports
the compliance rate, type distribution, forks missing `Branch｜`, forks still
carrying `(n)`, invalid type prefixes, `AUTO` titles without a run index, and
same-day/same-goal duplicates (parent/fork pairs are reported separately from
true duplicates). It never writes a title, session log, or projection cache.

### Fork badge (client half)

`lib/client.js` registers a compact, aria-labeled fork icon in
`sidebar.session.row.leading` for a row whose `SessionSummary` has a
`parentSessionId` and is not a subagent. It is a visual aid only: the durable
marker is still the `Branch｜` title prefix. The client entry is bundled
separately, so replacing an installed package needs an app restart to load a
fresh generation; a client failure cannot break the host tools or normalizer.


### Type inference

The type is not a first-match keyword scan. The title and the first human
message are scored separately:

- a strong title hit adds 3; a leading activity verb adds 2; a deliverable
  suffix (方案/报告/清单/复盘/分析) adds 3;
- the first human message adds 1 only for a strong hit, so a prompt's "如何"
  cannot override an action word in the title;
- a pure question with no failure signal is `查询`; a failure question stays
  `排障`;
- ties use `排障 > 实施 > 审计 > 规划 > 整理 > 复盘 > 分析 > 查询`.

It remains a deterministic heuristic: when the inferred type is wrong, correct
it with `set_session_title`; no model call is added. Normalization also strips
any `MMDD｜短类型｜` prefix, including types outside the vocabulary.

### Normalizer skips

The normalizer leaves these alone:

- human titles (`source.kind = "user"` on a non-fork, or a fork title that is no
  longer the inherited `父标题 (n)`);
- subagent sessions (`header.origin = "subagent"`);
- titles that already match the convention (for a fork: `Branch｜…` and no
  trailing `(n)`);
- forks with no human message seq to cite;
- its own revisions (prevents self-triggering).

Fork behavior: the inherited title is rewritten to `Branch｜MMDD｜类型｜目标`
and the trailing `(n)` is removed. A fork's inherited title is stable already,
so it is normalized without waiting for the normal `settleMs` window. The
revision reuses the replaced event's `messageSeqs` when present; for an
inherited fork title (empty refs) it cites the first human message in the
inherited log. DSH's invariant still holds: `messageSeqs` is empty **iff**
`source.kind === "user"`.

### Run log

`$DSH_HOME/logs/session-naming.log` records plugin loads and each rewrite:

```text
2026-10-20T01:59:28.358Z session session-a0208d93-…: "Session naming skills 实现" (provider) → "1020｜查询｜Session naming skills 实现"
```

The log rotates at 256 KiB. If it cannot be written (read-only disk), logging
disables itself and naming keeps working.

## Storage and security

- No network requests, telemetry, or credentials.
- The plugin does not write DSH data files directly. Tools call the title
  service; the normalizer appends one `session/title` event.
- Branch detection reads `session_projcache` (read-only). Unreadable caches are
  reported as unknown, never guessed.
- Uninstalling does not remove titles already written; they are ordinary
  session events.

## Compatibility and failure behavior

Verified against the DSH Desktop `0.2.1-rc.2` session-title service. It needs:

- `ctx.sessionTitle` (`get`, `rename`, `config.maxTitleBytes`);
- `ctx.tools.register`;
- `session.append('session/title', …)` and `session.header.createdAt`;
- for `rename_session`, `sessionController` (`rename`).

If `sessionController` is absent, only `rename_session` fails; it reports the
missing service instead of writing anything. If the title service is absent, the plugin
does not activate. `engines.dsh` is a target range, not a compatibility promise;
only the version above has been exercised.

## Troubleshooting

- **Tools missing.** Confirm the bundle is enabled and DSH was restarted; check
  that no home-level patch mounts `lib/index.js` at the same time.
- **A new title was not normalized.** Wait for `settleMs` after the last title
  event. Human titles, forks/subagents, already-compliant titles, and titles
  without human refs are intentionally skipped.
- **The inferred type is wrong.** Type inference is a deterministic weighted
  heuristic; the title outranks the first message, but it cannot read intent.
  Correct the title with `set_session_title`; no config override is needed.
- **Duplicate tool errors.** Remove one of the two mounts (Bundle vs home patch).
- **`dsh plugin --profile desktop …` is rejected.** Expected: install from the
  app's Settings page instead.
- **After a DSH upgrade.** Reinstall and re-run the tests; inspect
  `session/title` events if the service contract changed.

## Uninstall

Remove the plugin in Settings, or:

```bash
dsh plugin --profile web remove dsh-session-naming
```

Then restart DSH. If you used a development mount, delete that home-patch entry
instead. Titles already written stay as normal session history.

## Development

```bash
cd plugins/dsh-session-naming
npm test                      # 72 node:test cases
npm pack --dry-run            # inspect the published file list
cd ../..
python3 scripts/validate_metadata.py
```

Layout:

```text
lib/compose.js         title composition, vocabulary, byte budget (pure)
lib/audit.js           read-only title audit over the projection cache
lib/client.js          browser half: fork icon in the Session row
lib/branch.js          fork detection and inherited-title checks (read-only)
lib/normalizer.js      title rewrite, type inference, settle listener
lib/title-tools.js     set_session_title / rename_session definitions
lib/index.js           config validation and plugin assembly
tests/*.test.mjs       unit tests with fake ctx/session objects
```

See [VERIFICATION.md](VERIFICATION.md) for the recorded checks and limits.
