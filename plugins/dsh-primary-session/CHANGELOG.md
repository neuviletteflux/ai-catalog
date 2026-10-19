# Changelog

## 0.1.0 — 2026-10-19

- Initial public release as a DSH Profile Bundle.
- Adds **Set as primary** / **Clear primary** to the session row menu.
- Keeps one primary session per workspace by reusing the Host pin set: setting a
  primary unpins the other pinned sessions in the same workspace.
- Marks the primary row with a leading **主** badge while the stock pin icon
  stays at the row end.
- Selectable badge styles through `localStorage["dsh.primary.badge.style"]`:
  `bar` (default), `solid`, `soft`, `outline`, `circle`, `star`.
- Adds no Host storage, schema, or session event; the optional style key is
  client-local. Verified against DSH `0.2.1-rc.2`; see
  [VERIFICATION.md](VERIFICATION.md).
