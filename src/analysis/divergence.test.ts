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
