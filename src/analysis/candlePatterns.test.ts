import { describe, it, expect } from 'vitest'
import { detectCandlePatterns } from './candlePatterns'
import { assertNoLookAhead } from './testing'
import { synthCandles, mk } from './fixtures'

const idsAt = (cs: Parameters<typeof detectCandlePatterns>[0], i: number) =>
  detectCandlePatterns(cs).filter((s) => s.barIndex === i).map((s) => s.id)

describe('detectCandlePatterns', () => {
  it('망치형: 아래꼬리가 몸통의 2배 이상', () => {
    const cs = [mk(100, 101, 99, 100, 100, 0), mk(100, 101, 90, 100.5, 100, 1)]
    expect(idsAt(cs, 1)).toContain('candle_hammer')
  })

  it('유성형: 위꼬리가 몸통의 2배 이상인 음봉', () => {
    const cs = [mk(100, 101, 99, 100, 100, 0), mk(100, 110, 99.5, 99.5, 100, 1)]
    expect(idsAt(cs, 1)).toContain('candle_shooting_star')
  })

  it('상승 장악형: 음봉을 다음 양봉이 완전히 감싼다', () => {
    const cs = [mk(100, 101, 97, 98, 100, 0), mk(97.5, 103, 97, 102, 200, 1)]
    expect(idsAt(cs, 1)).toContain('candle_bull_engulf')
  })

  it('하락 장악형: 양봉을 다음 음봉이 완전히 감싼다', () => {
    const cs = [mk(98, 101, 97, 100, 100, 0), mk(100.5, 101, 96, 97, 200, 1)]
    expect(idsAt(cs, 1)).toContain('candle_bear_engulf')
  })

  it('적삼병: 계단식 상승 양봉 3개', () => {
    const cs = [
      mk(100, 104, 99.5, 103, 100, 0),
      mk(103, 108, 102.5, 107, 100, 1),
      mk(107, 112, 106.5, 111, 100, 2),
    ]
    expect(idsAt(cs, 2)).toContain('candle_three_soldiers')
  })

  it('샛별형: 음봉 → 작은 몸통 → 되돌리는 양봉', () => {
    const cs = [
      mk(110, 110.5, 99, 100, 100, 0),
      mk(99.5, 100.5, 99, 100, 100, 1),
      mk(100, 108, 99.5, 107, 200, 2),
    ]
    expect(idsAt(cs, 2)).toContain('candle_morning_star')
  })

  it('인사이드바: 직전 봉 레인지 안에 들어간다', () => {
    const cs = [mk(100, 110, 90, 105, 100, 0), mk(102, 108, 95, 104, 100, 1)]
    expect(idsAt(cs, 1)).toContain('candle_inside_bar')
  })

  it('트위저 바텀: 저점만 일치하고 색이 반대이면 tweezer_bottom만 발생한다', () => {
    // ATR 워밍업용 20봉 도입부 (TR=4 고정 → ATR≈4, 허용오차≈0.4)
    const lead = Array.from({ length: 20 }, (_, i) => mk(100, 102, 98, 100, 100, i))
    const cs = [...lead, mk(100, 108, 95, 96, 100, 20), mk(96, 101, 95.05, 100, 100, 21)]
    const tweezers = detectCandlePatterns(cs).filter((s) => s.barIndex === 21 && s.id.startsWith('tweezer_'))
    expect(tweezers).toHaveLength(1)
    expect(tweezers[0].id).toBe('tweezer_bottom')
    expect(tweezers[0].side).toBe('bullish')
  })

  it('트위저 탑: 고점만 일치하고 색이 반대이면 tweezer_top만 발생한다', () => {
    const lead = Array.from({ length: 20 }, (_, i) => mk(100, 102, 98, 100, 100, i))
    const cs = [...lead, mk(96, 108, 95, 103, 100, 20), mk(104, 108.05, 90, 95, 100, 21)]
    const tweezers = detectCandlePatterns(cs).filter((s) => s.barIndex === 21 && s.id.startsWith('tweezer_'))
    expect(tweezers).toHaveLength(1)
    expect(tweezers[0].id).toBe('tweezer_top')
    expect(tweezers[0].side).toBe('bearish')
  })

  it('트위저: 저점과 고점이 모두 일치해도 한쪽 side만 발생한다 (회귀 — 과거엔 양쪽 다 발생했다)', () => {
    const lead = Array.from({ length: 20 }, (_, i) => mk(100, 102, 98, 100, 100, i))
    // 현재 봉의 고점·저점 모두 직전 봉과 ATR 허용오차 이내로 일치시킨다 —
    // 예전 코드라면 이 조건에서 candle_tweezer 가 양방향으로 동시 발화했다.
    const cs = [...lead, mk(100, 108, 95, 103, 100, 20), mk(101, 108.05, 95.05, 96, 100, 21)]
    const tweezers = detectCandlePatterns(cs).filter((s) => s.barIndex === 21 && s.id.startsWith('tweezer_'))
    expect(tweezers).toHaveLength(1)
    expect(tweezers[0].id).toBe('tweezer_top')
  })

  it('look-ahead를 위반하지 않는다', () => {
    assertNoLookAhead(detectCandlePatterns, synthCandles(220))
  })
})

