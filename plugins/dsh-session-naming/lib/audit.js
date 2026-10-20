/**
 * dsh-session-naming / audit.js
 *
 * Read-only audit of the title convention over the Session projection cache.
 * It never writes a Session, projection, or title event: the agent uses it to
 * find non-compliant, fork, invalid-prefix, and duplicate titles before
 * deciding whether a backfill is worth doing.
 *
 * @module dsh-session-naming/audit
 */
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { dshHome, forkTitleBase } from './branch.js'
import { TYPES, oneLine } from './compose.js'
import { isConventionTitle } from './normalizer.js'

/** A title shape, including a type outside the vocabulary. */
const TITLE_SHAPE = /^(Branch｜)?(\d{4})｜([^｜|]{1,16})｜(.+)$/u

/** AUTO titles must carry the two-digit run index. */
const AUTO_SUFFIX = /-\d{2}$/u

/** Hard cap for one audit call. */
export const AUDIT_LIMIT_MAX = 1000

/**
 * Read title snapshots from the projection cache, newest first.
 * @param home - DSH home.
 * @param limit - maximum number of cache files to read (1-1000).
 * @returns `{ sessionId, title, isSeeded, inheritedEventCount, createdAt, subagent }[]`.
 */
export function scanProjectionEntries(home = dshHome(), limit = 200) {
  const capped = Math.max(1, Math.min(AUDIT_LIMIT_MAX, Number.isInteger(limit) ? limit : 200))
  const dir = join(home, 'storages', 'session_projcache', 'sessions')
  let names
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  const files = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    try {
      files.push({ name, mtime: statSync(join(dir, name)).mtimeMs })
    } catch {
      /* a cache file may disappear between readdir and stat */
    }
  }
  files.sort((a, b) => b.mtime - a.mtime)
  const out = []
  for (const { name } of files.slice(0, capped)) {
    try {
      const record = JSON.parse(readFileSync(join(dir, name), 'utf8')).record ?? {}
      const rows = record.rows ?? {}
      const title = rows.title?.val
      if (typeof title !== 'string' || oneLine(title) === '') continue
      const identity = record.identity ?? {}
      out.push({
        sessionId: name.slice(0, -5),
        title: oneLine(title),
        isSeeded: identity.isSeeded === true,
        inheritedEventCount: Number.isInteger(identity.inheritedEventCount)
          ? identity.inheritedEventCount
          : 0,
        createdAt: identity.createdAt,
        subagent: Boolean(rows.subagent?.val?.identity),
      })
    } catch {
      /* unreadable or partially written cache file: skip it */
    }
  }
  return out
}

/** Push an example string while keeping the list bounded. */
function example(list, value) {
  if (list.length < 5) list.push(value)
}

/**
 * Audit title entries. Subagent sessions are counted but excluded from the
 * convention, because their titles are not user-visible session rows.
 * @param entries - `scanProjectionEntries()` output.
 * @returns counts, examples, and a one-line message.
 */
export function auditEntries(entries) {
  const skippedSubagents = entries.filter((entry) => entry.subagent).length
  const top = entries.filter((entry) => !entry.subagent)
  const typeCounts = Object.fromEntries(TYPES.map((type) => [type, 0]))
  const duplicateMap = new Map()
  const examples = {
    noncompliant: [],
    forksMissingBranch: [],
    invalidType: [],
    duplicateGoals: [],
  }
  let compliant = 0
  let noncompliant = 0
  let branchTitles = 0
  let forksMissingBranch = 0
  let staleForkTitles = 0
  let invalidTypePrefixes = 0
  let unexpectedBranch = 0
  let autoWithoutSeq = 0

  for (const entry of top) {
    const matched = TITLE_SHAPE.exec(entry.title)
    const fork = entry.isSeeded || entry.inheritedEventCount > 0
    const branch = matched?.[1] !== undefined
    if (branch) branchTitles += 1
    if (!fork && branch) unexpectedBranch += 1
    if (fork && !branch) {
      forksMissingBranch += 1
      example(examples.forksMissingBranch, `${entry.sessionId}: ${entry.title}`)
    }
    if (fork && forkTitleBase(entry.title) !== entry.title) staleForkTitles += 1

    if (matched === null) {
      noncompliant += 1
      example(examples.noncompliant, `${entry.sessionId}: ${entry.title}`)
      continue
    }

    const [, , mmdd, type, goal] = matched
    const validType = TYPES.includes(type)
    if (!validType) {
      invalidTypePrefixes += 1
      noncompliant += 1
      example(examples.invalidType, `${entry.sessionId}: ${entry.title}`)
      example(examples.noncompliant, `${entry.sessionId}: ${entry.title}`)
      continue
    }
    typeCounts[type] += 1
    if (type === 'AUTO' && !AUTO_SUFFIX.test(entry.title)) {
      autoWithoutSeq += 1
      noncompliant += 1
      example(examples.noncompliant, `${entry.sessionId}: ${entry.title}`)
      continue
    }

    const forkCompliant = !fork || (branch && forkTitleBase(entry.title) === entry.title)
    if (forkCompliant && isConventionTitle(entry.title)) {
      compliant += 1
    } else {
      noncompliant += 1
      example(examples.noncompliant, `${entry.sessionId}: ${entry.title}`)
    }

    const duplicateKey = `${mmdd}｜${forkTitleBase(goal)}`
    const group = duplicateMap.get(duplicateKey) ?? []
    group.push(entry.title)
    duplicateMap.set(duplicateKey, group)
  }

  const duplicates = []
  const forkPairs = []
  for (const [key, titles] of duplicateMap) {
    if (titles.length < 2) continue
    const branches = titles.filter((title) => title.startsWith('Branch｜'))
    const parents = titles.filter((title) => !title.startsWith('Branch｜'))
    // A parent and its fork sharing a goal is the normal shape, not a duplicate.
    if (branches.length <= 1 && parents.length <= 1) {
      forkPairs.push({ key, count: titles.length, titles: titles.slice(0, 5) })
      continue
    }
    duplicates.push({ key, count: titles.length, titles: titles.slice(0, 5) })
  }
  duplicates.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
  forkPairs.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key))
  for (const item of duplicates) {
    example(examples.duplicateGoals, `${item.key} ×${item.count}`)
  }

  const rate = top.length === 0 ? 0 : Math.round((compliant / top.length) * 100)
  const message = top.length === 0
    ? '未找到可审计的顶层会话（检查 DSH_HOME 与投影缓存）'
    : `扫描 ${top.length} 条顶层会话：合规 ${compliant}（${rate}%），不合规 ${noncompliant}；`
      + `分叉缺 Branch ${forksMissingBranch}，分叉带 (n) ${staleForkTitles}，`
      + `无效类型前缀 ${invalidTypePrefixes}，AUTO 缺序号 ${autoWithoutSeq}，`
      + `重复目标 ${duplicates.length} 组`
      + (forkPairs.length === 0 ? '。' : `（另有 ${forkPairs.length} 组父子/分叉同目标）。`)

  return {
    scanned: entries.length,
    skippedSubagents,
    topLevel: top.length,
    compliant,
    noncompliant,
    branchTitles,
    forksMissingBranch,
    staleForkTitles,
    invalidTypePrefixes,
    unexpectedBranch,
    autoWithoutSeq,
    duplicateGroups: duplicates.length,
    forkPairGroups: forkPairs.length,
    typeCounts,
    duplicates,
    forkPairs,
    examples,
    message,
  }
}

