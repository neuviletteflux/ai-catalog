/**
 * dsh-session-naming / normalizer.js
 *
 * Rewrites the built-in summary title into `MMDD｜type｜goal` (forks are
 * marked by the sidebar badge, not by a title prefix).
 *
 * Design constraint: DSH ships different `@deepseek-ai/dsh-session-title-llm`
 * provider interfaces across releases, so replacing the provider couples the
 * plugin to one generation. Instead this module subscribes to `session/title`,
 * waits for the title to settle, and appends one `provider`-sourced revision.
 * A provider revision does not pin the title, so an agent can still correct it
 * later with `set_session_title`.
 *
 * @module dsh-session-naming/normalizer
 */
import { appendFile, mkdir, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  DEFAULT_MAX_TITLE_BYTES, SEPARATOR, TYPES, monthDayOf, oneLine, utf8Bytes,
} from './compose.js'
import { forkTitleBase, isBranchSession, isInheritedForkTitle } from './branch.js'

/** Source id used on revision events; also prevents self-triggering. */
export const PROVIDER_ID = 'session-naming-convention'

/** Types the normalizer may infer. `AUTO` belongs to automation runs only. */
export const GOAL_TYPES = TYPES.filter((type) => type !== 'AUTO')

/** Shape of a compliant title: `MMDD｜type｜goal`. */
export const CONVENTION = /^\d{4}｜(?:分析|规划|实施|排障|审计|查询|整理|复盘|AUTO)｜/u

/**
 * Any convention-shaped prefix, including a type outside the vocabulary.
 * Normalization strips this whole prefix so `1020｜开发｜…` cannot leak the
 * date/type into the goal.
 */
export const TITLE_PREFIX = /^(?:Branch｜)?\d{4}｜[^｜|]{1,16}｜/u

/** Default settle window; long enough for the built-in LLM summary to land. */
export const DEFAULT_SETTLE_MS = 10000

/** Rotate the run log at this size; the log only records loads and rewrites. */
const LOG_MAX_BYTES = 256 * 1024

/** Set to false after the first write failure, so read-only disks stay quiet. */
let loggingEnabled = true

/** Absolute run-log path, resolved at call time so tests can redirect it. */
function logPath() {
  return join(process.env.DSH_HOME ?? join(homedir(), '.dsh'), 'logs', 'session-naming.log')
}

async function rotateIfOversized(path) {
  try {
    const info = await stat(path)
    if (info.size > LOG_MAX_BYTES) {
      await writeFile(path, `${new Date().toISOString()} log rotated (> ${LOG_MAX_BYTES} bytes)\n`)
    }
  } catch {
    /* file does not exist yet */
  }
}

/** Append one run-log line; a write failure disables logging, never naming. */
export async function logLine(line) {
  if (!loggingEnabled) return
  const path = logPath()
  try {
    await mkdir(dirname(path), { recursive: true })
    await rotateIfOversized(path)
    await appendFile(path, `${new Date().toISOString()} ${line}\n`)
  } catch {
    loggingEnabled = false
  }
}

/**
 * Type signals used by the title scorer.
 *
 * `strong` marks the activity itself; `leading` gives a bonus when the title
 * opens with that activity verb; `artifact` gives a bonus when the title ends
 * in a deliverable noun (方案/报告/清单/复盘/分析). `weak` is reserved for
 * lookup/question words and never outweighs a title action.
 */
const FAILURE = /(报错|失败|错误|无法|不能|崩溃|坏|异常|超时|卡住|不生效|没生效|error|fail|bug|crash)/iu
const QUESTION_START = /^(?:(?:如何|怎么|怎样|什么|为什么|是否|哪些|哪个|多少|在哪|有没有)|(?:what|how|why|which|where|who)\b)/iu
const QUESTION_END = /[?？]\s*$/u
const QUERY_WEAK = /(是什么|含义|表示什么|怎么查|如何|在哪|有没有|哪种|哪些|哪个|多少|咨询|介绍|版本|what|how|where|which|是否|为什么|怎么)/iu

const ARTIFACT_PLAN = /(?:方案|计划|路线|设计|拆解)\s*(?:[（(]\d+[)）])?\s*$/u
const ARTIFACT_AUDIT = /(?:报告|评审|审计|核查|验收)\s*(?:[（(]\d+[)）])?\s*$/u
const ARTIFACT_ORGANIZE = /(?:清单|纪要|周报|简报|摘要|总结|汇总)\s*(?:[（(]\d+[)）])?\s*$/u
const ARTIFACT_RETRO = /复盘\s*(?:[（(]\d+[)）])?\s*$/u
const ARTIFACT_ANALYSIS = /(?:分析|评估|调研|对比|差异)\s*(?:[（(]\d+[)）])?\s*$/u