// ── Task 13 Group C: 미검증 8종 (task-9-brief.md 규칙표에서 직접 유도) ──

describe('candle_inv_hammer / candle_shooting_star — 동일 기하, isBull로만 버킷이 갈린다', () => {
  it('역망치형: upper>=2*body, lower<=body, 양봉이면 candle_inv_hammer만 발생한다 (shooting_star 아님)', () => {
    // body=0.5, upper=5.5(>=1), lower=0.5(<=0.5), isBull=true
    const cs = [mk(100, 101, 99, 100, 100, 0), mk(100, 106, 99.5, 100.5, 100, 1)]
    const ids = idsAt(cs, 1)
    expect(ids).toContain('candle_inv_hammer')
    expect(ids).not.toContain('candle_shooting_star')
  })

  it('동일 기하라도 음봉이면 candle_shooting_star만 발생한다 (inv_hammer 아님)', () => {
    // 동일한 body/upper/lower 비율, open/close만 뒤바꿔 음봉으로
    const cs = [mk(100, 101, 99, 100, 100, 0), mk(100.5, 106, 99.5, 100, 100, 1)]
    const ids = idsAt(cs, 1)
    expect(ids).toContain('candle_shooting_star')
    expect(ids).not.toContain('candle_inv_hammer')
  })

  it('위꼬리가 몸통의 2배에 아슬아슬하게 못 미치면 둘 다 발생하지 않는다', () => {
    // body=1, upper=1.9(<2*body), lower=0 — upper>=2*body 조건이 근소하게 거짓
    const cs = [mk(100, 101, 99, 100, 100, 0), mk(100, 102.9, 100, 101, 100, 1)]
    const ids = idsAt(cs, 1)
    expect(ids).not.toContain('candle_inv_hammer')
    expect(ids).not.toContain('candle_shooting_star')
  })
})

describe('candle_doji', () => {
  it('몸통이 레인지의 10% 이하이면 발생한다', () => {
    // range=10, body=0.999 → ratio=9.99% <= 10%
    const cs = [mk(100, 101, 99, 100, 100, 0), mk(100, 105, 95, 100.999, 100, 1)]
    expect(idsAt(cs, 1)).toContain('candle_doji')
  })

  it('몸통이 레인지의 10%를 근소하게 넘으면 발생하지 않는다', () => {
    // range=10, body=1.001 → ratio=10.01% > 10%
    const cs = [mk(100, 101, 99, 100, 100, 0), mk(100, 105, 95, 101.001, 100, 1)]
    expect(idsAt(cs, 1)).not.toContain('candle_doji')
  })
})

