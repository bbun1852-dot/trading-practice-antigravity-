/**
 * 문제 생성 파이프라인 (브라우저) — 스펙 §3.
 *
 *   심볼·TF 결정 → cache.getCandles(본TF + 상위TF) → scanForSetups 로 후보 →
 *   균등 랜덤 순서로 makeQuestion → 처음 성립한 문제를 낸다
 *
 * **스캔 범위를 문제 창을 만들 수 있는 봉으로 좁힌다 (스펙 §3 대비 변경, 실측 근거).**
 * scanForSetups 는 WARMUP(120)부터 끝까지 전부 훑는데, makeQuestion 은 앞뒤로
 * 창(warmup 120 + visible 220 + hidden 60)이 확보되는 봉에서만 성립한다. 1000봉을
 * 통째로 넘기면 봉 120~338 과 뒤쪽 60봉은 **애초에 문제가 될 수 없는 자리인데도
 * 정확 경로가 돈다.**
 *
 * 실측(2026-08-15, tsx/Node, 실데이터 5종×4h·1d): scanForSetups(1000봉) 은 심볼당
 * 8.3~9.6초다. 봉당 약 10.6ms 인 2단계(activeSignalsAt)가 880봉 전부에 도는 탓이고,
 * 1단계 지름길은 사실상 열려 있다(coarseFloor = minScore 85 − COARSE_SLACK 100 = −15,
 * 즉 모든 봉 통과). 3초 게이트를 두 배 넘게 초과한다.
 *
 * 그래서 유효 범위를 SCAN_CHUNK 봉짜리 구간으로 쪼개 **무작위 순서로 한 구간씩만**
 * 스캔한다. 첫 구간에서 문제가 나오면 거기서 끝이고(대개 그렇다), 안 나오면 다음
 * 구간으로 간다. 구간은 겹치지 않으므로 같은 봉을 두 번 계산하지 않고, 전 구간을
 * 소진하면 "이 심볼·TF 에는 낼 문제가 없다" 가 참인 결론이 된다.
 *
 * 스캔 슬라이스에는 앞쪽 WARMUP 봉을 붙여 넘긴다 — scanForSetups 가 자기 입력의
 * 앞 120봉을 워밍업으로 건너뛰는 것과 같은 규약이다. 후보의 barIndex 는 슬라이스
 * 기준이므로 전체 배열 기준으로 되돌린 뒤 makeQuestion 에 넘긴다(makeQuestion 은
 * 전체 배열에서 창을 다시 자르므로 창 자체는 어느 쪽으로 스캔했든 동일하다).
 *
 * 구간 크기 스윕 (Node, 실데이터 5종×4h·1d×seed 3개 = n=30, 문제 하나를 뽑는 데 걸린 시간):
 *   100봉 미측정 · 150봉 p50 479ms · 250봉 p50 1007ms · 400봉 p50 2005ms
 * 브라우저(Chrome, 랜덤 심볼 10회, 네트워크 포함):
 *   250봉 p50 2601ms p90 3636ms · 150봉 p50 1344ms p90 2392ms · 100봉 p50 859ms p90 2140ms
 *
 * 150봉을 쓴다. 구간이 작을수록 "안 될 자리" 를 덜 훑지만, 구간마다 워밍업 120봉과
 * detectAll 을 다시 치르므로 100봉 아래로는 그 고정비가 이득을 갉아먹는다.
 *
 * **Task 4 게이트 (스펙 §8): 캐시를 비운 브라우저에서 랜덤 심볼 10회 —
 * p50 1375ms · p90 1706ms · 실패 0. 기준 3초를 두 배 여유로 통과한다.**
 *
 * Web Worker 는 도입하지 않는다. 스펙 §3 은 p50 > 3초면 워커를 붙이라고 적었지만,
 * 워커는 벽시계 시간을 줄이지 않고 UI 스레드만 비운다 — 진짜 문제는 "낼 수 없는
 * 자리를 계산하는 것" 이었고 그건 위에서 없앴다. 구간 사이마다 이벤트 루프에
 * 양보하므로(yieldToPaint) 로딩 화면의 진행 표시는 갱신된다.
 */
