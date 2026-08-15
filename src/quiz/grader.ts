import type { Confidence } from '../analysis/signalTypes'
import { atr } from '../analysis/indicators'
import { findPivots } from '../analysis/structure'
import { activeSignalsAt, type ActiveSignal } from './lifetime'
import { TAG_BY_ID, signalWeight } from './taxonomy'
import { classifyOutcome } from './generator'
import { replay } from './replay'
import { fmtPrice } from '../format'
import type { Answer, Direction, EvidenceVerdict, GradeReport, Question, ReplayResult } from './types'

export const DIRECTION_MAX = 30
export const EXECUTION_MAX = 40
export const EVIDENCE_MAX = 30
/** 프로세스 = 근거 + 실행. 결과(방향)와 겹치는 항이 하나도 없다 */
export const PROCESS_MAX = EVIDENCE_MAX + EXECUTION_MAX

/**
 * 감점 대상이 되는 '핵심 근거' 개수. **실측으로 5로 정했다.**
 *
 * 기준은 스펙 8.2 가 정한 "핵심이 유효 근거 전체 가중치의 60~80% 를 덮을 것" 이다.
 * 너무 낮으면 중요한 근거가 참고로 밀려나고, 너무 높으면 잔소리가 된다.
 *
 * 측정(scripts/calibrate.ts, 심볼 5종 × 4h/1d, 2026-08-01Z 고정 1000봉에서 실제로
 * 출제된 문제 104개 — grade() 가 실제로 보게 되는 모집단이다):
 *
 *   K=3  중앙 50.7%  (p25 47.0 / p75 54.7)   ← 대역 아래
 *   K=4  중앙 63.0%  (p25 58.4 / p75 68.3)   ← p25 가 60 밑으로 샌다
 *   K=5  중앙 73.6%  (p25 68.2 / p75 78.3)   ← 사분위 구간 전체가 대역 안 ✔
 *   K=6  중앙 83.1%  (p25 77.2 / p75 87.6)   ← 브리프 초안값. 대역 위로 넘어간다
 *   K=8  중앙 95.8%                          ← 사실상 전부가 핵심 = 2단 분리가 무의미
 *
 * 5 만이 사분위 구간(68.2~78.3%)이 통째로 60~80 안에 들어간다. 4 는 아래 경계를,
 * 6 은 위 경계를 넘는다.
 *
 * **2026-08-09 (Part 3) 재측정 — 값은 5 그대로다.** 태그가 49 → 56 종이 되며 고유
 * 태그 중앙값이 9.1 → 10 으로 늘어 같은 K 의 커버리지가 내려갔다: K=5 가 중앙 73.6%
 * → 66.9% 다. 여전히 목표 대역 60~80 안이라 값을 바꾸지 않았다. 다만 사분위 전구간을
 * 요구하면 어떤 K 도 통과하지 못해(K=5 는 p25 59.3%, K=6 은 p75 82.8%) 게이트의 판정
 * 통계를 중앙값으로 되돌렸다 — 자세한 근거는 calibrate.ts 의 체크포인트 ③ 주석에 있다.
 *
 * 두 번째 근거: 참고 계층이 비지 않아야 2단 분리가 의미를 갖는다. 핵심 개수가 고유
 * 태그 수 이상이 되어 참고가 통째로 사라지는 문제의 비율이 K=5 에서 0.0%,
 * K=6 에서 4.8%, K=8 에서 29.8% 다. K=5 는 모든 문제에서 참고 계층이 살아 있다.
 */
export const DEFAULT_CORE_K = 5

/** 헛다리 하나당 기본 감점 (confidence A 기준) */
export const FALSE_CLAIM_PENALTY = 3

/**
 * 감지 신뢰도 등급별 감점 배율 (스펙 6.7).
 * B 는 근사 감지라 절반, C 는 부분 감지라 감점하지 않는다 — 엔진이 못 잡은 것을
 * 사용자 잘못으로 돌리면 채점 신뢰가 무너진다.
 */
const CONFIDENCE_FACTOR: Record<Confidence, number> = { A: 1, B: 0.5, C: 0 }

/** 손절폭 판정 하한/상한 (ATR 배수)과 감점 폭 (스펙 7.1) */
const RISK_ATR_MIN = 0.5
const RISK_ATR_MAX = 4
const RISK_PENALTY = 15
/** 구조적 손절 가산 */
const STRUCTURAL_BONUS = 5
/** R:R 하한과 감점 폭 */
const MIN_RR = 1.5
const RR_PENALTY = 10

