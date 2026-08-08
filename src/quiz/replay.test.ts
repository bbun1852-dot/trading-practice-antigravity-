import { describe, it, expect } from 'vitest'
import { replay } from './replay'
import type { Answer, Question } from './types'
import type { Candle } from '../data/types'
import { mk } from '../analysis/fixtures'

/**
 * decisionIndex=1, 은닉 구간을 직접 지정해 만든 최소 문제.
 * index0/1(=decisionIndex)은 항상 100 근방(99~101)에 머무는 평평한 봉이다 —
 * "결정 봉 이하는 재생하지 않는다" 테스트가 이 평탄함에 기대어 경계를 검증한다.
 */
const q = (hidden: Candle[]): Question => ({
  symbol: 'T', timeframe: '4h', startTime: 0, decisionIndex: 1,
  type: 'normal', difficulty: 'medium',
  candles: [mk(100, 101, 99, 100, 100, 0), mk(100, 101, 99, 100, 100, 1), ...hidden],
})

const long: Answer = { direction: 'long', entry: 100, stopLoss: 95, takeProfit: 110, tags: [] }
const short: Answer = { direction: 'short', entry: 100, stopLoss: 105, takeProfit: 90, tags: [] }

describe('replay', () => {
  describe('롱', () => {
    it('TP 를 터치하면 익절이다 (체결 봉과 같은 봉에서)', () => {
      const r = replay(q([mk(100, 111, 99, 110, 100, 2)]), long)
      expect(r.filled).toBe(true)
      expect(r.exit).toBe('tp')
      expect(r.exitBarIndex).toBe(2)
      expect(r.r).toBeCloseTo(2, 5) // (110-100)/(100-95) = 2R
      expect(r.pnlPct).toBeCloseTo(10, 5)
    })

    it('SL 을 터치하면 손절이다 (체결 봉과 같은 봉에서)', () => {
      const r = replay(q([mk(100, 101, 94, 95, 100, 2)]), long)
      expect(r.filled).toBe(true)
      expect(r.exit).toBe('sl')
      expect(r.exitBarIndex).toBe(2)
      expect(r.r).toBeCloseTo(-1, 5)
      expect(r.pnlPct).toBeCloseTo(-5, 5)
    })

    it('같은 봉에서 SL 과 TP 를 모두 터치하면 SL 우선이다', () => {
      // 보수적 가정. 봉 안의 체결 순서를 알 수 없으므로 불리한 쪽을 택한다.
      const r = replay(q([mk(100, 111, 94, 100, 100, 2)]), long)
      expect(r.filled).toBe(true)
      expect(r.exit).toBe('sl')
      expect(r.exitBarIndex).toBe(2)
      expect(r.r).toBeCloseTo(-1, 5)
      expect(r.pnlPct).toBeCloseTo(-5, 5)
    })

    it('진입가에 닿지 않으면 미체결이다', () => {
      const a: Answer = { ...long, entry: 50 }
      const r = replay(q([mk(100, 101, 99, 100, 100, 2)]), a)
      expect(r.filled).toBe(false)
      expect(r.exit).toBe('none')
      expect(r.exitBarIndex).toBeNull()
      expect(r.r).toBe(0)
      expect(r.pnlPct).toBe(0)
    })

    it('은닉 구간 안에 청산되지 않으면 마지막 종가로 강제 청산한다', () => {
      const r = replay(q([mk(100, 102, 99, 101, 100, 2), mk(101, 103, 100, 102, 100, 3)]), long)
      expect(r.filled).toBe(true)
      expect(r.exit).toBe('forced')
      expect(r.exitBarIndex).toBe(3)
      expect(r.r).toBeCloseTo((102 - 100) / 5, 5)
      expect(r.pnlPct).toBeCloseTo(2, 5)
    })

    it('체결 봉과 청산 봉이 다를 수 있다 — 체결 이후 봉에서 SL 이 터진다', () => {
      // 체결 봉(2번)에서는 SL/TP 어느 쪽도 안 닿고, 다음 봉(3번)에서 SL 이 터진다.
      // filled 상태가 봉을 넘어 유지되는지 확인한다.
      const r = replay(
        q([mk(100, 102, 99, 101, 100, 2), mk(101, 103, 94, 95, 100, 3)]),
        long,
      )
      expect(r.filled).toBe(true)
      expect(r.exit).toBe('sl')
      expect(r.exitBarIndex).toBe(3)
      expect(r.r).toBeCloseTo(-1, 5)
      expect(r.pnlPct).toBeCloseTo(-5, 5)
    })

    it('takeProfit 이 없으면 TP 로는 청산되지 않는다 — 강제청산으로 빠진다', () => {
      // 값만 보면 TP=110 을 터치할 법한 봉이지만, takeProfit 을 아예 안 정했으므로
      // hitTp 판정 자체가 없다 — 마지막 종가로 강제 청산해야 한다.
      const a: Answer = { ...long, takeProfit: undefined }
      const r = replay(q([mk(100, 111, 99, 110, 100, 2)]), a)
      expect(r.filled).toBe(true)
      expect(r.exit).toBe('forced')
      expect(r.exitBarIndex).toBe(2)
      expect(r.r).toBeCloseTo(2, 5)
      expect(r.pnlPct).toBeCloseTo(10, 5)
    })

    it('entry 가 없으면 재생하지 않는다', () => {
      const a: Answer = { ...long, entry: undefined }
      const r = replay(q([mk(100, 111, 99, 110, 100, 2)]), a)
      expect(r.filled).toBe(false)
      expect(r.exit).toBe('none')
      expect(r.exitBarIndex).toBeNull()
      expect(r.r).toBe(0)
      expect(r.pnlPct).toBe(0)
    })

    it('stopLoss 가 없으면 재생하지 않는다', () => {
      const a: Answer = { ...long, stopLoss: undefined }
      const r = replay(q([mk(100, 111, 99, 110, 100, 2)]), a)
      expect(r.filled).toBe(false)
      expect(r.exit).toBe('none')
      expect(r.exitBarIndex).toBeNull()
      expect(r.r).toBe(0)
      expect(r.pnlPct).toBe(0)
    })

    it('손절폭이 0이면 r 은 0이고, 체결과 동시에 SL 로 처리된다', () => {
      // entry===stopLoss 면 체결 조건(low<=entry<=high)과 SL 터치 조건(long: low<=stopLoss)이
      // 대수적으로 같아진다 — 체결되는 순간 항상 SL 도 함께 터진다. exit 이 'tp' 나
      // 'forced' 로 새서 손실 0인 트레이드가 이익처럼 보이면 채점이 조용히 오염된다.
      const a: Answer = { ...long, stopLoss: 100 }
      const r = replay(q([mk(100, 111, 99, 110, 100, 2)]), a)
      expect(r.filled).toBe(true)
      expect(r.exit).toBe('sl')
      expect(r.r).toBe(0)
      expect(r.pnlPct).toBe(0)
    })

    it('결정 봉 이하는 재생 대상이 아니다 — 결정 봉이 진입가를 포함해도 무시한다', () => {
      // 결정 봉(index1)은 low=99/high=101 이라 entry=100 을 포함하지만, 이건 솔버가
      // 이미 본 화면이라 재생 대상이면 안 된다. 은닉 봉은 entry(100)와 전혀 무관한
      // 범위(199~201)라서, 루프가 decisionIndex+1 부터 도는 구현이면 끝까지 미체결이어야
      // 한다. 만약 구현이 실수로 decisionIndex 부터(결정 봉 포함) 돈다면 결정 봉에서
      // 체결된 뒤 은닉 봉의 고가(201)가 TP(110)를 넘어서 'tp' 로 잘못 청산된다.
      const r = replay(q([mk(200, 201, 199, 200, 100, 2)]), long)
      expect(r.filled).toBe(false)
      expect(r.exit).toBe('none')
      expect(r.exitBarIndex).toBeNull()
      expect(r.r).toBe(0)
    })
  })

  describe('숏 (롱과 대칭)', () => {
    it('TP 를 터치하면 익절이다', () => {
      const r = replay(q([mk(100, 101, 89, 90, 100, 2)]), short)
      expect(r.filled).toBe(true)
      expect(r.exit).toBe('tp')
      expect(r.exitBarIndex).toBe(2)
      expect(r.r).toBeCloseTo(2, 5)
      expect(r.pnlPct).toBeCloseTo(10, 5)
    })

    it('SL 을 터치하면 손절이다', () => {
      const r = replay(q([mk(100, 106, 99, 105, 100, 2)]), short)
      expect(r.filled).toBe(true)
      expect(r.exit).toBe('sl')
      expect(r.exitBarIndex).toBe(2)
      expect(r.r).toBeCloseTo(-1, 5)
      expect(r.pnlPct).toBeCloseTo(-5, 5)
    })

    it('같은 봉에서 SL 과 TP 를 모두 터치하면 SL 우선이다', () => {
      const r = replay(q([mk(100, 106, 89, 100, 100, 2)]), short)
      expect(r.filled).toBe(true)
      expect(r.exit).toBe('sl')
      expect(r.exitBarIndex).toBe(2)
      expect(r.r).toBeCloseTo(-1, 5)
      expect(r.pnlPct).toBeCloseTo(-5, 5)
    })

    it('진입가에 닿지 않으면 미체결이다', () => {
      const a: Answer = { ...short, entry: 200 }
      const r = replay(q([mk(100, 101, 99, 100, 100, 2)]), a)
      expect(r.filled).toBe(false)
      expect(r.exit).toBe('none')
      expect(r.exitBarIndex).toBeNull()
      expect(r.r).toBe(0)
      expect(r.pnlPct).toBe(0)
    })

    it('은닉 구간 안에 청산되지 않으면 마지막 종가로 강제 청산한다', () => {
      const r = replay(
        q([mk(100, 101, 99, 100, 100, 2), mk(100, 102, 98, 99, 100, 3)]),
        short,
      )
      expect(r.filled).toBe(true)
      expect(r.exit).toBe('forced')
      expect(r.exitBarIndex).toBe(3)
      expect(r.r).toBeCloseTo((100 - 99) / 5, 5)
      expect(r.pnlPct).toBeCloseTo(1, 5)
    })

    it('체결 봉과 청산 봉이 다를 수 있다', () => {
      const r = replay(
        q([mk(100, 102, 99, 101, 100, 2), mk(101, 106, 98, 105, 100, 3)]),
        short,
      )
      expect(r.filled).toBe(true)
      expect(r.exit).toBe('sl')
      expect(r.exitBarIndex).toBe(3)
      expect(r.r).toBeCloseTo(-1, 5)
      expect(r.pnlPct).toBeCloseTo(-5, 5)
    })

    it('손절폭이 0이면 r 은 0이고, 체결과 동시에 SL 로 처리된다', () => {
      const a: Answer = { ...short, stopLoss: 100 }
      const r = replay(q([mk(100, 111, 99, 110, 100, 2)]), a)
      expect(r.filled).toBe(true)
      expect(r.exit).toBe('sl')
      expect(r.r).toBe(0)
      expect(r.pnlPct).toBe(0)
    })
  })

  describe('관망', () => {
    it('관망이면 재생하지 않는다', () => {
      const r = replay(q([mk(100, 111, 94, 100, 100, 2)]), { direction: 'flat', tags: [] })
      expect(r.filled).toBe(false)
      expect(r.exit).toBe('none')
      expect(r.exitBarIndex).toBeNull()
      expect(r.r).toBe(0)
      expect(r.pnlPct).toBe(0)
    })
  })
})