const TYPE_SIGNALS = [
  {
    type: '排障',
    strong: /(报错|失败|错误|无法|不能|崩溃|坏|异常|超时|卡住|不生效|没生效|修复|排查|定位|回归|error|fail|bug|crash|fix)/iu,
    leading: /^(?:修复|排查|定位|诊断|解决|处理|修好)/u,
    artifact: null,
  },
  {
    type: '实施',
    strong: /(实现|实施|安装|部署|配置|改成|改为|加上|接入|迁移|升级|重构|新建|构建|搭建|优化|移动|清理|重做|落地|分发|发布|新增|删除|改造|调整|合并|编写|启动|停用|关闭|开启|验证|复测|install|deploy|implement|migrate|upgrade|refactor)/iu,
    leading: /^(?:实现|实施|安装|部署|配置|改成|改为|加上|接入|迁移|升级|重构|新建|构建|搭建|优化|移动|清理|重做|发布|新增|删除|改造|调整|合并|编写|启动|停用|关闭|开启)/u,
    artifact: null,
  },
  {
    type: '审计',
    strong: /(审计|盘点|核查|核对|合规|一致性|对照|评审|验收|inspect|audit)/iu,
    leading: /^(?:审计|盘点|核查|核对|评审|验收)/u,
    artifact: ARTIFACT_AUDIT,
  },
  {
    type: '规划',
    strong: /(规划|方案|设计|路线|计划|拆解|roadmap|plan|design)/iu,
    leading: /^(?:规划|设计|计划|拆解)/u,
    artifact: ARTIFACT_PLAN,
  },
  {
    type: '整理',
    strong: /(整理|总结|汇总|清单|归纳|周报|简报|纪要|摘要|输出|导出|organize|summary)/iu,
    leading: /^(?:整理|总结|汇总|归纳|输出|导出)/u,
    artifact: ARTIFACT_ORGANIZE,
  },
  {
    type: '复盘',
    strong: /(复盘|回顾|retro|postmortem)/iu,
    leading: /^(?:复盘|回顾)/u,
    artifact: ARTIFACT_RETRO,
  },
  {
    type: '分析',
    strong: /(分析|评估|调研|对比|差异|原理|机制|研究|根因|analysis|analyze|evaluate|compare)/iu,
    leading: /^(?:分析|评估|调研|对比|研究)/u,
    artifact: ARTIFACT_ANALYSIS,
  },
  {
    type: '查询',
    strong: /(查询|查看|查找|搜索|检索|检查|确认|核实|lookup|search|find)/iu,
    leading: /^(?:查询|查看|查找|搜索|检索|列出|看看|介绍|说明)/u,
    weak: QUERY_WEAK,
    artifact: null,
  },
]

/** Tie-break order: concrete work beats lookup; diagnosis beats execution. */
const TYPE_PRIORITY = ['排障', '实施', '审计', '规划', '整理', '复盘', '分析', '查询']
const PRIORITY = new Map(TYPE_PRIORITY.map((type, index) => [type, index]))

/** Fallback type when no keyword matches. */
export const DEFAULT_TYPE = '分析'

/** A pure question asks for information; a failure question is diagnosis. */
function isPureQuestion(title) {
  if (!QUESTION_START.test(title) && !QUESTION_END.test(title)) return false
  return !FAILURE.test(title)
}

/** Weighted score for one type signal. */
function scoreSignal(signal, title, message) {
  let score = 0
  if (signal.strong.test(title)) score += 3
  if (signal.leading.test(title)) score += 2
  if (signal.artifact !== null && signal.artifact.test(title)) score += 3
  if (signal.strong.test(message)) score += 1
  if (signal.weak?.test(title)) score += 1
  return score
}

/** Whether a title already follows the convention. */
export function isConventionTitle(title) {
  if (typeof title !== 'string') return false
  const text = oneLine(title)
  if (!CONVENTION.test(text)) return false
  const matched = /^\d{4}｜([^｜]+)｜/u.exec(text)
  if (matched?.[1] === 'AUTO' && !/-\d{2}$/u.test(text)) return false
  return true
}

