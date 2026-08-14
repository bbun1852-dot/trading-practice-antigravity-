import { describe, it, expect } from 'vitest'
import { detectFVG, detectOrderBlocks } from './smc'
import { assertNoLookAhead } from './testing'
import { synthCandles, mk } from './fixtures'
import { detectLiquiditySweep, detectMSB } from './smc'
import type { Candle } from '../data/types'

describe('detectFVG', () => {
  it('상승 갭을 잡고 갭 구간을 refs에 담는다', () => {
    // i=2의 저가(15)가 i=0의 고가(10)보다 위 → 상승 FVG [10, 15]
    const cs = [mk(8, 10, 7, 9), mk(9, 16, 9, 15), mk(15, 20, 15, 19), mk(19, 21, 18, 20)]
    const sigs = detectFVG(cs)
    const bull = sigs.find((s) => s.id === 'fvg_bull')
    expect(bull).toBeDefined()
    expect(bull!.barIndex).toBe(2)
    expect(bull!.refs).toMatchObject({ priceLow: 10, priceHigh: 15 })
  })

  it('이후 가격이 갭을 메우면 신호를 내지 않는다', () => {
    const cs = [mk(8, 10, 7, 9), mk(9, 16, 9, 15), mk(15, 20, 15, 19), mk(19, 20, 9, 10)]
    expect(detectFVG(cs).some((s) => s.id === 'fvg_bull')).toBe(false)
  })

  it('look-ahead를 위반하지 않는다', () => {
    assertNoLookAhead(detectFVG, synthCandles(220))
  })
})

describe('detectOrderBlocks', () => {
  it('상승 임펄스 직전 음봉을 강세 오더블록으로 잡는다', () => {
    const flat = Array.from({ length: 20 }, (_, i) => mk(100, 101, 99, 100, 100, i))
    const cs = [
      ...flat,
      mk(100, 100.5, 98, 98.5, 100, 20),   // 20: 음봉 = OB 후보
      mk(98.5, 106, 98, 105, 300, 21),     // 21: 강한 상승 돌파
      mk(105, 107, 104, 106, 200, 22),
    ]
    const sigs = detectOrderBlocks(cs)
    const ob = sigs.find((s) => s.id === 'ob_bull_support')
    expect(ob).toBeDefined()
    expect(ob!.barIndex).toBe(21)
    expect(ob!.refs?.pivotBar).toBe(20)
  })

  it('look-ahead를 위반하지 않는다', () => {
    assertNoLookAhead(detectOrderBlocks, synthCandles(220))
  })

  // ── F3 회귀: 같은 확정 봉에서 겹치는 오더블록이 중복 계상되던 결함.
  // 실측(리뷰어): 108봉에서 105/106/107 유래 ob_bull_support 3개가 각각
  // 99.99–101.56 / 99.98–101.79 / 98.90–100.72 구간으로 동시 발화. 아래는 같은
  // 형태를 최소 픽스처로 재현한다 — ATR/OHLC를 직접 재계산해 격리 검증했다(보고서 참고).
  describe('회귀: 겹치는 오더블록은 하나로 병합된다 (F3)', () => {
    function overlapFixture(): Candle[] {
      const flat = Array.from({ length: 20 }, (_, i) => mk(100, 101, 99, 100, 100, i))
      return [
        ...flat,
        mk(100, 100.5, 99.5, 99.7, 100, 20),   // i=20: 음봉, 구간 [99.5,100.5]
        mk(99.7, 100.3, 99.3, 99.4, 100, 21),  // i=21: 음봉, 구간 [99.3,100.3] (20과 겹침)
        mk(99.4, 100.1, 98.9, 99.0, 100, 22),  // i=22: 음봉, 구간 [98.9,100.1] (21과 겹침)
        mk(99.0, 115, 99, 112, 300, 23),       // i=23: 셋 모두를 동시에 확정시키는 임펄스
      ]
    }

    it('겹치는 OB 후보 3개가 있으면 신호 1개로 병합되고 구간은 합집합이다', () => {
      const sigs = detectOrderBlocks(overlapFixture())
      const obs = sigs.filter((s) => s.id === 'ob_bull_support' && s.barIndex === 23)
      expect(obs.length).toBe(1)
      expect(obs[0].refs?.priceLow).toBeCloseTo(98.9, 6)
      expect(obs[0].refs?.priceHigh).toBeCloseTo(100.5, 6)
    })

    function nonOverlapFixture(): Candle[] {
      const flat = Array.from({ length: 20 }, (_, i) => mk(100, 101, 99, 100, 100, i))
      return [
        ...flat,
        mk(100, 100.5, 99.5, 99.7, 100, 20),   // i=20: 음봉, 구간 [99.5,100.5]
        mk(90.5, 90.5, 89.5, 89.7, 100, 21),   // i=21: 음봉, 구간 [89.5,90.5] (20과 겹치지 않음)
        mk(89.7, 90.3, 89.5, 90.0, 100, 22),   // i=22: 전환용 양봉 (bull OB 후보 아님)
        mk(90.0, 132, 89, 130, 300, 23),       // i=23: 둘 다 동시에 확정시키는 임펄스
      ]
    }

    it('같은 봉에서 확정돼도 겹치지 않는 OB 2개는 병합되지 않고 그대로 2개 남는다', () => {
      const sigs = detectOrderBlocks(nonOverlapFixture())
      const obs = sigs.filter((s) => s.id === 'ob_bull_support' && s.barIndex === 23)
      expect(obs.length).toBe(2)
    })
  })
})