/** 두 축 모두 이 비율 이상이어야 "잘한 매매" 라고 부른다 */
const WELL_REASONED_RATIO = 0.7
/** 프로세스 합계가 이 비율에 못 미치면 이긴 매매도 "운" 이다 */
const LUCKY_PROCESS_RATIO = 0.5

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))

/**
 * 완전순서 비교자. 채점이 결정론적이어야 같은 답안이 항상 같은 점수를 받는다.
 *
 * 무게 → barIndex 최신 → id 사전순까지가 스펙 8.2 가 정한 규약이고, 마지막
 * evidence 비교는 "같은 태그가 같은 봉에서 같은 강도로 두 번 나온" 이론적 경우까지
 * 입력 배열 순서에 기대지 않게 하려는 마무리다.
 */
const byPriority = (a: ActiveSignal, b: ActiveSignal): number =>
  signalWeight(b) - signalWeight(a) ||
  b.barIndex - a.barIndex ||
  a.id.localeCompare(b.id) ||
  a.evidence.localeCompare(b.evidence)

/**
 * 감점 대상이 되는 '핵심 근거' 상위 K개. **태그 하나가 슬롯 하나를 차지한다.**
 *
 * 같은 id 로 여러 인스턴스가 동시에 살아 있는 것이 예외가 아니라 정상이다 — 실측에서
 * 실제로 출제된 문제 104개가 **전부** 중복을 가졌고, 원본 13.5개가 고유 9.1개로
 * 접혔다(오더블록·스윕·FVG 가 주범이다. 수명이 zone(50)/recent(14) 라 여러 개가 겹쳐
 * 산다). 인스턴스 단위로 상위 K개를 자르면 K개 슬롯이 한두 태그로 다 채워져서, 예를
 * 들어 유효 근거 15개짜리 자리의 핵심이 태그 2종으로 쪼그라든다. 그러면 감점 분모가
 * 2가 되어 채점이 태그 한둘에 극단적으로 민감해진다.
 *
 * 답안(Answer.tags)이 애초에 **태그 id 의 집합**이므로, 채점 가능한 단위도 태그다.
 * 그래서 id 당 대표 인스턴스(가중치 최대 → barIndex 최신) 하나로 접은 뒤 K개를 자른다.
 */
export function coreSignals(active: ActiveSignal[], k: number): ActiveSignal[] {
  const limit = Math.max(0, Math.floor(k))
  if (limit === 0) return []

  // 전체를 완전순서로 세운 뒤 id 별 첫 등장만 취한다 — 이러면 "대표 고르기" 와
  // "상위 K개 고르기" 가 같은 비교자 하나로 결정되고, 입력 순서에 의존하지 않는다.
  const ranked = [...active].sort(byPriority)
  const seen = new Set<string>()
  const out: ActiveSignal[] = []
  for (const s of ranked) {
    if (seen.has(s.id)) continue
    seen.add(s.id)
    out.push(s)
    if (out.length === limit) break
  }
  return out
}

/** 태그 id → 그 시점에 살아 있는 인스턴스 중 최대 가중치 */
function weightByTag(active: ActiveSignal[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const s of active) {
    const w = signalWeight(s)
    const prev = m.get(s.id)
    if (prev === undefined || w > prev) m.set(s.id, w)
  }
  return m
}

/**
 * 헛다리 하나의 감점 (스펙 6.7).
 *
 * taxonomy 에 아예 없는 id 는 A 로 본다. 등급을 몰라서 봐주는 것이 아니라, 존재
 * 자체를 확인할 방법이 없는 주장이 가장 센 헛다리이기 때문이다 — 조용히 무시하면
 * 오타나 UI 버그로 들어온 태그가 채점에서 사라진다.
 */
export function falseClaimPenalty(tagId: string): number {
  const confidence = TAG_BY_ID.get(tagId)?.confidence ?? 'A'
  return FALSE_CLAIM_PENALTY * CONFIDENCE_FACTOR[confidence]
}

function gradeDirection(correct: Direction, answered: Direction): number {
  if (correct === 'flat') return answered === 'flat' ? 30 : 5
  if (answered === correct) return 30
  if (answered === 'flat') return 12   // 기회는 놓쳤으나 손실은 없다
  return 0
}

