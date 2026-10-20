import assert from 'node:assert/strict'
import test from 'node:test'

let spec
globalThis.window = {
  __ModuleLoader__: {
    load(value) {
      spec = value
    },
  },
}
await import('../lib/client.js')

const fakeReact = {
  createElement(type, props, ...children) {
    return { type, props, children }
  },
}

function clientModule() {
  assert.equal(spec.id, 'dsh-session-naming')
  return spec.factory((name) => {
    if (name === 'react') return fakeReact
    throw new Error(`unexpected require: ${name}`)
  })
}

test('the client bundle registers a fork badge and exposes its predicate', () => {
  const client = clientModule()
  assert.deepEqual(client.inject, ['slots', 'sessions', 'locale'])
  const { isFork } = client.__test
  assert.equal(isFork({ byId: { a: { parentSessionId: 'p' } } }, 'a'), true)
  assert.equal(isFork({ byId: { a: { parentSessionId: 'p', origin: 'subagent' } } }, 'a'), false)
  assert.equal(isFork({ byId: { a: {} } }, 'a'), false)
  assert.equal(isFork({ byId: {} }, 'missing'), false)
})

test('apply registers the row-leading seat with a fork hook', () => {
  const client = clientModule()
  const snapshot = { byId: { a: { parentSessionId: 'p' } } }
  const registered = []
  let dictionary
  let injectedSeat
  const ctx = {
    get: (name) => (name === 'sessions'
      ? { list: { getSnapshot: () => snapshot, subscribe: () => () => {} } }
      : undefined),
    effect: (fn) => {
      fn()
      return () => {}
    },
    locale: {
      register: (namespace, entries) => {
        dictionary = { namespace, entries }
        return () => {}
      },
    },
    slots: {
      inject: (seat, register) => {
        injectedSeat = seat
        register()
      },
      register: (meta, component) => {
        registered.push({ meta, component })
        return () => {}
      },
    },
  }
  client.apply(ctx)
  assert.equal(injectedSeat, 'sidebar.session.row.leading')
  assert.equal(registered.length, 1)
  assert.equal(registered[0].meta.id, 'session-naming-fork-badge')
  assert.equal(registered[0].meta.order, 60)
  assert.equal(registered[0].meta.locale, 'session-naming')
  assert.deepEqual(dictionary.namespace, 'session-naming')
  assert.equal(dictionary.entries.zh['badge.aria'], '分叉会话')
  assert.equal(dictionary.entries.en['badge.aria'], 'Forked session')

  const { component } = registered[0]
  const rendered = component({
    sessionId: 'a',
    t: (key) => key,
    useForkState: (selector) => selector(snapshot),
  })
  assert.equal(rendered.type, 'span')
  assert.equal(rendered.props['aria-label'], 'badge.aria')
  assert.equal(rendered.props.role, 'img')

  const hidden = component({
    sessionId: 'other',
    t: (key) => key,
    useForkState: (selector) => selector(snapshot),
  })
  assert.equal(hidden, null)
})
