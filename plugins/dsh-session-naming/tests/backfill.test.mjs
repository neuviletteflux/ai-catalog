import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'

const home = await mkdtemp(join(tmpdir(), 'dsh-session-naming-backfill-'))
process.env.DSH_HOME = home
const { proposeBackfill, sessionTitleBackfillTool } = await import('../lib/backfill.js')
const { pickType } = await import('../lib/normalizer.js')

after(async () => {
  await rm(home, { recursive: true, force: true })
})

const createdAt = new Date(2026, 0, 5, 9, 0, 0).getTime()

function entry(overrides) {
  return {
    sessionId: 's-x', title: '', isSeeded: false, inheritedEventCount: 0,
    createdAt, subagent: false, ...overrides,
  }
}

test('proposeBackfill keeps the title as goal and fixes date, type, and branch', () => {
  const plan = proposeBackfill([
    entry({ sessionId: 'raw', title: '盘点 skills' }),
    entry({ sessionId: 'fork', title: '0105｜规划｜主题 (1)', isSeeded: true }),
    entry({ sessionId: 'ok', title: '0105｜查询｜主题' }),
    entry({ sessionId: 'sub', title: '任务', subagent: true }),
    entry({ sessionId: 'bad-type', title: '0105｜开发｜主题' }),
    entry({ sessionId: 'auto', title: '0105｜AUTO｜每日巡检' }),
    entry({ sessionId: 'no-date', title: '无日期', createdAt: undefined }),
  ])
  const byId = new Map(plan.proposals.map((item) => [item.sessionId, item]))
  assert.equal(byId.has('ok'), false)
  assert.equal(byId.has('sub'), false)
  assert.equal(byId.has('auto'), false)
  assert.equal(byId.has('no-date'), false)
  assert.equal(byId.get('raw').proposedTitle, `0105｜${pickType('盘点 skills')}｜盘点 skills`)
  assert.equal(byId.get('fork').proposedTitle, 'Branch｜0105｜规划｜主题')
  assert.equal(byId.get('fork').branch, true)
  assert.equal(byId.get('bad-type').proposedTitle, `0105｜${pickType('主题')}｜主题`)
  assert.equal(plan.skipped.length, 2)
  assert.match(plan.skipped.find((item) => item.sessionId === 'auto').reason, /AUTO/u)
  assert.match(plan.skipped.find((item) => item.sessionId === 'no-date').reason, /createdAt/u)
})

async function writeSession(id, { title, isSeeded = false, subagent = false } = {}) {
  const dir = join(home, 'storages', 'session_projcache', 'sessions')
  await mkdir(dir, { recursive: true })
  const rows = { title: { val: title } }
  if (subagent) rows.subagent = { val: { identity: { mode: 'continuable' } } }
  await writeFile(join(dir, `${id}.json`), JSON.stringify({
    record: { identity: { isSeeded, createdAt, inheritedEventCount: 0 }, rows },
  }))
}

function fakeCtx() {
  const calls = []
  return {
    calls,
    ctx: {
      get: (name) => (name === 'sessionController'
        ? { rename: async (request) => { calls.push(request); return { title: request.title } } }
        : undefined),
    },
  }
}

test('session_title_backfill defaults to a dry run and only writes with apply', async () => {
  await writeSession('b-raw', { title: '盘点 skills' })
  await writeSession('b-fork', { title: '0105｜规划｜主题 (1)', isSeeded: true })
  await writeSession('b-ok', { title: '0105｜查询｜主题' })
  const { ctx, calls } = fakeCtx()
  const tool = sessionTitleBackfillTool(ctx)

  const dry = await tool.execute({ limit: 100 })
  assert.equal(dry.applied, 0)
  assert.equal(calls.length, 0)
  assert.deepEqual(dry.proposals.map((item) => item.sessionId).sort(), ['b-fork', 'b-raw'])

  const applied = await tool.execute({ limit: 100, apply: true })
  assert.equal(applied.applied, 2)
  assert.equal(applied.failed.length, 0)
  assert.equal(calls.length, 2)
  assert.deepEqual(calls.map((call) => call.sessionId).sort(), ['b-fork', 'b-raw'])
  assert.match(applied.message, /已应用 2 条/u)
})

test('session_title_backfill validates apply prerequisites and limit', async () => {
  const tool = sessionTitleBackfillTool({ get: () => undefined })
  await assert.rejects(() => tool.execute({ apply: true, limit: 100 }), /sessionController/u)
  await assert.rejects(() => tool.execute({ limit: 0 }), /limit 必须是/u)
  const schema = sessionTitleBackfillTool({ get: () => undefined }).output.schema
  const walk = (node) => {
    if (Array.isArray(node)) { node.forEach(walk); return }
    if (node === null || typeof node !== 'object') return
    if (Object.hasOwn(node, 'additionalProperties')) {
      assert.equal(typeof node.additionalProperties, 'boolean')
    }
    Object.values(node).forEach(walk)
  }
  walk(schema)
})
