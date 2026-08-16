/**
 * 상태 머신 테스트용 합성 문제.
 *
 * 화면 공급은 Task 4 의 파이프라인(pipeline.ts)이 맡는다 — 여기 남은 이유는
 * store.test.ts 가 **네트워크도 스캔도 없이** 전이를 돌려 보기 위해서다.
 * 구조는 진짜다: solverView(q) 가 이 위에서 실제로 돌므로 은닉 경계(decisionIndex)는
 * 실제 규약대로 동작한다.
 */
import { synthCandles } from '../../analysis/fixtures'
import type { Question } from '../../quiz/types'

export function stubQuestion(seed = 7): Question {
  const candles = synthCandles(400, seed)
  return {
    symbol: 'STUB',
    timeframe: '4h',
    startTime: candles[0].time,
    decisionIndex: 339,
    type: 'normal',
    difficulty: 'medium',
    candles,
    htfCandles: [],
  }
}
