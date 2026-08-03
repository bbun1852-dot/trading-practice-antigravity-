import { describe, it, expect } from 'vitest'
import { detectIndicatorSignals } from './indicatorSignals'
import { assertNoLookAhead } from './testing'
import { synthCandles, mk } from './fixtures'
import type { Candle } from '../data/types'

describe('detectIndicatorSignals', () => {
  it('연속 상승 후 RSI 과매수 진입을 잡는다', () => {
    const cs: Candle[] = []
    for (let i = 0; i < 20; i++) {
      const c = i % 2 === 0 ? 100 : 99
      cs.push(mk(c, c + 1, c - 1, c, 100, i))
    }
    for (let i = 20; i < 45; i++) cs.push(mk(100 + i, 102 + i, 99 + i, 101 + i, 100, i))
    expect(detectIndicatorSignals(cs).some((s) => s.id === 'rsi_overbought')).toBe(true)
  })

  it('거래량이 20봉 평균의 2배 이상이면 돌파 확인 신호를 낸다', () => {
    const cs: Candle[] = []
    for (let i = 0; i < 30; i++) cs.push(mk(100, 101, 99, 100, 100, i))
    cs.push(mk(100, 106, 99.5, 105.5, 270, 30))
    const s = detectIndicatorSignals(cs).find((x) => x.id === 'vol_breakout_confirm')
    expect(s).toBeDefined()
    expect(s!.barIndex).toBe(30)
  })

  it('큰 몸통인데 거래량이 평균 미만이면 가짜 돌파 신호를 낸다', () => {
    const cs: Candle[] = []
    for (let i = 0; i < 30; i++) cs.push(mk(100, 103, 97, 100, 300, i))
    cs.push(mk(100, 112, 99, 111, 50, 30))
    expect(detectIndicatorSignals(cs).some((x) => x.id === 'vol_breakout_weak')).toBe(true)
  })

  it('look-ahead를 위반하지 않는다', () => {
    assertNoLookAhead(detectIndicatorSignals, synthCandles(220))
  })
})

// ── Task 13 Group E: 미검증 13종 (task-11-brief.md 규칙표에서 직접 유도) ──
//
// 모든 픽스처는 detectIndicatorSignals()를 호출하기 전에 rsi/macd/ema/bollinger/sma를
// 독립적으로 재구현한 스크립트로 교차 지점(crossUp/crossDown)의 barIndex와 부호를
// 먼저 확인했다 (task-13-report.md에 유도 과정 기록). vol_breakout_weak 는 건드리지 않는다.

describe('rsi_50_break — 양방향', () => {
  // 완만한 하락(0~19) → 반등(20~39, RSI가 50을 상향 돌파) → 재하락(40~59, RSI가 50을
  // 하향 돌파). 재계산 결과 상향 돌파는 bar25, 하향 돌파는 bar46.
  function series(): Candle[] {
    const cs: Candle[] = []
    let p = 100
    for (let i = 0; i < 20; i++) { p -= 1; cs.push(mk(p + 1, p + 1.5, p - 0.5, p, 100, i)) }
    for (let i = 20; i < 40; i++) { p += 2; cs.push(mk(p - 2, p + 0.5, p - 2.5, p, 100, i)) }
    for (let i = 40; i < 60; i++) { p -= 2; cs.push(mk(p + 2, p + 2.5, p - 0.5, p, 100, i)) }
    return cs
  }
  // 35봉 순수 하락만 있으면 RSI가 워밍업 이후 0에 붙박여 50을 넘나드는 교차 자체가 없다.
  function seriesNoTrend(): Candle[] {
    const cs: Candle[] = []
    let p = 100
    for (let i = 0; i < 35; i++) { p -= 1; cs.push(mk(p + 1, p + 1.5, p - 0.5, p, 100, i)) }
    return cs
  }

  it('RSI가 50을 상향 돌파하면 bullish, 하향 돌파하면 bearish로 각각 발생한다', () => {
    const sigs = detectIndicatorSignals(series())
    const up = sigs.find((s) => s.id === 'rsi_50_break' && s.barIndex === 25)
    const down = sigs.find((s) => s.id === 'rsi_50_break' && s.barIndex === 46)
    expect(up?.side).toBe('bullish')
    expect(down?.side).toBe('bearish')
  })

  it('50을 넘나드는 교차가 없으면 발생하지 않는다', () => {
    expect(detectIndicatorSignals(seriesNoTrend()).some((s) => s.id === 'rsi_50_break')).toBe(false)
  })
})

