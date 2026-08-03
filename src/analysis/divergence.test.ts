import { describe, it, expect } from 'vitest'
import { detectDivergence } from './divergence'
import { assertNoLookAhead } from './testing'
import { synthCandles, mk } from './fixtures'
import type { Candle } from '../data/types'

/**
 * 급락 후 저점을 낮추지만 하락 강도는 약해지는 구간 → 강세 다이버전스
 *
 * 브리프 원안(40/10/12/8봉, 하락폭 3/2/0.4/1.5)은 두 번째 하락(구간 3)의 하락폭이
 * 너무 작아 첫 번째 저점(≈79)을 전혀 하회하지 못했다 (실측: 저점이 79→94.6로 오히려
 * "상승"). 가격 저점이 낮아지지 않으므로 rsi_bull_div 의 priceUp:false 조건이 절대
 * 참이 될 수 없어, 이 픽스처는 수학적으로 강세 다이버전스를 낼 수 없었다 — 캔들 데이터만
 * 교정했다 (구간 길이 30/10/14/8, 하락폭 3/2/2.5/1.5). 두 번째 하락은 갚음(반등)보다
 * 더 크게 내려가 실제로 저점을 하회하되(109.0→94.0), 하락 도중 직전 반등에서 남은
 * avgGain 이 완전히 소진되지 않아 RSI 는 0→14.886 로 "저점이 높아진다".
 * 계산 근거는 task-10-report.md 에 원본/픽스처 양쪽 pivot·RSI 표로 남겨둔다.
 */
function bullDivSeries(): Candle[] {
  const cs: Candle[] = []
  let p = 200
  for (let i = 0; i < 30; i++) { p -= 3; cs.push(mk(p + 3, p + 3.5, p - 1, p, 100, i)) }         // 급락
  for (let i = 30; i < 40; i++) { p += 2; cs.push(mk(p - 2, p + 0.5, p - 2.5, p, 100, i)) }       // 반등
  for (let i = 40; i < 54; i++) { p -= 2.5; cs.push(mk(p + 2.5, p + 2.9, p - 1, p, 100, i)) }     // 두 번째 하락 (첫 저점을 실제로 하회)
  for (let i = 54; i < 62; i++) { p += 1.5; cs.push(mk(p - 1.5, p + 0.5, p - 2, p, 100, i)) }     // 회복
  return cs
}

describe('detectDivergence', () => {
  it('가격 저점은 낮아지고 RSI 저점은 높아지면 강세 다이버전스를 낸다', () => {
    const sigs = detectDivergence(bullDivSeries())
    expect(sigs.some((s) => s.id === 'rsi_bull_div')).toBe(true)
  })

  it('신호의 evidence에 실제 수치를 담는다', () => {
    const s = detectDivergence(bullDivSeries()).find((x) => x.id === 'rsi_bull_div')
    expect(s?.evidence).toMatch(/RSI/)
  })

  it('look-ahead를 위반하지 않는다', () => {
    assertNoLookAhead(detectDivergence, synthCandles(220))
  })
})

// ── Task 13 Group D: rsi_bear_div · rsi_hidden_div · macd_divergence · obv_divergence ──
//
// 아래 픽스처들은 모두 task-10-brief.md 규칙표의 조건(가격/지표 방향 조합)을 먼저
// 독립적으로(re-implementation 스크립트로) 만족시키는지 확인한 뒤 옮겨 적었다 — 구현의
// detectDivergence() 출력을 베낀 게 아니다. 유도 과정과 스크립트 출력은 task-13-report.md에
// 남겨둔다. rsi_bull_div 픽스처가 이미 한 번 결함이 있었던 전례(task-10-report.md)를 따라,
// 각 픽스처는 findPivots/rsi/macd/obv 값을 직접 재계산해 피벗 위치와 방향을 먼저 확인했다.

type Seg = { n: number; step: number }

/** step 부호가 바뀔 때 low/high가 직전 봉과 우연히 같아져(동률) 피벗이 깨지는 걸
 * 피하려고, 마진을 step 크기에 비례시켜 각 구간 내내 단조성을 유지한다. */
function buildFromSegments(segments: Seg[], startPrice: number, padBase: number): Candle[] {
  const cs: Candle[] = []
  let p = startPrice
  let i = 0
  for (const seg of segments) {
    for (let k = 0; k < seg.n; k++) {
      p += seg.step
      const o = p - seg.step
      const pad = Math.abs(seg.step) * 0.1 + padBase
      cs.push(mk(o, Math.max(o, p) + pad, Math.min(o, p) - pad, p, 100, i))
      i++
    }
  }
  return cs
}

