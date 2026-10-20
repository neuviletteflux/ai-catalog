import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'

const home = await mkdtemp(join(tmpdir(), 'dsh-session-naming-normalizer-'))
process.env.DSH_HOME = home
const {
  CONVENTION, DEFAULT_SETTLE_MS, DEFAULT_TYPE, GOAL_TYPES, PROVIDER_ID,
  applyNormalizer, composeNormalized, firstHumanText, isConventionTitle,
  normalizeNow, pickType, settleDelayOf, truncateBytes,
} = await import('../lib/normalizer.js')

after(async () => {
  await rm(home, { recursive: true, force: true })
})

const createdAt = new Date(2026, 0, 5, 9, 0, 0).getTime()

function fakeSession({ id = 'session-x', createdAt: stamp = createdAt, parentSession, events = [] } = {}) {
  const appends = []
  const session = {
    id,
    header: { createdAt: stamp, parentSession },
    snapshotEvents: () => events,
    append: (type, data) => {
      appends.push({ type, data })
      events.push({ type, data })
    },
  }
  return { session, appends }
}

function fakeService(current, { maxTitleBytes = 80 } = {}) {
  return {
    config: { maxTitleBytes },
    get: () => current,
  }
}

test('PROVIDER_ID and vocabulary are stable', () => {
  assert.equal(PROVIDER_ID, 'session-naming-convention')
  assert.equal(DEFAULT_SETTLE_MS, 10000)
  assert.equal(DEFAULT_TYPE, '分析')
  assert.equal(GOAL_TYPES.includes('AUTO'), false)
  assert.equal(GOAL_TYPES.length, 8)
  assert.equal(CONVENTION.test('0105｜查询｜主题'), true)
})

test('isConventionTitle accepts ordinary and branch titles only', () => {
  assert.equal(isConventionTitle('0105｜查询｜主题'), true)
  assert.equal(isConventionTitle('Branch｜0105｜实施｜主题'), true)
  assert.equal(isConventionTitle('1016｜AUTO｜每日巡检-01'), true)
  assert.equal(isConventionTitle('Session naming skills 实现'), false)
  assert.equal(isConventionTitle(' 0105｜查询｜主题 '), true)
  assert.equal(isConventionTitle(undefined), false)
})

test('pickType follows the keyword order and falls back to 分析', () => {
  assert.equal(pickType('修复 codex 启动失败'), '排障')
  assert.equal(pickType('盘点本地插件'), '审计')
  assert.equal(pickType('复盘这次发布'), '复盘')
  assert.equal(pickType('整理周报'), '整理')
  assert.equal(pickType('规划迁移路线'), '规划')
  assert.equal(pickType('如何配置模型'), '查询')
  assert.equal(pickType('实现会话命名插件'), '实施')
  assert.equal(pickType('随便聊聊'), '分析')
  assert.equal(pickType(''), '分析')
})

test('truncateBytes never splits a code point', () => {
  assert.equal(truncateBytes('中文abc', 6), '中文')
  assert.equal(truncateBytes('中文abc', 7), '中文a')
  assert.equal(truncateBytes('abc', 10), 'abc')
  assert.equal(truncateBytes('中文', 2), '')
})

test('composeNormalized builds the convention title from the current summary', () => {
  assert.equal(
    composeNormalized({ goal: '修复会话排序', type: '排障', createdAt, maxBytes: 80 }),
    '0105｜排障｜修复会话排序',
  )
})

test('composeNormalized strips an existing convention prefix', () => {
  assert.equal(
    composeNormalized({ goal: '0105｜查询｜旧标题', type: '查询', createdAt, maxBytes: 80 }),
    '0105｜查询｜旧标题',
  )
})

test('composeNormalized replaces inner separators and supports branches', () => {
  assert.equal(
    composeNormalized({ goal: 'A｜B|C', type: '分析', createdAt, maxBytes: 80 }),
    '0105｜分析｜A B C',
  )
  assert.equal(
    composeNormalized({ goal: '主题', type: '分析', createdAt, maxBytes: 80, branch: true }),
    'Branch｜0105｜分析｜主题',
  )
})

