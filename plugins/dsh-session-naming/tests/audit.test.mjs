import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { after } from 'node:test'

const home = await mkdtemp(join(tmpdir(), 'dsh-session-naming-audit-'))
process.env.DSH_HOME = home
const {
  auditEntries, scanProjectionEntries, sessionTitleAuditTool,
} = await import('../lib/audit.js')

after(async () => {
  await rm(home, { recursive: true, force: true })
})

const dir = join(home, 'storages', 'session_projcache', 'sessions')

async function writeSession(id, {
  title, isSeeded = false, inheritedEventCount = 0, subagent = false,
} = {}) {
  await mkdir(dir, { recursive: true })
  const rows = { title: { val: title } }
  if (subagent) rows.subagent = { val: { identity: { mode: 'continuable', label: 'x' } } }
  const record = {
    identity: { isSeeded, inheritedEventCount, createdAt: 1792460000000 },
    rows,
  }
  await writeFile(join(dir, `${id}.json`), JSON.stringify({ record }))
}

await writeSession('s1', { title: '0105｜查询｜主题' })
await writeSession('s2', { title: 'Branch｜0105｜审计｜审计目标', isSeeded: true })
await writeSession('s3', { title: '0105｜规划｜规划目标 (1)', isSeeded: true })
await writeSession('s4', { title: '0105｜开发｜主题' })
await writeSession('s5', { title: '随便聊聊' })
await writeSession('s6', { title: '任务', subagent: true })
await writeSession('s7', { title: '0105｜分析｜主题' })

test('scanProjectionEntries reads titles and marks subagents and forks', () => {
  const entries = scanProjectionEntries(home, 100)
  assert.equal(entries.length, 7)
  const byId = new Map(entries.map((entry) => [entry.sessionId, entry]))
  assert.equal(byId.get('s2').isSeeded, true)
  assert.equal(byId.get('s6').subagent, true)
  assert.equal(byId.get('s1').title, '0105｜查询｜主题')
  assert.equal(scanProjectionEntries(home, 2).length, 2)
  assert.equal(scanProjectionEntries(join(home, 'missing'), 10).length, 0)
})

test('auditEntries counts compliance, forks, invalid prefixes, and duplicates', () => {
  const result = auditEntries(scanProjectionEntries(home, 100))
  assert.equal(result.scanned, 7)
  assert.equal(result.skippedSubagents, 1)
  assert.equal(result.topLevel, 6)
  assert.equal(result.compliant, 3)
  assert.equal(result.noncompliant, 3)
  assert.equal(result.branchTitles, 1)
  assert.equal(result.forksMissingBranch, 1)
  assert.equal(result.staleForkTitles, 1)
  assert.equal(result.invalidTypePrefixes, 1)
  assert.equal(result.unexpectedBranch, 0)
  assert.equal(result.autoWithoutSeq, 0)
  assert.equal(result.duplicateGroups, 1)
  assert.equal(result.forkPairGroups, 0)
  assert.deepEqual(result.forkPairs, [])
  assert.equal(result.duplicates[0].key, '0105｜主题')
  assert.equal(result.duplicates[0].count, 2)
  assert.deepEqual(
    [...result.duplicates[0].titles].sort(),
    ['0105｜分析｜主题', '0105｜查询｜主题'].sort(),
  )
  assert.equal(result.typeCounts['查询'], 1)
  assert.equal(result.typeCounts['审计'], 1)
  assert.equal(result.typeCounts['分析'], 1)
  assert.equal(result.typeCounts['规划'], 1)
  assert.equal(result.typeCounts['AUTO'], 0)
  assert.equal(result.examples.noncompliant.length, 3)
  assert.equal(result.examples.forksMissingBranch.length, 1)
  assert.equal(result.examples.invalidType.length, 1)
  assert.equal(result.examples.duplicateGoals.length, 1)
  assert.match(result.message, /6 条顶层会话/u)
  assert.match(result.message, /合规 3/u)
})

test('auditEntries flags AUTO without a run index', () => {
  const result = auditEntries([
    { sessionId: 'a', title: '0105｜AUTO｜每日巡检', isSeeded: false, inheritedEventCount: 0, subagent: false },
    { sessionId: 'b', title: '0105｜AUTO｜每日巡检-01', isSeeded: false, inheritedEventCount: 0, subagent: false },
  ])
  assert.equal(result.topLevel, 2)
  assert.equal(result.compliant, 1)
  assert.equal(result.noncompliant, 1)
  assert.equal(result.autoWithoutSeq, 1)
})

test('auditEntries treats a parent and its fork as a pair, not a duplicate', () => {
  const result = auditEntries([
    { sessionId: 'p', title: '0105｜查询｜主题', isSeeded: false, inheritedEventCount: 0, subagent: false },
    { sessionId: 'f', title: 'Branch｜0105｜查询｜主题', isSeeded: true, inheritedEventCount: 0, subagent: false },
  ])
  assert.equal(result.duplicateGroups, 0)
  assert.equal(result.forkPairGroups, 1)
  assert.equal(result.forkPairs[0].key, '0105｜主题')
  assert.equal(result.forkPairs[0].count, 2)
})

test('session_title_audit is read-only and validates its limit', async () => {
  const tool = sessionTitleAuditTool()
  assert.equal(tool.name, 'session_title_audit')
  const result = await tool.execute({ limit: 100 })
  assert.equal(result.topLevel, 6)
  assert.match(result.message, /分叉缺 Branch 1/u)
  assert.throws(() => tool.execute({ limit: 0 }), /limit 必须是/u)
  assert.throws(() => tool.execute({ limit: 1001 }), /limit 必须是/u)
})