describe('macd_golden / macd_dead / macd_zero_break', () => {
  // 상승(0~29) → 하락(30~59) → 상승(60~89) → 하락(90~119).
  // 재계산 결과: golden cross는 bar63, dead cross는 bar93, 0선 상향돌파는 bar73,
  // 0선 하향돌파는 bar103 (bar44에도 0선 하향돌파가 있지만 마진이 작아 bar103을 쓴다).
  function series(): Candle[] {
    const cs: Candle[] = []
    let p = 100
    for (let i = 0; i < 30; i++) { p += 1.5; cs.push(mk(p - 1.5, p + 0.3, p - 1.8, p, 100, i)) }
    for (let i = 30; i < 60; i++) { p -= 1.5; cs.push(mk(p + 1.5, p + 1.8, p - 0.3, p, 100, i)) }
    for (let i = 60; i < 90; i++) { p += 1.5; cs.push(mk(p - 1.5, p + 0.3, p - 1.8, p, 100, i)) }
    for (let i = 90; i < 120; i++) { p -= 1.5; cs.push(mk(p + 1.5, p + 1.8, p - 0.3, p, 100, i)) }
    return cs
  }
  // 가격이 완전히 평평하면 MACD선과 시그널선이 항상 0으로 같아 어떤 교차도 없다.
  function flatSeries(): Candle[] {
    return Array.from({ length: 120 }, (_, i) => mk(100, 100.5, 99.5, 100, 100, i))
  }

  it('MACD가 시그널을 상향 교차하면 macd_golden이 발생한다', () => {
    const s = detectIndicatorSignals(series()).find((x) => x.id === 'macd_golden' && x.barIndex === 63)
    expect(s).toBeDefined()
    expect(s!.side).toBe('bullish')
  })

  it('MACD가 시그널을 하향 교차하면 macd_dead가 발생한다', () => {
    const s = detectIndicatorSignals(series()).find((x) => x.id === 'macd_dead' && x.barIndex === 93)
    expect(s).toBeDefined()
    expect(s!.side).toBe('bearish')
  })

  it('MACD가 0선을 상향/하향 돌파하면 macd_zero_break가 방향에 따라 발생한다', () => {
    const sigs = detectIndicatorSignals(series())
    const up = sigs.find((x) => x.id === 'macd_zero_break' && x.barIndex === 73)
    const down = sigs.find((x) => x.id === 'macd_zero_break' && x.barIndex === 103)
    expect(up?.side).toBe('bullish')
    expect(down?.side).toBe('bearish')
  })

  it('평평한 가격이면 golden/dead/zero_break 어느 것도 발생하지 않는다', () => {
    const sigs = detectIndicatorSignals(flatSeries())
    expect(sigs.some((x) => x.id === 'macd_golden')).toBe(false)
    expect(sigs.some((x) => x.id === 'macd_dead')).toBe(false)
    expect(sigs.some((x) => x.id === 'macd_zero_break')).toBe(false)
  })
})

describe('ma_golden_cross / ma_dead_cross', () => {
  // 상승(0~59) → 하락(60~119, dead cross bar85) → 상승(120~179, golden cross bar144)
  function series(): Candle[] {
    const cs: Candle[] = []
    let p = 100
    for (let i = 0; i < 60; i++) { p += 1; cs.push(mk(p - 1, p + 0.3, p - 1.3, p, 100, i)) }
    for (let i = 60; i < 120; i++) { p -= 1.2; cs.push(mk(p + 1.2, p + 1.4, p - 0.2, p, 100, i)) }
    for (let i = 120; i < 180; i++) { p += 1.2; cs.push(mk(p - 1.2, p + 0.2, p - 1.4, p, 100, i)) }
    return cs
  }
  function flatSeries(): Candle[] {
    return Array.from({ length: 180 }, (_, i) => mk(100, 100.5, 99.5, 100, 100, i))
  }

  it('EMA20이 EMA50을 상향 교차하면 ma_golden_cross가 발생한다', () => {
    const s = detectIndicatorSignals(series()).find((x) => x.id === 'ma_golden_cross' && x.barIndex === 144)
    expect(s).toBeDefined()
    expect(s!.side).toBe('bullish')
  })

  it('EMA20이 EMA50을 하향 교차하면 ma_dead_cross가 발생한다', () => {
    const s = detectIndicatorSignals(series()).find((x) => x.id === 'ma_dead_cross' && x.barIndex === 85)
    expect(s).toBeDefined()
    expect(s!.side).toBe('bearish')
  })

  it('평평한 가격이면 교차가 없다', () => {
    const sigs = detectIndicatorSignals(flatSeries())
    expect(sigs.some((x) => x.id === 'ma_golden_cross')).toBe(false)
    expect(sigs.some((x) => x.id === 'ma_dead_cross')).toBe(false)
  })
})

