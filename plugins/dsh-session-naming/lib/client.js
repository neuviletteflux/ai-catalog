/**
 * dsh-session-naming — browser half.
 *
 * Adds one optional leading-seat badge to a Session row when its
 * `SessionSummary` carries a `parentSessionId` and is not a subagent. The
 * visual is the only fork marker in the title row: the title itself stays
 * `MMDD｜type｜goal` for both parents and forks. The badge is aria-labeled and
 * does not intercept row clicks.
 *
 * The client module is a separate bundle: replacing an installed package
 * requires an app restart to load a fresh generation. A failure here cannot
 * break the host tools or normalizer.
 */
window.__ModuleLoader__.load({
  id: 'dsh-session-naming',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    const React = require('react')
    /** Dictionary namespace owned by this plugin. */
    const NS = 'session-naming'
    const zh = { 'badge.aria': '分叉会话' }
    const en = { 'badge.aria': 'Forked session' }

    /**
     * Whether a client SessionSummary is a top-level fork.
     * A subagent also has a parentSessionId, so `origin` must be excluded.
     * @param snapshot - `sessions.list` snapshot (`byId`).
     * @param sessionId - row session id.
     * @returns true for a top-level fork row.
     */
    function isFork(snapshot, sessionId) {
      const summary = snapshot?.byId?.[sessionId]
      return summary?.parentSessionId !== undefined && summary.origin !== 'subagent'
    }

    /**
     * Row-leading fork icon. The leading seat is shared with the primary badge;
     * both may render on the same row, so this stays a compact 15px glyph.
     * @param props - composed slot props (`t`, `useForkState`).
     * @returns the icon, or null for a non-fork row.
     */
    function ForkBadge(props) {
      const { sessionId, t, useForkState } = props
      const snapshot = useForkState((state) => state)
      if (!isFork(snapshot, sessionId)) return null
      const label = t('badge.aria')
      return React.createElement('span', {
        role: 'img',
        'aria-label': label,
        title: label,
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '15px',
          height: '15px',
          flex: 'none',
          color: 'var(--dsw-alias-state-business-primary)',
        },
      }, React.createElement('svg', {
        width: 14,
        height: 14,
        viewBox: '0 0 16 16',
        'aria-hidden': true,
        fill: 'currentColor',
      }, React.createElement('path', {
        d: 'M5 3.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm0 2.122a2.25 2.25 0 1 0-1.5 0v.878A2.25 2.25 0 0 0 5.75 8.5h1.5v2.128a2.251 2.251 0 1 0 1.5 0V8.5h1.5a2.25 2.25 0 0 0 2.25-2.25v-.878a2.25 2.25 0 1 0-1.5 0v.878a.75.75 0 0 1-.75.75h-4.5A.75.75 0 0 1 5 6.25v-.878Zm3.75 7.378a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm3-8.75a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z',
      })))
    }

    /** Required client services. */
    const inject = ['slots', 'sessions', 'locale']

    /**
     * Register the fork badge once the sidebar declares the row-leading seat.
     * @param ctx - client root context.
     */
    function apply(ctx) {
      const sessions = ctx.get('sessions')
      if (sessions === undefined) return
      const source = {
        getSnapshot: () => sessions.list.getSnapshot(),
        subscribe: (listener) => sessions.list.subscribe(listener),
      }
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'session-naming: dictionaries')
      ctx.slots.inject('sidebar.session.row.leading', () => ctx.slots.register({
        name: 'sidebar.session.row.leading',
        id: 'session-naming-fork-badge',
        order: 60,
        locale: NS,
        inject: () => ({ hooks: { forkState: source } }),
      }, ForkBadge))
    }

    exports.__test = { isFork }
    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
