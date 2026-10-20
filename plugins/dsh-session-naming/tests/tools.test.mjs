import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'

const home = await mkdtemp(join(tmpdir(), 'dsh-session-naming-tools-'))
process.env.DSH_HOME = home
const {
  branchFromProjectionCache, guardHumanTitle, isBranchSession, isInheritedForkTitle,
  registerTitleTools, renameSessionTool, setSessionTitleTool,
} = await import('../lib/title-tools.js')
const { apply, normalizeConfig } = await import('../lib/index.js')

after(async () => {
  await rm(home, { recursive: true, force: true })
})

const createdAt = new Date(2026, 0, 5, 9, 0, 0).getTime()

function truncateUtf8(text, max) {
  let used = 0
  let out = ''
  for (const character of text) {
    const bytes = Buffer.byteLength(character, 'utf8')
    if (used + bytes > max) break
    out += character
    used += bytes
  }
  return out
}

function makeService({ title, source = { kind: 'fallback' }, messageSeqs = [1], maxTitleBytes = 80 } = {}) {
  const state = {
    current: title === undefined ? undefined : { title, source, messageSeqs },
  }
  const calls = { rename: [] }
  return {
    config: { maxTitleBytes },
    calls,
    get: () => state.current,
    rename: (_session, next) => {
      calls.rename.push(next)
      const accepted = Buffer.byteLength(next, 'utf8') <= maxTitleBytes ? next : truncateUtf8(next, maxTitleBytes)
      state.current = { title: accepted, source: { kind: 'user' }, messageSeqs: [] }
      return state.current
    },
  }
}

function makeCtx(service, { gateway } = {}) {
  const registered = []
  const ctx = {
    sessionTitle: service,
    tools: {
      register: (tool) => {
        registered.push(tool)
        return () => {
          const index = registered.indexOf(tool)
          if (index >= 0) registered.splice(index, 1)
        }
      },
    },
    get: (name) => (name === 'typertGateway' ? gateway : undefined),
    registered,
  }
  return ctx
}

function makeSession({
  id = 'session-current', createdAt: stamp = createdAt, isSeeded = false,
  parentSession, origin, events = [], inheritedEventCount = 0,
} = {}) {
  return {
    id,
    header: { createdAt: stamp, isSeeded, parentSession, origin },
    inheritedEventCount,
    snapshotEvents: () => events,
  }
}

const execFor = (session) => ({ agent: { session }, signal: undefined })

async function writeProjection(id, record) {
  const dir = join(home, 'storages', 'session_projcache', 'sessions')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, `${id}.json`), JSON.stringify({ record }))
}

test('registerTitleTools registers both tools and unregisters them on dispose', () => {
  const ctx = makeCtx(makeService())
  const dispose = registerTitleTools(ctx)
  assert.deepEqual(ctx.registered.map((tool) => tool.name), ['set_session_title', 'rename_session'])
  dispose()
  assert.equal(ctx.registered.length, 0)
})

test('guardHumanTitle protects user titles unless forced', () => {
  const session = makeSession()
  assert.doesNotThrow(() => guardHumanTitle(session, undefined, false))
  assert.doesNotThrow(() => guardHumanTitle(session, { title: '自动', source: { kind: 'provider' } }, false))
  assert.throws(
    () => guardHumanTitle(session, { title: '人工', source: { kind: 'user' } }, false),
    /已由显式重命名确定/u,
  )
  assert.doesNotThrow(() => guardHumanTitle(session, { title: '人工', source: { kind: 'user' } }, true))
})

test('isInheritedForkTitle accepts a title that matches the parent plus an index', async () => {
  await writeProjection('parent-a', { rows: { title: { val: '父标题' } } })
  const session = makeSession({ parentSession: 'parent-a' })
  const previous = { title: '父标题 (1)', source: { kind: 'user' } }
  assert.equal(isInheritedForkTitle(session, previous), true)
  assert.doesNotThrow(() => guardHumanTitle(session, previous, false))
  assert.equal(isInheritedForkTitle(session, { title: '父标题（2）', source: { kind: 'user' } }), true)
  assert.equal(isInheritedForkTitle(session, { title: '别的 (1)', source: { kind: 'user' } }), false)
})

