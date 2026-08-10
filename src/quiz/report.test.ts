import { describe, it, expect } from 'vitest'
import { toMarkdown } from './report'
import { grade } from './grader'
import type { Question, Answer } from './types'
import { mk } from '../analysis/fixtures'

const q: Question = {
  symbol: 'BTCUSDT', timeframe: '4h', startTime: 1700000000, decisionIndex: 199,
  type: 'no_setup', difficulty: 'medium',
  candles: Array.from({ length: 260 }, (_, i) => mk(100, 100.5, 99.5, 100, 100, i)),
}
const a: Answer = { direction: 'flat', tags: [] }

describe('마크다운 리포트', () => {
  it('종목과 점수와 판정을 담는다', () => {
    const md = toMarkdown(q, a, grade(q, a))
    expect(md).toContain('BTCUSDT')
    expect(md).toContain('4h')
    expect(md).toMatch(/프로세스/)
    expect(md).toMatch(/결과/)
  })

  it('태그를 한국어 라벨로 보여준다', () => {
    const withTag: Answer = { direction: 'flat', tags: ['ob_bull_support'] }
    const md = toMarkdown(q, withTag, grade(q, withTag))
    expect(md).toContain('강세 오더블록 지지')
  })

  it('알 수 없는 태그도 id 로라도 보여준다', () => {
    const withTag: Answer = { direction: 'flat', tags: ['모르는_태그'] }
    const md = toMarkdown(q, withTag, grade(q, withTag))
    expect(md).toContain('모르는_태그')
  })
})
