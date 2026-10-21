/**
 * dsh-session-naming / branch.js
 *
 * Fork detection shared by the agent tools and the automatic normalizer.
 *
 * The Web GUI creates a fork child with `parent title (1)` and records it as a
 * `source.kind = "user"` title, which looks exactly like a human rename. Two
 * independent pieces of evidence distinguish the inherited title:
 *   1. stripping `(n)` yields the parent's current title;
 *   2. it is the first title event in the branch, with no human `messageSeqs`.
 *
 * Subagent sessions also carry `isSeeded`/`inheritedEventCount`, so
 * `header.origin === "subagent"` always wins: subagents are neither forks nor
 * inherited titles.
 *
 * This module is read-only. It reads the projection cache for the parent title
 * and the session's own event log; it never writes DSH data files.
 *
 * @module dsh-session-naming/branch
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { oneLine } from './compose.js'

/** DSH home, used only to read existing session projections. */
export function dshHome() {
  const fromEnv = process.env.DSH_HOME
  return typeof fromEnv === 'string' && fromEnv !== '' ? fromEnv : join(homedir(), '.dsh')
}

/** Read a session's current title from the read-only projection cache. */
export function titleFromProjectionCache(sessionId) {
  try {
    const path = join(dshHome(), 'storages', 'session_projcache', 'sessions', `${sessionId}.json`)
    const record = JSON.parse(readFileSync(path, 'utf8'))
    const title = record?.record?.rows?.title?.val
    return typeof title === 'string' ? title : undefined
  } catch {
    return undefined
  }
}

/** Remove a fork index suffix: `parent (1)` / `parent（2）` → `parent`. */
export function forkTitleBase(title) {
  const text = oneLine(title)
  const matched = /^(?<base>.*?)\s*[（(]\d+[)）]$/u.exec(text)
  return matched?.groups?.base === undefined ? text : matched.groups.base.trim()
}

/** First title event in the session log (written by the GUI when forking). */
export function firstTitleEvent(session) {
  try {
    const events = typeof session?.snapshotEvents === 'function' ? session.snapshotEvents() : []
    return events.find((event) => event?.type === 'session/title')
  } catch {
    return undefined
  }
}

/**
 * Whether the current title is only the inherited fork title.
 * @param session - target session (must carry `header.parentSession`).
 * @param previous - current title snapshot.
 * @returns true when the title may be replaced by the convention title.
 */
export function isInheritedForkTitle(session, previous) {
  if (session?.header?.origin === 'subagent') return false
  const parentId = session?.header?.parentSession
  if (typeof parentId !== 'string' || parentId === '') return false
  const text = oneLine(previous?.title)
  const ordinal = forkTitleBase(text) !== text
  // The Host appends ` (1)` to every inherited fork title. Without that
  // ordinal the title cannot be distinguished from a human rename, so preserve
  // it instead of guessing.
  if (!ordinal) return false
  const parentTitle = titleFromProjectionCache(parentId)
  if (typeof parentTitle === 'string' && oneLine(parentTitle) !== ''
    && forkTitleBase(text) === oneLine(parentTitle)) {
    return true
  }
  const first = firstTitleEvent(session)
  return first?.data?.title === text && (first?.data?.messageSeqs?.length ?? 0) === 0
}

/**
 * Whether the session is a branch (fork).
 *
 * Subagents also carry `isSeeded`/`inheritedEventCount`, so
 * `header.origin === "subagent"` wins first; non-subagent sessions with fork
 * evidence are marked by the sidebar badge, not by a title prefix.
 */
export function isBranchSession(session) {
  const header = session?.header
  if (header?.origin === 'subagent') return false
  if (typeof header?.parentSession === 'string' && header.parentSession !== '') return true
  if (header?.isSeeded === true) return true
  const inherited = session?.inheritedEventCount
  return typeof inherited === 'number' && inherited > 0
}

/**
 * Read whether a session is a branch from its projection cache.
 * @returns `true`/`false`, or `undefined` when the cache is unreadable (never guess).
 */
export function branchFromProjectionCache(sessionId) {
  try {
    const path = join(dshHome(), 'storages', 'session_projcache', 'sessions', `${sessionId}.json`)
    const record = JSON.parse(readFileSync(path, 'utf8'))
    const identity = record?.record?.identity
    if (identity === undefined) return undefined
    if (typeof identity.isSeeded === 'boolean') {
      return identity.isSeeded || (identity.inheritedEventCount ?? 0) > 0
    }
    return undefined
  } catch {
    return undefined
  }
}
