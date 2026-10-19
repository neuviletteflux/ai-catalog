/**
 * dsh-draft-rows, host half.
 *
 * Intentionally empty: every behavior lives in the browser bundle
 * (`./client`). This module only makes the package a loadable Cordis plugin
 * so the profile boot graph picks up its `dsh.client` bundle.
 * @param _ctx - host plugin context (unused).
 * @param _config - profile-layer config (unused).
 */
export default function draftRowsHost(_ctx, _config = {}) {
  // The browser half owns all behavior.
}
