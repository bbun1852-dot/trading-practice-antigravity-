import { DURATION, HIGHER_TF, type Candle, type Timeframe } from '../data/types'
import { atr } from '../analysis/indicators'
import { activeSignalsAt } from './lifetime'
import { dominantSide, difficultyOf } from './scanner'
import type { Direction, Question, QuestionType, SetupCandidate, SolverView } from './types'

/** 창 구성: 워밍업(지표·신호 안정화) + 가시 구간 + 은닉 구간 */
export const WARMUP = 120
export const VISIBLE = 220
export const HIDDEN = 60

/** 방향 판정 임계값: 은닉 구간에서 이 배수의 ATR 이상 먼저 움직인 쪽이 정답이다 */
const TARGET_ATR_MULT = 1.5

/**
 * 문제로 낼 수 있는 유효 근거 개수 대역 (Task 5 실측: 8~15, 중앙값 11).
 *
 * 아래쪽(8 미만)은 "채점할 근거가 거의 없다" 는 뜻이라 문제가 성립하지 않는다.
 * 위쪽(15 초과)은 Answer.tags 의 체크 상한(15개, types.ts)과 직접 부딪힌다 — 결정
 * 시점의 유효 근거가 16개 이상이면 완벽하게 푼 답조차 전부 체크할 수 없어서
 * coreMiss 가 구조적으로 발생한다.
 *
 * 실측(scanForSetups 기본값 minScore=125 통과 후보, 심볼 5종×4h/1d, 2026-08-01Z
 * 고정 1000봉 창, window-local 재계산 기준): 창을 확보할 수 있는 후보 186개 중
 * 대역 안 108개(58.1%), 전부 위쪽 초과로 탈락한 78개(41.9%) — 아래쪽 미달은
 * 0개였다. 스캐너가 이미 점수 높은(=근거가 많이 쌓인) 자리만 통과시키므로,
 * 실전에서 이 게이트가 잘라내는 건 사실상 전부 "근거 과다" 쪽이다. Task 5가
 * 측정한 18.5%(전체 결정 시점 모집단 기준, 위아래 섞임)보다 이 수치가 훨씬 큰
 * 것은 표본이 다르기 때문이다 — Task 5는 20봉 간격으로 뽑은 임의 시점, 여기는
 * 이미 setupScore 필터를 통과한 "좋은" 후보만 본다.
 */
export const MIN_EVIDENCE = 8
export const MAX_EVIDENCE = 15

/**
 * 은닉 구간에서 어느 쪽으로 TARGET_ATR_MULT 이상 **먼저** 움직였는가.
 * 양쪽 다 미달이면 무방향(flat)이 정답이다.
 */
export function classifyOutcome(
  cs: Candle[], decisionIndex: number, hiddenCount: number,
): { direction: Direction; upAtr: number; downAtr: number } {
  const a = atr(cs, 14)[decisionIndex]
  const base = cs[decisionIndex].close
  const end = Math.min(decisionIndex + hiddenCount, cs.length - 1)

  let upAtr = 0
  let downAtr = 0
  // ATR 이 아직 확정되지 않았거나(NaN, 워밍업 부족) 0 이하면 배수 판정 자체가
  // 무의미하다 — 조용히 이상한 값을 내지 않고 명시적으로 무방향 처리한다.
  if (!Number.isFinite(a) || a <= 0) return { direction: 'flat', upAtr, downAtr }

  for (let j = decisionIndex + 1; j <= end; j++) {
    const upNow = (cs[j].high - base) / a
    const downNow = (base - cs[j].low) / a
    upAtr = Math.max(upAtr, upNow)
    downAtr = Math.max(downAtr, downNow)

    const upHit = upNow >= TARGET_ATR_MULT
    const downHit = downNow >= TARGET_ATR_MULT
    // 한 봉 안에서 고가·저가가 둘 다 임계값을 넘기면, 봉 하나만으로는 어느 쪽이
    // 실제로 먼저였는지 알 수 없다(분 단위 내부 순서는 데이터에 없다). 이 경우는
    // 임의로 한쪽을 편들지 않고 무방향으로 명시한다.
    if (upHit && downHit) return { direction: 'flat', upAtr, downAtr }
    if (upHit) return { direction: 'long', upAtr, downAtr }
    if (downHit) return { direction: 'short', upAtr, downAtr }
  }
  return { direction: 'flat', upAtr, downAtr }
}