import { SYMBOL_POOL } from '../data/binance'
import { getCandles } from '../data/cache'
import { HIGHER_TF, type Candle, type Timeframe } from '../data/types'
import { HIDDEN, VISIBLE, WARMUP, makeQuestion } from '../quiz/generator'
import { scanForSetups } from '../quiz/scanner'
import type { Question, SetupCandidate } from '../quiz/types'

/**
 * v1 이 실제로 낼 수 있는 TF — calibrate 가 검증한 두 개뿐이다 (스펙 §1 비목표).
 * 15m·1h 는 게이트를 다시 재는 별도 파트다.
 */
export const DRILL_TIMEFRAMES = ['4h', '1d'] as const
export type DrillTimeframe = (typeof DRILL_TIMEFRAMES)[number]

/** 한 번에 받아 두는 캔들 수 (drill.ts 와 같다) */
export const CANDLE_LIMIT = 1000

/** 한 구간에서 정확 경로를 돌리는 봉 수. 스윕 실측으로 정했다(위 주석) */
export const SCAN_CHUNK = 150

/** 심볼을 지정하지 않았을 때 최대 몇 종까지 갈아타며 시도하는가 */
export const SYMBOL_TRIES = 3

/** 창의 결정 봉 인덱스. makeQuestion 의 창 구성과 같은 값이어야 한다 */
const DECISION_INDEX = WARMUP + VISIBLE - 1

export type CandleLoader = (symbol: string, tf: Timeframe, limit: number) => Promise<Candle[]>

export type Stage = {
  kind: 'candles' | 'scan' | 'compose'
  symbol: string
  tf: DrillTimeframe
  /** scan 단계에서만: 지금 몇 번째 구간인가 (1-based) */
  chunk?: number
  chunks?: number
}

export type GenerateOptions = {
  /** null|undefined = SYMBOL_POOL 에서 랜덤  */
  symbol?: string | null
  /** null|undefined = DRILL_TIMEFRAMES 에서 랜덤  */
  tf?: DrillTimeframe | null
  rng?: () => number
  /** 로컬에 저장된 IndexedDB 캐시. 없을 시 기본 캐시 사용  */
  loadCandles?: CandleLoader
  onStage?: (s: Stage) => void
  /** 중단 시그널 */
  signal?: { readonly aborted: boolean }
  requiredTags?: string[]
}

/**
 * 문제 창을 확보할 수 있는 봉의 범위 [from, to] (전체 배열 기준).
 * 캔들이 창 하나도 못 채우면 null.
 */
export function viableRange(csLen: number): { from: number; to: number } | null {
  const from = DECISION_INDEX
  const to = csLen - HIDDEN - 1
  return to < from ? null : { from, to }
}

/**
 * 유효 범위를 겹치지 않는 구간으로 쪼갠다. 마지막 구간은 짧을 수 있다.
 * 합집합은 정확히 viableRange 와 같다 — 어떤 봉도 빠지거나 두 번 들어가지 않는다.
 */
export function scanChunks(csLen: number, chunk = SCAN_CHUNK): Array<{ from: number; to: number }> {
  const range = viableRange(csLen)
  if (!range) return []
  const out: Array<{ from: number; to: number }> = []
  for (let from = range.from; from <= range.to; from += chunk) {
    out.push({ from, to: Math.min(range.to, from + chunk - 1) })
  }
  return out
}

