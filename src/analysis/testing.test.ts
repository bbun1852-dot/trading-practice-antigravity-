import { describe, it, expect } from 'vitest'
import { assertNoLookAhead } from './testing'
import { synthCandles } from './fixtures'
import type { Signal, Detector } from './signalTypes'

const clean: Detector = (cs) =>
  cs.map((c, i) => (c.close > c.open
    ? { id: 'up', tier: 4, kind: 'candle', side: 'bullish', barIndex: i,
        confidence: 'A', strength: 1, evidence: 'green' } as Signal
    : null))
    .filter((s): s is Signal => s !== null)

/** 다음 봉을 보고 판단하므로 look-ahead 위반이다 */
const cheating: Detector = (cs) => {
  const out: Signal[] = []
  for (let i = 0; i < cs.length - 1; i++) {
    if (cs[i + 1].close > cs[i].close) {
      out.push({ id: 'peek', tier: 4, kind: 'candle', side: 'bullish', barIndex: i,
        confidence: 'A', strength: 1, evidence: 'peeked' })
    }
  }
  return out
}

describe('assertNoLookAhead', () => {
  const candles = synthCandles(220)

  it('정직한 감지기는 통과시킨다', () => {
    expect(() => assertNoLookAhead(clean, candles)).not.toThrow()
  })

  it('미래를 참조하는 감지기는 잡아낸다', () => {
    expect(() => assertNoLookAhead(cheating, candles)).toThrow(/look-ahead/i)
  })
})
