# Changelog

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