describe('ma_aligned_bull / ma_aligned_bear — look-ahead 제네릭 검사에도 안 걸리는 완전 미검증 경로', () => {
  // EMA200이 유효해지려면 최소 200봉이 필요하다. 220봉 지속 상승/하락으로 EMA
  // 20>50>200(상승) 또는 20<50<200(하락) 정배열/역배열을 만든다.
  function bullSeries(): Candle[] {
    const cs: Candle[] = []
    let p = 100
    for (let i = 0; i < 220; i++) { p += 0.5; cs.push(mk(p - 0.5, p + 0.3, p - 0.8, p, 100, i)) }
    return cs
  }
  function bearSeries(): Candle[] {
    const cs: Candle[] = []
    let p = 300
    for (let i = 0; i < 220; i++) { p -= 0.5; cs.push(mk(p + 0.5, p + 0.8, p - 0.3, p, 100, i)) }
    return cs
  }
  function flatSeries(): Candle[] {
    return Array.from({ length: 220 }, (_, i) => mk(100, 100.5, 99.5, 100, 100, i))
  }

  it('EMA 20>50>200 정배열이 지속되면 ma_aligned_bull이 발생하고, ma_aligned_bear는 발생하지 않는다', () => {
    const sigs = detectIndicatorSignals(bullSeries())
    expect(sigs.some((x) => x.id === 'ma_aligned_bull' && x.barIndex === 210)).toBe(true)
    expect(sigs.some((x) => x.id === 'ma_aligned_bear')).toBe(false)
  })

  it('EMA 20<50<200 역배열이 지속되면 ma_aligned_bear가 발생하고, ma_aligned_bull은 발생하지 않는다', () => {
    const sigs = detectIndicatorSignals(bearSeries())
    expect(sigs.some((x) => x.id === 'ma_aligned_bear' && x.barIndex === 210)).toBe(true)
    expect(sigs.some((x) => x.id === 'ma_aligned_bull')).toBe(false)
  })

  it('평평한 가격이면(EMA가 모두 같으면) 정배열도 역배열도 발생하지 않는다', () => {
    const sigs = detectIndicatorSignals(flatSeries())
    expect(sigs.some((x) => x.id === 'ma_aligned_bull')).toBe(false)
    expect(sigs.some((x) => x.id === 'ma_aligned_bear')).toBe(false)
  })
})

describe('bb_break_upper / bb_break_lower', () => {
  // 25봉 좁은 오실레이션으로 밴드를 좁힌 뒤, bar25에서 급등(상단 이탈), 이후
  // 잠잠하다가 bar30에서 급락(하단 이탈).
  function series(): Candle[] {
    const cs: Candle[] = []
    for (let i = 0; i < 25; i++) { const d = i % 2 === 0 ? 0.3 : -0.3; const p = 100 + d; cs.push(mk(100, p + 0.2, p - 0.2, p, 100, i)) }
    cs.push(mk(100.3, 106, 100, 105.5, 300, 25))
    for (let i = 26; i < 30; i++) cs.push(mk(105.5, 106, 105, 105.5, 100, i))
    cs.push(mk(105.5, 106, 94, 95, 300, 30))
    for (let i = 31; i < 35; i++) cs.push(mk(95, 95.5, 94.5, 95, 100, i))
    return cs
  }
  // bar25 종가를 105.5→100.7로 줄이면 상단 밴드(≈100.706)를 근소하게 못 넘는다.
  function seriesUpperNegative(): Candle[] {
    const cs: Candle[] = []
    for (let i = 0; i < 25; i++) { const d = i % 2 === 0 ? 0.3 : -0.3; const p = 100 + d; cs.push(mk(100, p + 0.2, p - 0.2, p, 100, i)) }
    cs.push(mk(100.3, 101, 100, 100.7, 300, 25))
    return cs
  }
  // bar30 종가를 95→96.0으로 올리면 하단 밴드(≈95.867)를 근소하게 못 넘는다.
  function seriesLowerNegative(): Candle[] {
    const cs: Candle[] = []
    for (let i = 0; i < 25; i++) { const d = i % 2 === 0 ? 0.3 : -0.3; const p = 100 + d; cs.push(mk(100, p + 0.2, p - 0.2, p, 100, i)) }
    cs.push(mk(100.3, 106, 100, 105.5, 300, 25))
    for (let i = 26; i < 30; i++) cs.push(mk(105.5, 106, 105, 105.5, 100, i))
    cs.push(mk(105.5, 106, 95, 96.0, 300, 30))
    return cs
  }

  it('종가가 상단 밴드를 상향 이탈하면 bb_break_upper가 발생한다', () => {
    const s = detectIndicatorSignals(series()).find((x) => x.id === 'bb_break_upper' && x.barIndex === 25)
    expect(s).toBeDefined()
    expect(s!.side).toBe('bullish')
  })

  it('종가가 상단 밴드를 근소하게 못 넘으면 발생하지 않는다', () => {
    expect(detectIndicatorSignals(seriesUpperNegative()).some((x) => x.id === 'bb_break_upper')).toBe(false)
  })

  it('종가가 하단 밴드를 하향 이탈하면 bb_break_lower가 발생한다', () => {
    const s = detectIndicatorSignals(series()).find((x) => x.id === 'bb_break_lower' && x.barIndex === 30)
    expect(s).toBeDefined()
    expect(s!.side).toBe('bearish')
  })

  it('종가가 하단 밴드를 근소하게 못 넘으면 발생하지 않는다', () => {
    expect(detectIndicatorSignals(seriesLowerNegative()).some((x) => x.id === 'bb_break_lower')).toBe(false)
  })
})

