import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
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

function fakeSession({
  id = 'session-x', createdAt: stamp = createdAt, parentSession, origin,
  isSeeded = false, inheritedEventCount = 0, events = [],
} = {}) {
  const appends = []
  const session = {
    id,
    header: { createdAt: stamp, parentSession, origin, isSeeded },
    inheritedEventCount,
    snapshotEvents: () => events,
    append: (type, data) => {
      appends.push({ type, data })
      events.push({ type, data })
    },
  }
  return { session, appends }
}

async function writeProjection(id, record) {
  const dir = join(home, 'storages', 'session_projcache', 'sessions')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, `${id}.json`), JSON.stringify({ record }))
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

test('pickType keeps the established vocabulary cases', () => {
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

test('pickType weights title actions above prompt question words', () => {
  const cases = [
    ['安装插件并质询UI优化', '', '实施'],
    ['新会话草稿插件实现与分发', '', '实施'],
    ['移动其它工作区会话', '', '实施'],
    ['文档配图弃用Mermaid重做', '', '实施'],
    ['Session naming skills 实现', '', '实施'],
    ['配置私有LLM模型Game Engine', '', '实施'],
    ['检查全局配置是否生效', '', '查询'],
    ['指令中英文规范差异分析', '', '分析'],
    ['分析 readability 插件实现原理', '他是如何实现的', '分析'],
    ['基于证据的项目审计与认知报告', '', '审计'],
    ['实时数仓同步方案评审', '', '审计'],
    ['盘点分析已安装的 skills 与 plugins', '', '审计'],
    ['重构控制台页面方案 (1)', '', '规划'],
    ['dsh web 最新版本与本地版本', '', '查询'],
    ['查询已安装的画图技能', '', '查询'],
    ['为什么安装失败', '', '排障'],
    ['如何排查启动失败', '', '排障'],
    ['主题', '帮我安装插件', '实施'],
    ['安装插件', '如何实现', '实施'],
    ['Acknowledgment and Confirmation', '', '分析'],
  ]
  for (const [title, message, expected] of cases) {
    assert.equal(pickType(title, message), expected, `${title} || ${message}`)
  }
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

test('composeNormalized strips any convention-shaped prefix, including unknown types', () => {
  assert.equal(
    composeNormalized({
      goal: '1020｜开发｜Session naming skills 改为 dsh 插件',
      type: '实施',
      createdAt,
      maxBytes: 80,
    }),
    '0105｜实施｜Session naming skills 改为 dsh 插件',
  )
  assert.equal(
    composeNormalized({ goal: '0105｜未知类型｜目标', type: '分析', createdAt, maxBytes: 80 }),
    '0105｜分析｜目标',
  )
  assert.equal(
    composeNormalized({ goal: 'Branch｜1020｜开发｜目标', type: '分析', createdAt, maxBytes: 80 }),
    '0105｜分析｜目标',
  )
  assert.equal(
    composeNormalized({ goal: '1020｜开发｜A｜B', type: '分析', createdAt, maxBytes: 80 }),
    '0105｜分析｜A B',
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

test('normalizeNow rewrites an inherited fork title with Branch and strips (n)', () => {
  const { session, appends } = fakeSession({
    parentSession: 'fork-parent',
    isSeeded: true,
    events: [
      { type: 'user/message', seq: 9, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '父任务' }] } },
      { type: 'session/title', seq: 20, data: { title: '父标题 (1)', source: { kind: 'user' }, messageSeqs: [] } },
    ],
  })
  const ctx = {
    sessionTitle: fakeService({ title: '父标题 (1)', source: { kind: 'user' }, messageSeqs: [] }),
  }
  const title = normalizeNow(ctx, session, { log: () => {} })
  assert.equal(title, 'Branch｜0105｜分析｜父标题')
  assert.equal(appends.length, 1)
  assert.deepEqual(appends[0].data.messageSeqs, [9])
  assert.deepEqual(appends[0].data.source, { kind: 'provider', provider: PROVIDER_ID })
})

test('normalizeNow keeps the type of a convention-shaped fork title', async () => {
  await writeProjection('fork-parent-conv', { rows: { title: { val: '0105｜查询｜主题' } } })
  const { session, appends } = fakeSession({
    parentSession: 'fork-parent-conv',
    isSeeded: true,
    events: [
      { type: 'user/message', seq: 9, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '主题' }] } },
      { type: 'session/title', seq: 20, data: { title: '0105｜查询｜主题 (1)', source: { kind: 'user' }, messageSeqs: [] } },
    ],
  })
  const ctx = {
    sessionTitle: fakeService({ title: '0105｜查询｜主题 (1)', source: { kind: 'user' }, messageSeqs: [] }),
  }
  assert.equal(normalizeNow(ctx, session, { log: () => {} }), 'Branch｜0105｜查询｜主题')
  assert.deepEqual(appends[0].data.messageSeqs, [9])
})

test('normalizeNow preserves a human-renamed fork title', () => {
  const { session, appends } = fakeSession({
    parentSession: 'fork-human',
    isSeeded: true,
    events: [
      { type: 'user/message', seq: 9, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '父任务' }] } },
      { type: 'session/title', seq: 20, data: { title: '父标题 (1)', source: { kind: 'user' }, messageSeqs: [] } },
      { type: 'session/title', seq: 30, data: { title: '我的分支', source: { kind: 'user' }, messageSeqs: [] } },
    ],
  })
  const ctx = {
    sessionTitle: fakeService({ title: '我的分支', source: { kind: 'user' }, messageSeqs: [] }),
  }
  assert.equal(normalizeNow(ctx, session, { log: () => {} }), undefined)
  assert.equal(appends.length, 0)
})