test('composeNormalized truncates the goal to the byte budget', () => {
  const title = composeNormalized({ goal: '汉'.repeat(40), type: '分析', createdAt, maxBytes: 28 })
  assert.equal(Buffer.byteLength(title, 'utf8') <= 28, true)
  assert.equal(title.startsWith('0105｜分析｜'), true)
})

test('composeNormalized rejects a budget too small for the head', () => {
  assert.throws(
    () => composeNormalized({ goal: '主题', type: '分析', createdAt, maxBytes: 18 }),
    /放不下/u,
  )
})

test('composeNormalized rejects an empty goal after stripping', () => {
  assert.throws(
    () => composeNormalized({ goal: '｜｜', type: '分析', createdAt, maxBytes: 80 }),
    /目标为空/u,
  )
})

test('firstHumanText returns the first non-empty human text block', () => {
  const { session } = fakeSession({
    events: [
      { type: 'session/title', data: { title: '标题' } },
      { type: 'user/message', data: { source: { kind: 'agent' }, content: [{ type: 'text', text: '忽略' }] } },
      { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'image' }] } },
      { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: ' 第一条 人类消息 ' }] } },
      { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '第二条' }] } },
    ],
  })
  assert.equal(firstHumanText(session), '第一条 人类消息')
  assert.equal(firstHumanText({}), '')
})

test('settleDelayOf validates the configured window', () => {
  assert.equal(settleDelayOf(undefined), DEFAULT_SETTLE_MS)
  assert.equal(settleDelayOf({ settleMs: 0 }), 0)
  assert.equal(settleDelayOf({ settleMs: 600000 }), 600000)
  for (const bad of [-1, 600001, 1.5, '10']) {
    assert.throws(() => settleDelayOf({ settleMs: bad }), /settleMs/u)
  }
})

test('normalizeNow rewrites a fallback title and keeps the human message refs', () => {
  const { session, appends } = fakeSession({ events: [] })
  const ctx = { sessionTitle: fakeService({ title: '主题', source: { kind: 'fallback' }, messageSeqs: [9] }) }
  const logs = []
  const title = normalizeNow(ctx, session, { log: (line) => logs.push(line) })
  assert.equal(title, '0105｜分析｜主题')
  assert.equal(appends.length, 1)
  assert.deepEqual(appends[0].data, {
    title: '0105｜分析｜主题',
    messageSeqs: [9],
    source: { kind: 'provider', provider: PROVIDER_ID },
  })
  assert.match(logs[0], /"主题" \(fallback\) → "0105｜分析｜主题"/u)
})

test('normalizeNow infers the type from the first human message', () => {
  const { session } = fakeSession({
    events: [
      { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '帮我部署插件' }] } },
    ],
  })
  const ctx = { sessionTitle: fakeService({ title: '主题', source: { kind: 'provider', provider: 'builtin' }, messageSeqs: [7] }) }
  assert.equal(normalizeNow(ctx, session, { log: () => {} }), '0105｜实施｜主题')
})

test('normalizeNow leaves human titles alone', () => {
  const { session, appends } = fakeSession()
  const ctx = { sessionTitle: fakeService({ title: '人工标题', source: { kind: 'user' }, messageSeqs: [] }) }
  assert.equal(normalizeNow(ctx, session, { log: () => {} }), undefined)
  assert.equal(appends.length, 0)
})

test('normalizeNow does not retrigger on its own revision', () => {
  const { session, appends } = fakeSession()
  const ctx = {
    sessionTitle: fakeService({
      title: '旧摘要',
      source: { kind: 'provider', provider: PROVIDER_ID },
      messageSeqs: [3],
    }),
  }
  assert.equal(normalizeNow(ctx, session, { log: () => {} }), undefined)
  assert.equal(appends.length, 0)
})

