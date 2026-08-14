import { describe, it, expect } from 'vitest'
import {
  classifyOutcome, makeQuestion, revealed, solverView,
  WARMUP, VISIBLE, HIDDEN, MIN_EVIDENCE, MAX_EVIDENCE,
} from './generator'
import { scanForSetups } from './scanner'
import { activeSignalsAt } from './lifetime'
import { atr } from '../analysis/indicators'
import { mk, synthCandles } from '../analysis/fixtures'
import type { SetupCandidate } from './types'

describe('classifyOutcome', () => {
  // ATR 을 1 근처로 안정시키는 도입부
  const lead = (n: number) => Array.from({ length: n }, (_, i) => mk(100, 100.5, 99.5, 100, 100, i))

  it('상방으로 1.5 ATR 이상 먼저 가면 long', () => {
    const cs = [...lead(200), ...Array.from({ length: 60 }, (_, i) => mk(100, 110, 99.5, 109, 100, 200 + i))]
    expect(classifyOutcome(cs, 199, 60).direction).toBe('long')
  })

  it('하방으로 1.5 ATR 이상 먼저 가면 short', () => {
    const cs = [...lead(200), ...Array.from({ length: 60 }, (_, i) => mk(100, 100.5, 90, 91, 100, 200 + i))]
    expect(classifyOutcome(cs, 199, 60).direction).toBe('short')
  })

  it('양쪽 다 1.5 ATR 에 못 미치면 flat', () => {
    const cs = [...lead(260)]
    expect(classifyOutcome(cs, 199, 60).direction).toBe('flat')
  })

  it('같은 봉 안에서 양쪽 다 1.5 ATR 에 닿으면 flat (동시 도달 타이브레이크)', () => {
    // base = cs[199].close = 100, ATR ≈ 1. 첫 은닉 봉의 고가·저가가 둘 다
    // 1.5 ATR 를 넘도록 만든다 — 어느 쪽이 먼저인지 봉 하나로는 알 수 없다.
    const cs = [...lead(200), mk(100, 105, 90, 100, 100, 200), ...lead(59)]
    const r = classifyOutcome(cs, 199, 60)
    expect(r.direction).toBe('flat')
    expect(r.upAtr).toBeGreaterThanOrEqual(1.5)
    expect(r.downAtr).toBeGreaterThanOrEqual(1.5)
  })

  it('ATR 이 아직 확정되지 않은(NaN) 구간에서는 던지지 않고 flat 으로 죽는다', () => {
    // period(14) 보다 짧은 배열이면 atr() 는 전부 NaN 을 낸다.
    const cs = lead(10)
    expect(() => classifyOutcome(cs, 5, 3)).not.toThrow()
    expect(classifyOutcome(cs, 5, 3).direction).toBe('flat')
  })
})