/**
 * 문제 유형: 무방향이면 노셋업, 우세 신호와 실제 방향이 갈리면 함정, 그 외 정상.
 *
 * activeCount>=3 문턱은 기본 근거 게이트(8~15)가 걸려 있으면 항상 참이 되어
 * 사실상 무해하지만, opts 로 게이트를 느슨하게 조정한 호출(예: minEvidence 0)에서도
 * "근거가 한둘뿐인데 함정으로 분류" 되는 것을 막는 방어선으로 남겨 둔다.
 */
function classifyType(
  direction: Direction, activeCount: number, dom: 'bullish' | 'bearish' | 'neutral',
): QuestionType {
  if (direction === 'flat') return 'no_setup'
  const domDir: Direction = dom === 'bullish' ? 'long' : dom === 'bearish' ? 'short' : 'flat'
  if (activeCount >= 3 && domDir !== 'flat' && domDir !== direction) return 'trap'
  return 'normal'
}

/**
 * 후보 봉이 창의 decisionIndex 가 되도록 창(기본 400봉 = warmup+visible+hidden)을
 * 자른다. 창을 확보할 수 없거나 결정 시점의 유효 근거가 대역 밖이면 null.
 *
 * **유형·난이도·근거 게이트는 전부 이 창(window) 위에서 다시 계산한다.** scanner 가
 * candidate 에 채워 둔 dominantSide/activeCount/difficulty 를 그대로 갖다 쓰지
 * 않는다 — 그 값들은 candidate 를 찾을 때 쓴 원본 cs 전체 이력 기준이고, 이후
 * 채점(Task 9)은 이 Question.candles 만 갖고 activeSignalsAt(q.candles, q.decisionIndex)
 * 로 정답 근거를 다시 산출할 수밖에 없다(원본 cs 는 Question 에 담기지 않으므로
 * 채점기가 볼 방법이 없다). type·difficulty·근거 게이트를 지금 이 자리에서 같은
 * 창·같은 함수로 계산해 둬야 나중에 채점 기준과 어긋나지 않는다.
 *
 * 실측(실데이터 5종×4h/1d, 2026-08-01Z 고정 1000봉)으로 이 어긋남이 실제로 있다는
 * 걸 확인했다 — 후보 233개 중 7개(3.0%)에서 전체이력 계산과 warmup=120(창 로컬
 * 339봉 이력) 계산의 activeCount 가 달랐고, 그중 1개는 dominantSide 자체가
 * 뒤집혔다(SOLUSDT 4h bar=572: 전체이력 bearish ↔ 창 로컬 bullish). scanner 의
 * candidate 필드를 그대로 믿으면 채점 기준과 다른 "함정/정상" 라벨이 나갈 수 있었다.
 */
