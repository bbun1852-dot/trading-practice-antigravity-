import type { Candle, Timeframe } from '../data/types'

export type Direction = 'long' | 'short' | 'flat'
export type QuestionType = 'normal' | 'trap' | 'no_setup'
export type Difficulty = 'easy' | 'medium' | 'hard'

export type SetupCandidate = {
  barIndex: number
  setupScore: number
  difficulty: Difficulty
  /** 유효 근거의 가중 합이 큰 쪽 */
  dominantSide: 'bullish' | 'bearish' | 'neutral'
  activeCount: number
}

/**
 * 채점기·재생기(replay)가 쓰는 전체 레코드. **솔버에게 그대로 넘기면 안 된다** —
 * candles 에 은닉 구간이 그대로 들어 있고, symbol/startTime/type 이 최상위
 * 필드로 노출돼 있다. 솔버가 볼 수 있는 부분만 꺼내려면 generator.ts 의
 * solverView() 를, 채점 뒤에만 공개할 값은 revealed() 를 쓴다 — 이 객체를
 * 직접 JSON.stringify 해서 클라이언트로 보내지 않는다.
 */
export type Question = {
  /** 채점 뒤에만 공개 — revealed() 를 거친다 */
  symbol: string
  timeframe: Timeframe
  /**
   * 창 첫 봉의 time (초). {symbol, timeframe, startTime, decisionIndex} 가 재현 키다.
   * 채점 뒤에만 공개 — revealed() 를 거친다.
   */
  startTime: number
  /** 창 내 인덱스. 이 봉까지가 사용자에게 보인다 */
  decisionIndex: number
  /**
   * 함정/노셋업 여부는 은닉 구간(classifyOutcome)에서 파생된다 — 근거를 하나도
   * 안 짚고 이 값만 보고도 답을 뒤집어 맞힐 수 있다. 채점 뒤에만 공개 —
   * revealed() 를 거친다.
   */
  type: QuestionType
  /**
   * 결정 시점의 유효 근거만으로 계산한다(activeSignalsAt 이 미래 신호를 아예
   * 걸러낸다) — type 과 달리 은닉 구간과 무관하고, 풀기 전에 보여줘도 안전하다.
   */
  difficulty: Difficulty
  /** 은닉 구간을 포함한 창 전체. 솔버에게는 decisionIndex 까지만 잘라서 보여준다(solverView) */
  candles: Candle[]
}

/**
 * 솔버가 풀 때 실제로 볼 수 있는 전부. Question 의 일부를 가린 것이 아니라 별도
 * 타입이다 — symbol·startTime·type·decisionIndex 필드 자체가 없고, candles 에는
 * 은닉 봉이 원천적으로 없다(길이가 곧 결정 인덱스+1이다). 이 값을 들고 있는
 * 코드는 원본 Question 을 함께 갖고 있지 않은 한 정답 관련 정보에 접근할 방법이
 * 없다 — generator.ts 의 solverView() 로만 만든다.
 */
export type SolverView = {
  timeframe: Timeframe
  difficulty: Difficulty
  /** decisionIndex 까지만. 마지막 원소가 곧 결정 봉이다 */
  candles: Candle[]
}

export type Answer = {
  direction: Direction
  entry?: number
  stopLoss?: number
  takeProfit?: number
  /** 체크한 태그 id. 최대 15개 */
  tags: string[]
  memo?: string
}

export type ReplayResult = {
  filled: boolean
  exit: 'tp' | 'sl' | 'forced' | 'none'
  exitBarIndex: number | null
  pnlPct: number
  /** 손실 1R 기준 배수. 손절폭이 0이면 0 */
  r: number
}

export type EvidenceVerdict = {
  /** 체크했고 유효한 근거 */
  hits: string[]
  /** 핵심 근거인데 체크하지 않음 — 감점 대상 */
  coreMisses: string[]
  /** 유효하지만 핵심이 아닌 미체크 근거 — 감점 없음 */
  reference: string[]
  /** 체크했으나 그 시점에 존재하지 않은 근거 */
  falseClaims: string[]
}

export type GradeReport = {
  direction: { correct: Direction; answered: Direction; score: number }
  /**
   * max 가 0이면 그 답안에서 실행 축은 **판정 대상이 아니다**(관망). 0점을 받은 것이
   * 아니라 잴 것이 없었다는 뜻이므로, 화면에 "0/40" 으로 그리면 안 된다.
   */
  execution: { score: number; max: number; notes: string[]; orderValid: boolean }
  evidence: { score: number; verdict: EvidenceVerdict }
  /** 근거 + 실행. 은닉 구간을 한 톨도 읽지 않고 나온 값이다 (스펙 7.2) */
  processScore: number
  /** 근거 + 실행의 적용 만점. 관망이면 실행 축이 빠져 30이다 */
  processMax: number
  /**
   * 결과 축 = 방향 점수. 재생 결과(R·PnL)는 여기 더하지 않고 replay 로 따로 낸다 —
   * 스케일이 다르고, 섞으면 "프로세스와 결과의 분리" 가 한쪽으로 무너진다.
   */
  outcomeScore: number
  /**
   * 판정 대상이 된 축들의 만점 합. 진입 답안은 100, 관망 답안은 60(방향 30 + 근거 30)이다.
   *
   * **이 필드 없이 totalScore 만 보면 환산된 수를 고정 100점 만점으로 오해한다.**
   * 관망 20점과 진입 20점은 같은 20이 아니다 — 앞은 두 축에서 60점 중 12점을 받아
   * 환산된 값이고 뒤는 세 축에서 실제로 20점을 받은 값이다. 리포트는 반드시 이 값을
   * 함께 그려야 한다.
   */
  applicableMax: number
  /** applicableMax 를 100점으로 환산한 값. 진입 답안에서는 세 축의 단순 합과 같다 */
  totalScore: number
  judgement: string
  replay: ReplayResult
}