/** Truncate to a byte budget without splitting a code point. */
export function truncateBytes(text, maxBytes) {
  if (utf8Bytes(text) <= maxBytes) return text
  let used = 0
  let out = ''
  for (const character of text) {
    const bytes = utf8Bytes(character)
    if (used + bytes > maxBytes) break
    out += character
    used += bytes
  }
  return out.trimEnd()
}

/**
 * Infer a type from the title and the first human message.
 *
 * The title dominates: action words in the title outrank question words in the
 * prompt. A pure question with no failure signal is a lookup; otherwise the
 * highest weighted score wins, with a stable tie-break order.
 * @param title - session title.
 * @param firstMessage - first human message text (optional).
 */
export function pickType(title, firstMessage = '') {
  const titleText = oneLine(title)
  const messageText = oneLine(firstMessage)
  if (titleText === '') return DEFAULT_TYPE
  if (isPureQuestion(titleText)) return '查询'
  let winner
  let winnerScore = 0
  for (const signal of TYPE_SIGNALS) {
    const score = scoreSignal(signal, titleText, messageText)
    if (score === 0) continue
    if (winner === undefined || score > winnerScore
      || (score === winnerScore && PRIORITY.get(signal.type) < PRIORITY.get(winner))) {
      winner = signal.type
      winnerScore = score
    }
  }
  if (winner !== undefined) return winner
  if (QUERY_WEAK.test(titleText)) return '查询'
  return DEFAULT_TYPE
}

/**
 * Compose a normalized title; shrink the goal instead of throwing when the
 * built-in summary is too long. A legacy `Branch｜` prefix is stripped, not
 * regenerated.
 * @param input - `{ goal, type, createdAt, maxBytes }`.
 */
export function composeNormalized(input) {
  const type = GOAL_TYPES.includes(input?.type) ? input.type : DEFAULT_TYPE
  const head = `${monthDayOf(input?.createdAt)}${SEPARATOR}${type}${SEPARATOR}`
  const maxBytes = Number.isInteger(input?.maxBytes) ? input.maxBytes : DEFAULT_MAX_TITLE_BYTES
  const room = maxBytes - utf8Bytes(head)
  if (room < 3) throw new Error(`session-naming-normalizer: 字节预算 ${maxBytes} 放不下 "${head}"`)
  const goal = oneLine(input?.goal)
    .replace(TITLE_PREFIX, '')
    .replace(/[｜|]/gu, ' ')
    .trim()
  const text = truncateBytes(goal, room)
  if (text === '') throw new Error('session-naming-normalizer: 目标为空，无法拼装规范标题')
  return head + text
}

/** Text of the first human message in the session log, for type inference. */
export function firstHumanText(session) {
  try {
    const events = typeof session?.snapshotEvents === 'function' ? session.snapshotEvents() : []
    for (const event of events) {
      if (event?.type !== 'user/message') continue
      if (event.data?.source?.kind !== 'user') continue
      const text = (event.data.content ?? [])
        .filter((block) => block?.type === 'text')
        .map((block) => block.text)
        .join(' ')
      if (oneLine(text) !== '') return oneLine(text)
    }
  } catch {
    /* unreadable logs simply do not inform the type */
  }
  return ''
}

/** Seq of the first human `user/message` event, for invariant-safe refs. */
export function firstHumanSeq(session) {
  try {
    const events = typeof session?.snapshotEvents === 'function' ? session.snapshotEvents() : []
    for (const event of events) {
      if (event?.type !== 'user/message') continue
      if (event.data?.source?.kind !== 'user') continue
      if (Number.isSafeInteger(event.seq) && event.seq >= 0) return event.seq
    }
  } catch {
    /* unreadable logs cannot supply a ref */
  }
  return undefined
}

/**
 * Message refs for a provider revision.
 *
 * A fork's inherited title is a user title with an empty `messageSeqs`, but a
 * provider revision must cite at least one earlier human message. Fall back to
 * the first human message in the inherited log; return an empty list when the
 * fork has none, so the caller skips instead of violating the invariant.
 */
export function titleRefs(session, current) {
  const refs = Array.isArray(current?.messageSeqs)
    ? [...new Set(current.messageSeqs.filter((seq) => Number.isSafeInteger(seq) && seq >= 0))]
    : []
  if (refs.length > 0) return refs
  const seq = firstHumanSeq(session)
  return seq === undefined ? [] : [seq]
}

