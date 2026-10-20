/**
 * dsh-session-naming / compose.js
 *
 * Pure title composition and validation for the local session-naming
 * convention. Zero imports, so it can be tested without a DSH runtime.
 *
 * Convention:
 * - ordinary session: `MMDD｜type｜goal`
 * - branch (fork) session: `Branch｜MMDD｜type｜goal`
 * - automation run: `MMDD｜AUTO｜task`, with `-01`, `-02` for repeated runs
 * MMDD comes from the session's creation date, not from "today".
 *
 * @module dsh-session-naming/compose
 */

/** Type vocabulary accepted by the convention. `AUTO` is for automation runs. */
export const TYPES = ['分析', '规划', '实施', '排障', '审计', '查询', '整理', '复盘', 'AUTO']

/** Full-width separator required by the convention. */
export const SEPARATOR = '｜'

/** Branch (fork) prefix label. */
export const BRANCH_LABEL = 'Branch'

/** Hard title limit in UTF-8 bytes; the session-title service's config wins. */
export const DEFAULT_MAX_TITLE_BYTES = 80

/** UTF-8 byte length. */
export function utf8Bytes(text) {
  return Buffer.byteLength(String(text ?? ''), 'utf8')
}

function pad2(value) {
  return String(value).padStart(2, '0')
}

/**
 * MMDD of the session creation date in the host's local time zone.
 * @param createdAt - the session header's createdAt (milliseconds).
 * @throws when the timestamp is unreadable; never falls back to "today".
 */
export function monthDayOf(createdAt) {
  const stamp = typeof createdAt === 'number' && Number.isFinite(createdAt) ? createdAt : NaN
  const date = new Date(stamp)
  if (Number.isNaN(date.getTime())) throw new Error('session-naming: 会话创建时间不可读，无法生成 MMDD')
  return pad2(date.getMonth() + 1) + pad2(date.getDate())
}

/** Collapse whitespace to one line and trim. */
export function oneLine(text) {
  return String(text ?? '').replace(/\s+/gu, ' ').trim()
}

/** Validate a type label. */
export function normalizeType(type) {
  const label = oneLine(type)
  if (label === '') throw new Error(`session-naming: 缺少类型；可选：${TYPES.join('、')}`)
  if (!TYPES.includes(label)) throw new Error(`session-naming: 类型 "${label}" 不在规范词表内；可选：${TYPES.join('、')}`)
  return label
}

/** Validate goal text. */
export function normalizeGoal(goal) {
  const target = oneLine(goal)
  if (target === '') throw new Error('session-naming: 目标不能为空')
  if (target.includes(SEPARATOR)) throw new Error(`session-naming: 目标里不要再写分隔符 "${SEPARATOR}"`)
  return target
}

/** Validate the same-task run index (1-99). */
export function normalizeSeq(seq) {
  if (seq === undefined || seq === null) return undefined
  if (!Number.isInteger(seq) || seq < 1 || seq > 99) throw new Error('session-naming: seq 必须是 1-99 的整数（同一任务同一天的运行序号）')
  return seq
}

/** Branch title prefix, such as `Branch｜`. */
export function branchPrefix() {
  return `${BRANCH_LABEL}${SEPARATOR}`
}

/** Whether the title already carries the branch prefix. */
export function hasBranchPrefix(title) {
  return oneLine(title).startsWith(branchPrefix())
}

/**
 * Add `Branch｜` when needed; never duplicate an existing prefix.
 * @param title - arbitrary title text.
 * @param branch - whether the session is a branch (fork).
 * @returns the resulting one-line title.
 */
export function ensureBranchPrefix(title, branch) {
  const text = oneLine(title)
  if (branch !== true || hasBranchPrefix(text)) return text
  return branchPrefix() + text
}

/**
 * Compose `[Branch｜]MMDD｜type｜goal` (automation runs append `-NN`).
 * @param input - `{ type, goal, seq?, branch? }`.
 * @param createdAt - session creation time (milliseconds).
 * @param maxBytes - title byte budget.
 * @returns the convention title.
 * @throws when over budget, naming the bytes and CJK characters still available.
 */
export function composeTitle(input, createdAt, maxBytes = DEFAULT_MAX_TITLE_BYTES) {
  const label = normalizeType(input?.type)
  const target = normalizeGoal(input?.goal)
  const index = normalizeSeq(input?.seq)
  const suffix = index === undefined ? '' : `-${pad2(index)}`
  const head = input?.branch === true ? branchPrefix() : ''
  const title = `${head}${monthDayOf(createdAt)}${SEPARATOR}${label}${SEPARATOR}${target}${suffix}`
  const bytes = utf8Bytes(title)
  if (bytes > maxBytes) {
    const goalBudget = Math.max(1, maxBytes - (bytes - utf8Bytes(target)))
    throw new Error(
      `session-naming: 标题 "${title}" 为 ${bytes} 字节，超过上限 ${maxBytes} 字节；`
      + `请把目标压缩到 ${goalBudget} 字节以内（约 ${Math.max(1, Math.floor(goalBudget / 3))} 个汉字）后重试`,
    )
  }
  return title
}