describe('candle_long_wick — ATR 워밍업 경계', () => {
  // 0~13봉 플랫(ATR 14기간 워밍업), 5번봉만 긴 꼬리 모양으로 바꿔 "조건은 만족하지만
  // ATR이 아직 NaN인" 상황을 만든다. 14번봉은 워밍업이 끝난 뒤 같은 모양의 캔들이다.
  const cs = Array.from({ length: 14 }, (_, i) => mk(100, 101, 99, 100, 100, i))
  cs[5] = mk(100, 106, 99.5, 100.5, 100, 5)
  cs.push(mk(100, 106, 99.5, 100.5, 100, 14))

  it('워밍업 구간(0~12봉)에서는 기하 조건을 만족해도 발생하지 않는다 (ATR이 NaN)', () => {
    expect(idsAt(cs, 5)).not.toContain('candle_long_wick')
  })

  it('워밍업이 끝난 뒤 같은 모양이면 발생한다', () => {
    // range=6.5 >= 0.8*ATR[14](≈2.62), max(upper=5.5,lower=0.5)=5.5 >= 0.66*6.5(≈4.29)
    const ids = idsAt(cs, 14)
    expect(ids).toContain('candle_long_wick')
    // 위꼬리가 더 기므로 반대쪽인 약세
    const sig = detectCandlePatterns(cs).find((s) => s.barIndex === 14 && s.id === 'candle_long_wick')
    expect(sig?.side).toBe('bearish')
  })
})

describe('candle_bull_harami — 장악형의 부등호 역방향', () => {
  it('음봉을 다음 양봉이 몸통 안에 품으면 발생한다', () => {
    // prev(음봉): open=100 close=96. cur(양봉): open=97(>close[prev]=96) close=99(<open[prev]=100)
    const cs = [mk(100, 101, 95, 96, 100, 0), mk(97, 99.5, 96.5, 99, 100, 1)]
    expect(idsAt(cs, 1)).toContain('candle_bull_harami')
  })

  it('상승 장악형 픽스처(부등호 방향이 반대)에서는 발생하지 않는다', () => {
    // open[cur]=97.5 > close[prev]=98? 거짓 — harami 조건의 부등호 방향이 장악형과 다름을 확인
    const cs = [mk(100, 101, 97, 98, 100, 0), mk(97.5, 103, 97, 102, 200, 1)]
    const ids = idsAt(cs, 1)
    expect(ids).toContain('candle_bull_engulf')
    expect(ids).not.toContain('candle_bull_harami')
  })
})

describe('candle_bear_harami — 장악형의 부등호 역방향', () => {
  it('양봉을 다음 음봉이 몸통 안에 품으면 발생한다', () => {
    // prev(양봉): open=96 close=100. cur(음봉): open=99(<close[prev]=100) close=97.5(>open[prev]=96)
    const cs = [mk(96, 101, 95, 100, 100, 0), mk(99, 99.5, 97, 97.5, 100, 1)]
    expect(idsAt(cs, 1)).toContain('candle_bear_harami')
  })

  it('하락 장악형 픽스처(부등호 방향이 반대)에서는 발생하지 않는다', () => {
    // open[cur]=100.5 < close[prev]=100? 거짓
    const cs = [mk(98, 101, 97, 100, 100, 0), mk(100.5, 101, 96, 97, 200, 1)]
    const ids = idsAt(cs, 1)
    expect(ids).toContain('candle_bear_engulf')
    expect(ids).not.toContain('candle_bear_harami')
  })
})

describe('candle_evening_star', () => {
  it('양봉 → 소형 몸통 → 중간값 아래로 마감하는 음봉이면 발생한다', () => {
    const cs = [
      mk(100, 110.5, 99.5, 110, 100, 0),  // 양봉, body=10, mid2=105
      mk(110.5, 111, 110, 110.5, 100, 1), // 소형 몸통 (<=3)
      mk(110, 110.5, 99, 100, 200, 2),    // 음봉, close=100 < mid2=105
    ]
    expect(idsAt(cs, 2)).toContain('candle_evening_star')
  })

  it('마지막 봉 종가가 중간값을 근소하게 웃돌면 발생하지 않는다', () => {
    const cs = [
      mk(100, 110.5, 99.5, 110, 100, 0),  // 동일, mid2=105
      mk(110.5, 111, 110, 110.5, 100, 1),
      mk(106, 106.5, 105, 105.5, 200, 2), // 음봉이지만 close=105.5 > mid2=105
    ]
    expect(idsAt(cs, 2)).not.toContain('candle_evening_star')
  })
})

