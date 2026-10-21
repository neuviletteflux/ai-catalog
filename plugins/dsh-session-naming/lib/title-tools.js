/**
 * dsh-session-naming / title-tools.js
 *
 * Agent-facing title tools. DSH's session-title service exposes `rename()` to
 * the Web GUI and plugins only; this module supplies the missing agent entry
 * points and encodes the local convention as validation.
 *
 * - `set_session_title`: rename the current session, composing
 *   `MMDD｜type｜goal` from structured fields. Forks are marked by the
 *   sidebar badge, not by a title prefix.
 * - `rename_session`: rename any session through the Host's
 *   `sessionController.rename`, the business method behind the Web GUI's
 *   `session.rename` remote.
 *
 * No `@deepseek-ai/*` imports: the package may be mounted outside the profile
 * directory, where bare package resolution is not guaranteed.
 *
 * @module dsh-session-naming/title-tools
 */
import {
  composeTitle, oneLine, stripLegacyBranchPrefix, utf8Bytes,
  DEFAULT_MAX_TITLE_BYTES, TYPES,
} from './compose.js'
import { branchFromProjectionCache, forkTitleBase, isBranchSession, isInheritedForkTitle } from './branch.js'

export { branchFromProjectionCache, isBranchSession, isInheritedForkTitle }

/** Protect only titles a person really decided; automatic and inherited fork titles stay replaceable. */
export function guardHumanTitle(session, previous, force) {
  if (previous === undefined) return
  if (previous.source?.kind !== 'user') return
  if (force === true) return
  if (isInheritedForkTitle(session, previous)) return
  throw new Error(
    `session-naming: 当前标题 "${previous.title}" 已由显式重命名确定，默认不覆盖；`
    + '仅当用户明确要求改名时才带 force: true 重试',
  )
}

/** The service's byte budget is the convention budget; fall back when unreadable. */
function budgetOf(service) {
  const value = service?.config?.maxTitleBytes
  return Number.isInteger(value) && value > 0 ? value : DEFAULT_MAX_TITLE_BYTES
}

const SET_TITLE_DESCRIPTION = [
  '设置当前会话的标题，遵循本机命名规范：所有会话统一 `MMDD｜类型｜目标`，',
  'fork 出来的会话也不写 Branch——分叉由侧边栏徽标标识，不要自己加前缀；',
  '自动化运行会话 `MMDD｜AUTO｜任务名称`（同一任务同一天多次运行追加 `-01`、`-02`）。',
  `MMDD 取该会话的创建日期，由本工具自动填入。类型从 ${TYPES.join('、')} 中选择。`,
  '目标写“要理解或完成的事”，不写执行过程，也不写“完成/进行中/待确认”等状态。',
  '目标明确后再调用，同一会话通常只命名一次。返回服务规范化后实际生效的标题与字节数，以此为准。',
  '标题已由显式重命名确定时默认拒绝覆盖，仅在用户明确要求改名时才带 force: true。',
].join(' ')

const RENAME_DESCRIPTION = [
  '按会话 id 重命名任意会话，调用 Host 的 `sessionController.rename`（Web GUI 的 `session.rename` 背后同一业务方法；非活跃会话由 Host 恢复后改名）。',
  '仅用于用户明确要求的存量会话整理：先只读盘点并把建议标题清单交用户确认，再逐条调用，最后用同一来源复核。',
  '标题统一为 `MMDD｜类型｜目标`；fork 由界面徽标标识，标题不加 Branch。旧的 `Branch｜` 前缀会被去掉。',
  '无法判断目标的空白会话不要凭空命名；不改归档状态，也不直接写会话日志或投影缓存。',
].join(' ')