test('normalizeNow skips compliant titles, subagent sessions, and missing refs', () => {
  const compliant = fakeSession()
  assert.equal(normalizeNow(
    { sessionTitle: fakeService({ title: '0105｜查询｜主题', source: { kind: 'fallback' }, messageSeqs: [1] }) },
    compliant.session,
    { log: () => {} },
  ), undefined)

  const subagent = fakeSession({ parentSession: 'session-parent' })
  assert.equal(normalizeNow(
    { sessionTitle: fakeService({ title: '主题', source: { kind: 'fallback' }, messageSeqs: [1] }) },
    subagent.session,
    { log: () => {} },
  ), undefined)

  const noRefs = fakeSession()
  assert.equal(normalizeNow(
    { sessionTitle: fakeService({ title: '主题', source: { kind: 'fallback' }, messageSeqs: [] }) },
    noRefs.session,
    { log: () => {} },
  ), undefined)

  const noTitle = fakeSession()
  assert.equal(normalizeNow({ sessionTitle: fakeService(undefined) }, noTitle.session, { log: () => {} }), undefined)
  assert.equal(normalizeNow({}, noTitle.session, { log: () => {} }), undefined)
})

test('normalizeNow honours the service byte budget', () => {
  const { session, appends } = fakeSession()
  const ctx = {
    sessionTitle: fakeService({ title: '汉'.repeat(40), source: { kind: 'fallback' }, messageSeqs: [2] }, { maxTitleBytes: 36 }),
  }
  const title = normalizeNow(ctx, session, { log: () => {} })
  assert.equal(Buffer.byteLength(title, 'utf8') <= 36, true)
  assert.equal(appends.length, 1)
})

test('applyNormalizer rewrites after the settle window and ignores human titles', async () => {
  const { session, appends } = fakeSession({ id: 'session-settle' })
  const state = { current: { title: '主题', source: { kind: 'fallback' }, messageSeqs: [5] } }
  let listener
  const effectDisposers = []
  const ctx = {
    sessionTitle: {
      config: { maxTitleBytes: 80 },
      get: () => state.current,
    },
    on: (_name, fn) => {
      listener = fn
      return () => { listener = undefined }
    },
    effect: (fn) => {
      effectDisposers.push(fn())
    },
    logger: { warn: () => {} },
  }
  const originalAppend = session.append
  session.append = (type, data) => {
    originalAppend(type, data)
    state.current = { ...data }
  }

  const dispose = applyNormalizer(ctx, { settleMs: 0 })
  listener(session, { type: 'other/event', data: {} })
  listener(session, { type: 'session/title', data: { source: { kind: 'user' } } })
  listener(session, { type: 'session/title', data: { source: { kind: 'provider', provider: PROVIDER_ID } } })
  assert.equal(appends.length, 0)

  listener(session, { type: 'session/title', data: { source: { kind: 'fallback' } } })
  await new Promise((resolve) => setTimeout(resolve, 50))
  assert.equal(appends.length, 1)
  assert.equal(state.current.title, '0105｜分析｜主题')

  dispose()
  for (const item of effectDisposers) {
    assert.equal(typeof item, 'function')
  }
})

test('applyNormalizer clears a pending timer on dispose', async () => {
  const { session, appends } = fakeSession({ id: 'session-dispose' })
  let listener
  const ctx = {
    sessionTitle: { config: { maxTitleBytes: 80 }, get: () => ({ title: '摘要', source: { kind: 'fallback' }, messageSeqs: [1] }) },
    on: (_name, fn) => { listener = fn; return () => {} },
    effect: () => {},
    logger: { warn: () => {} },
  }
  const dispose = applyNormalizer(ctx, { settleMs: 1000 })
  listener(session, { type: 'session/title', data: { source: { kind: 'fallback' } } })
  dispose()
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(appends.length, 0)
})