export function makeQuestion(
  cs: Candle[], symbol: string, tf: Timeframe, candidate: SetupCandidate,
  opts: {
    htfCs?: Candle[]; htfTf?: Timeframe
    warmup?: number; visible?: number; hidden?: number
    minEvidence?: number; maxEvidence?: number
    requiredTags?: string[]
  } = {},
): Question | null {
  const warmup = opts.warmup ?? WARMUP
  const visible = opts.visible ?? VISIBLE
  const hidden = opts.hidden ?? HIDDEN
  const minEvidence = opts.minEvidence ?? MIN_EVIDENCE
  const maxEvidence = opts.maxEvidence ?? MAX_EVIDENCE
  const decisionIndex = warmup + visible - 1

  const start = candidate.barIndex - decisionIndex
  const end = candidate.barIndex + hidden + 1
  if (start < 0 || end > cs.length) return null

  const window = cs.slice(start, end)
  
  let windowHtf: Candle[] = []
  if (opts.htfCs && opts.htfTf) {
    const minTime = window[0].time - DURATION[opts.htfTf]
    const maxTime = window[window.length - 1].time + DURATION[tf]
    windowHtf = opts.htfCs.filter(c => c.time >= minTime && c.time <= maxTime)
  }

  const active = activeSignalsAt(window, decisionIndex, tf, windowHtf, opts.htfTf)
  if (active.length < minEvidence || active.length > maxEvidence) return null
  
  if (opts.requiredTags && opts.requiredTags.length > 0) {
    const hasRequired = active.some(s => opts.requiredTags!.includes(s.id))
    if (!hasRequired) return null
  }

  const { direction } = classifyOutcome(window, decisionIndex, hidden)
  const dom = dominantSide(active)

  return {
    symbol,
    timeframe: tf,
    startTime: window[0].time,
    decisionIndex,
    // direction 은 은닉 구간을 읽어서 나온 값이라 type 도 정답 파생값이다 — 풀기 전엔
    // 노출 금지(solverView 에 없음, revealed() 로만 공개).
    type: classifyType(direction, active.length, dom),
    // active 는 decisionIndex 시점의 유효 근거만이다(activeSignalsAt 이 미래 신호를
    // 애초에 걸러낸다) — difficulty 는 은닉 구간과 무관하고 풀기 전에 보여줘도 안전하다.
    difficulty: difficultyOf(active),
    candles: window,
    htfCandles: windowHtf,
  }
}

/**
 * 솔버가 풀 때 실제로 보게 되는 투영(projection). `Question` 을 그대로 넘기면
 * `candles` 에 은닉 봉이, 최상위 필드에 symbol/startTime/type 이 그대로 실려
 * 있어서 `JSON.stringify(question)` 한 번으로 정답이 나간다 — 이 함수가 유일하게
 * 안전한 경로다.
 *
 * 구조적으로 안전하다: 반환 타입(SolverView)에는 symbol/startTime/type/decisionIndex
 * 필드 자체가 없고(관습이 아니라 타입에 없다), candles 는 slice 로 만든 새 배열이라
 * 은닉 봉 참조가 아예 들어 있지 않다. 이 반환값을 들고 있는 코드는 원본 Question 을
 * 함께 갖고 있지 않은 한 은닉 봉이나 비밀 필드에 접근할 방법이 없다.
 */
export function solverView(q: Question): SolverView {
  const htfTf = HIGHER_TF[q.timeframe]
  const decisionTime = q.candles[q.decisionIndex].time + DURATION[q.timeframe]
  return {
    timeframe: q.timeframe,
    difficulty: q.difficulty,
    candles: q.candles.slice(0, q.decisionIndex + 1),
    htfCandles: q.htfCandles.filter(c => c.time + DURATION[htfTf] <= decisionTime),
  }
}

/**
 * 채점이 끝난 뒤에만 공개하는 것들 — 종목, 결정 봉의 시각, 그리고 문제 유형.
 * type 을 여기 포함하는 이유: 함정/노셋업 여부는 은닉 구간에서 파생되므로
 * symbol/time 못지않게 정답을 흘린다 — 방향을 하나도 안 짚고 "함정이니 반대로"
 * 만 해도 맞힐 수 있다. 문제 중에 알면 기억으로 답을 맞히거나(symbol/time),
 * 근거 없이 답만 뒤집어서(type) 맞히게 되어 연습이 성립하지 않는다(스펙 5.2).
 */
export function revealed(q: Question): { symbol: string; time: number; type: QuestionType } {
  return { symbol: q.symbol, time: q.candles[q.decisionIndex].time, type: q.type }
}