describe('candle_three_crows', () => {
  it('연속 음봉 3개가 종가를 계단식으로 낮추면 발생한다', () => {
    const cs = [
      mk(110, 110.5, 105.5, 106, 100, 0), // body=4, range=5 (>=0.5)
      mk(106, 106.5, 101.5, 102, 100, 1),
      mk(102, 102.5, 97.5, 98, 200, 2),
    ]
    expect(idsAt(cs, 2)).toContain('candle_three_crows')
  })

  it('마지막 종가가 직전 종가를 하회하지 못하면(동률) 발생하지 않는다', () => {
    const cs = [
      mk(110, 110.5, 105.5, 106, 100, 0),
      mk(106, 106.5, 101.5, 102, 100, 1),
      mk(102, 102.5, 97.5, 102, 200, 2), // close == 직전 종가, 계단 하락 아님
    ]
    expect(idsAt(cs, 2)).not.toContain('candle_three_crows')
  })
})

describe('candle_tri_star', () => {
  it('도지 3개가 연속하면 발생한다', () => {
    const cs = [
      mk(100, 101, 99, 100.05, 100, 0),
      mk(100, 101, 99, 100.02, 100, 1),
      mk(100, 101, 99, 99.97, 200, 2),
    ]
    expect(idsAt(cs, 2)).toContain('candle_tri_star')
  })

  it('셋 중 하나라도 도지 조건을 벗어나면 발생하지 않는다', () => {
    const cs = [
      mk(100, 101, 99, 100.05, 100, 0),
      mk(100, 101, 99, 100.5, 100, 1),  // body=0.5, range=2, ratio=25% — 도지 아님
      mk(100, 101, 99, 99.97, 200, 2),
    ]
    expect(idsAt(cs, 2)).not.toContain('candle_tri_star')
  })
})

describe('트위저 분리와 임계값', () => {
  // ATR을 안정시키기 위한 도입부 20봉
  const lead = () => Array.from({ length: 20 }, (_, i) => mk(100, 102, 98, 100, 100, i))

  it('색이 반대이고 저점이 일치하면 tweezer_bottom 을 낸다', () => {
    const cs = [...lead(), mk(100, 101, 95, 96, 100, 20), mk(96, 101, 95, 100, 100, 21)]
    const ids = detectCandlePatterns(cs).filter(s => s.barIndex === 21).map(s => s.id)
    expect(ids).toContain('tweezer_bottom')
    expect(ids).not.toContain('candle_tweezer')
  })

  it('색이 반대이고 고점이 일치하면 tweezer_top 을 낸다', () => {
    const cs = [...lead(), mk(96, 105, 95, 100, 100, 20), mk(100, 105, 95, 96, 100, 21)]
    const ids = detectCandlePatterns(cs).filter(s => s.barIndex === 21).map(s => s.id)
    expect(ids).toContain('tweezer_top')
  })

  it('두 봉의 색이 같으면 트위저를 내지 않는다', () => {
    const cs = [...lead(), mk(96, 101, 95, 100, 100, 20), mk(96, 101, 95, 100, 100, 21)]
    const ids = detectCandlePatterns(cs).filter(s => s.barIndex === 21).map(s => s.id)
    expect(ids).not.toContain('tweezer_bottom')
    expect(ids).not.toContain('tweezer_top')
  })

  it('저점 차이가 ATR의 10%를 넘으면 내지 않는다', () => {
    // lead 의 TR 은 4 이므로 ATR ≈ 4, 허용오차 ≈ 0.4. 저점을 2 만큼 벌린다.
    const cs = [...lead(), mk(100, 101, 95, 96, 100, 20), mk(96, 101, 97, 100, 100, 21)]
    const ids = detectCandlePatterns(cs).filter(s => s.barIndex === 21).map(s => s.id)
    expect(ids).not.toContain('tweezer_bottom')
  })

  it('한 봉에서 상반된 side 의 트위저가 동시에 나오지 않는다', () => {
    const cs = synthCandles(400)
    const sigs = detectCandlePatterns(cs).filter(s => s.id.startsWith('tweezer_'))
    const byBar = new Map<number, Set<string>>()
    for (const s of sigs) {
      const set = byBar.get(s.barIndex) ?? new Set()
      set.add(s.side)
      byBar.set(s.barIndex, set)
    }
    for (const [bar, sides] of byBar) {
      expect(sides.size, `bar ${bar} 에서 양방향 동시 발화`).toBe(1)
    }
  })
})