test('isInheritedForkTitle accepts the first empty title event as inheritance evidence', () => {
  const session = makeSession({
    parentSession: 'parent-missing',
    events: [{ type: 'session/title', data: { title: '继承标题 (1)', messageSeqs: [] } }],
  })
  assert.equal(isInheritedForkTitle(session, { title: '继承标题 (1)' }), true)

  const later = makeSession({
    parentSession: 'parent-missing',
    events: [{ type: 'session/title', data: { title: '继承标题 (1)', messageSeqs: [1] } }],
  })
  assert.equal(isInheritedForkTitle(later, { title: '继承标题 (1)' }), false)

  const subagent = makeSession({
    parentSession: 'parent-missing',
    origin: 'subagent',
    events: [{ type: 'session/title', data: { title: '继承标题 (1)', messageSeqs: [] } }],
  })
  assert.equal(isInheritedForkTitle(subagent, { title: '继承标题 (1)' }), false)

  const human = makeSession({
    parentSession: 'parent-missing',
    events: [{ type: 'session/title', data: { title: '我的分支', messageSeqs: [] } }],
  })
  assert.equal(isInheritedForkTitle(human, { title: '我的分支' }), false)
})

test('branch detection uses storage flags and the projection cache', async () => {
  assert.equal(isBranchSession(makeSession({ isSeeded: true })), true)
  assert.equal(isBranchSession(makeSession({ inheritedEventCount: 2 })), true)
  assert.equal(isBranchSession(makeSession({ parentSession: 'session-parent' })), true)
  assert.equal(isBranchSession(makeSession({ isSeeded: true, origin: 'subagent' })), false)
  assert.equal(isBranchSession(makeSession()), false)

  await writeProjection('branch-true', { identity: { isSeeded: true } })
  await writeProjection('branch-false', { identity: { isSeeded: false } })
  await writeProjection('branch-inherited', { identity: { isSeeded: false, inheritedEventCount: 3 } })
  assert.equal(branchFromProjectionCache('branch-true'), true)
  assert.equal(branchFromProjectionCache('branch-false'), false)
  assert.equal(branchFromProjectionCache('branch-inherited'), true)
  assert.equal(branchFromProjectionCache('missing'), undefined)
})

test('set_session_title composes the ordinary title and reports byte evidence', async () => {
  const service = makeService({ title: undefined })
  const ctx = makeCtx(service)
  const tool = setSessionTitleTool(ctx)
  const session = makeSession()
  const result = await tool.execute({ type: '查询', goal: '看看实现' }, execFor(session))
  assert.equal(result.title, '0105｜查询｜看看实现')
  assert.equal(result.branch, false)
  assert.equal(result.truncated, false)
  assert.equal(result.budget, 80)
  assert.equal(result.bytes, Buffer.byteLength('0105｜查询｜看看实现', 'utf8'))
  assert.deepEqual(service.calls.rename, ['0105｜查询｜看看实现'])
  assert.match(result.message, /已将会话标题设为/u)
})

test('set_session_title adds the branch prefix automatically', async () => {
  const service = makeService()
  const tool = setSessionTitleTool(makeCtx(service))
  const session = makeSession({ isSeeded: true })
  const result = await tool.execute({ type: '实施', goal: '迁移插件' }, execFor(session))
  assert.equal(result.title, 'Branch｜0105｜实施｜迁移插件')
  assert.equal(result.branch, true)
  assert.match(result.message, /分支会话已加 Branch｜ 前缀/u)
})

test('set_session_title does not prefix subagent sessions', async () => {
  const service = makeService()
  const tool = setSessionTitleTool(makeCtx(service))
  const session = makeSession({ isSeeded: true, origin: 'subagent' })
  const result = await tool.execute({ type: '查询', goal: '主题' }, execFor(session))
  assert.equal(result.title, '0105｜查询｜主题')
  assert.equal(result.branch, false)
})

test('set_session_title accepts raw titles and appends the branch prefix', async () => {
  const service = makeService()
  const tool = setSessionTitleTool(makeCtx(service))
  const session = makeSession({ isSeeded: true })
  const result = await tool.execute({ raw: '  自定义标题  ' }, execFor(session))
  assert.equal(result.title, 'Branch｜自定义标题')
})

test('set_session_title appends the automation run index', async () => {
  const service = makeService()
  const tool = setSessionTitleTool(makeCtx(service))
  const result = await tool.execute({ type: 'AUTO', goal: '每日巡检', seq: 2 }, execFor(makeSession()))
  assert.equal(result.title, '0105｜AUTO｜每日巡检-02')
})

test('set_session_title refuses to overwrite a human title without force', async () => {
  const service = makeService({ title: '人工标题', source: { kind: 'user' }, messageSeqs: [] })
  const tool = setSessionTitleTool(makeCtx(service))
  const session = makeSession()
  assert.throws(
    () => tool.execute({ type: '分析', goal: '主题' }, execFor(session)),
    /默认不覆盖/u,
  )
  const forced = await tool.execute({ type: '分析', goal: '主题', force: true }, execFor(session))
  assert.equal(forced.title, '0105｜分析｜主题')
})

