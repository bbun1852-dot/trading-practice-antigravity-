import { describe, it, expect } from 'vitest'
import { fmtPrice } from './format'
import { detectAll } from './analysis/signals'
import { synthCandles } from './analysis/fixtures'
import type { Candle } from './data/types'

describe('fmtPrice', () => {
  it('규모가 크면 자릿수를 늘리지 않는다', () => {
    expect(fmtPrice(71408.9)).toBe('71408.90')
    expect(fmtPrice(69266.63299999999)).toBe('69266.63')
  })

  it('1~1000 은 4자리 — 실측 최대 필요가 3자리였다', () => {
    expect(fmtPrice(1.3312)).toBe('1.3312')
    expect(fmtPrice(76.67)).toBe('76.6700')
  })

  it('1 미만은 6자리 — 실측 최대 필요가 4자리였다', () => {
    expect(fmtPrice(0.2372)).toBe('0.237200')
    expect(fmtPrice(0.06972)).toBe('0.069720')
  })

  it('음수도 절댓값 기준으로 버킷을 고른다', () => {
    expect(fmtPrice(-0.2372)).toBe('-0.237200')
    expect(fmtPrice(-71408.9)).toBe('-71408.90')
  })

  it('경계값에서 버킷이 갈린다', () => {
    expect(fmtPrice(1000)).toBe('1000.00')
    expect(fmtPrice(999.9999)).toBe('999.9999')
    expect(fmtPrice(1)).toBe('1.0000')
    expect(fmtPrice(0.9999999)).toBe('1.000000')
  })
})

/**
 * 저가 자산에서 근거 텍스트가 뭉개지던 결함의 회귀 테스트.
 *
 * 실데이터(ADAUSDT $0.24)에서 `약세 오더블록 저항 — ... (0.25~0.25)` 와
 * `종가 1.33 가 직전 스윙로우 1.33 하향 붕괴` 가 나왔다. 두 경우 다 감지기의
 * 발화 조건이 두 값의 차이를 보증하는데 화면만 같았다.
 *
 * 네트워크를 타지 않도록 저가 자산을 흉내낸 합성 캔들로 건다 — 실데이터 확인은
 * `npm run calibrate` / `npm run drill` 이 맡는다.
 */
describe('저가 자산에서 근거의 가격이 뭉개지지 않는다', () => {
  /**
   * 검증된 픽스처를 저가대로 축척한다. OHLC 를 같은 비율로 줄이면 피벗·돌파·갭 같은
   * 구조 관계와 ATR 대비 조건이 전부 보존되므로 **같은 신호가 그대로 나오면서 가격만
   * ADA 급이 된다.** 직접 만든 파형은 MSB·스윕을 못 만들어 검사가 공허해졌다.
   */
  function scaled(n: number, k: number): Candle[] {
    return synthCandles(n).map((c) => ({
      ...c,
      open: c.open * k, high: c.high * k, low: c.low * k, close: c.close * k,
    }))
  }

  const cs = scaled(600, 0.0024)   // 픽스처가 100 근처이므로 0.24 근처가 된다

  it('축척한 픽스처가 실제로 저가대이고 봉마다 폭이 있다', () => {
    // 이 전제가 깨지면 아래 검사가 공허해진다
    expect(cs.every((c) => c.close < 1)).toBe(true)
    expect(cs.filter((c) => c.high > c.low).length).toBeGreaterThan(590)
  })

  it('evidence 에 같은 수가 나란히 찍히지 않는다', () => {
    // "A → B", "A~B", "A / B" 처럼 두 수를 나란히 적은 자리에서 같은 문자열이면
    // 그 근거는 읽는 사람에게 아무것도 말해주지 않는다.
    const pairPattern = /(\d+\.\d+)\s*(?:~|→|\/)\s*(\d+\.\d+)/g
    const collapsed: string[] = []
    let pairs = 0
    for (const s of detectAll(cs)) {
      for (const m of s.evidence.matchAll(pairPattern)) {
        pairs++
        if (m[1] === m[2]) collapsed.push(`${s.id}@${s.barIndex}: ${s.evidence}`)
      }
    }
    expect(pairs, '가격 쌍이 하나도 없으면 검사가 공허하다').toBeGreaterThan(0)
    expect(collapsed, `가격이 뭉개진 근거:\n${collapsed.slice(0, 5).join('\n')}`).toEqual([])
  })

  it('강부등호로 발화하는 신호에서 두 가격이 구분된다', () => {
    // detectMSB 는 close < swingLow(또는 >) 일 때만 발화하고, 스윕도 마찬가지다.
    // 따라서 evidence 의 두 수가 같으면 그건 표시 결함이지 데이터가 아니다.
    const strict = detectAll(cs).filter((s) => s.id.startsWith('msb_') || s.id.startsWith('liq_sweep_'))
    expect(strict.length, '표본이 0이면 검사가 공허하다').toBeGreaterThan(0)
    for (const s of strict) {
      const nums = s.evidence.match(/\d+\.\d+/g) ?? []
      expect(new Set(nums).size, `${s.id}@${s.barIndex} 에서 가격이 겹친다: ${s.evidence}`).toBe(nums.length)
    }
  })
})
