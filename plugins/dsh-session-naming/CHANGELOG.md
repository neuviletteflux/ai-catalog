# Changelog

## 0.4.2 — 2026-10-20

- Declare `@deepseek-ai/dsh-client-ui-renderer` in the client inject list, the
  same renderer dependency the primary-session badge uses, so the leading seat
  is available before the badge registers.

## 0.4.1 — 2026-10-20

- `session_title_audit` now separates a parent and its fork sharing the same
  day/goal (`forkPairs`) from true duplicate groups, so the intentional
  parent/branch shape no longer reads as a duplicate.
- Tests 71 → 72.

## 0.4.0 — 2026-10-20

- Add an optional client half (`./client`): a compact, aria-labeled fork icon
  in `sidebar.session.row.leading` for top-level `SessionSummary` rows with a
  `parentSessionId`; subagents are excluded. The title prefix remains the
  durable marker.
- The client bundle requires an app restart after replacing the package; host
  tools and the normalizer are unaffected by a client load failure.
- Tests 69 → 71.

## 0.3.0 — 2026-10-20

- Add the read-only `session_title_audit` tool: compliance rate, type
  distribution, forks missing `Branch｜`, forks still carrying `(n)`, invalid
  type prefixes, `AUTO` without `-NN`, and same-day/same-goal duplicates.
- `AUTO` now requires a `seq`; `composeTitle` rejects `AUTO` without a run
  index, and `isConventionTitle` treats `0105｜AUTO｜任务` (no `-NN`) as
  non-compliant.
- Tests 62 → 69.

## 0.2.2 — 2026-10-20

- `rename_session` now strips a trailing `(n)` before adding `Branch｜` to a
  fork title, so an inherited title cannot become `Branch｜… (1)`.

## 0.2.1 — 2026-10-20

- Fix `rename_session`: call the Host `sessionController.rename({ sessionId,
  title })` directly. The previous `typertGateway.invoke` request lacked the
  Peer context required by the gateway and failed live with
  `Cannot read properties of undefined (reading 'signal')`.
- Docs now name `sessionController` as the dependency; `typertGateway` is no
  longer used.

## 0.2.0 — 2026-10-20

- Fork children that still carry the inherited `父标题 (n)` are normalized
  automatically to `Branch｜MMDD｜类型｜目标`, with the ordinal removed.
- Human renames on a fork, subagents (`header.origin = "subagent"`), and forks
  without a human message seq are left untouched.
- Provider revisions for inherited titles cite the first human message in the
  inherited log (the inherited title itself has empty `messageSeqs`), satisfying
  DSH's invariant.
- Inherited fork titles normalize immediately (0ms) instead of waiting for
  `settleMs`, so a cold fork can be fixed before disposal.
- Extracted shared fork detection into `lib/branch.js`; 61 tests.

## 0.1.1 — 2026-10-20

- Type inference is now weighted: the title dominates the first human message,
  action verbs outrank question words, a leading verb gets a bonus, and a
  deliverable suffix (方案/报告/清单/复盘/分析) selects the artifact type.
- A pure question with no failure signal is classified as `查询`; failure
  questions stay `排障`. Added keywords for 优化、移动、清理、重做、落地、分发、
  评估、差异、原理、评审、验收、输出、导出、验证 and more.
- Normalization strips any `MMDD｜短类型｜` prefix, including types outside the
  vocabulary, so `1020｜开发｜…` no longer leaks the prefix into the goal.
- `isBranchSession` and `isInheritedForkTitle` treat
  `header.origin === "subagent"` as neither a fork nor an inherited title;
  subagents never receive the `Branch｜` prefix.
- Added regression tests for eight misclassified titles, unknown-type prefixes,
  and subagent branch handling (54 tests total).

## 0.1.0 — 2026-10-20

- Initial public release as a DSH Profile Bundle.
- Adds the `set_session_title` tool: composes `[Branch｜]MMDD｜类型｜目标` from
  the session creation date, validates the type vocabulary, enforces the title
  service's byte budget, and reports the accepted title and byte count.
- Adds the `rename_session` tool: renames any session through the same
  `session.rename` gateway as the Web GUI, with automatic branch-prefix
  detection from the read-only projection cache.
- Automatically normalizes the built-in summary title after a configurable
  settle window (`settleMs`, default 10s) by appending an unpinned
  `provider`-sourced revision.
- Skips human titles, compliant titles, subagent/fork sessions, titles without
  human message references, and its own revisions.
- Configuration: `settleMs`, `tools`, `normalizer`. Unknown keys and wrong
  types fail at activation.
- No extra model call, no network access, no direct writes to DSH data files.
- Verified against DSH `0.2.1-rc.2`; see [VERIFICATION.md](VERIFICATION.md).