describe('detectDivergence — rsi_bear_div', () => {
  // 급등(고점 RSI 100) → 되돌림 → 신고점 141→156 갱신하되 RSI는 100→85.1로 낮아짐.
  // pivotBar 29→53 (gap 24, 규칙 [5,60] 이내). barIndex = 53+2 = 55.
  function series(): Candle[] {
    const cs: Candle[] = []
    let p = 50
    for (let i = 0; i < 30; i++) { p += 3; cs.push(mk(p - 3, p + 1, p - 3.5, p, 100, i)) }
    for (let i = 30; i < 40; i++) { p -= 2; cs.push(mk(p + 2, p + 2.5, p - 0.5, p, 100, i)) }
    for (let i = 40; i < 54; i++) { p += 2.5; cs.push(mk(p - 2.5, p + 1, p - 2.9, p, 100, i)) }
    for (let i = 54; i < 62; i++) { p -= 1.5; cs.push(mk(p + 2, p + 0.5, p - 1.5, p, 100, i)) }
    return cs
  }

  // 두 번째 상승 구간을 14봉→8봉으로 줄여 두 번째 고점이 141로, 첫 고점(141)을
  // 근소하게도 넘지 못하게(동률) 만든 음성 픽스처. RSI는 여전히 100→76.7로 떨어지지만
  // 가격이 신고점을 갱신하지 못하므로 발생하면 안 된다.
  function seriesNoNewHigh(): Candle[] {
    const cs: Candle[] = []
    let p = 50
    for (let i = 0; i < 30; i++) { p += 3; cs.push(mk(p - 3, p + 1, p - 3.5, p, 100, i)) }
    for (let i = 30; i < 40; i++) { p -= 2; cs.push(mk(p + 2, p + 2.5, p - 0.5, p, 100, i)) }
    for (let i = 40; i < 48; i++) { p += 2.5; cs.push(mk(p - 2.5, p + 1, p - 2.9, p, 100, i)) }
    for (let i = 48; i < 56; i++) { p -= 1.5; cs.push(mk(p + 2, p + 0.5, p - 1.5, p, 100, i)) }
    return cs
  }

  it('가격 고점은 높아지고 RSI 고점은 낮아지면 발생한다', () => {
    const sigs = detectDivergence(series())
    const s = sigs.find((x) => x.id === 'rsi_bear_div')
    expect(s).toBeDefined()
    expect(s!.barIndex).toBe(55)
    expect(s!.side).toBe('bearish')
  })

  it('두 번째 고점이 첫 고점을 갱신하지 못하면(동률) RSI가 낮아져도 발생하지 않는다', () => {
    expect(detectDivergence(seriesNoNewHigh()).some((x) => x.id === 'rsi_bear_div')).toBe(false)
  })
})

describe('detectDivergence — rsi_hidden_div (일반 강세 다이버전스의 복붙이 아니다)', () => {
  // pivotKind는 'low'지만 rsi_bull_div와 정반대 조합: 가격은 저점을 높이는데(195.95→197.7)
  // RSI는 오히려 낮아진다(45.77→27.28) — 상승추세 지속 신호. pivotBar 19→49 (gap 30).
  const positive = buildFromSegments(
    [{ n: 14, step: 0.1 }, { n: 5, step: -1 }, { n: 25, step: 2.5 }, { n: 6, step: -10 }, { n: 8, step: 1 }],
    200, 0.2,
  )
  // 세 번째 구간(급락) 크기를 -10 → -4로 줄이면 가격은 여전히 저점을 높이지만
  // (195.95→234.3) RSI도 45.77→48.08로 함께 높아져 "RSI 저점 하락" 조건이 깨진다.
  const negative = buildFromSegments(
    [{ n: 14, step: 0.1 }, { n: 5, step: -1 }, { n: 25, step: 2.5 }, { n: 6, step: -4 }, { n: 8, step: 1 }],
    200, 0.2,
  )

  it('가격 저점은 높아지고(HL) RSI 저점은 낮아지면 발생한다', () => {
    const sigs = detectDivergence(positive)
    const s = sigs.find((x) => x.id === 'rsi_hidden_div')
    expect(s).toBeDefined()
    expect(s!.barIndex).toBe(51)
    expect(s!.side).toBe('bullish')
  })

  it('일반 강세 다이버전스(rsi_bull_div)와 다른 조건이다 — 가격이 오르는 픽스처이므로 bull_div는 나오지 않는다', () => {
    const sigs = detectDivergence(positive)
    expect(sigs.some((x) => x.id === 'rsi_bull_div')).toBe(false)
    expect(sigs.some((x) => x.id === 'rsi_hidden_div')).toBe(true)
  })

  it('RSI 저점이 같이 높아지면(하락하지 않으면) 가격 저점이 높아져도 발생하지 않는다', () => {
    expect(detectDivergence(negative).some((x) => x.id === 'rsi_hidden_div')).toBe(false)
  })
})