describe('detectLiquiditySweep', () => {
  it('스윙로우를 꼬리로 깨고 종가는 위에서 마감하면 저점 스윕이다', () => {
    const cs = [
      mk(100, 101, 99, 100, 100, 0), mk(100, 101, 99, 100, 100, 1),
      mk(100, 101, 95, 96, 100, 2),   // 2: 스윙로우 95
      mk(96, 101, 97, 100, 100, 3), mk(100, 102, 99, 101, 100, 4),
      mk(101, 102, 99, 100, 100, 5), mk(100, 101, 99, 100, 100, 6),
      mk(100, 101, 93, 99, 300, 7),   // 7: 95를 꼬리로 깨고 종가 복귀
    ]
    const sigs = detectLiquiditySweep(cs)
    const s = sigs.find((x) => x.id === 'liq_sweep_low')
    expect(s).toBeDefined()
    expect(s!.barIndex).toBe(7)
  })

  it('look-ahead를 위반하지 않는다', () => {
    assertNoLookAhead(detectLiquiditySweep, synthCandles(220))
  })
})

describe('detectMSB', () => {
  it('look-ahead를 위반하지 않는다', () => {
    assertNoLookAhead(detectMSB, synthCandles(220))
  })

  it('직전 스윙 하이를 종가로 돌파하면 첫 돌파이므로 choch(bullish) 를 낸다', () => {
    // 저점 → 고점(피벗) → 눌림 → 고점 돌파
    const cs = [
      ...Array.from({ length: 10 }, (_, i) => mk(100, 101, 99, 100, 100, i)),
      mk(100, 108, 100, 107, 100, 10),   // 스윙 하이 108
      ...Array.from({ length: 5 }, (_, i) => mk(107, 107.5, 103, 104, 100, 11 + i)),
      mk(104, 110, 104, 109.5, 100, 16), // 108 위로 종가 마감
    ]
    const ids = detectMSB(cs).map(s => s.id)
    expect(ids).toContain('choch')
  })
})

// ── Task 13 Group B: 하락 분기 보강 ──
// 규칙표(task-7-brief.md, task-8-brief.md)에서 직접 유도. 상승 대응 테스트를 거울로 뒤집는다.

describe('detectFVG — 하락 갭 (fvg_bear)', () => {
  it('하락 갭을 잡고 갭 구간을 refs에 담는다 (priceLow < priceHigh 확인 포함)', () => {
    // high[2]=14 < low[0]=18 → 하락 FVG, 갭 구간 [high[2]=14, low[0]=18]
    const cs = [mk(20, 21, 18, 19, 100, 0), mk(19, 19, 12, 13, 100, 1), mk(13, 14, 10, 11, 100, 2), mk(11, 12, 9, 10, 100, 3)]
    const sigs = detectFVG(cs)
    const bear = sigs.find((s) => s.id === 'fvg_bear')
    expect(bear).toBeDefined()
    expect(bear!.barIndex).toBe(2)
    expect(bear!.refs).toMatchObject({ priceLow: 14, priceHigh: 18 })
    // 규칙표: 갭 구간은 [high[i], low[i-2]] — 뒤집히지 않아야 한다
    expect(bear!.refs!.priceLow!).toBeLessThan(bear!.refs!.priceHigh!)
  })

  it('이후 가격이 하락 갭을 메우면 신호를 내지 않는다', () => {
    const cs = [mk(20, 21, 18, 19, 100, 0), mk(19, 19, 12, 13, 100, 1), mk(13, 14, 10, 11, 100, 2), mk(14, 17, 13, 15, 100, 3)]
    expect(detectFVG(cs).some((s) => s.id === 'fvg_bear')).toBe(false)
  })
})

