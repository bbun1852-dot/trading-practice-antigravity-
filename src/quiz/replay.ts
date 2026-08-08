import type { Answer, Question, ReplayResult } from './types'

/** 재생 대상이 없을 때 공통으로 쓰는 값 — 관망, 미체결, 필수 가격 누락이 전부 여기로 모인다. */
const NONE: ReplayResult = { filled: false, exit: 'none', exitBarIndex: null, pnlPct: 0, r: 0 }

/**
 * 은닉 구간(decisionIndex 다음 봉부터)을 봉 단위로 재생해 체결·청산을 시뮬레이션한다.
 *
 * **채점기 전용 소비자다** — `q.candles` 전체(은닉 봉 포함)를 그대로 읽는다.
 * `solverView(q)` 를 거치지 않는다: 그건 솔버가 풀 때 보는 투영을 만드는 함수고,
 * `replay` 는 답을 이미 받은 뒤 "실제로 어떻게 됐을지"를 계산하는 채점 쪽 로직이다.
 *
 * **체결 규칙(지정가 진입).** 봉의 [low, high] 구간이 entry 가격을 포함하면 그 봉에서
 * 체결된 것으로 본다.
 *
 * **같은 봉에서 체결과 SL/TP 판정이 함께 일어날 수 있다 — 의도적 선택이다.**
 * 방금 체결된 봉이라도, 그 봉의 고가·저가가 SL/TP 를 건드리면 그 자리에서 바로
 * 청산한다(체결을 다음 봉으로 미루지 않는다). 근거: 체결 조건
 * `low <= entry <= high` 가 성립했다는 건 그 봉 안에서 가격이 실제로 entry 를
 * 지나갔다는 뜻이고, 같은 봉의 저가/고가가 SL/TP 에도 닿았다면 그 역시 그 봉 안에서
 * 실제로 있었던 일이다. 체결 봉과 청산 봉을 인위적으로 분리해 청산 판정을 다음
 * 봉까지 미루면, 그 봉 안에서 실제로 발생했을 손실(혹은 이익)을 누락시켜 오히려
 * 채점을 실제보다 후하게 만든다 — "결정 시점부터 하나도 안 놓치고 다 본다"는
 * 이 함수의 존재 이유와 어긋난다. 4시간·일봉처럼 굵은 타임프레임에서는 진입과
 * 청산이 한 봉 안에서 같이 일어나는 일이 드물지 않다.
 *
 * **같은 봉에서 SL 과 TP 를 모두 터치하면 SL 이 우선한다.** 봉 안의 체결 순서는
 * OHLC 만으로는 알 수 없고, 유리한 쪽을 가정하면 채점이 실제보다 후해진다 —
 * 불리한(보수적인) 쪽을 택한다.
 */
export function replay(q: Question, a: Answer): ReplayResult {
  if (a.direction === 'flat') return NONE
  // entry/stopLoss 가 없으면 체결 여부도 R 환산도 정의할 수 없다. "언젠가 닿았을
  // 수도 있다"고 얼버무리지 않고, 재생 불가 상태를 무체결과 동일하게 명시적으로
  // 취급한다 — ReplayResult 에는 "답이 불완전함"을 따로 표현할 필드가 없으므로,
  // 이것이 거짓 없이 표현할 수 있는 가장 정직한 값이다.
  if (a.entry === undefined || a.stopLoss === undefined) return NONE

  const { entry, stopLoss, takeProfit } = a
  const isLong = a.direction === 'long'
  const risk = Math.abs(entry - stopLoss)

  const toR = (exitPrice: number): number => {
    // risk===0(SL=entry)이면 R 배수의 분모가 0이라 정의되지 않는다 — NaN/Infinity 가
    // 채점 파이프라인으로 새어나가지 않도록 0으로 고정한다. 이 경우 체결 조건
    // (low<=entry<=high)과 SL 터치 조건(예: 롱은 low<=stopLoss=entry)이 대수적으로
    // 같아져서 체결되는 순간 항상 SL 도 함께 터진다 — exit 은 항상 'sl', r 은 항상
    // 0 으로 결정론적이다(테스트로 고정: "손절폭이 0이면…"). 그래서 손실 0인
    // 트레이드가 'tp' 나 'forced' 로 새서 이익처럼 보일 여지가 없다.
    if (risk === 0) return 0
    return (isLong ? exitPrice - entry : entry - exitPrice) / risk
  }
  const toPct = (exitPrice: number): number =>
    ((isLong ? exitPrice - entry : entry - exitPrice) / entry) * 100

  let filled = false
  let lastIndex = q.decisionIndex

  // 은닉 구간만 재생한다 — decisionIndex 까지는 솔버도 이미 본 화면이므로 재생
  // 대상이 아니다. 루프가 decisionIndex+1 부터 시작하는 것이 그 경계다.
  for (let j = q.decisionIndex + 1; j < q.candles.length; j++) {
    const c = q.candles[j]
    lastIndex = j

    if (!filled) {
      if (c.low <= entry && entry <= c.high) filled = true
      else continue
    }

    const hitSl = isLong ? c.low <= stopLoss : c.high >= stopLoss
    const hitTp = takeProfit !== undefined
      ? (isLong ? c.high >= takeProfit : c.low <= takeProfit)
      : false

    // SL 을 먼저 검사한다 — 순서 자체가 "동시 터치 시 SL 우선" 규칙의 구현이다.
    if (hitSl) {
      return { filled: true, exit: 'sl', exitBarIndex: j, pnlPct: toPct(stopLoss), r: toR(stopLoss) }
    }
    if (hitTp) {
      return { filled: true, exit: 'tp', exitBarIndex: j, pnlPct: toPct(takeProfit!), r: toR(takeProfit!) }
    }
  }

  if (!filled) return NONE

  // 은닉 구간이 끝나도록 SL/TP 어느 쪽도 안 터지면, 마지막 봉의 종가로 강제 청산한다.
  const close = q.candles[lastIndex].close
  return { filled: true, exit: 'forced', exitBarIndex: lastIndex, pnlPct: toPct(close), r: toR(close) }
}