test('normalizeNow skips subagent forks and forks without human refs', () => {
  const subagent = fakeSession({
    parentSession: 'fork-sub',
    origin: 'subagent',
    isSeeded: true,
    events: [
      { type: 'user/message', seq: 9, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '任务' }] } },
      { type: 'session/title', seq: 20, data: { title: '父标题 (1)', source: { kind: 'user' }, messageSeqs: [] } },
    ],
  })
  assert.equal(normalizeNow({
    sessionTitle: fakeService({ title: '父标题 (1)', source: { kind: 'user' }, messageSeqs: [] }),
  }, subagent.session, { log: () => {} }), undefined)
  assert.equal(subagent.appends.length, 0)

  const noRefs = fakeSession({
    parentSession: 'fork-empty',
    isSeeded: true,
    events: [
      { type: 'session/title', seq: 20, data: { title: '父标题 (1)', source: { kind: 'user' }, messageSeqs: [] } },
    ],
  })
  assert.equal(normalizeNow({
    sessionTitle: fakeService({ title: '父标题 (1)', source: { kind: 'user' }, messageSeqs: [] }),
  }, noRefs.session, { log: () => {} }), undefined)
  assert.equal(noRefs.appends.length, 0)
})

test('normalizeNow skips a compliant fork title but strips a stale (n)', () => {
  const compliant = fakeSession({
    parentSession: 'fork-compliant',
    isSeeded: true,
    events: [
      { type: 'user/message', seq: 9, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '主题' }] } },
      { type: 'session/title', seq: 20, data: { title: 'Branch｜0105｜查询｜主题', source: { kind: 'user' }, messageSeqs: [] } },
    ],
  })
  assert.equal(normalizeNow({
    sessionTitle: fakeService({ title: 'Branch｜0105｜查询｜主题', source: { kind: 'user' }, messageSeqs: [] }),
  }, compliant.session, { log: () => {} }), undefined)
  assert.equal(compliant.appends.length, 0)

  const stale = fakeSession({
    parentSession: 'fork-stale',
    isSeeded: true,
    events: [
      { type: 'user/message', seq: 9, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '主题' }] } },
      { type: 'session/title', seq: 20, data: { title: 'Branch｜0105｜查询｜主题 (1)', source: { kind: 'user' }, messageSeqs: [] } },
    ],
  })
  assert.equal(normalizeNow({
    sessionTitle: fakeService({ title: 'Branch｜0105｜查询｜主题 (1)', source: { kind: 'user' }, messageSeqs: [] }),
  }, stale.session, { log: () => {} }), 'Branch｜0105｜查询｜主题')
  assert.deepEqual(stale.appends[0].data.messageSeqs, [9])
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

test('applyNormalizer schedules an inherited fork title for a user event', async () => {
  const { session, appends } = fakeSession({
    id: 'session-fork-settle',
    parentSession: 'fork-settle',
    isSeeded: true,
    events: [
      { type: 'user/message', seq: 9, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '父任务' }] } },
      { type: 'session/title', seq: 20, data: { title: '父标题 (1)', source: { kind: 'user' }, messageSeqs: [] } },
    ],
  })
  const state = { current: { title: '父标题 (1)', source: { kind: 'user' }, messageSeqs: [] } }
  let listener
  const ctx = {
    sessionTitle: { config: { maxTitleBytes: 80 }, get: () => state.current },
    on: (_name, fn) => { listener = fn; return () => {} },
    effect: () => {},
    logger: { warn: () => {} },
  }
  const originalAppend = session.append
  session.append = (type, data) => {
    originalAppend(type, data)
    state.current = { ...data }
  }
  const dispose = applyNormalizer(ctx, { settleMs: 0 })
  listener(session, { type: 'session/title', data: { source: { kind: 'user' } } })
  await new Promise((resolve) => setTimeout(resolve, 50))
  assert.equal(appends.length, 1)
  assert.equal(state.current.title, 'Branch｜0105｜分析｜父标题')
  dispose()
})

test('applyNormalizer normalizes an inherited fork title without the full settle window', async () => {
  const { session, appends } = fakeSession({
    id: 'session-fork-fast',
    parentSession: 'fork-fast',
    isSeeded: true,
    events: [
      { type: 'user/message', seq: 9, data: { source: { kind: 'user' }, content: [{ type: 'text', text: '父任务' }] } },
      { type: 'session/title', seq: 20, data: { title: '父标题 (1)', source: { kind: 'user' }, messageSeqs: [] } },
    ],
  })
  const state = { current: { title: '父标题 (1)', source: { kind: 'user' }, messageSeqs: [] } }
  let listener
  const ctx = {
    sessionTitle: { config: { maxTitleBytes: 80 }, get: () => state.current },
    on: (_name, fn) => { listener = fn; return () => {} },
    effect: () => {},
    logger: { warn: () => {} },
  }
  const originalAppend = session.append
  session.append = (type, data) => {
    originalAppend(type, data)
    state.current = { ...data }
  }
  const dispose = applyNormalizer(ctx, { settleMs: 1000 })
  listener(session, { type: 'session/title', data: { source: { kind: 'user' } } })
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.equal(appends.length, 1)
  assert.equal(state.current.title, 'Branch｜0105｜分析｜父标题')
  dispose()
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