/** Fisher-Yates. 원본을 건드리지 않는다 */
export function shuffle<T>(xs: readonly T[], rng: () => number): T[] {
  const a = [...xs]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/**
 * 한 구간의 후보. barIndex 는 전체 배열 기준으로 돌려준다.
 *
 * 슬라이스 앞에 WARMUP 봉을 덧대므로 구간의 첫 봉도 scanForSetups 가 요구하는
 * 워밍업을 갖춘다. 슬라이스에 잘려 나간 더 오래된 이력은 보지 못하지만, 그건
 * scanForSetups 가 자기 입력의 첫 120봉에 대해 하는 것과 같은 취급이다 — 그리고
 * 후보의 점수·난이도는 어차피 makeQuestion 이 창 위에서 다시 계산한다(generator.ts).
 */
export function candidatesIn(
  cs: Candle[], tf: Timeframe, htfCs: Candle[], range: { from: number; to: number },
): SetupCandidate[] {
  const sliceFrom = range.from - WARMUP
  const slice = cs.slice(sliceFrom, range.to + 1)
  return scanForSetups(slice, { tf, htfCs, htfTf: HIGHER_TF[tf] })
    .map((c) => ({ ...c, barIndex: c.barIndex + sliceFrom }))
    .filter((c) => c.barIndex >= range.from && c.barIndex <= range.to)
}

/** 무거운 동기 계산 사이에 이벤트 루프를 비워 준다 — 로딩 화면이 진행 상황을 그릴 틈 */
const yieldToPaint = () => new Promise((r) => setTimeout(r, 0))

const pick = <T>(xs: readonly T[], rng: () => number): T => xs[Math.floor(rng() * xs.length)]

/** 중단 신호가 켜졌으면 여기서 끊는다. 호출부는 자기 신호를 확인하고 조용히 버린다 */
function checkAborted(signal: GenerateOptions['signal']): void {
  if (signal?.aborted) throw new Error('문제 생성이 중단됐다')
}

async function questionFrom(
  symbol: string, tf: DrillTimeframe, rng: () => number, opts: GenerateOptions,
): Promise<Question | null> {
  const { onStage, signal } = opts
  const load = opts.loadCandles ?? getCandles

  onStage?.({ kind: 'candles', symbol, tf })
  // fetch 실패는 "Failed to fetch" 한 줄로 올라온다 — 어느 심볼·TF 였는지 붙여 준다.
  // 오류 화면이 사용자에게 보여 줄 수 있는 정보는 이게 전부다.
  let cs: Candle[]
  let htfCs: Candle[]
  try {
    cs = await load(symbol, tf, CANDLE_LIMIT)
    htfCs = await load(symbol, HIGHER_TF[tf], CANDLE_LIMIT)
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    throw new Error(`${symbol} ${tf} 캔들을 받지 못했다 — ${detail}`)
  }
  checkAborted(signal)

  const chunks = shuffle(scanChunks(cs.length), rng)
  for (const [i, range] of chunks.entries()) {
    onStage?.({ kind: 'scan', symbol, tf, chunk: i + 1, chunks: chunks.length })
    await yieldToPaint()
    checkAborted(signal)

    for (const cand of shuffle(candidatesIn(cs, tf, htfCs, range), rng)) {
      const q = makeQuestion(cs, symbol, tf, cand, { 
        htfCs, 
        htfTf: HIGHER_TF[tf],
        requiredTags: opts.requiredTags 
      })
      if (q) {
        onStage?.({ kind: 'compose', symbol, tf })
        return q
      }
    }
  }
  return null
}

/**
 * 문제 하나. 심볼·TF 를 지정하지 않으면 랜덤이고, 한 심볼에서 낼 문제를 못 찾으면
 * (지정하지 않은 경우에 한해) 다른 심볼로 갈아탄다.
 *
 * 던지는 경우는 둘이다 — 캔들을 못 받았거나(네트워크·차단), 시도한 심볼 전부에서
 * 조건을 만족하는 자리를 못 찾았거나. 호출부는 오류 화면과 재시도로 받는다.
 */
export async function generateQuestion(opts: GenerateOptions = {}): Promise<Question> {
  const rng = opts.rng ?? Math.random
  const tf = opts.tf ?? pick(DRILL_TIMEFRAMES, rng)
  const symbols = opts.symbol
    ? [opts.symbol]
    : shuffle(SYMBOL_POOL, rng).slice(0, SYMBOL_TRIES)

  for (const symbol of symbols) {
    const q = await questionFrom(symbol, tf, rng, opts)
    if (q) return q
  }

  throw new Error(
    `${symbols.join(', ')} (${tf}) 전 구간을 훑었지만 문제로 낼 자리를 찾지 못했다. ` +
    `다시 시도하면 다른 구간·심볼을 본다.`,
  )
}
