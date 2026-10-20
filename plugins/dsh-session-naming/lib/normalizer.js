/**
 * dsh-session-naming / normalizer.js
 *
 * Rewrites the built-in summary title into `[Branch｜]MMDD｜type｜goal`.
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

/** Source id used on revision events; also prevents self-triggering. */
export const PROVIDER_ID = 'session-naming-convention'

/** Types the normalizer may infer. `AUTO` belongs to automation runs only. */
export const GOAL_TYPES = TYPES.filter((type) => type !== 'AUTO')

/** Shape of a compliant title: `[Branch｜]MMDD｜type｜goal`. */
export const CONVENTION = /^(?:Branch｜)?\d{4}｜(?:分析|规划|实施|排障|审计|查询|整理|复盘|AUTO)｜/u

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

/** Type keywords, checked in order; the first hit wins. */
const TYPE_KEYWORDS = [
  ['排障', /(报错|失败|错误|无法|不能|崩溃|修复|坏|异常|超时|卡住|不生效|没生效|error|fail|bug|crash|fix)/iu],
  ['审计', /(审计|盘点|核查|核对|合规|一致性|对照|inspect|audit)/iu],
  ['复盘', /(复盘|回顾|retro|postmortem)/iu],
  ['整理', /(整理|总结|汇总|清单|归纳|周报|简报|纪要|摘要|organize|summary)/iu],
  ['规划', /(规划|方案|设计|怎么做|路线|计划|拆解|roadmap|plan|design)/iu],
  ['查询', /(是什么|含义|表示什么|怎么查|如何|在哪|有没有|查询|查看|哪种|哪些|哪个|多少|咨询|介绍|what|how|where|which)/iu],
  ['实施', /(实现|实施|安装|部署|配置|改成|加上|接入|迁移|升级|重构|新建|构建|搭建|install|deploy|implement|migrate|upgrade)/iu],
]

/** Fallback type when no keyword matches. */
export const DEFAULT_TYPE = '分析'

/** Whether a title already follows the convention. */
export function isConventionTitle(title) {
  return typeof title === 'string' && CONVENTION.test(oneLine(title))
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
 * Infer a type from the title and first human message.
 * @param text - haystack used for keyword matching.
 */
export function pickType(text) {
  const haystack = String(text ?? '')
  for (const [type, pattern] of TYPE_KEYWORDS) {
    if (pattern.test(haystack)) return type
  }
  return DEFAULT_TYPE
}

/**
 * Compose a normalized title; shrink the goal instead of throwing when the
 * built-in summary is too long.
 * @param input - `{ goal, type, createdAt, maxBytes, branch }`.
 */
export function composeNormalized(input) {
  const type = GOAL_TYPES.includes(input?.type) ? input.type : DEFAULT_TYPE
  const head = `${input?.branch === true ? 'Branch｜' : ''}${monthDayOf(input?.createdAt)}${SEPARATOR}${type}${SEPARATOR}`
  const maxBytes = Number.isInteger(input?.maxBytes) ? input.maxBytes : DEFAULT_MAX_TITLE_BYTES
  const room = maxBytes - utf8Bytes(head)
  if (room < 3) throw new Error(`session-naming-normalizer: 字节预算 ${maxBytes} 放不下 "${head}"`)
  const goal = oneLine(input?.goal)
    .replace(/^(?:Branch｜)?\d{4}｜(?:分析|规划|实施|排障|审计|查询|整理|复盘|AUTO)｜/u, '')
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

/** Validate the settle window. */
export function settleDelayOf(config) {
  const value = config?.settleMs
  if (value === undefined) return DEFAULT_SETTLE_MS
  if (!Number.isInteger(value) || value < 0 || value > 600000) {
    throw new Error('session-naming-normalizer: settleMs 必须是 0-600000 的整数')
  }
  return value
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
  if (current.source?.kind === 'user') return undefined
  if (current.source?.kind === 'provider' && current.source.provider === providerId) return undefined
  if (isConventionTitle(current.title)) return undefined
  const header = session?.header ?? {}
  if (header.parentSession !== undefined) return undefined
  const refs = Array.isArray(current.messageSeqs)
    ? current.messageSeqs.filter((seq) => Number.isSafeInteger(seq))
    : []
  if (refs.length === 0) return undefined
  const maxBytes = Number.isInteger(service.config?.maxTitleBytes)
    ? service.config.maxTitleBytes
    : DEFAULT_MAX_TITLE_BYTES
  const title = composeNormalized({
    goal: current.title,
    type: pickType(`${current.title} ${firstHumanText(session)}`),
    createdAt: header.createdAt,
    maxBytes,
    branch: false,
  })
  if (title === current.title) return undefined
  session.append('session/title', {
    title,
    messageSeqs: [...refs],
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

  const settleLater = (session) => {
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
    }, settleMs)
    // Do not hold a headless process open just to wait for a title.
    if (typeof timer.unref === 'function') timer.unref()
    timers.set(id, timer)
  }

  const off = ctx.on('session/event', (session, event) => {
    if (event?.type !== 'session/title') return
    const source = event.data?.source
    if (source?.kind === 'user') return
    if (source?.kind === 'provider' && source.provider === PROVIDER_ID) return
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
