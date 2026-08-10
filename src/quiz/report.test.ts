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

describe('헤더 줄이 채점 결과와 어긋나지 않는다', () => {
  it('관망에는 손익을 적지 않는다 — replay 가 null 이 아니라 NONE 센티넬이다', () => {
    // grade() 는 관망을 orderValid=true 로 보므로 r.replay 가 null 이 아니다.
    // exit:'none' / r:0 을 그대로 찍으면 헤더가 "none 0.00R" 이 되어, 바로 아래
    // judgement 의 "체결도 손익도 없습니다" 와 같은 문서 안에서 충돌한다.
    const r = grade(q, a)
    expect(r.replay).not.toBeNull()
    const md = toMarkdown(q, a, r)
    expect(md).not.toMatch(/0\.00R/)
    expect(md).toContain('관망')
  })

  it('관망 점수에 분모를 적는다 — 60점 만점 환산이라 세 수의 합이 맞지 않는다', () => {
    const r = grade(q, a)
    expect(r.applicableMax).toBe(60)   // 전제: 관망이면 실행 축이 판정에서 빠진다
    expect(r.processScore + r.outcomeScore).not.toBe(r.totalScore)
    const md = toMarkdown(q, a, r)
    expect(md).toContain(`프로세스 ${r.processScore}/${r.processMax}`)
    expect(md).toContain(`결과 ${r.outcomeScore}/30`)
    expect(md).toContain(`총 ${r.totalScore}/100`)
    expect(md).toContain('60점 만점 환산')
  })

  it('가격을 소수 둘째 자리까지 반올림해 적는다 — 부동소수 노이즈를 그대로 흘리지 않는다', () => {
    const noisy: Answer = {
      direction: 'long', entry: 71408.9, stopLoss: 69266.63299999999, takeProfit: 75693.434, tags: [],
    }
    const md = toMarkdown(q, noisy, grade(q, noisy))
    expect(md).toContain('진입 71408.90 / 손절 69266.63 / 익절 75693.43')
    expect(md).not.toContain('69266.63299999999')
  })

  it('익절가·손절가가 없으면 자리를 비운다 — undefined 를 찍지 않는다', () => {
    const partial: Answer = { direction: 'long', entry: 100, tags: [] }
    const md = toMarkdown(q, partial, grade(q, partial))
    expect(md).toContain('진입 100.00 / 손절 - / 익절 -')
    expect(md).not.toContain('undefined')
  })

  it('진입 답안은 체결 결과를 그대로 적고 환산 주석을 붙이지 않는다', () => {
    const entered: Answer = { direction: 'long', entry: 100, stopLoss: 99, takeProfit: 103, tags: [] }
    const r = grade(q, entered)
    expect(r.applicableMax).toBe(100)
    const md = toMarkdown(q, entered, r)
    expect(md).toContain(`총 ${r.totalScore}/100`)
    expect(md).not.toContain('만점 환산')
    expect(md).toContain('forced')
  })
})