/** `session_title_audit` tool definition: read-only, no writes. */
export function sessionTitleAuditTool() {
  return {
    name: 'session_title_audit',
    description: [
      '只读审计会话标题规范：扫描投影缓存，统计合规率、类型分布、分叉缺 Branch｜、',
      '分叉残留 (n)、无效类型前缀、AUTO 缺序号和同日同目标重复。不修改任何标题、',
      '不写会话日志或投影缓存。可选 limit 控制扫描条数（默认 200，最大 1000）。',
    ].join(''),
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: AUDIT_LIMIT_MAX,
          description: '最多扫描多少个投影缓存文件，默认 200。',
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: [
          'scanned', 'skippedSubagents', 'topLevel', 'compliant', 'noncompliant',
          'branchTitles', 'forksMissingBranch', 'staleForkTitles', 'invalidTypePrefixes',
          'unexpectedBranch', 'autoWithoutSeq', 'duplicateGroups', 'forkPairGroups',
          'typeCounts', 'duplicates', 'forkPairs', 'examples', 'message',
        ],
        properties: {
          scanned: { type: 'integer' },
          skippedSubagents: { type: 'integer' },
          topLevel: { type: 'integer' },
          compliant: { type: 'integer' },
          noncompliant: { type: 'integer' },
          branchTitles: { type: 'integer' },
          forksMissingBranch: { type: 'integer' },
          staleForkTitles: { type: 'integer' },
          invalidTypePrefixes: { type: 'integer' },
          unexpectedBranch: { type: 'integer' },
          autoWithoutSeq: { type: 'integer' },
          duplicateGroups: { type: 'integer' },
          forkPairGroups: { type: 'integer' },
          typeCounts: {
            type: 'object',
            additionalProperties: false,
            required: [...TYPES],
            properties: Object.fromEntries(TYPES.map((type) => [type, { type: 'integer' }])),
          },
          duplicates: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['key', 'count', 'titles'],
              properties: {
                key: { type: 'string' },
                count: { type: 'integer' },
                titles: { type: 'array', items: { type: 'string' } },
              },
            },
          },
          forkPairs: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['key', 'count', 'titles'],
              properties: {
                key: { type: 'string' },
                count: { type: 'integer' },
                titles: { type: 'array', items: { type: 'string' } },
              },
            },
          },
          examples: {
            type: 'object',
            additionalProperties: false,
            required: ['noncompliant', 'forksMissingBranch', 'invalidType', 'duplicateGoals'],
            properties: {
              noncompliant: { type: 'array', items: { type: 'string' } },
              forksMissingBranch: { type: 'array', items: { type: 'string' } },
              invalidType: { type: 'array', items: { type: 'string' } },
              duplicateGoals: { type: 'array', items: { type: 'string' } },
            },
          },
          message: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.message }],
    },
    execute(args) {
      const limit = args?.limit ?? 200
      if (!Number.isInteger(limit) || limit < 1 || limit > AUDIT_LIMIT_MAX) {
        throw new Error(`session-naming: limit 必须是 1-${AUDIT_LIMIT_MAX} 的整数`)
      }
      return Promise.resolve(auditEntries(scanProjectionEntries(dshHome(), limit)))
    },
  }
}
