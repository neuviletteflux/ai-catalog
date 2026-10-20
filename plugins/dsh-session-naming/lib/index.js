/**
 * dsh-session-naming
 *
 * Makes the local DSH session-naming convention the default behavior instead
 * of a prompt-only instruction. The package has two halves:
 *
 * - `title-tools`: `set_session_title` and `rename_session`, the agent-facing
 *   rename entry points DSH does not ship.
 * - `normalizer`: after the built-in summary title settles, append a
 *   `provider`-sourced revision in the convention shape. Provider revisions do
 *   not pin the title, so an agent can still correct it later.
 *
 * Mounted as a DSH Profile Bundle through `cordis.patch.yml`; also usable from
 * a home-level patch during development. The two mounting styles are mutually
 * exclusive because they register the same tools twice.
 *
 * @module dsh-session-naming
 */
import { sessionTitleAuditTool } from './audit.js'
import { sessionTitleBackfillTool } from './backfill.js'
import { applyNormalizer, settleDelayOf } from './normalizer.js'
import { registerTitleTools } from './title-tools.js'

/** Host plugin identity. */
export const name = 'dsh-session-naming'

/** Both halves need the title service; the tools half also needs the registry. */
export const inject = ['tools', 'sessionTitle']

const CONFIG_KEYS = new Set(['settleMs', 'tools', 'normalizer'])

/**
 * Validate and normalize the bundle row's `config`.
 * @param config - raw row config.
 * @returns `{ settleMs, tools, normalizer }`.
 * @throws when the config carries an unknown key or a wrong type.
 */
export function normalizeConfig(config) {
  if (config === undefined || config === null) config = {}
  if (typeof config !== 'object' || Array.isArray(config)) {
    throw new Error('dsh-session-naming: config 必须是对象')
  }
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) {
      throw new Error(`dsh-session-naming: 未知配置项 "${key}"；可用：${[...CONFIG_KEYS].join('、')}`)
    }
  }
  for (const key of ['tools', 'normalizer']) {
    if (config[key] !== undefined && typeof config[key] !== 'boolean') {
      throw new Error(`dsh-session-naming: ${key} 必须是布尔值`)
    }
  }
  return {
    settleMs: settleDelayOf(config),
    tools: config.tools !== false,
    normalizer: config.normalizer !== false,
  }
}

/**
 * Mount both halves according to `config`.
 * @param ctx - host context.
 * @param config - `{ settleMs?, tools?, normalizer? }`.
 * @returns a disposer for hosts that unload the plugin without disposing `ctx`.
 */
export function apply(ctx, config) {
  const options = normalizeConfig(config)
  const disposers = []
  if (options.tools) {
    disposers.push(registerTitleTools(ctx))
    const disposeAudit = ctx.tools.register(sessionTitleAuditTool())
    if (typeof disposeAudit === 'function') disposers.push(disposeAudit)
    const disposeBackfill = ctx.tools.register(sessionTitleBackfillTool(ctx))
    if (typeof disposeBackfill === 'function') disposers.push(disposeBackfill)
  }
  if (options.normalizer) disposers.push(applyNormalizer(ctx, options))
  return () => {
    for (const dispose of disposers) {
      if (typeof dispose === 'function') dispose()
    }
  }
}