/**
 * 실행 축 40점.
 *
 * **은닉 구간을 절대 읽지 않는다.** 스펙 7.1 의 표는 실행 축에 "실제 재생 PnL·R" 을
 * 포함한다고 적었지만, 스펙 7.2 는 프로세스(근거+실행)와 결과를 분리하는 것이 이
 * 모듈의 존재 이유라고 적는다. 재생 결과를 실행 점수에 섞으면 프로세스 점수가 결과를
 * 품게 되어 "잘 하고 졌다" 와 "운으로 이겼다" 를 구분할 수 없다 — 두 조항이 충돌할 때
 * 7.2 를 택했다. 재생 결과는 GradeReport.replay 로 따로 나간다.
 *
 * 이 성질은 테스트로 고정돼 있다("은닉 구간을 바꿔도 프로세스 점수는 변하지 않는다").
 * 아래에서 candles 를 decisionIndex 까지 잘라 쓰는 것도 같은 이유다 — ATR 은 원래
 * 인과적이라 자르지 않아도 값이 같지만, 잘라 두면 실수로 미래를 읽는 코드가 들어올 수 없다.
 */
type ExecutionResult = {
  score: number
  /** 이 답안에서 실행 축의 적용 만점. 0 이면 판정 대상이 아니다(관망) */
  max: number
  notes: string[]
  /** 주문이 주문으로 성립하는가. false 면 재생 결과의 손익을 사실로 말해선 안 된다 */
  orderValid: boolean
}

function gradeExecution(q: Question, a: Answer): ExecutionResult {
  const notes: string[] = []

  if (a.direction === 'flat') {
    // 실행하지 않았으니 실행을 탓할 것도 없다. 관망이 틀린 판단이었다면 그것은
    // 방향 축이 12점/30점으로 처리한다 — 같은 잘못을 두 축에서 두 번 깎지 않는다.
    //
    // 그렇다고 만점을 주지도 않는다. "감점하지 않는다" 와 "만점을 준다" 는 다른
    // 연산이다. 만점을 주면 아무것도 재지 않은 축에서 40점이 나와, 아무 분석도 하지
    // 않은 답안이 100점 만점에 52점을 받는다. 축 자체를 판정 대상에서 빼고
    // (max 0) 총점을 적용 만점 기준으로 환산한다.
    notes.push('관망 — 실행 판정 없음')
    return { score: 0, max: 0, notes, orderValid: true }
  }
  if (a.entry === undefined || a.stopLoss === undefined) {
    notes.push(
      a.entry === undefined
        ? '진입가가 없어 실행을 평가할 수 없다'
        : '손절가가 없어 실행을 평가할 수 없다',
    )
    return { score: 0, max: EXECUTION_MAX, notes, orderValid: false }
  }

  const { entry, stopLoss, takeProfit } = a
  const isLong = a.direction === 'long'

  // 방향과 손절 위치가 어긋난 답안은 감점이 아니라 실격이다. |entry − stopLoss| 로
  // 위험을 재면 손절이 진입가 반대편에 있어도 멀쩡한 값이 나와서, 롱인데 손절이
  // 위에 있는(= 주문으로 성립하지 않는) 답안이 만점을 받는다. 게다가 replay 의
  // R 환산은 그런 답안에 +1R 을 돌려주므로, 여기서 걸러내지 않으면 채점기가
  // "존재할 수 없는 매매의 이익" 을 그대로 실어 나른다.
  const risk = isLong ? entry - stopLoss : stopLoss - entry
  if (risk <= 0) {
    notes.push(
      isLong
        ? `손절가 ${stopLoss} 가 진입가 ${entry} 아래가 아니다 — 롱 주문으로 성립하지 않는다`
        : `손절가 ${stopLoss} 가 진입가 ${entry} 위가 아니다 — 숏 주문으로 성립하지 않는다`,
    )
    return { score: 0, max: EXECUTION_MAX, notes, orderValid: false }
  }

  const visible = q.candles.slice(0, q.decisionIndex + 1)
  let score = EXECUTION_MAX

  // ── 손절폭 (ATR 배수) ──
  const a14 = atr(visible, 14)[q.decisionIndex]
  if (Number.isFinite(a14) && a14 > 0) {
    const riskAtr = risk / a14
    if (riskAtr < RISK_ATR_MIN) {
      score -= RISK_PENALTY
      notes.push(`손절폭 ${riskAtr.toFixed(2)} ATR — 노이즈에 털릴 자리`)
    } else if (riskAtr > RISK_ATR_MAX) {
      score -= RISK_PENALTY
      notes.push(`손절폭 ${riskAtr.toFixed(2)} ATR — 너무 넓다`)
    } else {
      notes.push(`손절폭 ${riskAtr.toFixed(2)} ATR — 무난`)
    }
  } else {
    // 워밍업이 모자라 ATR 이 확정되지 않은 창. 모르는 것을 아는 척하지 않는다.
    notes.push('ATR 이 확정되지 않아 손절폭을 판정하지 않는다')
  }

  // ── 구조적 손절 ──
  // 가산이지 감점의 반대가 아니다. 시작이 이미 만점이므로 이 +5 는 위의 감점을
  // 일부 되돌리는 역할만 한다 (아래 clamp).
  const pivots = findPivots(visible)
  const lastPivot = (kind: 'high' | 'low') => [...pivots].reverse().find((p) => p.kind === kind)
  const lastLow = lastPivot('low')
  const lastHigh = lastPivot('high')
  if (isLong && lastLow && stopLoss < lastLow.price) {
    score += STRUCTURAL_BONUS
    notes.push(`직전 스윙 로우 ${fmtPrice(lastLow.price)} 아래 — 구조적 손절`)
  }
  if (!isLong && lastHigh && stopLoss > lastHigh.price) {
    score += STRUCTURAL_BONUS
    notes.push(`직전 스윙 하이 ${fmtPrice(lastHigh.price)} 위 — 구조적 손절`)
  }

  // ── R:R ──
  // 익절가가 없으면 감점한다. 없는 것을 그냥 넘기면 "목표를 안 적는 쪽" 이 R:R 감점을
  // 피해서 이득을 본다 — 목표 없는 계획이 나쁜 목표보다 나은 답이 될 수는 없다.
  const reward = takeProfit === undefined ? undefined : (isLong ? takeProfit - entry : entry - takeProfit)
  if (reward === undefined) {
    score -= RR_PENALTY
    notes.push('익절가가 없어 R:R 을 판정할 수 없다')
  } else if (reward <= 0) {
    score -= RR_PENALTY
    notes.push(`익절가 ${takeProfit} 가 진입가 ${entry} 의 반대편이다 — 목표로 성립하지 않는다`)
  } else {
    const rr = reward / risk
    if (rr < MIN_RR) {
      score -= RR_PENALTY
      notes.push(`R:R ${rr.toFixed(2)} — ${MIN_RR} 미만`)
    } else {
      notes.push(`R:R ${rr.toFixed(2)}`)
    }
  }

  return { score: clamp(score, 0, EXECUTION_MAX), max: EXECUTION_MAX, notes, orderValid: true }
}