describe('detectOrderBlocks — 하락 오더블록 (ob_bear_resistance)', () => {
  it('하락 임펄스 직전 양봉을 약세 오더블록으로 잡는다 (임펄스 = high[i] - close[j] >= 1.5*ATR)', () => {
    const flat = Array.from({ length: 20 }, (_, i) => mk(100, 101, 99, 100, 100, i))
    const cs = [
      ...flat,
      mk(100, 101.5, 100, 101.5, 100, 20), // 20: 양봉 = OB 후보 (ATR[20] ≈ 1.9643)
      mk(101.5, 102, 94, 95, 300, 21),     // 21: 임펄스 6.5 >= 1.5*1.9643 ≈ 2.946 → 발화
      mk(95, 96, 93, 94, 200, 22),
    ]
    const sigs = detectOrderBlocks(cs)
    const ob = sigs.find((s) => s.id === 'ob_bear_resistance')
    expect(ob).toBeDefined()
    expect(ob!.barIndex).toBe(21)
    expect(ob!.refs?.pivotBar).toBe(20)
  })

  it('임펄스가 1.5*ATR 를 아슬아슬하게 못 채우면 발화하지 않는다', () => {
    const flat = Array.from({ length: 20 }, (_, i) => mk(100, 101, 99, 100, 100, i))
    const cs = [
      ...flat,
      mk(100, 101.5, 100, 101.5, 100, 20), // 20: 동일 OB 후보, ATR[20] ≈ 1.9643, 임계값 ≈ 2.946
      mk(101.5, 102, 97, 98.6, 300, 21),   // 21: 임펄스 = 101.5-98.6 = 2.9 < 2.946 → 미발화
      mk(98.6, 101, 98, 100, 200, 22),     // 22: 종가 100 = low[20] → close<low 조건 자체가 거짓 (lookahead 윈도우 j=22도 미발화 확인)
    ]
    const sigs = detectOrderBlocks(cs)
    expect(sigs.some((s) => s.id === 'ob_bear_resistance')).toBe(false)
  })
})

describe('detectLiquiditySweep — 고점 스윕 (liq_sweep_high)', () => {
  it('스윙하이를 고가로 뚫고 종가는 아래로 복귀하면 고점 스윕이다', () => {
    const cs = [
      mk(100, 101, 99, 100, 100, 0), mk(100, 101, 99, 100, 100, 1),
      mk(100, 106, 99, 100, 100, 2),  // 2: 스윙하이 106
      mk(100, 104, 99, 100, 100, 3), mk(100, 102, 99, 101, 100, 4),
      mk(101, 102, 99, 100, 100, 5), mk(100, 101, 99, 100, 100, 6),
      mk(100, 110, 99, 101, 300, 7),  // 7: 106을 고가로 뚫고 종가는 아래로 복귀
    ]
    const sigs = detectLiquiditySweep(cs)
    const s = sigs.find((x) => x.id === 'liq_sweep_high')
    expect(s).toBeDefined()
    expect(s!.barIndex).toBe(7)
    expect(s!.refs?.price).toBe(106)
  })

  it('고가가 스윙하이에 닿기만 하고 넘지 못하면 발화하지 않는다', () => {
    const cs = [
      mk(100, 101, 99, 100, 100, 0), mk(100, 101, 99, 100, 100, 1),
      mk(100, 106, 99, 100, 100, 2),  // 2: 스윙하이 106
      mk(100, 104, 99, 100, 100, 3), mk(100, 102, 99, 101, 100, 4),
      mk(101, 102, 99, 100, 100, 5), mk(100, 101, 99, 100, 100, 6),
      mk(100, 106, 99, 101, 300, 7),  // 7: 고가가 106과 정확히 같음 (초과 아님)
    ]
    const sigs = detectLiquiditySweep(cs)
    expect(sigs.some((x) => x.id === 'liq_sweep_high')).toBe(false)
  })
})

describe('detectMSB — 하락 구조 붕괴 (msb_bear / choch)', () => {
  it('종가가 확정된 직전 스윙로우를 하향 돌파하면 첫 돌파이므로 choch를 낸다', () => {
    const cs = [
      mk(100, 101, 99, 100, 100, 0), mk(100, 101, 99, 100, 100, 1),
      mk(100, 101, 95, 96, 100, 2),   // 2: 스윙로우 95
      mk(96, 101, 99, 100, 100, 3), mk(100, 102, 99, 101, 100, 4),
      mk(101, 102, 99, 100, 100, 5), mk(100, 101, 99, 100, 100, 6),
      mk(100, 101, 90, 91, 300, 7),   // 7: 종가 91 < 95 → 구조 붕괴
    ]
    const sigs = detectMSB(cs)
    const s = sigs.find((x) => x.id === 'choch')
    expect(s).toBeDefined()
    expect(s!.side).toBe('bearish')
    expect(s!.barIndex).toBe(7)
    expect(s!.refs?.price).toBe(95)
  })

  it('종가가 스윙로우와 같을 뿐 하회하지 않으면 발화하지 않는다', () => {
    const cs = [
      mk(100, 101, 99, 100, 100, 0), mk(100, 101, 99, 100, 100, 1),
      mk(100, 101, 95, 96, 100, 2),   // 2: 스윙로우 95
      mk(96, 101, 99, 100, 100, 3), mk(100, 102, 99, 101, 100, 4),
      mk(101, 102, 99, 100, 100, 5), mk(100, 101, 99, 100, 100, 6),
      mk(96, 97, 94, 95, 300, 7),     // 7: 종가 95 == 스윙로우 95 (하회 아님)
    ]
    const sigs = detectMSB(cs)
    expect(sigs.some((x) => x.id === 'msb_bear')).toBe(false)
  })
})
