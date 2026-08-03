import { describe, it, expect } from 'vitest'
import { sma, ema, rsi, atr, obv, bollinger } from './indicators'
import type { Candle } from '../data/types'

const c = (o: number, h: number, l: number, cl: number, v = 100): Candle =>
  ({ time: 0, open: o, high: h, low: l, close: cl, volume: v })

describe('sma', () => {
  it('워밍업 구간은 NaN이고 이후 단순평균이다', () => {
    const out = sma([1, 2, 3, 4, 5], 3)
    expect(out.length).toBe(5)
    expect(out[0]).toBeNaN()
    expect(out[1]).toBeNaN()
    expect(out[2]).toBeCloseTo(2)
    expect(out[3]).toBeCloseTo(3)
    expect(out[4]).toBeCloseTo(4)
  })
})

describe('ema', () => {
  it('첫 유효값은 SMA이고 이후 지수평활한다', () => {
    const out = ema([1, 2, 3, 4, 5], 3)
    expect(out[2]).toBeCloseTo(2)
    // k = 2/(3+1) = 0.5 → 4*0.5 + 2*0.5 = 3
    expect(out[3]).toBeCloseTo(3)
    expect(out[4]).toBeCloseTo(4)
  })
})

describe('rsi', () => {
  it('연속 상승이면 100에 수렴한다', () => {
    const rising = Array.from({ length: 30 }, (_, i) => 100 + i)
    const out = rsi(rising, 14)
    expect(out[29]).toBeCloseTo(100, 0)
  })

  it('연속 하락이면 0에 수렴한다', () => {
    const falling = Array.from({ length: 30 }, (_, i) => 100 - i)
    const out = rsi(falling, 14)
    expect(out[29]).toBeCloseTo(0, 0)
  })
})

describe('atr', () => {
  it('일정한 레인지면 그 레인지값이 된다', () => {
    const cs = Array.from({ length: 30 }, () => c(100, 105, 95, 100))
    const out = atr(cs, 14)
    expect(out[29]).toBeCloseTo(10)
  })
})

describe('obv', () => {
  it('종가 상승 시 거래량을 더하고 하락 시 뺀다', () => {
    const out = obv([c(1, 1, 1, 10, 100), c(1, 1, 1, 11, 50), c(1, 1, 1, 9, 30)])
    expect(out[0]).toBe(0)
    expect(out[1]).toBe(50)
    expect(out[2]).toBe(20)
  })
})

describe('bollinger', () => {
  it('변동이 없으면 상하단이 중심선과 같다', () => {
    const flat = Array.from({ length: 25 }, () => 100)
    const out = bollinger(flat, 20, 2)
    expect(out.mid[24]).toBeCloseTo(100)
    expect(out.upper[24]).toBeCloseTo(100)
    expect(out.lower[24]).toBeCloseTo(100)
  })
})

// ── Task 13 Group A: RSI Wilder 재귀 검증 ──
//
// 기존 두 RSI 테스트는 연속 상승/연속 하락이라 avgLoss===0 / avgGain===0 축퇴 분기(상수
// 100 또는 0 반환)만 탄다. Wilder 재귀식 avgGain = (avgGain*(period-1)+gain)/period 를
// 전혀 행사하지 못한다. 아래는 혼합 등락 시퀀스에 대해 그 재귀식을 task-4-brief.md의
// 규칙표 그대로 독립적으로 손으로(스크립트로) 재계산한 값이다 — src/analysis/indicators.ts
// 의 rsi()를 호출해서 나온 값을 베낀 게 아니라, 문서화된 공식을 별도로 다시 구현해
// 대조했다 (evidence: task-13-report.md 참고).
//
// closes[0..18] (period=14, 델타 시퀀스 1,-1,2,-1,1,2,-2,1,-1,2,1,-2,1,2,-1,2,-1,1):
//   avgGain[14]=0.9285714286, avgLoss[14]=0.5 → RSI[14] = 100-100/(1+0.9285714286/0.5) = 65
//   그 다음 avgGain/avgLoss를 Wilder 가중치로 갱신하며 RSI[15..18] 을 재계산.
describe('rsi — Wilder 재귀 (혼합 등락)', () => {
  const deltas = [1, -1, 2, -1, 1, 2, -2, 1, -1, 2, 1, -2, 1, 2, -1, 2, -1, 1]
  const closes: number[] = [100]
  for (const d of deltas) closes.push(closes[closes.length - 1] + d)
  // closes = [100,101,100,102,101,102,104,102,103,102,104,105,103,104,106,105,107,106,107]
  const out = rsi(closes, 14)

  it('최초 유효 인덱스(period=14)에서 재귀 시작값이 규칙표 공식과 일치한다', () => {
    // avgGain = 0.9285714285714286, avgLoss = 0.5 (14개 델타의 단순평균)
    // RSI = 100 - 100/(1+avgGain/avgLoss) = 65
    expect(out[14]).toBeCloseTo(65, 2)
  })

  it('그 다음 3개 인덱스에서 Wilder 가중 재귀가 적용된다', () => {
    // 손으로 재귀 공식을 그대로 다시 계산한 값 (구현 출력 복사 아님, task-13-report.md에 유도 과정 기록)
    expect(out[15]).toBeCloseTo(61.678832, 2)
    expect(out[16]).toBeCloseTo(65.477997, 2)
    expect(out[17]).toBeCloseTo(62.159716, 2)
  })

  it('가중치를 (period-1)/period 대신 단순평균으로 바꾸면 이 값들과 어긋난다 (재귀 검증 증거)', () => {
    // 이 테스트 자체는 항상 통과해야 하는 게 아니라, 위 toBeCloseTo 값들이 축퇴값(0/100)이
    // 아니라 실제로 재귀식에 민감한 값임을 문서화하는 주석 대용 단언이다.
    expect(out[14]).not.toBe(100)
    expect(out[14]).not.toBe(0)
    expect(out[18]).not.toBe(100)
    expect(out[18]).not.toBe(0)
  })
})