describe('detectDivergence — macd_divergence', () => {
  // 40봉 하락(직선, 매물 소진으로 histogram이 정확히 0에 수렴) → 10봉 반등 →
  // 10봉 재하락(기울기 -2, 첫 하락의 -3보다 완만) → 가격은 179.4→174.5로 신저점을
  // 갱신하지만 히스토그램은 0→0.619로 오히려 높아진다. pivotBar 39→59 (gap 20).
  const positive = buildFromSegments(
    [{ n: 40, step: -3 }, { n: 10, step: 1.5 }, { n: 10, step: -2 }, { n: 8, step: 1 }],
    300, 0.3,
  )
  // 세 번째 구간 기울기를 -2 → -3으로, 즉 첫 하락과 "같은 강도"로 바꾸면 가격은
  // 여전히 신저점(164.4)을 갱신하지만 histogram도 0→-0.289로 같이 낮아진다.
  const negative = buildFromSegments(
    [{ n: 40, step: -3 }, { n: 10, step: 1.5 }, { n: 10, step: -3 }, { n: 8, step: 1 }],
    300, 0.3,
  )

  it('가격 저점은 낮아지고 MACD 히스토그램 저점은 높아지면 발생한다', () => {
    const sigs = detectDivergence(positive)
    const s = sigs.find((x) => x.id === 'macd_divergence')
    expect(s).toBeDefined()
    expect(s!.barIndex).toBe(61)
    expect(s!.side).toBe('bullish')
  })

  it('두 번째 하락이 첫 하락과 같은 기울기면(모멘텀이 약해지지 않으면) 발생하지 않는다', () => {
    expect(detectDivergence(negative).some((x) => x.id === 'macd_divergence')).toBe(false)
  })
})

describe('detectDivergence — obv_divergence', () => {
  // 12봉 하락(거래량 500, OBV -5500까지) → 5봉 반등(거래량 800) →
  // 12봉 재하락(거래량 50, 첫 하락보다 훨씬 적은 거래량, 기울기는 더 가파름) →
  // 가격은 263→239.6으로 신저점을 갱신하지만 거래량이 적어 OBV는 -5500→-2100으로
  // 오히려 높아진다(매도 압력 약화). pivotBar 11→28 (gap 17).
  function series(volC: number): Candle[] {
    const cs: Candle[] = []
    let p = 300
    for (let i = 0; i < 12; i++) { p -= 3; cs.push(mk(p + 3, p + 3.5, p - 1, p, 500, i)) }
    for (let i = 12; i < 17; i++) { p += 3; cs.push(mk(p - 3, p + 0.5, p - 3.5, p, 800, i)) }
    for (let i = 17; i < 29; i++) { p -= 3.2; cs.push(mk(p + 3.2, p + 3.7, p - 1, p, volC, i)) }
    for (let i = 29; i < 37; i++) { p += 1; cs.push(mk(p - 1, p + 0.5, p - 1.5, p, 100, i)) }
    return cs
  }

  it('가격 저점은 낮아지고 OBV 저점은 높아지면 발생한다', () => {
    const sigs = detectDivergence(series(50))
    const s = sigs.find((x) => x.id === 'obv_divergence')
    expect(s).toBeDefined()
    expect(s!.barIndex).toBe(30)
    expect(s!.side).toBe('bullish')
  })

  it('두 번째 하락의 거래량이 첫 하락과 같으면(매도 압력이 약해지지 않으면) 발생하지 않는다', () => {
    // 거래량을 50 → 500(첫 하락과 동일)으로 바꾸면 OBV가 -5500→-7500으로 더 낮아진다
    expect(detectDivergence(series(500)).some((x) => x.id === 'obv_divergence')).toBe(false)
  })
})
