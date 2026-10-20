import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEFAULT_MAX_TITLE_BYTES, TYPES, branchPrefix, composeTitle, ensureBranchPrefix,
  hasBranchPrefix, monthDayOf, normalizeGoal, normalizeSeq, normalizeType, oneLine, utf8Bytes,
} from '../lib/compose.js'

const createdAt = new Date(2026, 0, 5, 12, 0, 0).getTime()

test('TYPES covers the convention vocabulary', () => {
  assert.deepEqual(TYPES, ['分析', '规划', '实施', '排障', '审计', '查询', '整理', '复盘', 'AUTO'])
  assert.equal(DEFAULT_MAX_TITLE_BYTES, 80)
})

test('monthDayOf uses the session creation date, zero padded', () => {
  assert.equal(monthDayOf(new Date(2026, 0, 5, 23, 59).getTime()), '0105')
  assert.equal(monthDayOf(new Date(2026, 11, 31, 0, 1).getTime()), '1231')
})

test('monthDayOf rejects an unreadable timestamp instead of using today', () => {
  assert.throws(() => monthDayOf(undefined), /创建时间不可读/u)
  assert.throws(() => monthDayOf(Number.NaN), /创建时间不可读/u)
  assert.throws(() => monthDayOf('2026-01-05'), /创建时间不可读/u)
})

test('oneLine collapses whitespace and trims', () => {
  assert.equal(oneLine('  a\n\tb  '), 'a b')
  assert.equal(oneLine(undefined), '')
})

test('normalizeType accepts only the vocabulary', () => {
  assert.equal(normalizeType(' 查询 '), '查询')
  assert.equal(normalizeType('AUTO'), 'AUTO')
  assert.throws(() => normalizeType(''), /缺少类型/u)
  assert.throws(() => normalizeType('修复'), /不在规范词表内/u)
})

test('normalizeGoal rejects empty goals and separator injection', () => {
  assert.equal(normalizeGoal('  看看实现  '), '看看实现')
  assert.throws(() => normalizeGoal('   '), /目标不能为空/u)
  assert.throws(() => normalizeGoal('A｜B'), /不要再写分隔符/u)
})

test('normalizeSeq accepts 1-99 only', () => {
  assert.equal(normalizeSeq(undefined), undefined)
  assert.equal(normalizeSeq(null), undefined)
  assert.equal(normalizeSeq(1), 1)
  assert.equal(normalizeSeq(99), 99)
  for (const bad of [0, 100, 1.5, '2']) {
    assert.throws(() => normalizeSeq(bad), /1-99/u)
  }
})

test('branch prefix helpers never duplicate the label', () => {
  assert.equal(branchPrefix(), 'Branch｜')
  assert.equal(ensureBranchPrefix('0105｜查询｜主题', true), 'Branch｜0105｜查询｜主题')
  assert.equal(ensureBranchPrefix('Branch｜0105｜查询｜主题', true), 'Branch｜0105｜查询｜主题')
  assert.equal(ensureBranchPrefix('0105｜查询｜主题', false), '0105｜查询｜主题')
  assert.equal(hasBranchPrefix('Branch｜0105｜查询｜主题'), true)
  assert.equal(hasBranchPrefix('0105｜查询｜主题'), false)
})

test('composeTitle builds the ordinary title from the creation date', () => {
  const title = composeTitle({ type: '查询', goal: '看看实现' }, createdAt, 80)
  assert.equal(title, '0105｜查询｜看看实现')
  assert.equal(utf8Bytes(title) <= 80, true)
})

test('composeTitle adds the branch prefix when requested', () => {
  assert.equal(
    composeTitle({ type: '实施', goal: '迁移插件', branch: true }, createdAt, 80),
    'Branch｜0105｜实施｜迁移插件',
  )
})

test('composeTitle appends the automation run index', () => {
  assert.equal(
    composeTitle({ type: 'AUTO', goal: '每日巡检', seq: 2 }, createdAt, 80),
    '0105｜AUTO｜每日巡检-02',
  )
})

test('composeTitle reports the available goal budget when over the limit', () => {
  const goal = '很长的目标'.repeat(12)
  assert.throws(
    () => composeTitle({ type: '分析', goal }, createdAt, 40),
    (error) => /超过上限 40 字节/u.test(error.message) && /请把目标压缩到 \d+ 字节以内/u.test(error.message),
  )
})

test('composeTitle measures UTF-8 bytes, not characters', () => {
  // 12 CJK characters = 36 bytes plus "0105｜分析｜" = 15 bytes → 51 > 50.
  const goal = '汉'.repeat(12)
  assert.throws(() => composeTitle({ type: '分析', goal }, createdAt, 50), /超过上限 50 字节/u)
})