/**
 * 근거 축 30점 — 핵심/참고 2단 (스펙 8.2).
 *
 * 감점은 **핵심 놓침과 헛다리에만** 적용한다. 참고(유효하지만 핵심이 아닌 미체크
 * 근거)는 목록으로만 보여준다 — 유효 근거가 8~15개인데 미체크 전부를 지적하면
 * "놓쳤다" 가 매 문제 10개씩 찍혀 신호가 되지 못한다.
 *
 * 커버리지를 개수가 아니라 **가중치**로 잰다. 핵심 계층이 존재하는 이유 자체가
 * "무게가 큰 근거" 라서, 12점짜리 스윕을 놓친 것과 2점짜리 도지를 놓친 것을 같은
 * 1/K 로 처리하면 계층을 나눈 의미가 절반 사라진다.
 *
 * 참고를 맞게 짚어도 점수는 오르지 않는다. 참고 적중을 분모·분자에 함께 넣으면
 * 커버리지가 1로 끌려가서 "전부 체크" 가 최적 전략이 되고, 그러면 이 축은 아무것도
 * 측정하지 못한다. 대신 적중 자체는 verdict.hits 에 전부 남아 리포트에 나간다.
 */
export function gradeEvidence(
  active: ActiveSignal[], tags: string[], coreK: number,
): { score: number; coreCount: number; verdict: EvidenceVerdict } {
  const weights = weightByTag(active)
  const checked = new Set(tags)                 // 같은 태그를 두 번 체크해도 한 번이다
  const core = coreSignals(active, coreK)
  const coreIds = new Set(core.map((s) => s.id))

  // 표시 순서를 무게 내림차순으로 고정한다 — 리포트가 중요한 것부터 읽히고,
  // 답안의 체크 순서 같은 우연한 입력 순서가 결과물에 새지 않는다.
  const byWeight = (x: string, y: string) => (weights.get(y) ?? 0) - (weights.get(x) ?? 0) || x.localeCompare(y)
  const alpha = (x: string, y: string) => x.localeCompare(y)

  const hits = [...checked].filter((t) => weights.has(t)).sort(byWeight)
  const falseClaims = [...checked].filter((t) => !weights.has(t)).sort(alpha)
  const coreMisses = [...coreIds].filter((t) => !checked.has(t)).sort(byWeight)
  const reference = [...weights.keys()].filter((t) => !checked.has(t) && !coreIds.has(t)).sort(byWeight)

  const coreTotal = core.reduce((acc, s) => acc + signalWeight(s), 0)
  const coreHit = core.reduce((acc, s) => acc + (checked.has(s.id) ? signalWeight(s) : 0), 0)
  // 핵심이 없는 자리(유효 근거가 아예 없거나 coreK 가 0)의 커버리지는 1이다.
  // 짚을 것이 없는 자리에서 아무것도 짚지 않은 것은 정답이지 0점이 아니다.
  const coverage = coreTotal > 0 ? coreHit / coreTotal : 1

  const penalty = falseClaims.reduce((acc, t) => acc + falseClaimPenalty(t), 0)
  const score = clamp(Math.round(EVIDENCE_MAX * coverage - penalty), 0, EVIDENCE_MAX)

  // coreCount 를 함께 낸다 — grade 가 coreSignals 를 한 번 더 부르지 않도록.
  return { score, coreCount: coreIds.size, verdict: { hits, coreMisses, reference, falseClaims } }
}

