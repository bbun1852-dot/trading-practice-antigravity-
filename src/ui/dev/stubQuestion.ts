/**
 * 골격 단계의 스텁 문제 — **Task 4(문제 생성 파이프라인)가 대체한다.**
 *
 * 상태 머신과 화면 전이를 dev 서버에서 검증하려면 answering 으로 들어갈
 * 문제가 필요한데, 실제 파이프라인(fetch → scan → makeQuestion)은 Task 4 의
 * 일이다. synthCandles 는 엔진의 픽스처라 브라우저에서 그대로 돈다.
 *
 * 스텁이어도 구조는 진짜다 — solverView(q) 가 실제로 이 위에서 돌므로
 * 은닉 경계(decisionIndex)는 실제 규약대로 동작한다.
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