/** Validate the settle window. */
export function settleDelayOf(config) {
  const value = config?.settleMs
  if (value === undefined) return DEFAULT_SETTLE_MS
  if (!Number.isInteger(value) || value < 0 || value > 600000) {
    throw new Error('session-naming-normalizer: settleMs 必须是 0-600000 的整数')
  }
  return value
}

/** A fork title is compliant with no trailing `(n)`; the badge marks the fork. */
function isForkTitleCompliant(title) {
  const text = oneLine(title)
  return isConventionTitle(text) && forkTitleBase(text) === text
}

/**
 * Normalize the current title once, appending a provider revision only when
 * something actually changes.
 * @param ctx - host context carrying `sessionTitle`.
 * @param session - live session.
 * @param options - `{ providerId?, log? }`; `log` is injectable for tests.
 * @returns the appended title, or `undefined` when left untouched.
 */
export function normalizeNow(ctx, session, options = {}) {
  const providerId = options.providerId ?? PROVIDER_ID
  const service = ctx?.sessionTitle
  if (service === undefined) return undefined
  const current = service.get(session)
  if (current === undefined) return undefined
  if (current.source?.kind === 'provider' && current.source.provider === providerId) return undefined
  const header = session?.header ?? {}
  if (header.origin === 'subagent') return undefined

  const fork = isBranchSession(session)
  if (fork) {
    // Only the system-written inherited title may be replaced; a human rename on
    // the fork must survive; a title without a trailing (n) is done.
    if (!isInheritedForkTitle(session, current)) return undefined
    if (isForkTitleCompliant(current.title)) return undefined
  } else {
    if (current.source?.kind === 'user') return undefined
    if (isConventionTitle(current.title)) return undefined
    // Preserve the old rule for non-fork sessions with a parent (subagents whose
    // origin marker is missing must never be normalized).
    if (header.parentSession !== undefined) return undefined
  }

  const refs = titleRefs(session, current)
  if (refs.length === 0) return undefined
  const maxBytes = Number.isInteger(service.config?.maxTitleBytes)
    ? service.config.maxTitleBytes
    : DEFAULT_MAX_TITLE_BYTES
  const goal = fork ? forkTitleBase(current.title) : current.title
  const title = composeNormalized({
    goal,
    type: pickType(goal, firstHumanText(session)),
    createdAt: header.createdAt,
    maxBytes,
  })
  if (title === oneLine(current.title)) return undefined
  session.append('session/title', {
    title,
    messageSeqs: refs,
    source: { kind: 'provider', provider: providerId },
  })
  const log = options.log ?? logLine
  void log(`session ${session.id}: "${current.title}" (${current.source?.kind ?? 'unknown'}) → "${title}"`)
  return title
}

/**
 * Install the title-settling listener.
 * @param ctx - host context; needs `on`, and optionally `effect`/`logger`.
 * @param config - `{ settleMs? }`.
 * @returns a disposer that clears pending timers and the listener.
 */
export function applyNormalizer(ctx, config) {
  const settleMs = settleDelayOf(config)
  const timers = new Map()

  const settleLater = (session, delay = settleMs) => {
    const id = session?.id
    if (typeof id !== 'string') return
    const existing = timers.get(id)
    if (existing !== undefined) clearTimeout(existing)
    const timer = setTimeout(() => {
      timers.delete(id)
      try {
        normalizeNow(ctx, session)
      } catch (error) {
        if (typeof ctx.logger?.warn === 'function') {
          ctx.logger.warn(`session-naming-normalizer: 规范化会话 "${id}" 失败: ${String(error)}`)
        }
      }
    }, delay)
    // Do not hold a headless process open just to wait for a title.
    if (typeof timer.unref === 'function') timer.unref()
    timers.set(id, timer)
  }

  const off = ctx.on('session/event', (session, event) => {
    if (event?.type !== 'session/title') return
    const source = event.data?.source
    if (source?.kind === 'provider' && source.provider === PROVIDER_ID) return
    if (source?.kind === 'user') {
      if (!isBranchSession(session)) return
      // A fork's inherited title is stable already: do not wait for the LLM
      // summary window, and normalize before a cold fork can be disposed.
      settleLater(session, 0)
      return
    }
    settleLater(session)
  })

  const dispose = () => {
    if (typeof off === 'function') off()
    for (const timer of timers.values()) clearTimeout(timer)
    timers.clear()
  }

  if (typeof ctx.effect === 'function') {
    ctx.effect(() => dispose, 'session-naming-normalizer timers')
  }
  void logLine(`loaded (settleMs=${settleMs})`)
  return dispose
}
