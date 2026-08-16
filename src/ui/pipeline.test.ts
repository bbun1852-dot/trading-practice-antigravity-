import { describe, it, expect } from 'vitest'
import { synthCandles } from '../analysis/fixtures'
import { HIDDEN, VISIBLE, WARMUP } from '../quiz/generator'
import type { Candle, Timeframe } from '../data/types'
import {
  CANDLE_LIMIT, SCAN_CHUNK,
  generateQuestion, scanChunks, shuffle, viableRange,
  type Stage,
} from './pipeline'

/**
 * 파이프라인이 지켜야 하는 것 (스펙 §3):
 * - 스캔 구간 분할이 "문제가 될 수 있는 봉" 을 정확히 덮는다 — 빠뜨리지도, 두 번 세지도 않는다
 * - 캔들은 주입된 로더로만 온다 (테스트는 오프라인 합성 캔들을 쓴다)
 * - 낼 자리를 못 찾으면 조용히 이상한 문제를 내지 않고 던진다
 *
 * 합성 캔들 seed 는 실측으로 골랐다 — 460봉짜리 창에서 seed 7 은 문제가 성립하고
 * seed 2 는 성립하지 않는다. 실데이터를 쓰면 테스트가 네트워크와 시장에 묶인다.
 */

const DECISION_INDEX = WARMUP + VISIBLE - 1

/** 본 TF 는 460봉, 상위 TF 는 하루 간격 80봉을 내는 오프라인 로더 */
function synthLoader(seed: number, mainTf: Timeframe = '4h') {
  const calls: Array<{ symbol: string; tf: Timeframe; limit: number }> = []
  const load = async (symbol: string, tf: Timeframe, limit: number): Promise<Candle[]> => {
    calls.push({ symbol, tf, limit })
    return tf === mainTf ? synthCandles(460, seed) : synthCandles(80, seed + 1, 86400)
  }
  return { load, calls }
}

const seededRng = (seed: number) => () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648

describe('스캔 구간 분할', () => {
  it('유효 범위는 창을 확보할 수 있는 봉만이다', () => {
    expect(viableRange(1000)).toEqual({ from: DECISION_INDEX, to: 1000 - HIDDEN - 1 })
    // 창(warmup+visible+hidden) 하나가 딱 들어가는 최소 길이
    const exact = WARMUP + VISIBLE + HIDDEN
    expect(viableRange(exact)).toEqual({ from: DECISION_INDEX, to: DECISION_INDEX })
    expect(viableRange(exact - 1)).toBeNull()
  })

  it('구간들이 유효 범위를 정확히 덮는다 — 겹치지도 빠뜨리지도 않는다', () => {
    const chunks = scanChunks(1000)
    const range = viableRange(1000)!
    expect(chunks[0].from).toBe(range.from)
    expect(chunks[chunks.length - 1].to).toBe(range.to)
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].from).toBe(chunks[i - 1].to + 1)
    }
    const covered = chunks.reduce((n, c) => n + (c.to - c.from + 1), 0)
    expect(covered).toBe(range.to - range.from + 1)
    for (const c of chunks) expect(c.to - c.from + 1).toBeLessThanOrEqual(SCAN_CHUNK)
  })

  it('캔들이 창 하나도 못 채우면 스캔할 구간이 없다', () => {
    expect(scanChunks(300)).toEqual([])
  })
})

describe('shuffle', () => {
  it('원본을 건드리지 않고 같은 원소의 순열을 낸다', () => {
    const src = [1, 2, 3, 4, 5, 6, 7, 8]
    const out = shuffle(src, seededRng(3))
    expect(src).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect([...out].sort((a, b) => a - b)).toEqual(src)
  })
})

describe('generateQuestion', () => {
  it('주입된 로더의 캔들로 문제를 만든다 — 본 TF 와 상위 TF 를 각각 받는다', async () => {
    const { load, calls } = synthLoader(7)
    const q = await generateQuestion({
      symbol: 'SYNTHUSDT', tf: '4h', rng: seededRng(1), loadCandles: load,
    })

    expect(q.symbol).toBe('SYNTHUSDT')
    expect(q.timeframe).toBe('4h')
    expect(q.decisionIndex).toBe(DECISION_INDEX)
    expect(q.candles).toHaveLength(WARMUP + VISIBLE + HIDDEN)
    expect(calls).toEqual([
      { symbol: 'SYNTHUSDT', tf: '4h', limit: CANDLE_LIMIT },
      { symbol: 'SYNTHUSDT', tf: '1d', limit: CANDLE_LIMIT },
    ])
  })

  it('진행 단계를 캔들 → 스캔 → 출제 순서로 알린다', async () => {
    const { load } = synthLoader(7)
    const stages: Stage[] = []
    await generateQuestion({
      symbol: 'SYNTHUSDT', tf: '4h', rng: seededRng(1), loadCandles: load,
      onStage: (s) => stages.push(s),
    })
    expect(stages[0].kind).toBe('candles')
    expect(stages[1].kind).toBe('scan')
    expect(stages[1].chunks).toBe(scanChunks(460).length)
    expect(stages[stages.length - 1].kind).toBe('compose')
  })

  it('낼 자리가 없으면 던진다 — 심볼을 지정했으면 다른 심볼로 갈아타지 않는다', async () => {
    const { load, calls } = synthLoader(2)
    await expect(
      generateQuestion({ symbol: 'SYNTHUSDT', tf: '4h', rng: seededRng(1), loadCandles: load }),
    ).rejects.toThrow(/SYNTHUSDT/)
    expect(new Set(calls.map((c) => c.symbol))).toEqual(new Set(['SYNTHUSDT']))
  })

  it('중단 신호가 켜지면 계산을 이어가지 않는다', async () => {
    const { load } = synthLoader(7)
    await expect(
      generateQuestion({
        symbol: 'SYNTHUSDT', tf: '4h', rng: seededRng(1), loadCandles: load,
        signal: { aborted: true },
      }),
    ).rejects.toThrow(/중단/)
  })
})