const fmtR = (r: number) => `${r >= 0 ? '+' : ''}${r.toFixed(1)}R`

/** 재생 결과를 사실 그대로 옮긴 한 구절. 일어나지 않은 일을 말하지 않는다. */
function exitPhrase(rep: ReplayResult): string {
  switch (rep.exit) {
    case 'sl':     return `손절당했습니다(${fmtR(rep.r)})`
    case 'tp':     return `익절했습니다(${fmtR(rep.r)})`
    case 'forced': return `은닉 구간이 끝날 때까지 청산되지 않아 마지막 종가로 정리했습니다(${fmtR(rep.r)})`
    case 'none':   return '체결되지 않았습니다'
  }
}

/**
 * 프로세스와 결과를 갈라 말하는 한 문장 (스펙 7.2).
 *
 * **여기 들어가는 모든 사실은 측정값이어야 한다.** 브리프 초안은 프로세스 합계가
 * 50 이상이면 "손절 위치 적절" 이라고 단정했는데, 근거 30 + 실행 20 이면 합계 50 이면서
 * 실행 축은 손절폭 감점과 R:R 감점을 둘 다 맞은 상태다 — 채점기가 자기가 방금 깎은
 * 항목을 칭찬하게 된다. 그래서 판정은 합계가 아니라 **두 축 각각**이 기준을 넘었는지로
 * 가르고, 문장에는 실제 점수와 실제 청산 사유만 적는다.
 */