test('set_session_title reports service truncation', async () => {
  const service = makeService({ maxTitleBytes: 20 })
  const tool = setSessionTitleTool(makeCtx(service))
  const result = await tool.execute({ raw: 'A'.repeat(30) }, execFor(makeSession()))
  assert.equal(result.title, 'A'.repeat(20))
  assert.equal(result.truncated, true)
  assert.match(result.message, /已截断/u)
})

test('set_session_title rejects a goal over the byte budget before renaming', async () => {
  const service = makeService({ maxTitleBytes: 40 })
  const tool = setSessionTitleTool(makeCtx(service))
  assert.throws(
    () => tool.execute({ type: '分析', goal: '目标'.repeat(20) }, execFor(makeSession())),
    /超过上限 40 字节/u,
  )
  assert.equal(service.calls.rename.length, 0)
})

test('rename_session uses the gateway and derives the branch prefix from the cache', async () => {
  await writeProjection('session-branch', { identity: { isSeeded: true } })
  const calls = []
  const gateway = {
    invoke: async (request) => {
      calls.push(request)
      return { title: request.args.request.title, seq: 7 }
    },
  }
  const tool = renameSessionTool(makeCtx(makeService(), { gateway }))
  const result = await tool.execute(
    { sessionId: 'session-branch', title: '1016｜实施｜存量整理' },
    { signal: 'signal' },
  )
  assert.equal(result.title, 'Branch｜1016｜实施｜存量整理')
  assert.equal(result.branch, true)
  assert.equal(result.seq, 7)
  assert.deepEqual(calls[0], {
    namespace: 'session',
    method: 'rename',
    args: { request: { sessionId: 'session-branch', title: 'Branch｜1016｜实施｜存量整理' } },
    signal: 'signal',
  })
})

test('rename_session lets an explicit branch flag override the cache', async () => {
  await writeProjection('session-plain', { identity: { isSeeded: true } })
  const gateway = { invoke: async (request) => ({ title: request.args.request.title }) }
  const tool = renameSessionTool(makeCtx(makeService(), { gateway }))
  const result = await tool.execute({ sessionId: 'session-plain', title: '1016｜查询｜主题', branch: false }, {})
  assert.equal(result.title, '1016｜查询｜主题')
  assert.equal(result.branch, false)
})

test('rename_session fails clearly without the gateway or with empty input', async () => {
  const tool = renameSessionTool(makeCtx(makeService()))
  await assert.rejects(
    () => tool.execute({ sessionId: 'session-x', title: '1016｜查询｜主题' }),
    /typertGateway/u,
  )
  await assert.rejects(() => tool.execute({ sessionId: ' ', title: '主题' }), /sessionId 不能为空/u)
  await assert.rejects(() => tool.execute({ sessionId: 'session-x', title: '  ' }), /title 不能为空/u)
})

test('normalizeConfig validates keys and defaults both halves on', () => {
  assert.deepEqual(normalizeConfig(undefined), { settleMs: 10000, tools: true, normalizer: true })
  assert.deepEqual(normalizeConfig({ settleMs: 0, tools: false }), { settleMs: 0, tools: false, normalizer: true })
  assert.throws(() => normalizeConfig({ settleMs: 1, extra: true }), /未知配置项/u)
  assert.throws(() => normalizeConfig({ tools: 'yes' }), /必须是布尔值/u)
  assert.throws(() => normalizeConfig([]), /config 必须是对象/u)
})

test('apply mounts both halves and disposes the tool registration', () => {
  const service = makeService()
  const registered = []
  let listener
  const ctx = {
    sessionTitle: service,
    tools: {
      register: (tool) => {
        registered.push(tool)
        return () => {
          const index = registered.indexOf(tool)
          if (index >= 0) registered.splice(index, 1)
        }
      },
    },
    on: (_name, fn) => {
      listener = fn
      return () => { listener = undefined }
    },
    effect: () => {},
    logger: { warn: () => {} },
  }
  const dispose = apply(ctx, { settleMs: 0 })
  assert.equal(typeof listener, 'function')
  assert.deepEqual(registered.map((tool) => tool.name), ['set_session_title', 'rename_session'])
  dispose()
  assert.equal(registered.length, 0)
  assert.equal(listener, undefined)
})

test('apply can mount one half at a time', () => {
  const service = makeService()
  const registered = []
  let listens = 0
  const ctx = {
    sessionTitle: service,
    tools: {
      register: (tool) => {
        registered.push(tool)
        return () => {}
      },
    },
    on: () => { listens += 1; return () => {} },
    effect: () => {},
    logger: { warn: () => {} },
  }
  apply(ctx, { tools: false })
  assert.equal(registered.length, 0)
  assert.equal(listens, 1)
  apply(ctx, { normalizer: false })
  assert.equal(registered.length, 2)
  assert.equal(listens, 1)
})
