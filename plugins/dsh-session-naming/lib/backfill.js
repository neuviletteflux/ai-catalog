/**
 * dsh-session-naming / backfill.js
 *
 * Build and optionally apply canonical titles for non-compliant top-level
 * sessions discovered in the projection cache. The current title is kept as
 * the goal; only the date, type, fork prefix, and byte budget are normalized.
 * `apply` is false by default, so a call is a dry run unless explicitly told
 * otherwise.
 *
 * @module dsh-session-naming/backfill
 */
import { dshHome, forkTitleBase } from './branch.js'
import { scanProjectionEntries } from './audit.js'
import { DEFAULT_MAX_TITLE_BYTES, TYPES, oneLine } from './compose.js'
import { composeNormalized, isConventionTitle, pickType } from './normalizer.js'

/** A title shape, including a type outside the vocabulary. */
const TITLE_SHAPE = /^(?:Branch｜)?\d{4}｜([^｜|]{1,16})｜/u

/**
 * Decide whether one entry is already canonical for its fork state.
 * @param title - current title.
 * @param branch - whether the session is a fork.
 * @returns true when the title needs no rewrite.
 */
function isCanonical(title, branch) {
  if (!isConventionTitle(title)) return false
  const text = oneLine(title)
  if (branch) return text.startsWith('Branch｜') && forkTitleBase(text) === text
  return !text.startsWith('Branch｜')
}

/**
 * Build proposals from projection entries. Subagents, already-compliant rows,
 * AUTO titles without a run index, and rows without a readable createdAt are
 * skipped.
 * @param entries - `scanProjectionEntries()` output.
 * @param options - `{ maxBytes? }`.
 * @returns `{ proposals, skipped }`.
 */
export function proposeBackfill(entries, { maxBytes = DEFAULT_MAX_TITLE_BYTES } = {}) {
  const proposals = []
  const skipped = []
  for (const entry of entries) {
    if (entry.subagent) continue
    const currentTitle = oneLine(entry.title)
    if (currentTitle === '') continue
    if (!Number.isFinite(entry.createdAt)) {
      skipped.push({ sessionId: entry.sessionId, currentTitle, reason: 'createdAt 不可读' })
      continue
    }
    const branch = entry.isSeeded || entry.inheritedEventCount > 0
    if (isCanonical(currentTitle, branch)) continue

    const matched = TITLE_SHAPE.exec(currentTitle)
    const existingType = TYPES.includes(matched?.[1]) ? matched[1] : undefined
    if (existingType === 'AUTO') {
      skipped.push({ sessionId: entry.sessionId, currentTitle, reason: 'AUTO 标题需要保留运行序号，未自动改写' })
      continue
    }

    const goalSource = branch ? forkTitleBase(currentTitle) : currentTitle
    const type = existingType ?? pickType(goalSource)
    if (type === 'AUTO') {
      skipped.push({ sessionId: entry.sessionId, currentTitle, reason: 'AUTO 标题需要保留运行序号，未自动改写' })
      continue
    }
    try {
      const proposedTitle = composeNormalized({
        goal: goalSource, type, createdAt: entry.createdAt, maxBytes, branch,
      })
      if (proposedTitle === currentTitle) continue
      proposals.push({
        sessionId: entry.sessionId,
        currentTitle,
        proposedTitle,
        type,
        branch,
      })
    } catch (error) {
      skipped.push({
        sessionId: entry.sessionId,
        currentTitle,
        reason: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return { proposals, skipped }
}

/** `session_title_backfill` tool: dry run by default, writes only with apply. */
export function sessionTitleBackfillTool(ctx) {
  return {
    name: 'session_title_backfill',
    description: [
      '批量规范化历史会话标题。只处理不合规的顶层会话；现标题保留为目标文本，',
      '按创建日期补 MMDD、按标题推断类型、fork 补 Branch｜并去掉末尾 (n)，',
      '子代理、已合规标题和缺 createdAt 的会话跳过。默认 apply=false，只返回',
      '建议列表；apply=true 才通过 sessionController.rename 写入。',
    ].join(''),
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        apply: {
          type: 'boolean',
          description: '是否真正写入；默认 false，只做 dry-run。',
        },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: 500,
          description: '最多扫描多少个投影缓存文件，默认 200。',
        },
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        required: ['scanned', 'proposals', 'skipped', 'applied', 'failed', 'message'],
        properties: {
          scanned: { type: 'integer' },
          proposals: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['sessionId', 'currentTitle', 'proposedTitle', 'type', 'branch'],
              properties: {
                sessionId: { type: 'string' },
                currentTitle: { type: 'string' },
                proposedTitle: { type: 'string' },
                type: { type: 'string' },
                branch: { type: 'boolean' },
              },
            },
          },
          skipped: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['sessionId', 'currentTitle', 'reason'],
              properties: {
                sessionId: { type: 'string' },
                currentTitle: { type: 'string' },
                reason: { type: 'string' },
              },
            },
          },
          applied: { type: 'integer' },
          failed: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              required: ['sessionId', 'proposedTitle', 'error'],
              properties: {
                sessionId: { type: 'string' },
                proposedTitle: { type: 'string' },
                error: { type: 'string' },
              },
            },
          },
          message: { type: 'string' },
        },
      },
      render: (_args, value) => [{ type: 'text', text: value.message }],
    },
    async execute(args, exec) {
      const limit = args?.limit ?? 200
      if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
        throw new Error('session-naming: limit 必须是 1-500 的整数')
      }
      const entries = scanProjectionEntries(dshHome(), limit)
      const plan = proposeBackfill(entries)
      if (args?.apply !== true) {
        return {
          scanned: entries.length,
          proposals: plan.proposals,
          skipped: plan.skipped,
          applied: 0,
          failed: [],
          message: `扫描 ${entries.length} 条，生成 ${plan.proposals.length} 条建议，跳过 ${plan.skipped.length} 条；未写任何会话（apply=false）。`,
        }
      }

      const controller = ctx.get('sessionController')
      if (controller === undefined) {
        throw new Error('session-naming: session_title_backfill 需要 sessionController 服务')
      }
      let applied = 0
      const failed = []
      for (const item of plan.proposals) {
        if (exec?.signal?.aborted) break
        try {
          await controller.rename({ sessionId: item.sessionId, title: item.proposedTitle })
          applied += 1
        } catch (error) {
          failed.push({
            sessionId: item.sessionId,
            proposedTitle: item.proposedTitle,
            error: error instanceof Error ? error.message : String(error),
          })
        }
      }
      return {
        scanned: entries.length,
        proposals: plan.proposals,
        skipped: plan.skipped,
        applied,
        failed,
        message: `扫描 ${entries.length} 条，生成 ${plan.proposals.length} 条建议；已应用 ${applied} 条，失败 ${failed.length} 条。`,
      }
    },
  }
}