describe('makeQuestion', () => {
  const cs = synthCandles(1000)
  const decisionIndex = WARMUP + VISIBLE - 1

  // 창을 확보할 수 있는(=start>=0, end<=cs.length) 후보만 골라서, 그 위에서
  // 실제로 계산되는 window-local 유효 근거 개수(구현이 쓰는 것과 같은 계산)로
  // 대역 안/밖 후보를 각각 찾는다. 매직 넘버를 미리 박아 넣지 않는다 —
  // synthCandles 나 감지 로직이 바뀌어도 이 테스트는 그대로 유효하다.
  const viable = scanForSetups(cs, { minScore: 0 }).filter((c) => {
    const start = c.barIndex - decisionIndex
    const end = c.barIndex + HIDDEN + 1
    return start >= 0 && end <= cs.length
  })
  const evidenceCountAt = (barIndex: number): number => {
    const start = barIndex - decisionIndex
    const window = cs.slice(start, barIndex + HIDDEN + 1)
    return activeSignalsAt(window, decisionIndex).length
  }
  const cand = viable.find((c) => {
    const n = evidenceCountAt(c.barIndex)
    return n >= MIN_EVIDENCE && n <= MAX_EVIDENCE
  })
  const outOfBandCand = viable.find((c) => {
    const n = evidenceCountAt(c.barIndex)
    return n < MIN_EVIDENCE || n > MAX_EVIDENCE
  })

  it('테스트 전제: 대역 안/밖 후보를 실측으로 둘 다 찾을 수 있다', () => {
    // 이 전제가 깨지면 아래 게이트 테스트들이 조용히 의미를 잃는다 — 먼저 여기서 잡는다.
    expect(cand).toBeDefined()
    expect(outOfBandCand).toBeDefined()
  })

  it('창 길이가 warmup + visible + hidden 이다', () => {
    const q = makeQuestion(cs, 'BTCUSDT', '4h', cand!)!
    expect(q.candles).toHaveLength(WARMUP + VISIBLE + HIDDEN)
  })

  it('decisionIndex 가 후보 봉을 가리키고, 은닉 개수가 정확히 HIDDEN 이다', () => {
    const q = makeQuestion(cs, 'BTCUSDT', '4h', cand!)!
    expect(q.decisionIndex).toBe(decisionIndex)
    // 창 안의 결정 봉이 원본의 후보 봉과 같은 캔들(참조 동일성)이어야 한다
    expect(q.candles[q.decisionIndex]).toBe(cs[cand!.barIndex])
    // decisionIndex 뒤로 정확히 HIDDEN 개의 봉만 남는다
    expect(q.candles.length - 1 - q.decisionIndex).toBe(HIDDEN)
  })

  it('startTime 이 창 첫 봉의 time 이다', () => {
    const q = makeQuestion(cs, 'BTCUSDT', '4h', cand!)!
    expect(q.startTime).toBe(q.candles[0].time)
  })

  it('같은 입력이면 같은 문제가 나온다 (재현성)', () => {
    expect(makeQuestion(cs, 'BTCUSDT', '4h', cand!)).toEqual(makeQuestion(cs, 'BTCUSDT', '4h', cand!))
  })

  it('창을 앞으로 확보할 수 없으면(워밍업 부족) null 을 낸다', () => {
    const short = synthCandles(200)
    const early: SetupCandidate = { ...cand!, barIndex: 150 }
    expect(makeQuestion(short, 'BTCUSDT', '4h', early)).toBeNull()
  })

  it('창을 뒤로 확보할 수 없으면(은닉 부족) null 을 낸다', () => {
    // 배열 맨 끝 근처 후보는 hidden(60)봉을 다 못 채운다
    const cs2 = synthCandles(400)
    const late: SetupCandidate = { ...cand!, barIndex: 395 }
    expect(makeQuestion(cs2, 'BTCUSDT', '4h', late)).toBeNull()
  })

  it('유형이 셋 중 하나다', () => {
    const q = makeQuestion(cs, 'BTCUSDT', '4h', cand!)!
    expect(['normal', 'trap', 'no_setup']).toContain(q.type)
  })

  it('난이도가 셋 중 하나다', () => {
    const q = makeQuestion(cs, 'BTCUSDT', '4h', cand!)!
    expect(['easy', 'medium', 'hard']).toContain(q.difficulty)
  })

  it('결정 시점의 ATR 이 400봉 창 안에서 확정돼 있다 (NaN 이면 판정이 조용히 무너진다)', () => {
    const q = makeQuestion(cs, 'BTCUSDT', '4h', cand!)!
    const a = atr(q.candles, 14)[q.decisionIndex]
    expect(Number.isFinite(a)).toBe(true)
    expect(a).toBeGreaterThan(0)
  })

  it('revealed 로만 종목·시각·유형을 꺼낸다', () => {
    const q = makeQuestion(cs, 'BTCUSDT', '4h', cand!)!
    const r = revealed(q)
    expect(r.symbol).toBe('BTCUSDT')
    expect(r.time).toBe(q.candles[q.decisionIndex].time)
    expect(r.type).toBe(q.type)
  })

  describe('solverView — 솔버가 볼 수 있는 투영', () => {
    const q = makeQuestion(cs, 'BTCUSDT', '4h', cand!)!
    const view = solverView(q)

    it('candles 가 decisionIndex 까지만이고 은닉 봉이 배열에 아예 없다', () => {
      expect(view.candles).toHaveLength(q.decisionIndex + 1)
      expect(view.candles).toEqual(q.candles.slice(0, q.decisionIndex + 1))
    })

    it('마지막 캔들이 곧 결정 봉이다 (참조 동일성)', () => {
      expect(view.candles[view.candles.length - 1]).toBe(q.candles[q.decisionIndex])
    })

    it('timeframe·difficulty 는 원본과 같다', () => {
      expect(view.timeframe).toBe(q.timeframe)
      expect(view.difficulty).toBe(q.difficulty)
    })

    it('비밀 필드(symbol/startTime/type/decisionIndex)가 키로도 존재하지 않는다', () => {
      // 몇 개만 기억해서 확인하는 게 아니라, 반환 객체의 키 전체를 고정한다 —
      // 나중에 누가 편의상 symbol 이나 type 을 슬쩍 끼워 넣어도 여기서 잡힌다.
      expect(Object.keys(view).sort()).toEqual(['candles', 'difficulty', 'htfCandles', 'timeframe'])
      expect('symbol' in view).toBe(false)
      expect('startTime' in view).toBe(false)
      expect('type' in view).toBe(false)
      expect('decisionIndex' in view).toBe(false)
    })
  })

  describe('근거 개수 게이트 (Task 5 실측 대역 8~15)', () => {
    it('대역 안이면 문제가 나온다', () => {
      expect(makeQuestion(cs, 'BTCUSDT', '4h', cand!)).not.toBeNull()
    })

    it('대역 밖이면 null 을 낸다', () => {
      expect(makeQuestion(cs, 'BTCUSDT', '4h', outOfBandCand!)).toBeNull()
    })

    it('opts.minEvidence/maxEvidence 로 대역을 넓히면 대역 밖 후보도 통과한다', () => {
      const q = makeQuestion(cs, 'BTCUSDT', '4h', outOfBandCand!, { minEvidence: 0, maxEvidence: 1000 })
      expect(q).not.toBeNull()
    })
  })
})