/** `set_session_title` tool definition. */
export function setSessionTitleTool(ctx) {
  return {
    name: 'set_session_title',
    description: SET_TITLE_DESCRIPTION,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        type: { type: 'string', description: `类型词：${TYPES.join('｜')}。自动化运行会话用 AUTO。` },
        goal: { type: 'string', description: '简短具体的目标（要理解或完成的事），不写状态；建议 20 个汉字以内。' },
        seq: { type: 'integer', description: '同一任务同一天的运行序号（1-99，仅自动化运行会话需要），会拼成 -01、-02。' },
        raw: { type: 'string', description: '完整标题原文，跳过规范拼装；仅当用户明确指定了标题时使用（旧 Branch｜ 前缀会被去掉）。' },
        force: { type: 'boolean', description: '覆盖已由显式重命名确定的标题；只在用户明确要求改名时使用。' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'bytes', 'budget', 'truncated', 'previous', 'branch', 'message'],
        properties: {
          title: { type: 'string' },
          bytes: { type: 'integer' },
          budget: { type: 'integer' },
          truncated: { type: 'boolean' },
          previous: { type: 'string' },
          branch: { type: 'boolean' },
          message: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.message }],
    },
    execute(args, exec) {
      const agent = exec.agent
      if (agent === undefined) throw new Error('session-naming: set_session_title 只能在 agent 会话内调用')
      const session = agent.session
      const service = ctx.sessionTitle
      const budget = budgetOf(service)
      const previous = service.get(session)
      const previousTitle = previous?.title ?? ''
      guardHumanTitle(session, previous, args.force === true)

      const branch = isBranchSession(session)
      const raw = typeof args.raw === 'string' && args.raw.trim() !== '' ? oneLine(args.raw) : undefined
      const title = raw === undefined
        ? composeTitle({ type: args.type, goal: args.goal, seq: args.seq }, session.header?.createdAt, budget)
        : stripLegacyBranchPrefix(raw)
      const accepted = service.rename(session, title)
      const bytes = utf8Bytes(accepted.title)
      const truncated = accepted.title !== title
      const branchNote = branch ? '，分叉由界面徽标标识' : ''
      return Promise.resolve({
        title: accepted.title,
        bytes,
        budget,
        truncated,
        previous: previousTitle,
        branch,
        message: truncated
          ? `标题超过 ${budget} 字节，已截断为 "${accepted.title}"（${bytes} 字节）`
          : `已将会话标题设为 "${accepted.title}"（${bytes}/${budget} 字节${branchNote}）`,
      })
    },
  }
}

/** `rename_session` tool definition. */
export function renameSessionTool(ctx) {
  return {
    name: 'rename_session',
    description: RENAME_DESCRIPTION,
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['sessionId', 'title'],
      properties: {
        sessionId: { type: 'string', description: '目标会话 id，形如 session-<uuid>。' },
        title: { type: 'string', description: '要设置的完整标题，遵循 `MMDD｜类型｜目标`；旧 `Branch｜` 前缀会被去掉，fork 由界面徽标标识。' },
        branch: { type: 'boolean', description: '显式指定该会话是否为分支（仅影响结果里的 branch 字段）；省略时按投影缓存里的 isSeeded 自动判定。' },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['sessionId', 'title', 'seq', 'branch', 'message'],
        properties: {
          sessionId: { type: 'string' },
          title: { type: 'string' },
          seq: { type: 'integer' },
          branch: { type: 'boolean' },
          message: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.message }],
    },
    async execute(args) {
      if (typeof args.sessionId !== 'string' || args.sessionId.trim() === '') {
        throw new Error('session-naming: sessionId 不能为空')
      }
      const rawInput = oneLine(args.title)
      if (rawInput === '') throw new Error('session-naming: title 不能为空')
      const legacyPrefix = rawInput.startsWith('Branch｜')
      const input = stripLegacyBranchPrefix(rawInput)
      const controller = ctx.get('sessionController')
      if (controller === undefined) {
        throw new Error('session-naming: rename_session 需要 sessionController 服务，当前部署未挂载')
      }
      const detected = typeof args.branch === 'boolean' ? args.branch : branchFromProjectionCache(args.sessionId)
      const base = detected === true ? forkTitleBase(input) : input
      const title = base
      const result = await controller.rename({ sessionId: args.sessionId, title })
      const accepted = result?.title ?? title
      const notes = []
      if (detected === true) notes.push('分叉由界面徽标标识，标题不加 Branch｜')
      if (legacyPrefix) notes.push('已去掉旧的 Branch｜ 前缀')
      if (detected === true && base !== input) notes.push('已去掉末尾的 (n)')
      else if (detected === undefined) notes.push('未能判定是否分支（分叉由界面徽标标识）')
      if (accepted !== title) notes.push(`超过字节上限，已截断为 ${utf8Bytes(accepted)} 字节`)
      return {
        sessionId: args.sessionId,
        title: accepted,
        seq: Number.isInteger(result?.seq) ? result.seq : 0,
        branch: detected === true,
        message: `已把 ${args.sessionId} 的标题设为 "${accepted}"${notes.length === 0 ? '' : `（${notes.join('；')}）`}`,
      }
    },
  }
}

/** Register both tools; the returned disposer unregisters them. */
export function registerTitleTools(ctx) {
  const disposers = [
    ctx.tools.register(setSessionTitleTool(ctx)),
    ctx.tools.register(renameSessionTool(ctx)),
  ]
  return () => {
    for (const dispose of disposers) {
      if (typeof dispose === 'function') dispose()
    }
  }
}
