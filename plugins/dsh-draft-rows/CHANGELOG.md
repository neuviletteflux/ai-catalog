# Changelog

## 0.2.1 — 2026-10-19

- Stop rewriting the stock `sessions.list.ids` order: projection now preserves
  the host order, and draft lift stays a CSS-only visual effect.
- In manual order mode, lead visible drafts and Sessions missing from the saved
  order instead of letting the stock reconcile append them at the end. Existing
  saved rows keep their relative order; recent-update mode is untouched.
- Fixes new Sessions disappearing behind the workspace watermark in manual
  order mode.
- Added `leadManualOrders` unit tests (new Session lead, stable re-run, saved
  relative order, typed draft already in the saved order) and apply-layer tests
  for the manual/updated write guard.
- Verified in an isolated Web Host E2E: a second ordinary Session copied into a
  manual-order workspace led the saved order ahead of the previously saved row.

## 0.2.0 — 2026-10-19

- Each workspace now keeps exactly one New Session row. Extra empty drafts are
  collapsed and reused instead of rendered as separate rows.
- Draft rows are sorted above ordinary and pinned sessions inside their
  workspace.
- Multi mode reuses the current visible empty draft even when another blank
  draft is newer.
- Added tests for the collapse plan and the New Session row order.
- Verified in an isolated Web Host E2E against DSH `0.2.1-rc.2`: New Session
  reuse, reload persistence, one-row collapse, and ordering above pinned rows.

## 0.1.0 — 2026-10-19

- Initial public release as a DSH Profile Bundle.
- Unsent New Sessions stay visible as sidebar draft rows with live composer
  previews.
- New Session reuses an empty draft instead of minting a session id every time;
  typed drafts keep their own rows.
- Draft previews and text survive switching and reloads; Archive discards a
  draft through the stock Host archive.
- Multi-draft is the default. `localStorage["dsh.drafts.mode"] = "single"`
  restores the pre-0.2.1 single-slot behavior.
- Verified against DSH `0.2.1-rc.2`; see [VERIFICATION.md](VERIFICATION.md).
