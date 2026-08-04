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

/** 아무 신호도 안 낸다 — 검증이 공허해지는 경우다. */
const empty: Detector = () => []

/**
 * 전체 실행에서는 bar 5에 같은 키의 신호를 2개 배출하지만, 0..5로 자른 실행에서는
 * (candles.length 가 딱 6일 때만) 1개만 배출한다. "같은 키를 전체 실행에서 2번,
 * 잘린 실행에서 1번 배출" 공격을 재현한다.
 */
const duplicateKeyCheat: Detector = (cs) => {
  const targetBar = 5
  if (cs.length <= targetBar) return []
  const count = cs.length > targetBar + 1 ? 2 : 1
  const out: Signal[] = []
  for (let j = 0; j < count; j++) {
    out.push({ id: 'dup', tier: 4, kind: 'candle', side: 'bullish', barIndex: targetBar,
      confidence: 'A', strength: 1, evidence: 'dup' })
  }
  return out
}

/**
 * barIndex 는 정직하지만, tier 를 다음 봉의 결과로 계산한다 (미래 결과로 4→1 상향해
 * 점수 가중치를 뻥튀기하는 공격). 옛 key가 tier를 포함하지 않았을 때 이 공격이 통과했다 —
 * 넓힌 key가 이걸 잡는지 증명한다.
 */
const futureTierCheat: Detector = (cs) => {
  const out: Signal[] = []
  for (let i = 0; i < cs.length; i++) {
    const canPeek = i + 1 < cs.length
    const tier = canPeek && cs[i + 1].close > cs[i].close ? 1 : 4
    out.push({ id: 'tierpeek', tier, kind: 'candle', side: 'bullish', barIndex: i,
      confidence: 'A', strength: 1, evidence: 'stable' } as Signal)
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

  it('아무 신호도 안 내는 감지기는 공허성 가드에 걸린다', () => {
    expect(() => assertNoLookAhead(empty, candles)).toThrow(/look-ahead/i)
  })

  it('전체에서 중복 키, 잘린 실행에서 1개만 나오면 잡아낸다', () => {
    expect(() => assertNoLookAhead(duplicateKeyCheat, candles)).toThrow(/look-ahead/i)
  })

  it('tier를 미래 봉으로 계산하는 감지기를 잡아낸다 (넓힌 키 검증)', () => {
    expect(() => assertNoLookAhead(futureTierCheat, candles)).toThrow(/look-ahead/i)
  })
})