function judge(
  a: Answer, rep: ReplayResult, exec: ExecutionResult,
  evidenceScore: number, directionScore: number,
  coreHitCount: number, coreCount: number, falseClaimCount: number,
): string {
  const executionScore = exec.score
  const processScore = evidenceScore + executionScore
  // 관망이면 실행 축이 판정 대상이 아니므로 원장에서도 뺀다. "실행 0/40" 이라고 적으면
  // 재지도 않은 축에서 0점을 받은 것처럼 읽힌다.
  const ledger = exec.max === 0
    ? `프로세스 ${evidenceScore}/${EVIDENCE_MAX} (근거만 — 실행은 판정 대상 아님), ` +
      `결과 ${directionScore}/${DIRECTION_MAX}.`
    : `프로세스 ${processScore}/${PROCESS_MAX} (근거 ${evidenceScore}/${EVIDENCE_MAX} · ` +
      `실행 ${executionScore}/${EXECUTION_MAX}), 결과 ${directionScore}/${DIRECTION_MAX}.`

  if (a.direction === 'flat') return `관망했으므로 체결도 손익도 없습니다. ${ledger}`

  // 주문으로 성립하지 않는 답안에는 손익을 말하지 않는다. replay 의 R 환산은 손절이
  // 진입가 반대편에 있어도 숫자를 돌려주므로(롱인데 손절이 위면 +1R), 그 값을 사실로
  // 옮기면 채점기가 자기가 방금 실격시킨 주문의 이익을 보고하게 된다.
  if (!exec.orderValid) {
    return `${exec.notes[0]}. 성립하지 않는 주문이라 손익을 따지지 않습니다. ${ledger}`
  }
  if (!rep.filled) {
    return a.entry === undefined
      ? `진입가가 없어 체결을 따질 수 없습니다. ${ledger}`
      : `진입가 ${a.entry} 에 가격이 닿지 않아 체결되지 않았습니다. ${ledger}`
  }

  const wellReasoned =
    evidenceScore >= EVIDENCE_MAX * WELL_REASONED_RATIO &&
    executionScore >= EXECUTION_MAX * WELL_REASONED_RATIO
  const evidenceLedger = `근거 핵심 ${coreHitCount}/${coreCount} 적중`

  if (wellReasoned && rep.r < 0) {
    return (
      `${evidenceLedger}, 실행 ${executionScore}/${EXECUTION_MAX} — 그런데 ${exitPhrase(rep)}. ` +
      `**이건 잘한 매매입니다.** 같은 자리에 100번 들어가면 수익이 남습니다.`
    )
  }
  if (processScore < PROCESS_MAX * LUCKY_PROCESS_RATIO && rep.r > 0) {
    return (
      `결과는 ${fmtR(rep.r)} 인데 ${evidenceLedger} · 헛다리 ${falseClaimCount}개, ` +
      `실행 ${executionScore}/${EXECUTION_MAX} 입니다. ` +
      `**운입니다.** 같은 매매를 반복하면 계좌가 녹습니다.`
    )
  }
  return `${ledger} ${exitPhrase(rep)}.`
}

/**
 * 3축 채점 — 방향 30 / 실행 40 / 근거 30.
 *
 * **채점기는 Question 전체를 읽는 쪽이다.** 은닉 봉이 필요한 것은 정답 방향
 * (classifyOutcome)과 재생(replay) 둘뿐이고, 나머지 두 축은 decisionIndex 까지만
 * 잘라서 쓴다. q.type 은 읽지 않는다 — 정답 방향은 은닉 구간에서 직접 다시 뽑으므로
 * 출제 시점의 라벨에 기대지 않는다.
 */
export function grade(q: Question, a: Answer, opts: { coreK?: number } = {}): GradeReport {
  const coreK = opts.coreK ?? DEFAULT_CORE_K
  const hiddenCount = q.candles.length - q.decisionIndex - 1

  // 정답 근거는 결정 시점까지만 보고 뽑는다. 자른 배열을 넘기는 것이 규약이자 방어선이다.
  const active = activeSignalsAt(q.candles.slice(0, q.decisionIndex + 1), q.decisionIndex)
  const { direction: correct } = classifyOutcome(q.candles, q.decisionIndex, hiddenCount)
  const rep = replay(q, a)

  const direction = { correct, answered: a.direction, score: gradeDirection(correct, a.direction) }
  const execution = gradeExecution(q, a)
  const evidence = gradeEvidence(active, a.tags, coreK)

  const coreCount = evidence.coreCount
  const coreHitCount = coreCount - evidence.verdict.coreMisses.length

  const processScore = evidence.score + execution.score
  const outcomeScore = direction.score

  // 판정 대상이 된 축들의 만점. 관망이면 실행 축이 빠져 60(방향 30 + 근거 30)이다.
  const applicableMax = DIRECTION_MAX + EVIDENCE_MAX + execution.max
  const raw = direction.score + execution.score + evidence.score
  // 적용 만점을 100점으로 환산한다. 진입 답안은 applicableMax 가 100 이라 항등이고,
  // 관망 답안만 60 기준으로 늘어난다. Math.round 로 고정해 같은 입력이 항상 같은
  // 정수를 내게 한다 — 60 분모에서는 정수로 안 떨어지는 조합이 흔하다.
  const totalScore = Math.round((raw / applicableMax) * 100)

  return {
    direction,
    execution,
    evidence,
    processScore,
    processMax: EVIDENCE_MAX + execution.max,
    outcomeScore,
    applicableMax,
    totalScore,
    judgement: judge(
      a, rep, execution, evidence.score, direction.score,
      coreHitCount, coreCount, evidence.verdict.falseClaims.length,
    ),
    // 성립하지 않는 주문에는 재생 결과를 싣지 않는다. judge 가 손익을 말하지 않게
    // 막아도, 리포트가 report.replay.r 을 직접 그리면 같은 거짓이 다른 경로로 나간다.
    replay: execution.orderValid ? rep : null,
  }
}