describe('bb_squeeze', () => {
  // 0~99봉: 오실레이션 진폭이 3→0.2로 점점 줄어들며 밴드폭이 계속 신저점을 갱신한다.
  // 100~109봉: finalAmp로 진폭을 고정 — 0.05를 주면 수축이 계속돼 bar100이 직전 60봉
  // 최저 밴드폭이 되고(양성), 1.5를 주면 변동성이 급팽창해 신저점 경신이 깨진다(음성).
  function series(finalAmp: number): Candle[] {
    const cs: Candle[] = []
    for (let i = 0; i < 100; i++) {
      const amp = Math.max(0.05, 3 - i * 0.028)
      const d = i % 2 === 0 ? amp : -amp
      const p = 100 + d
      cs.push(mk(100, p + 0.05, p - 0.05, p, 100, i))
    }
    for (let i = 100; i < 110; i++) {
      const d = i % 2 === 0 ? finalAmp : -finalAmp
      const p = 100 + d
      cs.push(mk(100, p + 0.05, p - 0.05, p, 100, i))
    }
    return cs
  }

  it('밴드폭이 직전 60봉 중 최저치를 계속 갱신하면 발생한다', () => {
    const s = detectIndicatorSignals(series(0.05)).find((x) => x.id === 'bb_squeeze' && x.barIndex === 100)
    expect(s).toBeDefined()
    expect(s!.side).toBe('neutral')
  })

  it('변동성이 다시 팽창해 신저점을 갱신하지 못하면 발생하지 않는다', () => {
    const sigs = detectIndicatorSignals(series(1.5))
    expect(sigs.some((x) => x.id === 'bb_squeeze' && x.barIndex === 100)).toBe(false)
  })
})

describe('vol_climax — vol_breakout_confirm과의 else-if 우선순위 경계', () => {
  // 몸통 비중은 0.857로 vol_breakout_confirm 조건(>=0.6)도 동시에 만족하는 캔들을 쓴다.
  // 거래량이 3배 임계값을 넘으면 vol_climax만 발생해야 한다(else if 이므로 confirm과
  // 동시에 나오면 안 된다 — candle_tweezer의 else-if 버그와 같은 유형의 위험을 겨눈다).
  function series(climaxVol: number): Candle[] {
    const cs: Candle[] = []
    for (let i = 0; i < 30; i++) cs.push(mk(100, 101, 99, 100, 100, i))
    cs.push(mk(100, 106.5, 99.5, 106, climaxVol, 30))
    return cs
  }

  it('거래량이 20봉 평균의 3배 이상이면 vol_climax만 발생하고 vol_breakout_confirm은 발생하지 않는다', () => {
    const sigs = detectIndicatorSignals(series(350))
    const climax = sigs.find((x) => x.id === 'vol_climax' && x.barIndex === 30)
    expect(climax).toBeDefined()
    expect(climax!.side).toBe('bullish')
    expect(sigs.some((x) => x.id === 'vol_breakout_confirm' && x.barIndex === 30)).toBe(false)
  })

  it('거래량이 3배에 근소하게 못 미치면(2배는 넘음) vol_climax 대신 vol_breakout_confirm이 발생한다', () => {
    const sigs = detectIndicatorSignals(series(299))
    expect(sigs.some((x) => x.id === 'vol_climax' && x.barIndex === 30)).toBe(false)
    expect(sigs.some((x) => x.id === 'vol_breakout_confirm' && x.barIndex === 30)).toBe(true)
  })
})
